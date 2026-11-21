# platform/control

The Campusverse super admin (spec: `docs/specs/SUPER_ADMIN.md`). Staff only; schools never see it. The portal is `apps/admin` (port 3001).

**Sign-in:** passkeys only (WebAuthn via `@simplewebauthn/server`, user verification required). One-time enrolment links (15 minutes) from an owner, or `pnpm --filter @campusverse/api admin-staff "Name" email owner` in development. Sessions: 30 minutes idle, 8 hours at most; disabling a staff member ends them. Separate from school logins in both directions.

**Roles (`domain/roles.ts`):** owner does everything; support reads, creates customers, sets flags for a customer, and asks for support access or status changes, but never approves, flips switches, edits plans or manages staff.

**Tenancy:** the `control` schema is global and allowlisted (no school data). Nothing bypasses RLS: `inCustomer` runs the work through `withTenant(orgId)` and writes both the school's own `audit_event` (`platform.*`, so the school sees it) and `control.admin_audit`. Read-only counts across customers use `eachTenant` from `@campusverse/db`, which switches tenant per customer inside one read-only transaction. Other modules answer through ports wired by the API: `activeStudentCount` (people records), `deliveryCounts` (communications), `supportSummary` and `provisionSchool` (school setup).

**What it decides for the rest of the platform:**

- `customerAccess(db, orgId)`: the API's ActorGuard refuses suspended or closed customers (403 `customer_suspended`) and refuses writes while `writes_off` is on (503 `read_only`).
- `switchOn(db, 'messaging_off', orgId)`: the worker's dispatch waits and retries every minute.
- `flagOn(db, 'online_payments', orgId)` and `switchOn(db, 'payments_off', orgId)`: finance refuses new payment links.
- `registerCustomer(tx, …)`: called by school signup, so every organisation is a customer from the start.

**Flags:** a customer's own setting wins; otherwise on when the flag's default is on and the plan includes it.

**Maker-checker:** customer status changes and support access go through `control.approval`; the requester can't approve (code and a CHECK constraint). Support access is read-only, 15 minutes to 4 hours, for the requesting person only, and every view is logged at the school.

**Incidents:** `openIncident`, `recordIncidentStep`, `listIncidents` record security incidents and personal-data breaches with clocks from discovery (`domain/incident.ts`: CERT-In 6 hours; Board and schools 72 hours when personal data is involved; legal confirmation pending), each step once with who and when, and a `platform.incident.recorded` row in each affected school's audit log.

**Owned tables:** `control.incident`, `control.incident_customer` (migration 0014), `control.staff`, `passkey`, `enrolment`, `challenge`, `session`, `plan`, `customer`, `flag`, `flag_override`, `switch`, `approval`, `support_grant`, `admin_audit` (append-only). Migration 0012.

**Events:** none; changes are audited on both sides instead.

**Not yet:** SSO for staff, billing schools, "view as" a school user, data export for a leaving customer, a status page, provider dashboards, customer list beyond 50 (search instead).

**Self-serve sign-up** (`selfSignup`; rule book §11 "Self-serve onboarding"; migrations 0077, 0089): `/signup` opens a **request** (`status = 'requested'`, Pilot plan, `source = 'self'`) with onboarding answers already drafted. Staff approve it (`decideSignup` → `invited`, onboarding opens) or decline it with a reason the person sees (`declined`; they can ask again). Someone with an open request or invite keeps it; someone already a member just signs in. The same OTP send limits apply before anything is written.

**Email invites** (`inviteByEmail`, `emailInvite`): a one-time link (`/signup?invite=…`, 14 days; only its SHA-256 hash is stored) for an address. Signing up through it takes the invite without approval and fixes the email; a waiting request from the same mobile gives way to it. No email service is connected: the portal shows the link once to copy or open in the staff member's mail app.

**Several organisations per admin** (`startAnotherOrganisation`): an admin who has onboarded opens another invite (`source = 'additional'`, same plan) and builds a new organisation, its own tenant, in the same onboarding. `listAdmins` groups the organisations each admin set up (portal: Admins).
