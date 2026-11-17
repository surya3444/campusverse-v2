import type { Db, Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  MAX_ACTIVE_FIELDS,
  checkDefinition,
  cleanValue,
  keyFromLabel,
  type FieldEntity,
  type FieldType,
  type FieldValue,
  type ValueError,
} from '../domain/values.js';

type Permissions = ReturnType<typeof createPermissions>;

export const FIELD_DEFINED = 'platform.field.defined.v1';

export class FieldError extends Error {
  constructor(
    readonly code: 'label' | 'options' | 'too_many' | 'not_found' | 'values',
    readonly problems: Record<string, ValueError> = {},
  ) {
    super(`fields: ${code}`);
    this.name = 'FieldError';
  }
}

export type Field = {
  id: string;
  entity: FieldEntity;
  key: string;
  label: string;
  help: string | null;
  type: FieldType;
  options: string[];
  required: boolean;
  section: string | null;
  position: number;
  retired: boolean;
};

export type FieldInput = {
  label: string;
  help?: string | null;
  type: FieldType;
  options?: string[];
  required?: boolean;
  section?: string | null;
};

const MANAGE = 'platform.fields.manage';

/** An entity's fields in form order. Definitions are not personal data; values are. */
export async function listFields(
  tx: Tx,
  entity: FieldEntity,
  opts: { includeRetired?: boolean } = {},
): Promise<Field[]> {
  return [
    ...(await tx.execute<Field>(sql`
      select id::text, entity, key, label, help, type, options, required, section, position,
        retired_at is not null as retired
      from custom_field
      where org_id = app_current_org() and entity = ${entity}
        and (${opts.includeRetired ?? false} or retired_at is null)
      order by retired_at nulls first, position, created_at`)),
  ];
}

export async function defineField(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  entity: FieldEntity,
  input: FieldInput,
): Promise<string> {
  const options = (input.options ?? []).map((o) => o.trim());
  const problem = checkDefinition({
    key: 'x',
    label: input.label,
    type: input.type,
    options,
    required: false,
  });
  if (problem) throw new FieldError(problem);
  return command(
    db,
    permissions,
    actor,
    { permission: MANAGE, resource: { orgId: actor.orgId } },
    async (tx) => {
      const [count] = await tx.execute<{ n: number; last: number }>(sql`
      select count(*)::int as n, coalesce(max(position), -1)::int as last from custom_field
      where org_id = app_current_org() and entity = ${entity} and retired_at is null`);
      if ((count?.n ?? 0) >= MAX_ACTIVE_FIELDS) throw new FieldError('too_many');
      // A unique key per entity: blood_group, then blood_group_2 if a retired one holds it.
      const base = keyFromLabel(input.label);
      const taken = new Set(
        (
          await tx.execute<{ key: string }>(sql`
          select key from custom_field where org_id = app_current_org() and entity = ${entity}
            and key like ${`${base}%`}`)
        ).map((r) => r.key),
      );
      let key = base;
      for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
      const [row] = await tx.execute<{ id: string }>(sql`
      insert into custom_field (org_id, entity, key, label, help, type, options, required, section, position)
      values (app_current_org(), ${entity}, ${key}, ${input.label.trim()}, ${input.help?.trim() || null},
        ${input.type}, ${JSON.stringify(options)}::jsonb, ${input.required ?? false},
        ${input.section?.trim() || null}, ${(count?.last ?? -1) + 1})
      returning id::text`);
      if (!row) throw new Error('defineField: insert returned no row');
      return {
        result: row.id,
        audit: {
          action: 'platform.fields.define',
          entityType: 'custom_field',
          entityId: row.id,
          dataClass: 'operational',
          detail: { entity, key, type: input.type },
        },
        events: [{ type: FIELD_DEFINED, payload: { fieldId: row.id, entity, key } }],
      };
    },
  );
}

/** Label, help, options, required and section change; the key and type never do. */
export async function updateField(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  fieldId: string,
  input: Omit<FieldInput, 'type'>,
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    { permission: MANAGE, resource: { orgId: actor.orgId } },
    async (tx) => {
      const [f] = await tx.execute<{ type: FieldType; key: string; entity: string }>(sql`
      select type, key, entity from custom_field where org_id = app_current_org() and id = ${fieldId}`);
      if (!f) throw new FieldError('not_found');
      const options = (input.options ?? []).map((o) => o.trim());
      const problem = checkDefinition({
        key: f.key,
        label: input.label,
        type: f.type,
        options,
        required: false,
      });
      if (problem) throw new FieldError(problem);
      await tx.execute(sql`
      update custom_field set label = ${input.label.trim()}, help = ${input.help?.trim() || null},
        options = ${JSON.stringify(options)}::jsonb, required = ${input.required ?? false},
        section = ${input.section?.trim() || null}
      where org_id = app_current_org() and id = ${fieldId}`);
      return {
        result: undefined,
        audit: {
          action: 'platform.fields.update',
          entityType: 'custom_field',
          entityId: fieldId,
          dataClass: 'operational',
          detail: { entity: f.entity, key: f.key },
        },
      };
    },
  );
}

