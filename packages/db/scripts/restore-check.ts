// Checks a restored copy of the database: every migration this image knows is applied, and the
// core tables answer with row counts. Counts only, no data is printed. Exit 1 on any gap.
// RESTORE_HOST points the migrator's login at the restored copy instead of the live database.
import { migrationEnv } from '@campusverse/config';
import { readdir } from 'node:fs/promises';
import postgres from 'postgres';

const env = migrationEnv();
const url = new URL(env.MIGRATION_DATABASE_URL);
if (env.RESTORE_HOST) url.hostname = env.RESTORE_HOST;
if (env.RESTORE_PORT) url.port = env.RESTORE_PORT;

const started = Date.now();
const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
try {
  const expected = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied = new Set(
    (await sql<{ name: string }[]>`select name from ops.schema_migration`).map((r) => r.name),
  );
  const missing = expected.filter((f) => !applied.has(f));
  const counts: Record<string, number> = {};
  for (const table of [
    'organisation',
    'person',
    'audit_event',
    'school_enrolment',
    'fee_receipt',
  ]) {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
    counts[table] = r?.n ?? 0;
  }
  const report = {
    ok: missing.length === 0,
    missing,
    counts,
    checkSeconds: (Date.now() - started) / 1000,
  };
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
} finally {
  await sql.end();
}
