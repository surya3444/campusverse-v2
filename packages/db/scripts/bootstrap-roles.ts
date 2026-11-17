// One-time setup of a new RDS database's logins, as packages/db/sql/roles.local.sql does locally:
// cv_migrator owns the schema and runs migrations; cv_app owns nothing and never bypasses RLS.
// The owner runs it inside a logged ECS Exec session (infra/README.md), with the RDS master
// login from Secrets Manager and two new passwords, which then go into the app's secrets:
//   MASTER_DATABASE_URL=… CV_MIGRATOR_PASSWORD=… CV_APP_PASSWORD=… \
//     node --import tsx packages/db/scripts/bootstrap-roles.ts
// Safe to repeat: existing roles get the new passwords.
import { bootstrapEnv } from '@campusverse/config';
import postgres from 'postgres';

const env = bootstrapEnv();
const sql = postgres(env.MASTER_DATABASE_URL, { max: 1, onnotice: () => {} });

// Role statements can't take bind parameters; format(%L) quotes the passwords safely.
async function run(template: string, password: string) {
  const [row] = await sql<
    { stmt: string }[]
  >`select format(${template}::text, ${password}::text) as stmt`;
  if (row) await sql.unsafe(row.stmt);
}

try {
  const existing = new Set(
    (await sql<{ rolname: string }[]>`select rolname from pg_roles`).map((r) => r.rolname),
  );
  await run(
    existing.has('cv_migrator')
      ? 'alter role cv_migrator login bypassrls password %L'
      : 'create role cv_migrator login bypassrls password %L',
    env.CV_MIGRATOR_PASSWORD,
  );
  await run(
    existing.has('cv_app')
      ? 'alter role cv_app login nosuperuser nobypassrls nocreatedb nocreaterole password %L'
      : 'create role cv_app login nosuperuser nobypassrls nocreatedb nocreaterole password %L',
    env.CV_APP_PASSWORD,
  );
  await sql`grant cv_migrator to current_user`;
  await sql`alter schema public owner to cv_migrator`;
  await sql.unsafe(`grant create on database ${env.DATABASE_NAME} to cv_migrator`);
  console.log('cv_migrator and cv_app are ready. Put their URLs in the environment secrets.');
} finally {
  await sql.end();
}
