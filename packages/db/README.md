# @campusverse/db

SQL migrations, Drizzle query types, the tenant transaction helper and synthetic seeds.

- `migrations/`: the source of truth. Applied once each, in filename order; a checksum stops edits to applied files.
- `sql/roles.local.sql`: development and CI roles only. Test and production roles come from Terraform.
- `src/client.ts`: `createDb()` and `withTenant()`. All tenant queries go through `withTenant()`.
- `src/schema.ts`: Drizzle table types mirroring the SQL.
- `src/seed.ts`: `seedTenant()` builds a synthetic organisation, legal entity, campus and school.
- `tests/*.rls.test.ts`: generic isolation suite over every public table (`pnpm test:rls`).

Owned tables: `organisation`, `legal_entity`, `campus`, `institution`, plus `ops.schema_migration`.