/** Retiring hides the field from forms; its values stay with the records. Restoring brings it back. */
export async function retireField(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  fieldId: string,
  retired: boolean,
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    { permission: MANAGE, resource: { orgId: actor.orgId } },
    async (tx) => {
      const [f] = await tx.execute<{ key: string; entity: string }>(sql`
      update custom_field set retired_at = ${retired ? sql`now()` : null}
      where org_id = app_current_org() and id = ${fieldId}
      returning key, entity`);
      if (!f) throw new FieldError('not_found');
      return {
        result: undefined,
        audit: {
          action: retired ? 'platform.fields.retire' : 'platform.fields.restore',
          entityType: 'custom_field',
          entityId: fieldId,
          dataClass: 'operational',
          detail: { entity: f.entity, key: f.key },
        },
      };
    },
  );
}

/** Moves fields into the given order (ids not listed keep their place after these). */
export async function orderFields(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  entity: FieldEntity,
  ids: string[],
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    { permission: MANAGE, resource: { orgId: actor.orgId } },
    async (tx) => {
      for (const [i, id] of ids.entries())
        await tx.execute(sql`
        update custom_field set position = ${i}
        where org_id = app_current_org() and entity = ${entity} and id = ${id}`);
      return {
        result: undefined,
        audit: {
          action: 'platform.fields.reorder',
          entityType: 'custom_field',
          dataClass: 'operational',
          detail: { entity, count: ids.length },
        },
      };
    },
  );
}

/** One record's values by field key, for active and retired fields. Call after the owner's read check. */
export async function valuesOf(
  tx: Tx,
  entity: FieldEntity,
  recordId: string,
): Promise<Record<string, FieldValue>> {
  const rows = await tx.execute<{ key: string; value: FieldValue }>(sql`
    select f.key, v.value from custom_field_value v
    join custom_field f on f.org_id = v.org_id and f.id = v.field_id
    where v.org_id = app_current_org() and f.entity = ${entity} and v.record_id = ${recordId}`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * Checks and saves values for one record, inside the owning module's command (which has already
 * checked its own permission and writes the audit row). Keys not given are left as they are;
 * required fields must end up with a value. Returns the keys whose value changed, for the
 * caller's audit detail (keys only, never values).
 */
export async function saveValues(
  tx: Tx,
  entity: FieldEntity,
  recordId: string,
  input: Record<string, unknown>,
  /** Types this form doesn't ask (the public application form has no file upload): not required. */
  opts: { notAsked?: FieldType[] } = {},
): Promise<string[]> {
  const fields = await listFields(tx, entity);
  const current = await valuesOf(tx, entity, recordId);
  const problems: Record<string, ValueError> = {};
  const changes: { field: (typeof fields)[number]; value: FieldValue }[] = [];
  for (const f of fields) {
    const given = Object.hasOwn(input, f.key);
    if (!given && opts.notAsked?.includes(f.type)) continue;
    const cleaned = cleanValue(f, given ? input[f.key] : current[f.key]);
    if (!cleaned.ok) {
      problems[f.key] = cleaned.error;
      continue;
    }
    if (given && JSON.stringify(cleaned.value) !== JSON.stringify(current[f.key] ?? null))
      changes.push({ field: f, value: cleaned.value });
  }
  const unknown = Object.keys(input).filter((k) => !fields.some((f) => f.key === k));
  for (const k of unknown) problems[k] = 'invalid';
  if (Object.keys(problems).length > 0) throw new FieldError('values', problems);

  // A cleared value is stored as JSON null, so the row (and when it changed) stays.
  for (const { field, value } of changes) {
    await tx.execute(sql`
        insert into custom_field_value (org_id, field_id, record_id, value)
        values (app_current_org(), ${field.id}, ${recordId}, ${JSON.stringify(value)}::jsonb)
        on conflict (org_id, field_id, record_id)
        do update set value = excluded.value, updated_at = now()`);
  }
  return changes.map((c) => c.field.key);
}
