# shared/health — Health Connect

Rule book §13.9, §12.4 decision 13, §16.5. Records, sick-room visits, totals and break-glass.

- **The vault:** `saveHealthRecord` seals blood group, allergies, conditions, medicines and responder notes as one value with the health keys (`HEALTH_KEYS`, or a key derived from the field keys with HKDF; never the field keys themselves). Only flags (has allergies, has conditions, blood group known) are kept in clear, for totals. `healthRecord` opens it for the medical role and audits every opening as sensitive.
- **Sick-room visits:** `recordVisit` seals the notes; the event `health.visit.recorded.v1` carries the outcome only (`sent_home`), never the reason, so attendance can mark medical leave as a status. `visitsToday` lists the day's visits without notes.
- **Totals:** `healthTotals` for management (`health.report.read`): never a name; counts below 5 come back as null ("fewer than 5").
- **Break-glass:** `openBreakGlass` (`health.emergency.open`) needs a reason of 10+ characters, expires in an hour, shows blood group, allergies and responder notes only, is kept in `health_break_glass` (append-only) and the audit log, and emits `health.break_glass.opened.v1` so the Data Protection Officer is told.
- **Medicines & Stock** (`application/stock.ts`, `health.stock.manage`, the medical role): medicines per school with a reorder level; stock arrives as batches with an expiry date (`receiveStock`, never already expired); `dispense` takes from the earliest-expiring usable batch first (`takeFromBatches`), batches locked while counting; `discardStock` needs a reason. Every movement is a row in `health_medicine_move` (append-only): the dispensing log. A dose may name the sick-room visit; no student is stored on stock rows.
- **Emergency** (`application/emergency.ts`): `raiseSos` (`health.emergency.raise`, every staff role) opens an incident with what and where; naming a student who has a record opens a recorded break-glass and returns the life-saving card. `health.sos.raised.v1` makes `health.sos-alert` tell holders of `health.emergency.manage` (principal, nurse, admins) and the student's non-restricted guardians that the school is responding, never a health detail. Partner hospitals and ambulances (`savePartner`) are listed in the school's order. `closeIncident` seals the report with the health keys and emits `health.incident.closed.v1` with the outcome only.
- **Who sees names:** `health.record.read`, `health.record.update` and `health.visit.record` are the medical role's (School nurse). Owners hold every other permission but not these (`NAMED_HEALTH` in platform/access).
- A student is checked against the school through people/records (`memberKind`, `studentIdsAt`); no academic tables are read.

**Owned tables:** `health_record`, `health_visit`, `health_break_glass` (migration 0053); `health_medicine`, `health_medicine_batch`, `health_medicine_move`, `health_partner`, `health_incident` (migrations 0080–0081).

**Events:** `health.record.updated.v1`, `health.visit.recorded.v1`, `health.break_glass.opened.v1`, `health.sos.raised.v1`, `health.incident.closed.v1`.
