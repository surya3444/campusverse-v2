# Campus Verse

Multi-tenant education platform for schools, colleges and universities.
First release is schools only. AI assistant name: Verse AI.

## Commands

- pnpm dev:infra (Postgres 18 on localhost:5433, Redis, S3 emulator on :9090; Colima must be running: `colima start`)
- pnpm dev:infra:reset (wipes local data and re-runs packages/db/sql/roles.local.sql)
- pnpm db:migrate, pnpm db:seed
- pnpm dev (apps/web :3000, apps/admin :3001, apps/api :4000, apps/worker: outbox relay + BullMQ consumers)
- Real sign-up: the super admin portal's "Invite an admin" (or `pnpm --filter @campusverse/api dev-session --invite "Name"`, which prints the phone); the admin signs in at /login with the simulated SMS code shown on screen and onboards at /onboarding (docs/decisions/0017)
- pnpm --filter @campusverse/api provision "School" KA 9876543210 "Owner" (dev shortcut: a whole school at once, no onboarding)
- pnpm --filter @campusverse/api admin-staff "Name" email owner (dev: a super admin staff member; prints a one-time passkey enrolment link for apps/admin on :3001)
- pnpm --filter @campusverse/api dev-session (dev: new school + signed-in owner tokens, used by e2e)
- pnpm verify (format, lint, types, unit tests, boundaries)
- pnpm test:rls (tenant isolation suite) and pnpm test:integration (all `*.rls|db.test.ts`; need dev:infra and db:migrate; stop `pnpm dev`'s worker first, or it takes the tests' outbox events)
- pnpm --filter @campusverse/mobile start (Expo app; set EXPO_PUBLIC_API_URL to http://<this Mac's LAN IP>:4000 for a phone). Its web build is for tests only (apps/mobile/README.md)
- pnpm test:e2e (Playwright + axe, desktop and 360px phone; screenshots in apps/web/e2e/screenshots)
- pnpm db:restore-rehearsal (timed dump, restore into a throwaway Postgres, restore check)
- Load test: pnpm --filter @campusverse/api load-school > load/fixture.json (git-ignored), then run load/peak.js with grafana/k6 in Docker against the API (docs/HARDENING.md)
- Open risks with severity: docs/RISKS.md. Keep it current; never drop an item without saying how it closed.
- docker build --target api|worker|migrate|web|admin . (the images AWS runs)
- Terraform: infra/ (README there). Validate without installing: docker run --rm -v "$PWD/infra:/infra" hashicorp/terraform:1.13 -chdir=/infra/envs/test validate (after init -backend=false). Never apply; the owner applies, and the production root is infra/envs/live.

## Environments

- Test and live (production) are separate AWS accounts in ap-south-1, from the same Terraform modules (docs/decisions/0016). Merges to main deploy to test automatically; `Promote to live` copies the tested images after the owner's approval.
- Images take all configuration at run time; don't read APP_ENV at build time or bake environment values into pages.
- The migrate task gets only MIGRATION_DATABASE_URL (migrationEnv()); services update only after it succeeds.

## Architecture

- Read docs/BUILD_GUIDE.md before planning a new module. docs/PLATFORM_MAP.md places every app in one of the six systems (Enrollment, Academics, People, Finance, Operations, Verse AI) plus Organisation; apps/web/lib/systems.ts drives the sidebar and /apps from it.
- Module specs live in docs/specs/. Don't start a milestone without its spec.
- Settled decisions live in docs/decisions/. Don't reopen them without a new note.
- PostgreSQL is the source of truth. Redis is never the source of truth.
- Shared: core, people, transport, hostel, gate, finance, communications.
- Separate: school, college and university academics.
- Modules interact through contract.ts and events only. dependency-cruiser enforces this.
- Config is read only through @campusverse/config, never process.env.
- Permission checks: createPermissions().can/assertCan from @campusverse/platform-permissions. Actors come from identity's resolveActor(), never from client input.
- Global login tables live in schema identity; worker plumbing (outbox, processed events) in schema ops; the super admin in schema control. All allowlisted. Everything tenant-owned lives in public with RLS.
- Write use cases go through command() from @campusverse/platform-events: can(), work, audit, outbox in one transaction.
- Consumers: `handle` runs once per event (in-transaction); `afterCommit` must be repeat-safe.
- Shared modules never read academic tables: placement comes through AcademicPlacementPort (school: schoolPlacement). Cross-module tests live in the school module.
- New permissions go in SCHOOL_ROLES and in a migration for existing schools (docs/decisions/0008).
- Aadhaar, PAN and similar are sealed with packages/crypto (FIELD_KEYS); store last four only in clear.
- Certificates issue through platform/documents' issueDocumentIn inside their own command (number, frozen PDF, enrolment ended together); numbers come from school_number_counter (docs/decisions/0012).
- Exams and year end: modules/school/exams and modules/school/rollover. Marks are numeric, hundredths in code; blank is never zero; grading and promotion come from packages/rules; rollover can be undone until the new year is used (docs/decisions/0013).
- Owner-defined fields: modules/platform/fields. The module that owns a record calls saveValues inside its own command; never store core data there (decision 0020).
- Roles on screen: modules/platform/access. Sensitive permissions (its catalogue) wait for a second owner; a database check stops self-approval. Add every new permission to the catalogue (a school-module test enforces it).
- Pictures: storeFile (platform/documents) under the caller's own permission, then the owning module stores the file id (person.photo_file_id, organisation/institution logos, campus photo). Serve only cleanFileBytes; the web uses ImageUpload (apps/web/app/(school)/common/image-upload.tsx).
- Staff: people/records createStaff, staffDetails (Aadhaar and bank sealed), documents in folders with versions (record_document; staff need people.staff.documents). Staff attendance: modules/shared/staff-attendance (check-ins with location against the campus gate; the office register wins; changes need a reason).
- "Who did this": recordStamps/auditTrail (ids) + people displayNames at read time; record screens show RecordStamp and History (apps/web/app/(school)/common/activity.tsx).
- Connected records (docs/specs/CONNECTED_SCHOOL.md): apps/api record.controller composes each module's per-person read under the viewer's own permission (denied parts are left out) for the student and staff records (apps/web/app/(school)/common/connected.tsx). A module that sets something up owns its whole flow on its own page (Transport: setup guide, crew added as staff with their role, zone fees through finance's setGroupFee; riders billed in the same transaction through a BillRider port).
- Payroll: modules/people/payroll (docs/specs/PAYROLL.md). Dated salaries; a month's run from staff attendance's payrollInputsIn; statutory rates from packages/rules payrollRules; maker ≠ checker in the database; slips frozen once approved (trigger).
- Money: modules/shared/finance. Paise only; receipts are append-only and numbered per legal entity and financial year; counter writes need an Idempotency-Key; webhooks are verified on the raw body and applied idempotently (docs/decisions/0011).

## API

- apps/api: NestJS on Fastify, explicit @Inject tokens. Inputs validated with packages/contracts (Zod).
- Requests act as a person: Bearer token + x-org-id + x-person-id, checked by ActorGuard.
- Long work goes to the worker via events; endpoints return 202.

## Super admin

- apps/admin + modules/platform/control (docs/decisions/0014). Staff sign in with passkeys only. Admin code reaches a customer only through withTenant (or eachTenant for read-only counts), writing the school's audit_event and control.admin_audit; never a bypass.
- ActorGuard refuses suspended customers and writes while writes_off is on; the worker honours messaging_off; finance honours the online_payments flag and payments_off.

## Verse AI

- packages/verse-ai (tools, gateway, models) + modules/platform/verse (ask, log, budget, actions) (docs/decisions/0015, 0021). Tools live in the module that owns the data (defineTool), call its use cases with the asking person, and return public, operational or `names` data (names, classes, admission/employee numbers; nothing else personal). Verse AI never writes by itself: an `act` tool's handler only prepares a card (and `confirmInput`); the change runs in its `execute`, through the module's normal use case, when the person taps Confirm (`verse_action`, 15 minutes, once, own person only, permission re-checked).
- The AI home is /ask (sign-in lands there) and the Verse AI panel opens from every page's header and from Ctrl K (apps/web/app/(school)/common/verse-chat.tsx). Tests can't rely on the model's wording when a key is set: check the cards the server builds.
- Providers (decision 0020): Claude (ANTHROPIC_API_KEY) or OpenAI (OPENAI_API_KEY, OPENAI_MODEL), switched by VERSE_PROVIDER; same tools, permissions, budgets and logs. No key: development uses an offline stand-in model. Live evaluations run only with a key and VERSE_LIVE_EVAL=1 (they cost money).

## Web sign-in

- Tokens never reach the browser: apps/web/app/session/* sets httpOnly SameSite=Strict cookies; app/api/v1/[...path] passes requests to the API, adds the session, refreshes once, and requires `x-requested-with: campusverse` on writes.
- /setup, /students, /attendance, /admissions, /certificates, /exams, /year-end, /notices, /fees, /timetable, /staff-attendance, /staff-leave, /appraisals, /homework, /syllabus, /library, /gate, /expenses, /hostel, /helpdesk, /assets, /payroll, /ask and the sidebar use the real API; /verify/<code> is the public QR check and /apply/<slug> the public online application form (no session; app/api/v1 passes only public/apply through without one); other school pages still show synthetic data.
- Parent and teacher app: apps/mobile (Expo SDK 58, expo-router). It calls the API directly with Bearer + x-org-id + x-person-id; tokens in expo-secure-store; offline queue in expo-sqlite. Words: apps/mobile/lib/messages.ts (6 languages; non-English drafts need native review).
- Offline: apps/web/lib/sync-queue.ts queues device events (UUIDv7 ids) and POSTs /api/v1/sync/events; the server accepts each event id once (docs/decisions/0009).

## UI

- Components and tokens: packages/ui (see its README). Words: apps/web/messages/en.ts.
- Create and edit forms open in FormModal (packages/ui), never inline between existing content; only pages whose whole purpose is the form stay pages.
- /design shows every component and state; /?state=…&at=HH:MM shows any Day Line state.

## Non-negotiables

- Every tenant table has org_id, RLS and FORCE RLS. Tenant context only via withTenant() from @campusverse/db.
- The app connects as cv_app (no ownership, no BYPASSRLS). Only db:migrate uses cv_migrator.
- Every write checks can(), writes audit and emits outbox events in one transaction.
- Money is integer paise. Marks use numeric. Never float.
- Bulk writes use preview then commit.
- Real student data never enters local or test environments.
- No `any` in domain code.

## Done means

- Tests cover allowed and denied cases.
- pnpm verify passes.
- UI states are complete: loading, empty, error, offline, denied.
