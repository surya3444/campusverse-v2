import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url: string, poolSize = 10): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max: poolSize, onnotice: () => {} });
  return { db: drizzle({ client, schema }), close: () => client.end() };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs fn in one transaction scoped to orgId; RLS then shows only that tenant's rows.
 * The setting is transaction-local (is_local = true), so it never leaks to a pooled connection.
 * orgId must come from the verified actor, never straight from a client request.
 */
export async function withTenant<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(orgId)) throw new Error('withTenant: orgId must be a UUID');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/**
 * Read-only counts across several tenants (the super admin's lists): one transaction, switching
 * the tenant before each call, so RLS still scopes every query to one organisation at a time.
 * fn must only read; writes belong in withTenant.
 */
export async function eachTenant<T>(
  db: Db,
  orgIds: readonly string[],
  fn: (tx: Tx, orgId: string) => Promise<T>,
): Promise<T[]> {
  if (!orgIds.every((id) => UUID.test(id))) throw new Error('eachTenant: orgIds must be UUIDs');
  return db.transaction(
    async (tx) => {
      const out: T[] = [];
      for (const orgId of orgIds) {
        await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
        out.push(await fn(tx, orgId));
      }
      return out;
    },
    { accessMode: 'read only' },
  );
}
