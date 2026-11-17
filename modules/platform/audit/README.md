# platform/audit

`writeAudit(tx, actor, entry)` adds one row to `audit_event` in the caller's tenant transaction. Write use cases get it through `command()`. Reads of personal data, such as file downloads, are audited as well.

- **Append-only:** the app role has SELECT and INSERT only, and a trigger refuses UPDATE, DELETE and TRUNCATE for every role.
- **No personal data in `detail`:** ids, codes and counts only.
- **Retention:** at least one year (spec), which exceeds CERT-In's 180 days. Partition by month once volume justifies it.

- **Tamper-evident (rule book §13.12):** `sealAuditLog` adds a seal to `audit_seal`: a SHA-256 chain (`chainLink`) over every event in id order, as an unbroken run (it stops at the first event younger than a minute). `verifyAuditLog` recomputes the chain from the first event and names the first seal that no longer matches. Opening the Activity Log seals what's new; a scheduled seal across tenants waits for the worker's tenant list.
- **The log:** `activityLog` pages the organisation's events newest first, filtered by kind of data, person and day. Verse AI's steps are events too. Campus Core › Activity Log (`/activity-log`) needs `platform.activity.read`.

**Owned tables:** `audit_event` (migration 0003), `audit_seal` (migration 0050, append-only). **Events:** none.

**Exports:** `recordExport` logs a downloaded list (`platform.data.exported`: which list, which school or section, how many rows; never the rows). The web calls `POST /api/v1/activity/exports` through `exportCsv` (apps/web/lib/csv.ts) before every download.
