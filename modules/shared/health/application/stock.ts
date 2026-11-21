// Health Connect › Medicines & Stock (rule book §13.9): the health room's medicines by batch,
// earliest expiry used first, every receipt, dose and discard logged for ever. For the medical
// role (`health.stock.manage`). Doses may name the sick-room visit; no student is stored here.
import { withTenant, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, Resource } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { EXPIRY_WARNING_DAYS, takeFromBatches, type Batch } from '../domain/health.js';
import { HealthError, type HealthDeps } from './health.js';

export class StockError extends Error {
  constructor(
    readonly code:
      | 'medicine_not_found'
      | 'batch_not_found'
      | 'duplicate_medicine'
      | 'not_enough_stock'
      | 'already_expired'
      | 'visit_not_found',
  ) {
    super(`health stock: ${code}`);
    this.name = 'StockError';
  }
}

async function place(tx: Tx, actor: Actor, institutionId: string): Promise<Resource> {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new HealthError('institution_not_found');
  return { orgId: actor.orgId, place: p };
}
const resourceAt = (deps: HealthDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, (tx) => place(tx, actor, institutionId));

async function medicineAt(tx: Tx, institutionId: string, medicineId: string) {
  const [m] = await tx.execute<{ id: string; name: string }>(sql`
    select id::text, name from health_medicine
    where org_id = app_current_org() and id = ${medicineId} and institution_id = ${institutionId}`);
  if (!m) throw new StockError('medicine_not_found');
  return m;
}

export type MedicineRow = {
  id: string;
  name: string;
  unit: string;
  reorderLevel: number;
  active: boolean;
  /** Usable now: not expired. */
  inStock: number;
  /** Units in batches expiring within the warning window. */
  expiringSoon: number;
  nextExpiry: string | null;
  low: boolean;
};

/** The health room's medicines with what's usable, what's expiring and what's low. */
export async function medicines(
  deps: HealthDeps,
  actor: Actor,
  institutionId: string,
): Promise<MedicineRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'health.stock.manage',
      await place(tx, actor, institutionId),
    );
    const rows = await tx.execute<Omit<MedicineRow, 'low'>>(sql`
      select m.id::text, m.name, m.unit, m.reorder_level as "reorderLevel", m.active,
        coalesce(sum(b.remaining) filter (where b.expires_on >= app_today()), 0)::int as "inStock",
        coalesce(sum(b.remaining) filter (where b.expires_on >= app_today()
          and b.expires_on < app_today() + ${EXPIRY_WARNING_DAYS}::int), 0)::int as "expiringSoon",
        min(b.expires_on) filter (where b.remaining > 0 and b.expires_on >= app_today())::text as "nextExpiry"
      from health_medicine m
      left join health_medicine_batch b on b.org_id = m.org_id and b.medicine_id = m.id and b.remaining > 0
      where m.org_id = app_current_org() and m.institution_id = ${institutionId}
      group by m.org_id, m.id order by m.active desc, m.name`);
    return rows.map((r) => ({ ...r, low: r.active && r.inStock <= r.reorderLevel }));
  });
}

