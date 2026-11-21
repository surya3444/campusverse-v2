// Generic tenant isolation suite. Tables are discovered from the catalogue, so every new
// public table is covered automatically; it fails until the table has RLS and seed rows.
import { loadEnv } from '@campusverse/config';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withTenant } from '../src/client.js';
import { seedTenant, type SeededTenant } from '../src/seed.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);

// The tenant root is keyed by id; every other tenant table by org_id.
const keyOf = (table: string) => (table === 'organisation' ? 'id' : 'org_id');

type TableInfo = { table: string; rls: boolean; force: boolean; has_org_id: boolean };
const tables: TableInfo[] = [
  ...(await db.execute<TableInfo>(sql`
    select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as force,
      exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
      ) as has_org_id
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by 1`)),
];

/** Resolves to the Postgres error code, or undefined if the query succeeded. */
async function errorCode(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
}

const RLS_VIOLATION = '42501'; // insufficient_privilege: RLS WITH CHECK or missing grant

let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  a = await seedTenant(db, 'Isolation A');
  b = await seedTenant(db, 'Isolation B');
});

afterAll(() => close());

describe('application role', () => {
  it('is not a superuser, cannot bypass RLS and owns no tables', async () => {
    const [role] = await db.execute<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      owned: number;
    }>(sql`
      select r.rolsuper, r.rolbypassrls,
        (select count(*)::int from pg_class c where c.relowner = r.oid) as owned
      from pg_roles r where r.rolname = current_user`);
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, owned: 0 });
  });
});

describe('tenant table catalogue', () => {
  it('finds the tenant tables', () => {
    expect(tables.map((t) => t.table)).toEqual(
      expect.arrayContaining(['organisation', 'legal_entity', 'campus', 'institution']),
    );
  });

  it.each(tables)('$table has RLS, FORCE RLS and a tenant key', (t) => {
    expect(t.rls).toBe(true);
    expect(t.force).toBe(true);
    expect(t.table === 'organisation' || t.has_org_id).toBe(true);
  });
});

