# Campusverse

The rule book is docs/rulebook/ ("Campusverse vs CampX — Competitive Analysis & System Architecture",
13 Nov 2026). It overrides every other document in this repo, including docs/decisions and docs/specs.
Before planning or building anything, look up the relevant section (index: docs/rulebook/README.md;
grep docs/rulebook/*.txt). This file is a summary; the rule book text wins where they differ.

## Product (§1, §12)

- Wordmark "Campusverse" (one word). The AI is **Verse AI**. The owner overrode the rule book's
  rename (§1, §14.5): never rename it to Mitra. Wherever the rule book or this file says "Mitra"
  (Mitra Watch, Mitra Agents, Ask Mitra…), read and build it as Verse AI (Verse AI Watch, and so on).
- One platform for schools, colleges, universities and groups/trusts. Each institution has an
  institution profile that switches modules, vocabulary, rule packs and ready-made roles (§12.3).
  Coaching and training centres are out of scope.
- Layers (§12.2): Experience (role dashboards, My Work, All Institutions; web admin; teacher, parent,
  student, staff, driver/warden apps; applicant, recruiter, partner portals) → Mitra → nine systems →
  Campus Core → data in India.
- Nine systems and their modules (§13.1):
  - Enrollment: Admissions CRM, Applications, Merit & Seat Allocation, Offers & Onboarding
  - Academics: Academic Structure, Course Registration, Timetable, Attendance, Teaching & Learning,
    Assessments, Exams & Results, OBE, Feedback & Surveys, Library, Research & PhD
  - Students: Student Records, Certificates & ID Cards, Mentoring, Clubs & Events
  - Finance: Fees, Scholarships & Concessions, Accounts & Expenses
  - People: HR, Staff Attendance & Leave, Appraisals & Development, Payroll
  - Operations: Transport, Hostel & Mess, Inventory & Assets, Facilities & Maintenance, Visitors & Gate, Helpdesk
  - Health Connect: Health Records, Medical Visits & Stock, Emergency, Counselling & Wellbeing, Care Network
  - Career Connect: Placements, Internships, Skill-Up & Micro-credentials, Career Guidance, Alumni
  - Quality & Compliance: Accreditation, Government Reports, Grievances & Committees, Compliance Monitor
- Campus Core services: Organization & Hierarchy, Identity & Access, Rule Packs, Workflow & Approvals,
  Communications, Documents & e-Sign, Privacy & Consent, Activity Log, Reports & Analytics,
  Integrations Hub, Data Import.
- Keep V1 module names inside systems. Payroll stays in People (posts a salary journal to Finance).
  Library is in Academics (fines flow to Fees). OBE is in Academics; Accreditation in Quality & Compliance.
- "For" in §13 says which profiles get each sub-module (All, School, College, University, HE).

## Architecture decisions (§12.4, §16)

1. Organisation hierarchy: typed nodes of any depth (Group → University/School Group → Campus →
   Institution → Institute/Wing → Department). Affiliation is a link, not a parent.
2. Three linked trees: organisation; curriculum (program → regulation → courses); cohort
   (batch → term → section → enrolment). Batches keep their regulation version.
3. One lifelong learner record with APAAR, ABC and PEN (optional, with consent; enforced only at the
   step that needs it). Batches advance by terms, never by copying a year.
4. One staff record across the institutions of a group.
5. Sub-ledgers (fees, payroll, purchases) post to one general ledger per legal entity, with fund accounting.
6. One workflow and approval engine (roles, scopes, amount limits, timers, escalation) for every module.
7. One communications service (SMS with DLT, WhatsApp, email, push, in-app; templates per language).
8. OpenAPI 3.1 contract per module; events between systems; Integrations Hub for outside systems.
9. Reporting store fed by events; reports and Mitra read it, never the daily tables.
10. Access = role × scope node × relationship × data class (§10.3). SSO, MFA for staff, OTP for parents.
11. Regulation is data: versioned, effective-dated, tested rule packs + obligation register +
    evidence store + Mitra Watch (§15.1). A new circular is a pack version, not a release.
12. Mitra: one orchestrator over permissioned tools via a model-neutral gateway.
13. Health Connect: separate vault and keys; other systems get a status only ("medical leave").
14. Career Connect: reads the academic record with consent; paid content hidden from under-18s.

- Every entity has exactly one owning system (§16.1). Others read through its API or events and never
  keep their own copy.
- Tenant isolation by row-level security on tenant and hierarchy node; tenant keys; data hosted in India.
- Sensitive data (health, counselling, category/caste certificates) is opt-in per role. Group owners
  and principals see health totals, never names. Break-glass needs a reason, alerts the DPO, expires.
- Activity Log: tamper-evident, India-hosted, kept 180 days or more, includes every Mitra step.
- The seven end-to-end workflows in §16.2–16.8 are the contract for how systems hand off.

## Mitra (§14)

- One assistant, tools and tone chosen by role. Tools are the same permissioned APIs the screens use;
  Mitra never reads tables directly. Every request passes the policy guard first.
- Action classes (§14.4): read and answer (show sources); draft (nothing leaves draft without a person);
  reversible action (preview + one confirm); sensitive action (confirm + second approver: results,
  bulk messages, refunds, offers, consent changes, anything about health); never (train on institution
  data, profile or advertise to children, read counselling notes, act without a user).
- Risk scores show their reasons and never trigger action alone. Students under 18 get study help only.
- Each agent ships with a test set and is re-tested on every model change.

## Compliance dates (§15)

- DPDP main duties start 13 May 2027. Consent and guardian verification live before then is the gate
  that beats everything else. Consent Manager rules from about mid-November 2026.
- Labour Codes in force since 21 Nov 2025: 50% wage rule, gratuity for fixed-term staff, appointment
  letters, wages within two working days of the last working day.
- CERT-In: incidents reported within 6 hours; ICT logs 180 days in India.
- §15 is a summary of public sources, not legal advice; counsel confirms privacy and labour items.

## Roadmap (§17)

- Build P0 → P1 → P2 → P3 in the phase order of §17.5. Nothing is built only because CampX has it.
  FFCS, proctoring, face attendance, bring-your-own model and perpetual licences are deliberately late.
- Never repeat the four demo defects: OBE COs "at target" while POs are below; course registration
  listing the wrong semester parity; payroll runs for future periods or "all paid" with 0 credited;
  named health data on the owner dashboard.
- No unproven claims on any screen ("SOC 2 compliant", "500+ institutions", "2M+ students").

## UI

- The UI is the exact UI of ~/Projects/campusverse/campus-verse-hub/apps/web: colours, fonts,
  alignment, shell, sidebar, top bar, profile and record pages. When unsure, check what the hub does.
  The only allowed deviations are WCAG 2.1 AA fixes.
- WCAG 2.1 AA on every screen. Languages: English, then Hindi, Telugu, Tamil, Kannada, Malayalam.

## Where the build stands

docs/PLATFORM_MAP.md lists every module's status; apps/web/lib/systems.ts drives the sidebar (systems as
sections, their modules as rows, a module with several pages folding them, as the hub does) and /apps from it.
Self-serve sign-up (/signup) and onboarding take schools, colleges and universities; colleges land on a
getting-started home and can enrol a batch from a file and import staff in Data Import. Schools see every
year's classes, sections, class teachers and headcounts on /classes, and Year end sets up next year in one step;
/years shows each year's life (status from its dates) and closes an ended year (attendance and exams refuse changes)
or reopens it with a reason. Staff are added with a work role (teacher, office, driver, bus attendant, security,
warden, nurse, or support without app access) and carry safety checks (police verification; licence and medical
fitness for drivers); routes refuse crew without them. Enrolment gives a roll number and a welcome message to the family.
ID cards print per section (Classes) or per student (profile); the student list has a year picker for past years. Built against the rule book so far: the nine-system map; institution profiles and the academic engine (programs, versioned regulations,
batches that advance by terms; colleges and universities first, schools still on school/setup); course
registration with credit limits, elective seats and approval; college exams and results (UGC 10-point,
SGPA/CGPA, published with approval; internal assessment components from the regulation; supplementary and
revaluation re-exams; eligibility from attendance and overdue fees, QR hall tickets, ineligibility notices); college
attendance period by period, with shortage against the credits pack and condonation through Workflow; OBE (versioned
programme outcomes, COs with the CO–PO/PSO matrix and tagged items, direct attainment with POs only from COs); the Workflow & Approvals engine (designer,
amount limits, escalation, My Work; bills, registrations, settlements, results, staff leave, refunds and
notices on it); Rule Packs (versions with test cases, released by a second owner, switched on per
institution by date; payroll, credits, grading and the school board rules read them);
data classes on every permission, case grants for sensitive data and a Check access explainer (§10.3);
the Data Import centre with Campusverse V1 importers for students and staff; final settlements with gratuity
and the two-working-day deadline, the wage-rule warning on salaries, arrears from back-dated revisions,
LWF by state and the ESI monthly file, TDS challans with the 24Q worksheet and Form 16 Part B figures; Privacy & Consent (console,
data-rights requests, breach register, guardians deciding in the parent app, guardian verification
under DPDP Rule 10); the Activity Log
with hash-chain seals; PEN and ABC ID on the learner record; Health Connect's vault, visits, totals
and break-glass; UDISE+ readiness and APAAR reconciliation from UDISE+; the ABC & NAD credit file; payroll's ECR file and challan totals. docs/decisions/ predates
the rule book; where a decision conflicts with it, the rule book wins.

Commands for running the repo are recorded in docs/archive/old-instructions/CLAUDE.md (Commands
section). That file is reference only; its rules are superseded.