export async function saveMedicine(
  deps: HealthDeps,
  actor: Actor,
  input: {
    institutionId: string;
    id?: string | undefined;
    name: string;
    unit: string;
    reorderLevel: number;
    active: boolean;
  },
): Promise<{ id: string }> {
  const resource = await resourceAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'health.stock.manage', resource },
    async (tx) => {
      if (input.id) await medicineAt(tx, input.institutionId, input.id);
      const [dupe] = await tx.execute(sql`
        select 1 from health_medicine where org_id = app_current_org()
          and institution_id = ${input.institutionId} and lower(btrim(name)) = lower(btrim(${input.name}))
          and id is distinct from ${input.id ?? null}::uuid`);
      if (dupe) throw new StockError('duplicate_medicine');
      const [row] = input.id
        ? await tx.execute<{ id: string }>(sql`
            update health_medicine set name = btrim(${input.name}), unit = btrim(${input.unit}),
              reorder_level = ${input.reorderLevel}, active = ${input.active}
            where org_id = app_current_org() and id = ${input.id} returning id::text`)
        : await tx.execute<{ id: string }>(sql`
            insert into health_medicine (org_id, institution_id, name, unit, reorder_level, active)
            values (app_current_org(), ${input.institutionId}, btrim(${input.name}), btrim(${input.unit}),
              ${input.reorderLevel}, ${input.active})
            returning id::text`);
      if (!row) throw new Error('saveMedicine: no row');
      return {
        result: row,
        audit: {
          action: input.id ? 'health.medicine.update' : 'health.medicine.create',
          entityType: 'health_medicine',
          entityId: row.id,
          dataClass: 'operational',
        },
      };
    },
  );
}

/** A new batch arrives with its expiry date. */
export async function receiveStock(
  deps: HealthDeps,
  actor: Actor,
  input: { institutionId: string; medicineId: string; quantity: number; expiresOn: string },
): Promise<{ batchId: string }> {
  const resource = await resourceAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'health.stock.manage', resource },
    async (tx) => {
      await medicineAt(tx, input.institutionId, input.medicineId);
      const [ok] = await tx.execute<{ ok: boolean }>(
        sql`select ${input.expiresOn}::date > app_today() as ok`,
      );
      if (!ok?.ok) throw new StockError('already_expired');
      const [b] = await tx.execute<{ id: string }>(sql`
        insert into health_medicine_batch (org_id, medicine_id, expires_on, received, remaining)
        values (app_current_org(), ${input.medicineId}, ${input.expiresOn}, ${input.quantity}, ${input.quantity})
        returning id::text`);
      if (!b) throw new Error('receiveStock: no batch');
      await tx.execute(sql`
        insert into health_medicine_move (org_id, medicine_id, batch_id, kind, quantity, by_person_id)
        values (app_current_org(), ${input.medicineId}, ${b.id}, 'receive', ${input.quantity}, ${actor.personId})`);
      return {
        result: { batchId: b.id },
        audit: {
          action: 'health.medicine.receive',
          entityType: 'health_medicine',
          entityId: input.medicineId,
          dataClass: 'operational',
          detail: { quantity: input.quantity, expiresOn: input.expiresOn },
        },
      };
    },
  );
}

/** Gives a dose: earliest-expiring usable batches first. Batches are locked while counting. */
export async function dispense(
  deps: HealthDeps,
  actor: Actor,
  input: {
    institutionId: string;
    medicineId: string;
    quantity: number;
    visitId?: string | undefined;
  },
): Promise<void> {
  const resource = await resourceAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'health.stock.manage', resource },
    async (tx) => {
      await medicineAt(tx, input.institutionId, input.medicineId);
      if (input.visitId) {
        const [v] = await tx.execute(sql`
          select 1 from health_visit where org_id = app_current_org() and id = ${input.visitId}
            and institution_id = ${input.institutionId}`);
        if (!v) throw new StockError('visit_not_found');
      }
      const [today] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
      const batches = await tx.execute<Batch>(sql`
        select id::text, expires_on::text as "expiresOn", remaining from health_medicine_batch
        where org_id = app_current_org() and medicine_id = ${input.medicineId} and remaining > 0
        order by expires_on for update`);
      const takes = takeFromBatches(batches, input.quantity, today?.d ?? '');
      if (!takes) throw new StockError('not_enough_stock');
      for (const t of takes) {
        await tx.execute(sql`
          update health_medicine_batch set remaining = remaining - ${t.quantity}
          where org_id = app_current_org() and id = ${t.batchId}`);
        await tx.execute(sql`
          insert into health_medicine_move (org_id, medicine_id, batch_id, kind, quantity, visit_id, by_person_id)
          values (app_current_org(), ${input.medicineId}, ${t.batchId}, 'dispense', ${t.quantity},
            ${input.visitId ?? null}, ${actor.personId})`);
      }
      return {
        result: undefined,
        audit: {
          action: 'health.medicine.dispense',
          entityType: 'health_medicine',
          entityId: input.medicineId,
          dataClass: 'sensitive',
          detail: { quantity: input.quantity, visitId: input.visitId ?? null },
        },
      };
    },
  );
}

