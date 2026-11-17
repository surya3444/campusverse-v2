---
paths:
  - 'packages/db/**'
  - 'modules/**/infrastructure/**'
---

# Database rules

- Follow expand and contract.
- Use reviewed SQL for RLS and concurrent indexes.
- Add a tenant isolation test for each new table.
- Never change an applied migration.
- Every tenant table: org_id first in the primary key and every index; foreign keys include org_id.
- IDs are UUIDv7. Money is integer paise. Marks are numeric. Times are UTC timestamptz; calendar days are date.
- Changing facts use `valid_during daterange` with an exclusion constraint.
- Receipts, issued documents and audit rows are append-only.
- Migrations set lock_timeout and statement_timeout. Indexes use CREATE INDEX CONCURRENTLY.
- Tenant context is set with `set_config('app.org_id', $1, true)` inside the transaction, never plain SET.
