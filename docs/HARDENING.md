# Pilot hardening record (Milestone 17)

Run on 5 November 2026, on the development machine. Open risks are in `docs/RISKS.md`. Nothing here was run in AWS: the accounts don't exist yet.

## Exit check

| Condition                             | State                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| No open critical issue                | **Not met.** Five critical items are open (RISKS.md C1–C5); none can be closed in code alone |
| Independent security test             | **Not done.** Needs an outside tester (C1). A scope is below                                 |
| Legal review of consent and contracts | **Not done.** Needs a lawyer (C2)                                                            |

## Test table (guide: "Testing and release gates")

| Test                            | Evidence                                                                                                                  | State                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Unit                            | `pnpm test`: 137 tests (rule packs, money, attendance, grades, promotion, planner, gateway, clocks)                       | Pass                      |
| Property-based                  | Money totals, instalment splits, section planner (fast-check)                                                             | Pass                      |
| Integration                     | `pnpm test:integration`: real Postgres and Redis                                                                          | Pass                      |
| RLS                             | `pnpm test:rls`: every tenant table, read and write, both directions; global schemas allowlisted                          | Pass                      |
| Permissions                     | Allowed and denied cases per module; Verse AI exit check; admin roles                                                     | Pass                      |
| Contract (older mobile clients) | —                                                                                                                         | **Not built** (M5)        |
| Migration on large data         | All migrations from empty on a fresh server (Milestone 16); not on a large data set                                       | **Partial** (M6)          |
| End to end                      | `pnpm test:e2e`: 50 journeys and checks, desktop and 360 px phone                                                         | Pass                      |
| Mobile (Maestro)                | Parent app tested through its web build only                                                                              | **Not built** (H6)        |
| Visual                          | Screenshots per journey; PDFs checked by hash in tests; regional fonts not compared                                       | **Partial**               |
| Accessibility                   | axe (WCAG 2.1 AA) on every school screen (`e2e/a11y-sweep.spec.ts`) and every admin screen; keyboard pass on the Day Line | Pass (automated only, M2) |
| Load                            | `load/peak.js` (k6), below                                                                                                | Pass locally (H4)         |
| Verse AI                        | Exit check with misbehaving models; live evaluations written, not run (cost)                                              | Pass (offline)            |
| Restore                         | `pnpm db:restore-rehearsal`: timed; AWS check written, not run                                                            | Partial (C5)              |

## Critical journeys

| #   | Journey                                        | Covered by                                                                       |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Set up a school from the wizard                | `e2e/setup-wizard.spec.ts`, `apps/api/tests/api.db.test.ts`                      |
| 2   | Import students, parents and staff             | same, plus `modules/school/setup/tests` (preview, commit, undo)                  |
| 3   | Parent sees only their child                   | `e2e/parent-app.spec.ts`, attendance and finance parent tests, RLS suite         |
| 4   | Teacher marks offline, syncs once              | `e2e/attendance.spec.ts`, `sync-queue` unit tests, attendance db tests           |
| 5   | Absence alert reaches a guardian or falls back | communications delivery tests (push, WhatsApp, SMS fallback)                     |
| 6   | Parent pays once despite duplicate webhooks    | finance payments tests ("repeated and duplicate webhooks … exactly one receipt") |
| 7   | Accountant closes the day                      | finance office tests, `e2e/fees.spec.ts`                                         |
| 8   | Admission becomes an enrolled student          | `e2e/admissions.spec.ts`, admissions db tests                                    |
| 9   | TC is issued and frozen                        | same, certificate journey test, public QR check                                  |
| 10  | Marks publish, report cards release            | `e2e/exams.spec.ts`, `full-year.db.test.ts`                                      |
| 11  | Rollover previews, commits and reverses        | same                                                                             |
| 12  | Tenant A's student can't appear to tenant B    | RLS suite, Verse AI exit check, admin isolation                                  |
| 13  | Shared bus shows the right students            | **Not applicable yet**: transport follows the pilot (guide)                      |

## Load (k6 against the hardened API image, one vCPU, 1 GB)

Synthetic school from `pnpm --filter @campusverse/api load-school`: 40 sections, 1,400 students, 40 class teachers and 300 parents with logins.

| Scenario                                    | Load                                                                            | Result                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Morning attendance rush                     | all 40 class teachers open the register and submit at the same moment           | 40 of 40 accepted; submit p95 1.0 s                                   |
| Parent app peak (results day, fee due date) | 20 app openings a second for 2 minutes (2,400 openings, home and messages each) | reads p95 39 ms, max 1.2 s; 0 errors of 4,880 requests                |
| Stress (closed loop)                        | 150 parents with no pause                                                       | ~210 requests a second, p95 1.03 s, 0 errors: the ceiling of one vCPU |

Not load-tested yet: online payments at fee due date, publishing a whole school's report cards (PDF generation) and imports of several thousand rows (H4).

## Security checks

| Check                           | Result                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency audit (`pnpm audit`) | 2 moderate, both in development tooling (ESLint's minimatch, Expo CLI's glob); none in running code (L1)                                                  |
| Secret scan (gitleaks, Trivy)   | Nothing outside git-ignored build caches                                                                                                                  |
| Container images (Trivy)        | Was 45 high/critical (Debian packages, npm inside the Node image). Now distroless Debian 13 with no shell or npm: 1 high with no fix published (zlib, M9) |
| Infrastructure (Trivy config)   | No high or critical; two accepted by design (public load balancer, HTTPS egress)                                                                          |
| Injection                       | Every raw SQL fragment and identifier uses constants or typed values; all values are bound parameters                                                     |
| Browser headers                 | CSP, HSTS, COOP, frame-ancestors none, nosniff on web and admin; HSTS also at the load balancer. CSP still allows inline scripts (M1)                     |
| Sign-in brute force             | OTP: 5 attempts per code, send limits per phone and per address; passkeys for staff                                                                       |

## Fixed during this milestone

1. **The live worker couldn't start.** It used the development malware scanner, which refuses to run in production by design. Uploads are now scanned by GuardDuty Malware Protection for S3 (Terraform and a scanner that waits for GuardDuty's tag, fails closed, and is unit-tested); the EICAR check stays for development.
2. **Rate limits would have hit every user at once in AWS.** The API trusted forwarded addresses only from itself, so behind the load balancer every sign-in shared one address, and the web server forwarded the first (client-supplied) address. Now private proxy ranges are trusted and the address the load balancer appended is used.
3. **Container images:** 45 high/critical findings down to 1, with no shell or package manager in running images.
4. **Browser security headers** added (CSP, HSTS and others), checked against a built image with no violations.
5. **Incident and breach workflow** (missing, and required from the start): the admin portal records incidents with the 6-hour CERT-In and 72-hour Board and school clocks, each step and who did it, and writes the incident into each affected school's activity log.

## Suggested scope for the independent security test

Web app, admin portal and API in the test environment, with two synthetic schools: tenant isolation (IDs from the other school in every route), roles and relationships (teacher, parent, accountant, support staff), the session cookies and pass-through, CSRF, file upload and download, payments webhooks, the public QR check, Verse AI prompt injection, the admin portal (passkeys, approvals, support access), and the AWS configuration (read-only review).