/** Removes expired or damaged units from a batch, with a reason. */
export async function discardStock(
  deps: HealthDeps,
  actor: Actor,
  input: { institutionId: string; batchId: string; quantity: number; reason: string },
): Promise<void> {
  const resource = await resourceAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'health.stock.manage', resource },
    async (tx) => {
      const [b] = await tx.execute<{ medicineId: string; remaining: number }>(sql`
        select b.medicine_id::text as "medicineId", b.remaining from health_medicine_batch b
        join health_medicine m on m.org_id = b.org_id and m.id = b.medicine_id
        where b.org_id = app_current_org() and b.id = ${input.batchId}
          and m.institution_id = ${input.institutionId}
        for update of b`);
      if (!b) throw new StockError('batch_not_found');
      if (b.remaining < input.quantity) throw new StockError('not_enough_stock');
      await tx.execute(sql`
        update health_medicine_batch set remaining = remaining - ${input.quantity}
        where org_id = app_current_org() and id = ${input.batchId}`);
      await tx.execute(sql`
        insert into health_medicine_move (org_id, medicine_id, batch_id, kind, quantity, reason, by_person_id)
        values (app_current_org(), ${b.medicineId}, ${input.batchId}, 'discard', ${input.quantity},
          btrim(${input.reason}), ${actor.personId})`);
      return {
        result: undefined,
        audit: {
          action: 'health.medicine.discard',
          entityType: 'health_medicine',
          entityId: b.medicineId,
          dataClass: 'operational',
          reason: input.reason.trim(),
          detail: { batchId: input.batchId, quantity: input.quantity },
        },
      };
    },
  );
}

export type MedicineDetail = {
  id: string;
  name: string;
  unit: string;
  batches: {
    id: string;
    expiresOn: string;
    received: number;
    remaining: number;
    expired: boolean;
  }[];
  moves: {
    id: string;
    kind: 'receive' | 'dispense' | 'discard';
    quantity: number;
    at: string;
    by: string;
    reason: string | null;
  }[];
};

/** One medicine's batches and its last 50 movements: the dispensing log. */
export async function medicineDetail(
  deps: HealthDeps,
  actor: Actor,
  input: { institutionId: string; medicineId: string },
): Promise<MedicineDetail> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'health.stock.manage',
      await place(tx, actor, input.institutionId),
    );
    const [m] = await tx.execute<{ id: string; name: string; unit: string }>(sql`
      select id::text, name, unit from health_medicine
      where org_id = app_current_org() and id = ${input.medicineId} and institution_id = ${input.institutionId}`);
    if (!m) throw new StockError('medicine_not_found');
    const batches = await tx.execute<MedicineDetail['batches'][number]>(sql`
      select id::text, expires_on::text as "expiresOn", received, remaining, expires_on < app_today() as expired
      from health_medicine_batch where org_id = app_current_org() and medicine_id = ${m.id}
        and remaining > 0 order by expires_on`);
    const moves = await tx.execute<
      Omit<MedicineDetail['moves'][number], 'by'> & { byId: string }
    >(sql`
      select id::text, kind, quantity, at::text, reason, by_person_id::text as "byId"
      from health_medicine_move where org_id = app_current_org() and medicine_id = ${m.id}
      order by at desc limit 50`);
    const names = await displayNames(
      tx,
      moves.map((x) => x.byId),
    );
    return {
      ...m,
      batches,
      moves: moves.map(({ byId, ...x }) => ({ ...x, by: names[byId] ?? '' })),
    };
  });
}
