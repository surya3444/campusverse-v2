# Campus Verse Claude Code Build Guide

Nov 4, 2026 · @Surya Karthik Varma Indukuri

## Summary

This guide is the single build brief for Claude Code. Campus Verse will be a TypeScript modular monolith on PostgreSQL and Redis, with shared people and campus services, and separate academic modules for schools, colleges and universities. The first release is schools-only, but it keeps room for the other two types.

**Your latest decisions, applied throughout:**

| Decision | Effect on the build |
| --- | --- |
| PostgreSQL and Redis | Postgres is the source of truth. Redis handles cache, rate limits, jobs and live state |
| Shared people and services | Students, staff, guardians, transport, hostel and similar services sit at organisation level |
| Separate academics | Subjects, exams and similar logic live in separate school, college and university modules |
| Independent modules | Other modules keep their own tables and connect only through contracts |
| Verse AI | This replaces the name Mitra everywhere |
| Development, test, production | Three environments. Test doubles as the final rehearsal before production |
| Bold UI | Complex work appears as simple, direct actions, built on Campus Verse's brand |

**How to use it:**

1. Save this guide in the repo as `docs/BUILD_GUIDE.md`.
2. Create the Claude Code setup in the Claude Code section.
3. Run the build prompts in order. Finish each exit check before moving on.
4. Save decisions in `docs/decisions/`, so later sessions don't reopen them.

**Exact module specs:** build from these tabs, and save each one under `docs/specs/`: 1. School Setup, 2. Students, 3. Attendance and 4. Fees. Specs for Parent App, Admissions, Certificates, Exams, Section Planner and Year Rollover, and Staff are still to be written. Don't start those milestones without one.

**What needs your attention before public launch:** the current site and demo make claims that this research couldn't verify, including 500+ institutions, 2M+ students, SOC 2 compliance and a 50% productivity boost. The site also gives different setup times of 5 working days and 48 hours. Don't carry these into the new product unless they're true and proven. This matters more now that you've told me there are no real customers.

## Product boundaries

Three kinds of module keep the product connected without tying schools and colleges together. This follows your instruction and replaces V2's single academic engine.

_(Diagram in the original document: module boundaries · shared, separate and independent.)_

Dashed arrows are the only link from shared services into academics. Shared services ask for a person's current placement, and never read school or college tables.

| Module | Type | Reason |
| --- | --- | --- |
| Organisation, identity, roles, consent, audit | Shared core | Every feature needs them |
| Students, staff, guardians | Shared people | The same person can move or work across institutions |
| Transport | Shared | One bus can carry mixed institutions |
| Hostel | Shared | One hostel can house mixed institutions |
| Gate and visitors | Shared | A campus gate serves everyone |
| HR | Shared | Staff may work across institutions |
| Fee ledger and receipts | Shared | Money follows legal entities. Fee plan rules can differ by institution type |
| Communications | Shared | One delivery engine |
| Verse AI | Shared | Uses tools provided by each module |
| Classes, sections, subjects | School only | Colleges use programmes and courses |
| Attendance rules | Separate by type | School day registers differ from college period attendance |
| Exams, report cards, promotion | Separate by type | Boards and universities work differently |
| Timetable | Separate by type | School and college constraints differ |
| Admissions | Separate workflows on a shared CRM base | Schools use class entry; colleges use counselling and merit |
| Certificates | Shared engine, separate templates | Rendering is shared, while rules differ |
| Library, inventory, helpdesk, clubs, health, career | Independent | Each stands alone and connects through contracts |

**Build rule:** each academic type is a complete module set. If two types later prove identical in one small area, extract a shared helper then. Don't build for similarity in advance.

The first release builds the school set only. College and university folders remain empty until needed, while the shared person and placement contract already exist.

## Tech stack

Use one language, one primary database and a few managed services. These are firm defaults for the build, so Claude Code shouldn't swap them without a decision note.