describe.each(tables.map((t) => t.table))('%s', (table) => {
  const T = sql.identifier(table);
  const K = sql.identifier(keyOf(table));
  const count = (where: ReturnType<typeof sql>) =>
    sql`select count(*)::int as n from ${T} where ${where}`;

  it('tenant sees its own rows', async () => {
    const [row] = await withTenant(db, a.orgId, (tx) =>
      tx.execute<{ n: number }>(count(sql`${K} = ${a.orgId}`)),
    );
    expect(row?.n).toBeGreaterThan(0);
  });

  it('every visible row belongs to the tenant, none to the other', async () => {
    const [row] = await withTenant(db, a.orgId, (tx) =>
      tx.execute<{ n: number }>(count(sql`${K} <> ${a.orgId}`)),
    );
    expect(row?.n).toBe(0);
  });

  it("cannot update the other tenant's rows", async () => {
    // Append-only tables refuse UPDATE outright; the rest must match nothing.
    const outcome = await withTenant(db, a.orgId, (tx) =>
      tx.execute(sql`update ${T} set ${K} = ${K} where ${K} = ${b.orgId}`),
    ).then(
      (r) => r.count,
      (e: { code?: string; cause?: { code?: string } }) => e.cause?.code ?? e.code,
    );
    expect([0, RLS_VIOLATION]).toContain(outcome);
  });

  it("cannot delete the other tenant's rows", async () => {
    const outcome = await withTenant(db, a.orgId, (tx) =>
      tx.execute(sql`delete from ${T} where ${K} = ${b.orgId}`),
    ).then(
      (r) => r.count,
      (e: { code?: string; cause?: { code?: string } }) => e.cause?.code ?? e.code,
    );
    expect([0, RLS_VIOLATION]).toContain(outcome);
  });

  it('cannot insert a row for the other tenant', async () => {
    const code = await errorCode(
      withTenant(db, a.orgId, (tx) =>
        tx.execute(sql`
          insert into ${T}
          select (jsonb_populate_record(null::${T},
            to_jsonb(r) || jsonb_build_object('id', uuidv7())
                        || jsonb_build_object(${keyOf(table)}::text, ${b.orgId}::text))).*
          from ${T} r where r.${K} = ${a.orgId} limit 1`),
      ),
    );
    expect(code).toBe(RLS_VIOLATION);
  });

  it('cannot move its own row to the other tenant', async () => {
    const code = await errorCode(
      withTenant(db, a.orgId, (tx) =>
        tx.execute(sql`update ${T} set ${K} = ${b.orgId} where ${K} = ${a.orgId}`),
      ),
    );
    expect(code).toBe(RLS_VIOLATION);
  });

  it('sees nothing without tenant context', async () => {
    const [row] = await db.transaction((tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from ${T}`),
    );
    expect(row?.n).toBe(0);
  });
});

describe('withTenant', () => {
  it('rejects a non-UUID org id before touching the database', async () => {
    await expect(withTenant(db, "x' or 1=1 --", async () => 1)).rejects.toThrow(/UUID/);
  });

  it('does not leak tenant context to the next query on the same connection', async () => {
    const single = createDb(loadEnv().DATABASE_URL, 1);
    try {
      await withTenant(single.db, a.orgId, async () => undefined);
      const [row] = await single.db.execute<{ org: string | null }>(
        sql`select app_current_org() as org`,
      );
      expect(row?.org).toBeNull();
    } finally {
      await single.close();
    }
  });
});

describe('cross-tenant schemas', () => {
  // ops: worker plumbing. Ids, codes and hashes only; no names, phones or message text.
  it('ops holds only the allowlisted plumbing tables', async () => {
    const rows = await db.execute<{ table: string }>(sql`
      select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'ops' and c.relkind in ('r', 'p') order by 1`);
    expect(rows.map((r) => r.table)).toEqual([
      'admission_form_ref',
      'delivery_ref',
      'document_verification',
      'outbox',
      'payment_ref',
      'processed_event',
      'schema_migration',
      'webhook_event',
    ]);
  });

  it('the app role cannot read the migration ledger', async () => {
    expect(await errorCode(db.execute(sql`select 1 from ops.schema_migration`))).toBe(
      RLS_VIOLATION,
    );
  });

  it('tenant code cannot emit an event for another tenant', async () => {
    const code = await errorCode(
      withTenant(db, a.orgId, (tx) =>
        tx.execute(sql`insert into ops.outbox (org_id, type, payload)
          values (${b.orgId}, 'test.thing.happened.v1', '{}')`),
      ),
    );
    expect(code).toBe(RLS_VIOLATION);
  });
});

describe('append-only tables', () => {
  it.each([
    'audit_event',
    'consent_record',
    'consent_notice',
    'issued_document',
    'verse_request',
    'fee_remittance',
  ])('%s refuses UPDATE and DELETE from the app role', async (table) => {
    const T = sql.identifier(table);
    for (const stmt of [
      sql`update ${T} set org_id = org_id where org_id = ${a.orgId}`,
      sql`delete from ${T} where org_id = ${a.orgId}`,
    ]) {
      expect(await errorCode(withTenant(db, a.orgId, (tx) => tx.execute(stmt)))).toBe(
        RLS_VIOLATION,
      );
    }
  });
});

describe('identity schema', () => {
  // Global by design: read before any tenant is chosen. Anything else here would dodge RLS.
  const GLOBAL_TABLES = [
    'account',
    'account_person_link',
    'login_identifier',
    'mfa_challenge',
    'mfa_secret',
    'session',
    'trusted_device',
  ];

  it('holds only the allowlisted global login tables', async () => {
    const rows = await db.execute<{ table: string }>(sql`
      select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'identity' and c.relkind in ('r', 'p') order by 1`);
    expect(rows.map((r) => r.table)).toEqual(GLOBAL_TABLES);
  });
});

describe('control schema', () => {
  // The super admin's own records. Global like identity; no school data may live here.
  it('holds only the allowlisted admin tables', async () => {
    const rows = await db.execute<{ table: string }>(sql`
      select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'control' and c.relkind in ('r', 'p') order by 1`);
    expect(rows.map((r) => r.table)).toEqual([
      'account_invite',
      'admin_audit',
      'approval',
      'challenge',
      'customer',
      'enrolment',
      'flag',
      'flag_override',
      'incident',
      'incident_customer',
      'passkey',
      'plan',
      'rule_pack_version',
      'session',
      'staff',
      'support_grant',
      'switch',
    ]);
  });

  it('the admin audit refuses UPDATE and DELETE from the app role', async () => {
    for (const stmt of [
      sql`update control.admin_audit set reason = reason`,
      sql`delete from control.admin_audit`,
    ]) {
      expect(await errorCode(db.execute(stmt))).toBe(RLS_VIOLATION);
    }
  });
});
