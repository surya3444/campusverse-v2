import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const TIMEOUTS = `SET lock_timeout = '5s'; SET statement_timeout = '60s'`;
const LOCAL_TIMEOUTS = `SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s'`;
// First line of a file that must run outside a transaction, such as CREATE INDEX CONCURRENTLY.
const NO_TRANSACTION = '-- no-transaction';

/**
 * Applies pending SQL migrations in filename order, once each.
 * A checksum per file refuses to continue if an applied migration was edited.
 */
export async function migrate(url: string, log: (line: string) => void = console.log) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    // One runner at a time, even if two deploys overlap.
    await sql`select pg_advisory_lock(hashtext('campusverse.migrate'))`;
    await sql`create schema if not exists ops`;
    await sql`create table if not exists ops.schema_migration (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`;
    const rows = await sql<{ name: string; checksum: string }[]>`
      select name, checksum from ops.schema_migration`;
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
    for (const name of files) {
      const body = await readFile(new URL(name, MIGRATIONS), 'utf8');
      const checksum = createHash('sha256').update(body).digest('hex');
      const prior = applied.get(name);
      if (prior === checksum) continue;
      if (prior)
        throw new Error(`${name} changed after it was applied. Add a new migration instead.`);

      const started = Date.now();
      if (body.startsWith(NO_TRANSACTION)) {
        await sql.unsafe(TIMEOUTS);
        await sql.unsafe(body);
        await sql`insert into ops.schema_migration (name, checksum) values (${name}, ${checksum})`;
      } else {
        await sql.begin(async (tx) => {
          await tx.unsafe(LOCAL_TIMEOUTS);
          await tx.unsafe(body);
          await tx`insert into ops.schema_migration (name, checksum) values (${name}, ${checksum})`;
        });
      }
      log(`applied ${name} in ${Date.now() - started} ms`);
    }
  } finally {
    await sql.end();
  }
}