| Layer | Decision | Rule |
| --- | --- | --- |
| Language | TypeScript strict mode | No `any` in domain code |
| Runtime | [Node LTS](https://nodejs.org/en/about/previous-releases), pinned with `.nvmrc` | Use an LTS line only |
| Monorepo | pnpm workspaces and Turborepo | Lockfile committed. Use [`minimumReleaseAge`](https://www.sqli.com/int-en/insights/pnpm-vs-shai-hulud-npm-security) |
| API | NestJS with Fastify adapter | One Nest module per product module |
| Worker | Same codebase, separate entry point | Long tasks never run in API requests |
| Web | Next.js and React | School app and super admin are separate apps |
| Mobile | [React Native with Expo](https://docs.expo.dev/eas-update/codepush.md) | One app with role-based experiences first |
| Database | [PostgreSQL 18](https://www.postgresql.org/support/versioning/) on RDS Multi-AZ | [18.6 was available on RDS](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html) when checked |
| Data access | Drizzle ORM plus reviewed SQL migrations | Row-level security and special indexes live in SQL |
| Redis | ElastiCache using Redis-compatible engine | See below |
| Jobs | BullMQ on Redis | Job rows are retry-safe, and durable work starts from a Postgres outbox |
| Storage | Private S3 in Mumbai | Direct upload by signed URL |
| Search | Postgres full-text and `pg_trgm` | Add search engine only with evidence |
| Auth | Phone OTP for parents, Google or Microsoft for staff, passkeys for super admin | Don't invent cryptography |
| Validation | Zod contracts shared by API, web and mobile | OpenAPI generated from contracts |
| Web data | TanStack Query and TanStack Table | Server state stays out of global stores |
| Forms | React Hook Form with Zod | Autosave drafts where work could be lost |
| UI | Radix primitives, Tailwind and Campus Verse tokens | No off-the-shelf look |
| Tests | Vitest, Testcontainers, Playwright, Maestro, k6 | See Testing |
| Infrastructure | Terraform on AWS Mumbai | Everything in code |
| Compute | [ECS Fargate](https://docs.aws.amazon.com/decision-guides/latest/containers-on-aws-how-to-choose/choosing-aws-container-service.html) | No Kubernetes now |
| Observability | OpenTelemetry, Sentry, Grafana Cloud or AWS tools | No student data in telemetry |
| Messaging | MSG91 or equal for SMS and WhatsApp; FCM and APNs | Provider adapters only |
| Payments | Razorpay first, behind an adapter | [Webhooks can repeat](https://razorpay.com/docs/webhooks/best-practices/) |

### What Redis does

Redis is a speed layer. Losing Redis must never lose business data.

| Use | Key pattern | Expiry | If Redis fails |
| --- | --- | --- | --- |
| Permission snapshot | `perm:{org}:{person}:{version}` | 15 minutes | Load from Postgres |
| Reference cache | `ref:{org}:{entity}:{version}` | 1 hour | Load from Postgres |
| Rate limits | `rl:{scope}:{id}:{window}` | Window length | Fail safely per endpoint; login and OTP stay strict |
| OTP attempt counters | `otp:{hash}` | OTP lifetime | Block sending and alert |
| Idempotency fast check | `idem:{org}:{key}` | 24 hours | Database unique key remains final |
| BullMQ jobs | Library managed | Per job | Outbox replays jobs |
| Live bus state | `bus:{org}:{trip}` | Short | Parents see last known time |
| Dashboard counters | `dash:{org}:{date}` | Same day | Recalculate from rollups |

**Rules:**

- Every key starts with its type and includes `org_id` where tenant data exists.
- Cache by a version number, not by deleting many keys.
- Don't cache marks, health or sensitive profile data in Redis.
- Set `maxmemory-policy` to suit cache keys, and run BullMQ on a separate logical deployment if eviction could affect jobs.

**Licence note:** you asked for Redis, and the code should use standard Redis commands. AWS says [Redis OSS 7.2 was the last fully open-source version](https://aws.amazon.com/elasticache/redis/?loc=0&nc=sn), and ElastiCache offers Redis OSS and Valkey compatibility. Using managed ElastiCache keeps this choice open. Test BullMQ on the chosen engine in the test environment.

### Costs and limits

Costs weren't estimated here. Add AWS budgets from the first day, and turn off development resources at night.

## Repository structure and module rules

A strict monorepo lets one developer and Claude Code work fast without creating a tangle. Folder boundaries represent product boundaries, and automated checks enforce them.

```text
campusverse/
  apps/
    api/                 NestJS API
    worker/              BullMQ workers and scheduled jobs
    web/                 School, college and university web app
    admin/               Campus Verse super admin portal
    mobile/              Expo app for parent, student, teacher, attendant, driver
  packages/
    contracts/           Zod schemas, OpenAPI, typed events
    db/                  Drizzle schema, SQL migrations, RLS policies, seeds
    ui/                  Design tokens and components
    rules/               Versioned state and board rule packs
    verse-ai/            Tool registry, gateway, prompts, evaluations
    sdk/                 Typed client for web and mobile
    test-data/           Synthetic data generator
    config/              Shared lint, TypeScript and environment validation
  modules/
    platform/            organisation, identity, permissions, audit, consent
    people/              students, staff, guardians, documents
    shared/              transport, hostel, gate, finance, communications
    independent/         library, inventory, helpdesk, health, career, clubs
    school/              school academics
    college/             college academics, later
    university/          university academics, later
  infra/                 Terraform
  docs/                  Build guide, specs, decisions, runbooks
  .claude/               Claude Code rules, skills, agents, hooks
```

### Inside each module

```text
modules/school/attendance/
  contract.ts            Public API, events, permissions
  domain/                Pure rules with no framework imports
  application/           Use cases
  infrastructure/        Database and adapters
  http/                  Controllers
  jobs/                  Workers
  tests/
  README.md              Purpose, owned tables, events
```

### Boundary rules

1. A module owns its tables. Other modules can't read or write them directly.
2. A module imports another module only through `contract.ts`.
3. Domain code has no NestJS, database or HTTP imports.
4. `school`, `college` and `university` can't import each other.
5. Shared modules know nothing about school classes or college semesters. They use contracts.
6. Rule logic comes from `packages/rules`, never `if (state === ...)` inside modules.
7. Each write use case calls `can()`, writes audit data and emits events in one transaction.
8. Secrets are read only through validated config.

Enforce these rules with `dependency-cruiser`, TypeScript path limits and CI.

### Naming

- Database tables use `snake_case` and module prefixes, such as `school_exam`.
- Permissions use `module.resource.action`, such as `school.marks.update`.
- Events use `domain.entity.verb.v1`, such as `school.result.published.v1`.
- User-facing words live in language files from the start.

## Data model

People are shared across an organisation, while each institution type owns its academic structure. So one person can be a school student, then a college student, and use the same bus, without forcing colleges into school tables.

### Rules

- Every tenant table has `org_id`. Foreign keys include it, so rows can't reference another tenant.
- IDs are UUIDv7.
- Money uses integer paise. Marks use `numeric`, never float.
- Times are stored in UTC and displayed in IST. Dates such as attendance date use `date`.
- Changing facts use `valid_during daterange` with exclusion constraints.
- Issued documents, receipts and audit rows are append-only.
- Soft-deleted rows stay out of ordinary queries through views or helpers.

### Shared tables

```sql
CREATE TABLE organisation (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL
);

CREATE TABLE legal_entity (
  org_id uuid NOT NULL REFERENCES organisation(id),
  id uuid NOT NULL,
  name text NOT NULL,
  gstin text,
  PRIMARY KEY (org_id, id)
);

CREATE TABLE campus (
  org_id uuid NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (org_id, id)
);

CREATE TABLE institution (
  org_id uuid NOT NULL,
  id uuid NOT NULL,
  campus_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('school','college','university')),
  authority_code text NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, campus_id) REFERENCES campus(org_id, id),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity(org_id, id)
);

CREATE TABLE person (
  org_id uuid NOT NULL,
  id uuid NOT NULL,
  legal_name text NOT NULL,
  date_of_birth date,
  PRIMARY KEY (org_id, id)
);

CREATE TABLE student_profile (
  org_id uuid NOT NULL,
  person_id uuid NOT NULL,
  apaar_status text NOT NULL DEFAULT 'not_generated',
  apaar_id_encrypted bytea,
  PRIMARY KEY (org_id, person_id)
);

CREATE TABLE staff_profile (
  org_id uuid NOT NULL,
  person_id uuid NOT NULL,
  employee_code text NOT NULL,
  PRIMARY KEY (org_id, person_id),
  UNIQUE (org_id, employee_code)
);

CREATE TABLE institution_membership (
  org_id uuid NOT NULL,
  id uuid NOT NULL,
  person_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('student','staff')),
  valid_during daterange NOT NULL,
  PRIMARY KEY (org_id, id)
);
```

These are illustrative starting points. Claude Code should generate full tables from module specs, with timestamps, creators and constraints.

### Global account and tenant identity

| Table | Purpose |
| --- | --- |
| `account` | Login, global across organisations |
| `login_identifier` | Phone, email or SSO identity |
| `account_person_link` | Connects one account to people in several organisations |
| `person` | One human within one organisation |
| `guardian_link` | Guardian, student, flags and valid dates |
| `role_assignment` | Role, scope and valid dates |
| `staff_duty` | Temporary duties such as exam superintendent |

### School tables

These are owned only by `modules/school`.

| Area | Tables |
| --- | --- |
| Structure | `school_year`, `school_term`, `school_class`, `school_cohort`, `school_section`, `school_teaching_group` |
| Enrolment | `school_enrolment`, `school_group_membership` |
| Subjects | `school_subject`, `school_subject_offering`, `school_teacher_allocation` |
| Attendance | `school_attendance_session`, `school_attendance_event`, `school_attendance_day` |
| Exams | `school_exam_cycle`, `school_exam_component`, `school_mark`, `school_result`, `school_report_card` |
| Lifecycle | `school_rollover_run`, `school_rollover_item`, `school_section_plan` |

### College and university tables, later

`college_programme`, `college_regulation`, `college_course`, `college_batch`, `college_semester`, and `university_faculty`, `university_affiliation`, `university_exam_cycle` remain separate. They don't reuse school tables, even where names sound similar.

### How shared modules connect to separate academics

A shared service needs only a short answer, such as who the student is and which label to print. So each academic type implements one small contract.

```ts
export interface AcademicPlacementPort {
  getCurrentPlacement(input: {
    orgId: string;
    personId: string;
    onDate: string;
  }): Promise<null | {
    institutionId: string;
    institutionType: 'school' | 'college' | 'university';
    displayLabel: string; // e.g. Class 5-A or BTech CSE, Semester 3
    active: boolean;
  }>;
}
```

| Example | Handling |
| --- | --- |
| School and college students on one bus | Transport assigns person IDs to a trip. Labels come from the port |
| Hostel shared by two institutions | Beds link to person IDs. Fee follows each person's legal entity policy |
| Staff teach in school and college | One staff profile, two memberships, shared clash check contract |
| School student joins group's college | Same person. New membership and new college enrolment |

**Privacy limit:** one person record doesn't mean every institution sees everything. Access still follows role scope and purpose. For example, a college can't see school health or marks without a defined reason and permission.

### Tables and partitions

- Attendance, audit and message events should be partitioned by date once volume justifies it.
- Indexes begin with `org_id`.
- Keep reports in rollup tables, updated by workers.
- Use a read replica for heavy reports.

## Security, tenancy, permissions and privacy

Treat tenant isolation and child data as the two rules that can't fail. Each must be enforced in code, the database and tests.

### Tenant isolation

The API opens a transaction, verifies the actor, and sets tenant context locally. AWS warns that [plain `SET` can leak or pin sessions](https://aws.amazon.com/blogs/database/understanding-the-differences-between-pgbouncer-and-amazon-rds-proxy-for-postgresql-connection-pooling), so use transaction-scoped settings.

```sql
ALTER TABLE person ENABLE ROW LEVEL SECURITY;
ALTER TABLE person FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON person
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);
```

```ts
await db.transaction(async (tx) => {
  await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
  return handler(tx);
});
```

**Rules:**

- The application role doesn't own tables and doesn't have `BYPASSRLS`.
- Migrations use a separate role.
- The super admin API uses audited service functions, not a blanket tenant bypass.
- A CI query lists any tenant table lacking `org_id`, RLS or `FORCE ROW LEVEL SECURITY`.

### Permissions

```ts
await can(actor, 'school.marks.update', {
  orgId,
  institutionId,
  sectionId,
  subjectId,
});
```

A permission check combines four inputs: role, scope, relationship and state.

| Input | Example |
| --- | --- |
| Role | Class teacher |
| Scope | School A, Class 5 |
| Relationship | Teaches Maths to 5-A |
| State | Exam marks are open |

### Authentication

- Parents use phone OTP with WhatsApp backup and trusted devices.
- Staff use SSO where available, plus MFA for sensitive roles.
- Super admins use SSO and passkeys, with short sessions.
- Sessions use rotating refresh tokens, and can be revoked per device.

### Privacy requirements

| Requirement | Build |
| --- | --- |
| Consent | Ledger by student, guardian, purpose and notice version |
| Field classes | `public`, `personal`, `sensitive`, `restricted` in schema metadata |
| Encryption | Field-level encryption for Aadhaar, APAAR, staff PAN, bank and health |
| Logs | Keep access logs at least one year, with [CERT-In's 180-day rule](https://www.internetsociety.org/wp-content/uploads/2022/06/IIB-India-CERT-In-Directions-2022.pdf) already in force |
| Breach | Workflow with 6-hour and 72-hour timers. Get legal confirmation |
| Telemetry | Mask names, phones, Aadhaar, and message contents |
| Files | Private storage, malware scan, short signed links |
| Exports | Permission, reason, count, expiry, watermark and audit entry |
| Deletion | Retention rules, legal hold and proof of completion |
| Support | Off by default, school-approved, time-limited, logged |

### Application security checklist

Use [OWASP ASVS 5.0](https://asvs.owasp.org/) as a checklist. Include strict headers, CSRF protection, content security policy, rate limits, file type checks, safe PDF generation, dependency scans, secret scans and no third-party scripts in admin.

**Don't do these:** store OTPs in plain form, send passwords by message, store card details, log request bodies by default, or accept tenant IDs from clients as proof of access.

## API, events, jobs and offline sync

Every screen, mobile app and Verse AI tool uses the same contracts. Slow or unreliable work moves to jobs, and mobile work survives bad networks.

### API rules

- Base path: `/api/v1/{module}`. Breaking changes need a new version.
- Lists use cursor pagination, with a maximum page size.
- Errors use one shape: `code`, `message`, `field`, `requestId`, `retryable`.
- Writes for money, messages and sync need an `Idempotency-Key`.
- Bulk writes follow preview, confirm, status. They never apply on the first call.

```http
POST /api/v1/school/rollovers/{id}/preview
POST /api/v1/school/rollovers/{id}/commit
GET  /api/v1/jobs/{jobId}
```

### Transaction pattern

A use case does these steps in one Postgres transaction:

1. Set tenant context.
2. Check permission.
3. Validate business rules.
4. Write module tables.
5. Write the audit row.
6. Write an outbox event.

A worker reads the outbox, publishes to BullMQ and marks the row done. Consumers store processed event IDs, so repeats are harmless.

### First events

| Event | Consumers |
| --- | --- |
| `people.student.created.v1` | Parent access, search |
| `school.enrolment.started.v1` | Fees, Communications |
| `school.attendance.confirmed.v1` | Absence alerts, rollups |
| `finance.payment.succeeded.v1` | Receipts, notifications, rollups |
| `school.result.published.v1` | Report cards, Communications |
| `school.rollover.committed.v1` | Fees, parent notice, exports |
| `consent.changed.v1` | Feature gates, notifications |

### Job queues

| Queue | Work | Retry |
| --- | --- | --- |
| `notifications` | Push, WhatsApp, SMS and fallback | Backoff, provider switch |
| `documents` | PDFs and bulk report cards | Limited |
| `imports` | Excel validation and commit | Manual review |
| `payments` | Reconciliation | Repeated checks |
| `rollups` | Dashboard tables | Rebuildable |
| `compliance` | Retention, deadlines, Verse AI checks | Scheduled |

Each tenant has fair limits, so one large bulk job can't delay another school.

### Offline sync

First offline flows are teacher attendance and bus attendant marks.

```ts
type SyncEvent = {
  eventId: string;     // UUIDv7 generated on device
  deviceId: string;
  actorId: string;
  occurredAt: string;
  type: 'attendance.mark' | 'trip.mark';
  payload: unknown;
};
```

- The phone stores a local event queue in SQLite.
- The server stores a unique `event_id`, so it accepts each event once.
- Events are append-only, and a read model derives the current state.
- The app shows a pending count, and blocks sign-out with unsent work.
- Conflicts appear as review items. They aren't silently overwritten.

## UI system

The interface should feel like a live control room for the school day. Bold design here means the hardest jobs feel direct, so people stop thinking about menus.

### Brand assets

The [site](https://campusverse.app) and [demo](https://demo.campusverse.app/) expose only a few reusable items. Use them as starting points, and give me any original files you have.

| Asset | Status |
| --- | --- |
| White logo | [SVG on the demo](https://demo.campusverse.app/full_logo_white.svg). Need dark and icon versions |
| Social image | [Site image](https://campusverse.app/og-image.jpg) |
| Brand colours | Cyan `#0AC5FF`, navy `#04266D`, from the V2 product document |
| Font | Plus Jakarta Sans, from the V2 product document |
| Taglines | "Beyond ERP for Modern Educational Institutions", "One Platform. Every Campus. Infinite Possibilities." |
| Illustrations and icons | Please provide. The site uses emoji-style icons, which won't suit the product |

### The big idea: the Day Line

Most ERPs open on stat cards. Campus Verse opens on a horizontal **Day Line**, a live timeline of the institution's day. Attendance, periods, buses, fee deadlines, approvals and problems sit where they occur in time. The present moment is a bright cyan line moving across a navy field.

```text
08:00      09:00      10:30      12:30      15:30      18:00
  |  Buses   | Register |  Marks    | Gate     | Buses     |
--+----------+----|-----+-----------+----------+-----------+--
                  | NOW
     4 classes haven't marked attendance    [ Remind them ]
     2 teachers absent, 3 periods need cover [ Assign cover ]
```

A principal sees the school's pulse immediately. A teacher sees their next period. An accountant sees the money day. Each role uses the same structure with different events. This is the one memorable element, so everything around it stays quiet.

### Second signature: the Verse Bar

A single command line sits at the bottom of every screen on web, and above the tab bar on mobile. People can type a search, a command or a question. It handles three things:

- **Find:** student, parent, receipt or page.
- **Do:** collect a fee, approve leave, or send a notice.
- **Ask:** questions for Verse AI.

It returns an action card with a preview, so most users won't need to learn the menu. `Ctrl K` opens it on desktop.

### Third signature: the Preview Canvas

Every bulk action opens the same full-screen canvas: what will change, who is affected, what could go wrong, and how to undo it. Promotion, sections, fee changes, imports and mass messages all use it. Complex work therefore teaches one reusable behaviour.

### Design tokens

| Token | Value | Use |
| --- | --- | --- |
| `navy-950` | `#04266D` | Day Line, main actions, brand areas |
| `cyan-400` | `#0AC5FF` | Now line, focus, highlights, on navy only |
| `paper` | `#F6FAFD` | Main work surface |
| `ink` | `#071633` | Body text |
| `signal-go` | `#0B8A5A` | Done |
| `signal-warn` | `#B76E00` | Needs attention |
| `signal-stop` | `#C4314B` | Blocked or urgent |

**Contrast rule:** cyan on white is about 2:1, which is too low for text. Use navy text on cyan, or cyan accents on navy, where contrast is about 7:1.

### Type

- Latin: Plus Jakarta Sans.
- Regional: Noto Sans Kannada, Telugu, Tamil and Devanagari, with per-language size and line-height adjustment.
- Use a clear scale of 13, 15, 18, 24, 32 and 48 pixels.
- Marks and money use tabular numbers.

### Layout

- **Work first:** avoid a dashboard made of identical cards. Use the Day Line, focused worklists, spreadsheet grids and side panels.
- **Left navigation:** icons with labels, showing only enabled modules.
- **Scope chip:** always shows campus, institution and year.
- **Record drawer:** opens from any name without leaving the current work.
- **Grids:** keyboard entry, paste from Excel, frozen columns, autosave.
- **Mobile:** one main task per screen, large targets, bottom actions.

### Screens that must feel exceptional

| Screen | Simple experience |
| --- | --- |
| Attendance | Roster fills the screen; tap absentees; a sweep confirms completion |
| Fee Counter | Type a name, see dues, collect, print or share in seconds |
| Marks | Excel-like grid with progress and instant error marking |
| Section Planner | Students move between sections, while balance meters update live |
| Year Rollover | Preview Canvas shows every student's next step |
| Notices | Compose once, see per-language previews and delivery live |
| Parent Home | One child-status sentence, then the next action |
| Bus Attendant | One stop, photo tiles, large tap areas, voice and sound |

### Motion

Motion answers an action. The Day Line advances, a sent notice shows live delivery, and a section move animates the student and updates the meters. Avoid decorative entrances. Respect `prefers-reduced-motion`.

### Rules for Claude Code

- Avoid the generic SaaS look: stat cards everywhere, soft shadows and gradients.
- Every state needs design: loading, empty, error, offline and permission denied.
- Write labels in plain words. Use the same action name from button to confirmation.
- Meet WCAG 2.1 AA, with visible focus and keyboard access.
- Test on a low-end Android phone.
- Test Kannada, Telugu, Tamil, Hindi and Urdu layouts where supported. Urdu needs right-to-left support.

The first screen to design is the Day Line for a principal. Review it with real staff before spreading the pattern.

## Verse AI

Verse AI is one assistant built as a permissioned layer on top of the product. It uses typed tools, so it can never reach data the user couldn't reach.

### Request flow

1. The API authenticates the user and builds their permission context.
2. The Verse Gateway selects allowed tools for that role and page.
3. The model answers or requests tools.
4. Tool calls run through ordinary use cases, with `can()` and RLS.
5. Writes create a preview only.
6. The user confirms, and the normal API commits.
7. Prompt, tools, data classes and result are logged.

### Tool definition

```ts
export const getMissingAttendance = defineTool({
  name: 'school.attendance.missing',
  permission: 'school.attendance.read',
  risk: 'read',
  input: z.object({ date: z.string() }),
  output: z.object({ sections: z.array(SectionRef) }),
  dataClasses: ['operational'],
  handler: attendance.getMissing,
});
```

| Risk | Behaviour |
| --- | --- |
| `read` | Runs with user permissions |
| `draft` | Produces content for review |
| `write` | Preview, confirm, undo where possible |
| `sensitive` | Disabled until explicitly approved in design |

### First-release limits

- Stage A: answers and help.
- Stage B: drafts, translations and import mapping.
- Stage C: confirmed actions and nightly checks.
- No child tutor, behaviour scoring, automatic grading or autonomous mass messages.
- Student risk scores stay out until legal review.

### Safety

- Tool outputs and uploaded files are untrusted data, not instructions.
- Remove sensitive fields before model calls.
- Each organisation has AI budgets and an off switch.
- Models never train on tenant data under your provider terms. Confirm those terms.
- Add an evaluation suite covering permissions, tenant isolation, injection, language and refusal.
- Show sources and dates with answers.
- Verse AI labels itself as AI in every message.

**Data location:** V2 wants inference in Indian regions. Confirm which models and providers support that for your needs before promising it. Until then, send no student data to a model without review.

## Environments

Use three environments, as you asked: development, test and production. Test is the last rehearsal, so it must match production's design. Real student data stays only in production.

| Item | Development | Test | Production |
| --- | --- | --- | --- |
| Purpose | Daily building on your machine | Automated checks, demos and final rehearsal | Real schools |
| Location | Local Docker | Separate AWS account | Separate AWS account |
| Database | Local Postgres 18 | RDS with large synthetic data | RDS Multi-AZ |
| Redis | Local Docker | ElastiCache | ElastiCache |
| Data | Small generated set | Large generated set | Real |
| Payments | Sandbox | Sandbox | Live |
| Messages | Console or allowlist | Allowlisted numbers only | Live |
| Domain | `localhost` | `test.campusverse.app` | `app.campusverse.app` |
| Deploy | Manual local run | Automatic after merge | Approved pipeline only |
| Access | You | You and invited testers | Temporary and logged |
| Backups | Not needed | Short | Full |
| Banner | Green "Development" | Orange "Test" | None |

### Files

```text
.env.example             Names only, committed
.env.development         Local values, ignored
```

Test and production use AWS Secrets Manager, and never `.env` files with real secrets. Config is validated at startup, so a missing value stops the app.

### Rules

- The same Docker image moves from test to production.
- Terraform uses shared modules for both AWS accounts.
- Migrations run on test before production.
- Non-production can message only allowlisted numbers.
- Claude Code has no production credentials.
- Production database access requires a time-limited, logged session.

### Starting commands

```bash
pnpm install
pnpm dev:infra     # Postgres, Redis, mail and object storage
pnpm db:migrate
pnpm db:seed
pnpm dev
pnpm verify        # lint, types, tests, boundaries
```

## Testing and release gates

A module isn't done because it runs once. It is done when its rules, permissions and critical journeys pass automatically.

| Test | Required coverage |
| --- | --- |
| Unit | Rule packs, fees, attendance percentages, grades, promotion |
| Property-based | Money totals, date ranges, proration |
| Integration | Module with real Postgres and Redis |
| RLS | Tenant A can't read or write tenant B, on every table |
| Permissions | Allowed and denied cases, for each role and scope |
| Contract | API compatibility, webhooks, older mobile clients |
| Migration | Forward migration on large synthetic data |
| End to end | Critical web journeys with Playwright |
| Mobile | Offline attendance and parent flows with Maestro |
| Visual | Regional fonts, PDFs and key screens |
| Accessibility | axe checks plus keyboard pass |
| Load | Attendance peak, fee due date, results day |
| Verse AI | Evaluations and injection tests |
| Restore | Monthly backup restore in an isolated environment |

### Critical journeys

1. Set up a school from the wizard.
2. Import students, parents and staff.
3. Parent logs in and sees only their child.
4. Teacher marks attendance offline, then syncs once.
5. Absence alert reaches a guardian or falls back.
6. Parent pays once despite duplicate webhooks.
7. Accountant closes the day.
8. Admission becomes an enrolled student.
9. TC is issued and frozen.
10. Marks publish, and report cards release.
11. Rollover previews, commits and reverses.
12. Student from tenant A can't appear to tenant B.
13. Shared bus shows the right students to each institution.

### Release path

1. Small branch and pull request.
2. CI: `pnpm verify`, security scans, RLS checks and build.
3. `/code-review` and your own review.
4. Merge to `main`.
5. Automatic deployment to test.
6. Migrations, smoke tests and critical journeys.
7. Manual production approval.
8. Production migration, then gradual release.
9. Monitor, with automatic rollback on failure.

Database changes use expand and contract. Index builds use `CREATE INDEX CONCURRENTLY`. Add `lock_timeout` and `statement_timeout` to migrations.

**Solo rule:** Claude Code can review and help, but you approve production. Before real schools join, get an independent security test.

## Claude Code setup

Give Claude Code the project knowledge it can't discover, and enforce the rules that can't have exceptions. Claude Code's [best practices](https://code.claude.com/docs/en/best-practices) separate guidance in `CLAUDE.md` from hard rules in hooks and deny rules. Keep the enforced set small.

### Project files

```text
CLAUDE.md
docs/BUILD_GUIDE.md
docs/specs/SCHOOLS_RELEASE.md
docs/decisions/
.claude/settings.json
.claude/hooks/block-risky.sh
.claude/rules/database.md
.claude/rules/frontend.md
.claude/rules/modules.md
.claude/skills/new-module/SKILL.md
.claude/skills/db-migration/SKILL.md
.claude/skills/rule-pack/SKILL.md
.claude/skills/ui-screen/SKILL.md
.claude/skills/release-check/SKILL.md
.claude/agents/security-reviewer.md
.claude/agents/ui-critic.md
```

### CLAUDE.md

Keep this under [200 lines](https://code.claude.com/docs/en/memory). Long detail belongs in docs, rules or skills. The live file is `CLAUDE.md` at the repo root.

### Path rules

Path-scoped rules [load only for matching files](https://code.claude.com/docs/en/memory), which keeps context small. The live files are in `.claude/rules/`.

### Settings and hard blocks

The live files are `.claude/settings.json` and `.claude/hooks/block-risky.sh`.

The `onFailure` setting needs Claude Code [v2.1.295 or later](https://code.claude.com/docs/en/hooks). The `prod` pattern matches the word prod, not words like product. Adjust it if it blocks ordinary work. A hook is a safety net, not your only protection. Production access must also be absent from your laptop's default credentials.

### Skills

Skills hold repeatable procedures, and they [load only when needed](https://code.claude.com/docs/en/skills). The live files are in `.claude/skills/`.

| Skill | Purpose |
| --- | --- |
| `new-module` | Module scaffold and checklist |
| `db-migration` | Safe schema change process |
| `rule-pack` | New board or state rule pack with source, dates and sample tests |
| `ui-screen` | Build a screen from design rules and verify it visually |
| `release-check` | Manual pre-release review. Set `disable-model-invocation: true` |

### Review agents

Agents live in [`.claude/agents/`](https://code.claude.com/docs/en/sub-agents). Read-only tools make the limit enforceable.

### Working method

1. Start each milestone in a fresh session.
2. Ask for a plan first, and read it before coding.
3. Keep work to one milestone and one branch.
4. Ask Claude to run tests and show results, not just claim success.
5. Run `/code-review` on the diff, and `/verify` for visible app behaviour.
6. Review everything touching money, permissions, migrations and child data yourself.
7. Use `/usage` to watch cost when running agents.

For pull request automation, [`/install-github-app`](https://code.claude.com/docs/en/github-actions) sets up the GitHub Action. Keep production deployment approvals human.

## Build plan

Run these prompts in order. Each one is a milestone, so don't merge several into one session. Start every prompt with this shared opening:

```text
Read CLAUDE.md, docs/BUILD_GUIDE.md and docs/specs/SCHOOLS_RELEASE.md.
Make a plan first and wait for my approval.
Do not change the agreed stack or module boundaries.
When finished, run the checks and show the results.
```

### Milestone 1: Repository

```text
Create the pnpm and Turborepo monorepo exactly as the guide describes.
Add strict TypeScript, ESLint, Prettier, dependency-cruiser, Vitest,
Docker Compose for Postgres 18 and Redis, and environment validation.
Add pnpm verify and GitHub Actions CI.
```

**Exit check:** a fresh clone runs `pnpm verify`.

### Milestone 2: Claude Code rules

```text
Create CLAUDE.md, .claude settings, hook, path rules, skills and review agents
from the guide. Keep CLAUDE.md under 200 lines.
```

**Exit check:** the risky hook blocks a sample production command.

### Milestone 3: Tenant foundation

```text
Build organisation, legal entity, campus and institution tables.
Add migrations, app and migration roles, RLS, FORCE RLS, tenant transaction helper,
synthetic data, and a generic tenant isolation test suite.
```

**Exit check:** tenant A can't read or write tenant B.

### Milestone 4: Identity and permissions

```text
Build accounts, login identifiers, people, guardian links, role assignments,
duties and can(). Add phone OTP, trusted devices, revocable sessions,
Google sign-in for staff, and Redis permission caching.
```

**Exit check:** permission matrix tests pass, including denied cases and restricted guardians.

### Milestone 5: Platform services

```text
Build audit log, consent ledger, notification engine with delivery states and fallback,
document storage, frozen PDFs, Outbox and BullMQ workers.
```

**Exit check:** a duplicate event produces one outcome.

### Milestone 6: Design system and Day Line

```text
Create packages/ui with the tokens, Plus Jakarta Sans, regional font fallbacks,
Day Line, Verse Bar, Preview Canvas, Scope Chip, Record Drawer and Data Grid.
Use the Campus Verse logo I provide. Show all states.
Avoid a generic card dashboard.
```

**Exit check:** you approve a principal Day Line on desktop and phone.

### Milestone 7: School setup

```text
Build the setup wizard and Excel import from the specification.
Create school years, classes, sections, subjects and teacher allocation.
Import previews, row errors and whole-batch undo are required.
```

**Exit check:** a generated school reaches first attendance in one sitting.

### Milestone 8: Students and staff

```text
Build shared student and staff profiles, memberships and school enrolments,
placement contract, documents, guardians and records.
Keep school-only logic in modules/school.
```

**Exit check:** the same person can be represented across institutions without academic table coupling.

### Milestone 9: Attendance

```text
Build teacher attendance on web and mobile, including offline event sync,
leave requests, corrections, shortage, condonation and parent alerts.
```

**Exit check:** offline marks sync once after reconnecting.

### Milestone 10: Parent app

```text
Build parent login, child switcher, feed, notices, leave and message delivery display.
Include shared-phone profile picker and regional languages.
```

**Exit check:** delivery status is correct for every channel.

### Milestone 11: Fees

```text
Build fee plans, invoices, counter, Razorpay online payment, receipts,
concessions, refunds, day close, dues and reconciliation.
Use integer paise and idempotency. Receipts are immutable.
```

**Exit check:** repeated webhooks create one receipt, and all money tests pass.

### Milestone 12: Admissions and certificates

```text
Build the school admissions pipeline and certificates, including TC clearance,
numbering, QR verification and frozen documents.
```

**Exit check:** an enquiry becomes an enrolled student, then later receives a TC.

### Milestone 13: Exams and rollover

```text
Build CBSE school exams, marks grid, locks, report cards, section planner,
and year rollover with preview, commit and undo.
```

**Exit check:** a test school finishes one full year.

### Milestone 14: Super admin

```text
Build apps/admin from the Admin Portal plan: customers, plans, feature flags,
approvals, support access, audit search, delivery health and emergency switches.
```

**Exit check:** you can run a customer without SQL.

### Milestone 15: Verse AI

```text
Build the Verse Gateway, tool registry, Verse Bar answers, sources,
usage budgets, logs and evaluations. Start with read and draft tools only.
```

**Exit check:** Verse AI can't reveal data outside the user's permissions.

### Milestone 16: Test and production

```text
Write Terraform for test and production on AWS Mumbai.
Add deployment, migrations, smoke tests, monitoring, backups and a restore check.
Do not apply anything to production. I will run production steps.
```

**Exit check:** test deploys automatically, and a backup restore is timed.

### Milestone 17: Pilot hardening

```text
Run performance, accessibility, security and critical journey tests.
List every open risk with severity. Do not hide failures.
```

**Exit check:** no open critical issue, an independent security test, and legal review of consent and contracts.

Transport, shared hostel and college modules follow after real pilot learning. The placement contract keeps them open.

## Definition of done, open items and sources

A feature is done only when a school could use it safely and you could support it.

### Definition of done

- [ ] Contract, permissions, audit and events exist.
- [ ] Tenant, permission and rule tests pass.
- [ ] Loading, empty, error, offline and denied states exist.
- [ ] Text uses language files.
- [ ] Works on low-end Android where relevant.
- [ ] Telemetry contains no personal data.
- [ ] Docs and decisions are updated.
- [ ] It has been used end to end in test.

### What I need from you

- [ ] Logo in dark, white and icon versions.
- [ ] Any original Figma or brand files, and permission to use the current site assets.
- [ ] AWS, domain and provider accounts, created by you.
- [ ] The first board and state choice.
- [ ] Decisions left open in the Schools Release Specification.

### Items to verify

- Current Verse AI model options and Indian-region availability.
- BullMQ behaviour on the chosen ElastiCache engine.
- CBSE and state rules listed as unverified in the specification.
- Current DPDP timeline and APAAR instruction.
- Whether `Verse AI` conflicts with any trademark.

The website lists a [₹12,999 one-time setup fee](https://campusverse.app) alongside ₹299. Keep that or remove it, then update the plan text.

### Sources

- [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [Claude Code memory and rules](https://code.claude.com/docs/en/memory)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions)
- [PostgreSQL versions](https://www.postgresql.org/support/versioning/)
- [Amazon RDS PostgreSQL versions](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html)
- [AWS on ElastiCache, Redis OSS and Valkey](https://aws.amazon.com/elasticache/redis/?loc=0&nc=sn)
- [AWS connection pooling comparison](https://aws.amazon.com/blogs/database/understanding-the-differences-between-pgbouncer-and-amazon-rds-proxy-for-postgresql-connection-pooling)
- [Campus Verse site](https://campusverse.app) and [demo](https://demo.campusverse.app/)

The V2 documents, School ERP Blueprint, Admin Portal and Platform Engineering Plan, and Schools Release Specification remain the detailed inputs. Where they conflict, follow your decisions in this guide first.
