# shared/health — Health Connect

Rule book §13.9, §12.4 decision 13, §16.5. Records, sick-room visits, totals and break-glass.

- **The vault:** `saveHealthRecord` seals blood group, allergies, conditions, medicines and responder notes as one value with the health keys (`HEALTH_KEYS`, or a key derived from the field keys with HKDF; never the field keys themselves). Only flags (has allergies, has conditions, blood group known) are kept in clear, for totals. `healthRecord` opens it for the medical role and audits every opening as sensitive.
- **Sick-room visits:** `recordVisit` seals the notes; the event `health.visit.recorded.v1` carries the outcome only (`sent_home`), never the reason, so attendance can mark medical leave as a status. `visitsToday` lists the day's visits without notes.
- **Totals:** `healthTotals` for management (`health.report.read`): never a name; counts below 5 come back as null ("fewer than 5").
- **Break-glass:** `openBreakGlass` (`health.emergency.open`) needs a reason of 10+ characters, expires in an hour, shows blood group, allergies and responder notes only, is kept in `health_break_glass` (append-only) and the audit log, and emits `health.break_glass.opened.v1` so the Data Protection Officer is told.
- **Who sees names:** `health.record.read`, `health.record.update` and `health.visit.record` are the medical role's (School nurse). Owners hold every other permission but not these (`NAMED_HEALTH` in platform/access).
- A student is checked against the school through people/records (`memberKind`, `studentIdsAt`); no academic tables are read.

**Owned tables:** `health_record`, `health_visit`, `health_break_glass` (migration 0053).

**Events:** `health.record.updated.v1`, `health.visit.recorded.v1`, `health.break_glass.opened.v1`.
