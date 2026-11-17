---
name: db-migration
description: Make a safe Postgres schema change in packages/db — expand and contract, RLS, timeouts, tenant test.
---

1. Never edit an applied migration. Add a new one.
2. Plan expand and contract: add the new shape, backfill in a job, switch reads, then remove the old shape in a later release.
3. Add `packages/db/migrations/NNNN_name.sql`. The runner wraps each file in a transaction and sets lock_timeout 5s and statement_timeout 60s.
4. New tenant table: org_id in the primary key and every foreign key; `ENABLE` and `FORCE ROW LEVEL SECURITY`; a tenant_isolation policy `USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())`.
5. Indexes start with org_id. On tables with data, use `CREATE INDEX CONCURRENTLY` in its own file whose first line is `-- no-transaction`.
6. Grant the app role only what it needs. It never owns tables or has BYPASSRLS.
7. Add the table to the tenant isolation suite and run pnpm test:rls.
8. Run the migration forward against large synthetic data and report timings.
