# Campus Verse Schools Release Specification

Nov 4, 2026 · @Surya Karthik Varma Indukuri

> Naming and environment conflicts with the build guide are resolved in `docs/decisions/0002-spec-vs-guide-conflicts.md`. Read "Mitra" as **Verse AI**.

## Summary

One developer cannot build all 27 V2 modules for a first release. The workable first release is a dependable daily school product: setup, students, attendance, parent communication, fees, certificates, then exams and rollover. Everything else stays in the design but waits for paying schools.

**What your answers change:**

| Your answer       | Effect on the plan                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schools only      | Colleges stay in the data model, but OBE, NBA, CBCS, Research and college regulators leave the first release                                           |
| No real customers | V1 importers, parallel runs and V1 retirement are dropped. V1 needs no maintenance plan. Remove its unverified claims from the demo                    |
| Four states       | State rules ship as data packs. Tamil Nadu, Telangana, Andhra Pradesh and Karnataka differ more than expected on age, fees, language and RTE           |
| ₹299              | Keep it, and include core modules. Sell reliability, compliance and support, because rivals list lower prices                                          |
| One developer     | Use managed services, simple tools and a narrow scope. Avoid a separate search engine, event warehouse, dedicated tenant cells and native integrations |

**The biggest point:** the legal date doesn't move for a solo team. Main DPDP duties start on 13 May 2027, so consent, access logs and breach handling belong in the core from the start.

The specifications below combine the V2 documents and our research. They are design recommendations, and they need checking with real schools. State rules change often, so legal and board items need checking against official orders before coding.

## Release scope

Ship in three steps, and let paying schools pull later modules forward. Stage A is what a pilot school needs to stop using paper daily. Stage B makes the year complete. Stage C expands operations.

| V2 module               | Decision                | First-release content                                                        |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| Home                    | Stage A                 | Role home, My Work, group view basics                                        |
| Mitra                   | Stage A onward, limited | Ask and draft first; confirmed actions later                                 |
| M1 Organization         | Stage A                 | Institutions, campuses, users, roles, approvals, consent, audit, import      |
| M2 Academic Structure   | Stage A                 | Years, classes, sections, subjects, teacher allocation, rollover             |
| M3 Admissions           | Stage A, simple         | Enquiry to enrolment, documents, offers. Merit rounds later                  |
| M4 Students             | Stage A                 | Record, guardians, IDs, section changes, TC link                             |
| M5 Attendance           | Stage A                 | Absentee marking, leave, shortage, offline                                   |
| M6 Certificates         | Stage A                 | TC, bonafide, fee and study certificates                                     |
| M14 Fees                | Stage A                 | Structures, collection, online pay, receipts, dues, concessions              |
| M24 Communications      | Stage A                 | Notices, messages, delivery tracking, languages                              |
| M7 Timetable            | Stage B                 | Manual timetable and substitution. Auto-generation later                     |
| M8 Teaching             | Stage B, small          | My Classes, homework, diary, gradebook. No LMS                               |
| M10 Exams & Results     | Stage B                 | Exams, marks, report cards, hall tickets, promotion, board lists             |
| M16 HR                  | Stage B, small          | Staff records, leave, document expiry, TET tracking                          |
| M21 Visitors & Gate     | Stage B, small          | Gate pass and authorised pickup first                                        |
| M23 Helpdesk & Feedback | Stage B, small          | Concerns, committees, safeguarding cases                                     |
| M25 Government Reports  | Stage B                 | UDISE+ and state exports, deadline calendar                                  |
| M18 Transport           | Stage C                 | Routes, stops, attendant and driver apps, GPS by phone                       |
| M12 Library             | Stage C                 | Scan issue and return, fines, clearance                                      |
| M15 Accounts & Expenses | Stage C, small          | Tally export and expenses. No full ledger yet                                |
| M17 Payroll             | Stage C or partner      | Consider exporting to a payroll tool first, because rules are changing       |
| M20 Inventory & Assets  | Stage C, small          | Stock and uniform or book sales                                              |
| M26 Health Connect      | Minimal now, full later | Only allergies, emergency contact and a sick-room log. Full vault later      |
| M22 Clubs & Events      | Later                   | Events with attendance and certificates                                      |
| M19 Hostel & Mess       | Later                   | Build when a boarding school pays for it                                     |
| M27 Career Connect      | Later                   | Mostly for colleges. Keep paid courses away from under-18s                   |
| M9 Course Registration  | Not for schools         | Class 11 stream and language choices live in Students and Academic Structure |
| M11 OBE & Accreditation | Not for schools         | College release                                                              |
| M13 Research & PhD      | Not for schools         | University release                                                           |

**Removed for now:** V1 importers, parallel runs, LTI, OneRoster, on-screen evaluation, recruiter portal, MOOC mapping, ISO work beyond good practice, and SOC 2.

**Health Connect needs a decision.** It is one of your three pillars, but it brings children's health data, the riskiest data you could hold, and a solo team can't yet run a proper vault and partner network. So I recommend keeping the name and selling it later.

## Corrected core

Keep the 12 V2 core blocks, with the corrections below. These decisions are expensive to change later, so they come before any module.

| Block                | Decision                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Campus Tree          | Add **legal entity** as a separate record. Organisation, legal entity, campus and institution stay distinct, and a wizard hides this for single schools                              |
| Academic authority   | Each class or stream links to a board. Colleges reuse this link later for universities                                                                                               |
| Batches and sections | For schools, a **cohort** is the class of students by expected final year. A **section instance** belongs to one academic year. So sections can reshuffle while lineage stays intact |
| Teaching groups      | Separate from homeroom sections, for languages, electives and streams                                                                                                                |
| Student Record       | Permanent person. Enrolments are dated. Names keep history and source                                                                                                                |
| Staff Record         | Designation stays apart from dated duties                                                                                                                                            |
| Rule Packs           | Layered: national, state, board, then school. Each has effective dates, a source and sample tests                                                                                    |
| Permissions          | One `can()` function, with row-level security on `org_id`. Roles scope down the Campus Tree                                                                                          |
| Consent              | One row per student, guardian and purpose. Core-data basis is still a counsel question, so don't label it "exempt" yet                                                               |
| Approvals            | One shared request model across modules                                                                                                                                              |
| Notifications        | Each message tracks channel, delivery, read state and fallback                                                                                                                       |
| Documents            | Issued documents are frozen, with a hash and QR. Corrections create versions                                                                                                         |
| Activity Log         | Keep at least one year, not 180 days. Reads of sensitive data are logged too                                                                                                         |

### Field states that recur everywhere

- **APAAR:** present, refused with evidence, or not generated with a reason. It never blocks admission or a board list. Follow the [Supreme Court's July 2026 order](https://www.livelaw.in/amp/top-stories/supreme-court-directs-centre-cbse-to-amend-apaar-consent-form-to-give-opt-outrefuse-option-restricts-third-party-sharing-of-data-542873), and check the latest CBSE instruction.
- **Aadhaar:** optional, masked and logged.
- **Documents:** required, conditional, optional, pending, verified or rejected.
- **Dues-linked blocks:** off by default. A school can enable them for classes where allowed, and a warning explains the risk.

### Rules for one owner

The V2 menus repeat some jobs, so each job gets one owner.

| Job             | Owner                              | Other modules                         |
| --------------- | ---------------------------------- | ------------------------------------- |
| Promotion       | Academic Structure › Year Rollover | Exams supplies outcomes               |
| TC              | Certificates                       | Students opens the request            |
| Board lists     | Government Reports                 | Exams and Students supply data        |
| Parent meetings | Teaching                           | Communications delivers notices       |
| Marks           | Exams & Results                    | Gradebook is the teacher's entry view |

### Simplified technical choices

These fit one developer and replace heavier V2 suggestions for now.

- One Postgres database on AWS RDS in Mumbai, with no Supabase split.
- Postgres search first. Add Meilisearch only when search is a proven problem.
- A queue with SQS or BullMQ, not both. Choose by what you can run most easily.
- Rollup tables and a read replica, with no event warehouse.
- One shared multi-tenant deployment. Per-tenant keys and dedicated cells wait for a customer who pays for them.
- Use the environment and release rules from the engineering plan, sized down: local, CI, staging and production.

## State packs

The four states need different rule data, so a single "South India" pack won't work. This table reflects press and secondary reports read on 4 November 2026. Rows marked "check" are unresolved. Several items changed during 2026, so verify each against the official order before coding.

| Rule                        | Andhra Pradesh                                                                                                                                                                                | Telangana                                                                                                                                                                                                                                                                                                                                                                                                 | Karnataka                                                                                                                                                                                                                                                       | Tamil Nadu                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026–27 reopening           | Check official order                                                                                                                                                                          | [15 June](https://telanganatoday.com/telangana-reschedules-school-reopening-to-june-15-for-2026-27-academic-year)                                                                                                                                                                                                                                                                                         | [29 May](https://newsable.asianetnews.com/karnataka-news/karnataka-schools-to-reopen-on-may-29-for-2026-27-session-government-releases-academic-calendar-articleshow-7vcgryv)                                                                                   | [4 June](https://www.dtnext.in/news/tamilnadu/tamil-nadu-schools-set-to-reopen-on-june-4-for-2026-27-academic-year)                                                                                                 |
| Working days                | [229, unofficial](https://teachernews.in/?p=62600)                                                                                                                                            | [227](https://www.deccanchronicle.com/southern-states/telangana/telangana-schools-to-have-227-working-days-1962064)                                                                                                                                                                                                                                                                                       | 245                                                                                                                                                                                                                                                             | [210](https://www.dtnext.in/news/tamilnadu/tamil-nadu-155-holidays-210-working-days-for-schools-this-academic-year)                                                                                                 |
| State-school exam structure | Formative and final exams; check details                                                                                                                                                      | SA exams and Class 10 pre-finals                                                                                                                                                                                                                                                                                                                                                                          | FA and SA structure; check                                                                                                                                                                                                                                      | [Three terms](https://www.dtnext.in/news/tamilnadu/tamil-nadu-155-holidays-210-working-days-for-schools-this-academic-year): September, December, April                                                             |
| Class 1 age                 | [Not on the six-year rule in January 2026](https://newsable.asianetnews.com/amp/india/class-1-admission-6-states-defy-centres-6-age-rule-30-comply-articleshow-yg2vtpf); check                | [Five years, undecided in January 2026](https://telanganatoday.com/telangana-yet-to-decide-on-class-i-age-rule-despite-centres-six-year-mandate)                                                                                                                                                                                                                                                          | Six by 1 June, [60-day relaxation for 2026–27](https://www.deccanherald.com/india/karnataka/karnataka-govt-issues-order-on-age-relaxation-for-class-1-3963944)                                                                                                  | [Not on the six-year rule in January 2026](https://newsable.asianetnews.com/amp/india/class-1-admission-6-states-defy-centres-6-age-rule-30-comply-articleshow-yg2vtpf); check                                      |
| RTE 25%                     | [Class 1, portal and two lottery rounds](https://school.careers360.com/articles/rte-andhra-pradesh-admission-2026-27)                                                                         | [Limited by a July 2025 order](https://www.deccanchronicle.com/southern-states/telangana/telangana-government-limits-rte-admissions-in-private-schools-1891291) to areas lacking government school access; [a rollout was planned](https://news.careers360.com/telangana-implement-25-percent-rte-quota-for-ews-children-in-private-schools-report-students-disadvantaged-group-supreme-court/amp); check | [1 km exemption may have been withdrawn](https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fkarnataka-likely-to-withdraw-rte-amendments-3876305); check                                                                                                 | [LKG and Class 1, lottery, under ₹2 lakh income](https://news.careers360.com/tn-rte-2026-registration-tamil-nadu-tnschools-gov-ews-application-begins-lkg-class-1-admissions-apply-may-18-sc-st-parents-family/amp) |
| Fee control                 | [Regulatory commission reported non-functional](https://www.deccanchronicle.com/southern-states/andhra-pradesh/parents-seek-action-against-high-fees-in-private-schools-1962218) in June 2026 | [Bill in draft in May 2026](https://www.deccanchronicle.com/amp/southern-states/telangana/telangana-cabinet-meet-on-may-21-may-take-up-private-school-fee-bill-1956521); [8% every two years proposed](https://telanganatoday.com/telangana-private-schools-reject-proposal-for-8-fee-hike-every-two-years); check                                                                                        | [State control struck down in 2023](https://www.livelaw.in/amp/news-updates/karnataka-high-court-karnataka-education-act-1983-private-unaided-educational-institutions-article-14-219106); disclosure rules disputed                                            | [Committee fixes binding fees for three years](https://thelogicalindian.com/tamil-nadu-passes-bill-to-regulate-private-school-fees-across-the-state-offering-relief-to-parents/); CBSE and ICSE position unclear    |
| Fee display                 | Parents are demanding it                                                                                                                                                                      | Check final law                                                                                                                                                                                                                                                                                                                                                                                           | By [31 December disclosure](https://www.legitquest.com/act/karnataka-educational-institutions-regulation-of-certain-fees-and-donations-amendment-rules-2018/EFE5)                                                                                               | [Notice-board display ordered](https://news.careers360.com/tamil-nadu-cracks-down-on-private-schools-mandates-display-of-government-approved-fee-structure)                                                         |
| Language                    | Check                                                                                                                                                                                         | [Telugu compulsory across boards](https://news.careers360.com/telangana-class-10-students-exempt-non-telugu-compulsory-language-study-hc-petitions-schools-compliance-cbse-icse-ib-private-aided/amp); non-Telugu Class 10 exempt in 2026–27                                                                                                                                                              | Check                                                                                                                                                                                                                                                           | [Tamil teaching directed to Class 10](https://www.dtnext.in/tamilnadu/2023/05/23/tn-private-schools-told-to-teach-tamil-for-students-till-class-10); application to CBSE disputed                                   |
| Class 10 state pass rule    | [35% per subject](https://school.careers360.com/boards/bseap/ap-ssc-passing-marks)                                                                                                            | [80 external, 20 internal](https://telanganatoday.com/telangana-government-takes-u-turn-on-ssc-exams-scheme); marks or grades unclear                                                                                                                                                                                                                                                                     | [33% aggregate](https://news.careers360.com/karnataka-revises-sslc-2nd-puc-passing-marks-starting-from-2026-board-exams-at-par-cbse-other-state-boards), [625 total](https://www.pw.live/kseab/exams/karnataka-sslc-exam-pattern-2025); subject minimum unclear | [35 per subject, Science split](https://www.pw.live/dgetn/exams/tn-sslc-grading-marking)                                                                                                                            |
| State school portal         | cse.ap.gov.in for RTE; other portals check                                                                                                                                                    | Check                                                                                                                                                                                                                                                                                                                                                                                                     | SATS                                                                                                                                                                                                                                                            | [EMIS](https://www.dtnext.in/news/chennai/govt-restricts-issue-of-tc-via-emis-to-prevent-tampering-of-students-data); TC limits reported in 2020, check current rule                                                |
| Parent languages            | Telugu, English                                                                                                                                                                               | Telugu, English, Urdu to test                                                                                                                                                                                                                                                                                                                                                                             | Kannada, English                                                                                                                                                                                                                                                | Tamil, English                                                                                                                                                                                                      |

### What this means for the product

- Every pack stores age rules, calendars, RTE seats, fee limits, language rules, exam structures and portal exports by year.
- Admission age is a warning with an order reference, because a school may follow a relaxation or a differing board instruction.
- Fee limits are warnings by default. Tamil Nadu may need a stronger warning where a government-fixed fee applies.
- Language rules create required teaching groups by state, class and year. A student exemption needs a stored reason.
- Portal support means validated exports and checklists until an official integration exists.
- Tamil Nadu's state-school curriculum is [changing for Classes 1–3](https://www.dtnext.in/news/tamilnadu/tamil-nadu-schools-set-to-reopen-on-june-4-for-2026-27-academic-year), and revision continues for higher classes. Report card templates must expect change.

**Suggested order:** ship CBSE first, because the rules work across all four states. Add one state board next, based on your first paying school. Building four state boards before any customer would waste your time.

## Setup and Organization

**Job:** a school goes from signup to first attendance in one sitting, without seeing the words "tenant" or "legal entity".

**Setup wizard, in order:**

1. School name, state, board, one school or group.
2. Classes run, sections per class, approximate strength.
3. Academic year dates from the state or board template.
4. Review of assumptions: holidays, subjects, fee heads, roles, grading.
5. Upload students, parents and staff from Excel.
6. Invite staff and send a parent app link after a preview.

**Screens:** School Profile, Campuses, Users, Roles, Approvals, Data Import, Privacy & Consent, Activity Log, Settings.

**Status of an institution:** draft, setup, pilot, live, read-only, suspended, closed.

| Rule           | Behaviour                                                                 |
| -------------- | ------------------------------------------------------------------------- |
| Roles          | Copied from templates, and a school can edit its copy                     |
| Scope          | Header always shows campus and institution                                |
| Group settings | Inherited, with local overrides recorded                                  |
| Import         | Preview, valid rows imported, error file returned, whole batch reversible |
| Bulk actions   | Show count and campus before confirming                                   |
| Consent        | Notice versions stored. Parent acceptance recorded per purpose            |

| Edge case                                  | Handling                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| School changes board                       | New programme from a start date; old records stay under the old board  |
| Staff member uses one phone in two schools | One account, two person links, context switch                          |
| Headteacher leaves                         | Owner transfer needs a verified request and the platform approval flow |
| Wrong date formats in Excel                | Parser accepts common forms and flags ambiguous rows                   |
| Duplicate students in import               | Flagged for review, never auto-merged                                  |

**Events sent:** institution created, user invited, role changed, consent changed.

## Admissions

**Job:** one pipeline from enquiry to enrolment, with the school's decision method set by class, board and state.

**Application states:** enquiry, contacted, applied, documents pending, under review, offered, waitlisted, confirmed, enrolled, lost, withdrawn, rejected.

| Screen    | Work done                                                             |
| --------- | --------------------------------------------------------------------- |
| Pipeline  | Kanban by state, filters by class, source and owner                   |
| Enquiries | Quick add, duplicate check by phone, next follow-up                   |
| Forms     | Public mobile form, saved drafts, English and regional versions       |
| Documents | Upload, verification and pending list                                 |
| Seats     | Seats by class and category, including RTE seats                      |
| Offers    | Offer letter, fee due, expiry, waitlist                               |
| Enrol     | Create student, enrolment, fee plan, parent access and handover tasks |

| Rule             | Behaviour                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Age              | Rule pack calculates eligibility for that year. Override needs a reason and order reference            |
| Screening        | Test or interview options are unavailable at RTE-entry levels by default. State packs control the rest |
| Documents        | Elementary admission can proceed with documents pending                                                |
| Fee disclosure   | The offer shows the full fee structure before payment                                                  |
| Sibling priority | Checked against current enrolments. Any discount needs its own approval                                |
| RTE              | Allotted students arrive as a separate source, with exempt fee heads and a reimbursement tag           |
| Rejected data    | Deleted after the cycle plus a dispute period                                                          |

| Edge case                      | Handling                                                          |
| ------------------------------ | ----------------------------------------------------------------- |
| Twins                          | Joint application option; separate student records                |
| Parent applies to two campuses | Linked, with one final seat                                       |
| Offer lapses                   | Seat returns, and the next waitlisted applicant is offered        |
| Fee paid, then withdrawal      | Refund slab applies                                               |
| Mid-year admission             | Attendance starts from joining date; fee prorates by policy       |
| Class 10 or 12 entry           | Warning and principal review, as boards limit it                  |
| Class 11 stream                | Provisional on internal marks, confirmed after the board result   |
| Portal lottery changes         | Allotment can be cancelled with a reason; seat count recalculates |

**Events sent:** application confirmed, student enrolled. **Reads from:** Rule Packs, Fees, Students.

## Students, sections and year rollover

**Job:** keep one trustworthy record, and move students through classes without retyping anything.

**Student states:** applicant, active, on leave, left, passed out, alumni. Enrolment states: active, promoted, conditional, detained, transferred, withdrawn.

**Profile tabs:** Overview, Guardians, Academics, Attendance, Fees, Documents, Consent, Timeline. Each tab appears only where the user has permission.

### Guardians

Students link to any number of guardians. Each link has relationship, primary contact, login, fee payer, pickup, academic messages, fee messages, location access, validity dates and restriction reason. A restricted guardian is blocked in every channel at once.

### Section allocation tool

This tool is missing from V2 and is needed for schools.

1. Select class and year, and set the number and size of sections.
2. Set hard rules: capacity, language availability and keep-apart pairs.
3. Set goals: gender balance, marks spread, friend choices and teacher notes.
4. Generate options and compare balance scores.
5. Drag students, with warnings for broken rules.
6. Commit, assign roll numbers and notify parents at a chosen time.

Sensitive factors are off by default. A warning appears if a setting would create a merit-ranked section.

### Year rollover

1. Checklist: results locked, dues carried, next year created, classes ready.
2. Draft row per student: outcome and next class.
3. Review exceptions and overrides, with reasons.
4. Section allocation.
5. Commit per institution on its own date.
6. Follow-on tasks: fees, IDs, class teachers, parent notice, government export.
7. Undo stays available until the new year is used.

| Rule                | Behaviour                                               |
| ------------------- | ------------------------------------------------------- |
| Promotion           | Comes from the yearly rule pack, never fixed in code    |
| No expulsion option | Hidden up to Class 8                                    |
| Detained list       | Tracked, with extra support tasks where rules need them |
| Dues                | Stay on the old year as arrears                         |
| Section cap         | Warns from the board limit, and needs a reason          |
| After CBSE list     | Warns before Class 10 or 12 section changes             |

| Edge case                        | Handling                                                                   |
| -------------------------------- | -------------------------------------------------------------------------- |
| Student changes section mid-year | New dated enrolment; old attendance stays                                  |
| Sections merge                   | Close, open and move by date                                               |
| New language mid-year            | New teaching groups; homeroom unchanged                                    |
| Campus transfer                  | Same person, new enrolment, fee handled across entities                    |
| Name mismatch across documents   | Keep each version; warn on government exports                              |
| Student returns after leaving    | Same person; school keeps original admission number where its rules say so |

## Attendance and leave

**Job:** a class teacher marks attendance in under a minute, even offline, and the school can prove what happened later.

**Daily flow:**

1. Teacher opens their section, and everyone starts as present.
2. Students on approved leave appear marked.
3. Teacher taps absentees and submits.
4. Parents of absentees are told, after the school's chosen delay.
5. Coordinator sees missing sections.

**Day states per student:** present, absent, late, half day, approved leave, medical leave, school duty, holiday, not enrolled.

| Screen          | Work done                                            |
| --------------- | ---------------------------------------------------- |
| Mark Attendance | Absentee tapping, offline queue, sign-off            |
| Register        | Monthly view and printable register                  |
| Leave Requests  | Parent requests with teacher approval                |
| Shortage        | Running percentage, warnings, evidence of notice     |
| Condonation     | Case file with documents and deadline                |
| Calendar        | Working days by class group, including late holidays |

| Rule              | Behaviour                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corrections       | Original stays; corrections need a reason and show the editor                                                                                                         |
| Sign-off          | Teacher, then competent authority, as configured                                                                                                                      |
| Thresholds        | From rule pack: often 75%, with board dates such as [CBSE's cut-off](https://www.cbse.gov.in/cbsenew/documents/Strict_Compliance_attendance_Eligibility_05082025.pdf) |
| Parent notice     | Delivery proof saved with the warning                                                                                                                                 |
| RFID or biometric | Later source events, reconciled with the teacher's record                                                                                                             |
| Offline sync      | Unique event ID; server accepts once                                                                                                                                  |

| Edge case                       | Handling                                                               |
| ------------------------------- | ---------------------------------------------------------------------- |
| Two teachers mark same section  | Later change shows as a conflict for review                            |
| Student arrives late            | Status updates, and parent gets a correction                           |
| Parent told of absence wrongly  | Correction message sent automatically                                  |
| Holiday declared in the morning | Bulk action, with counts and parent notice                             |
| Substitute teacher              | Temporary permission for that day                                      |
| Phone lost offline              | Unsynced marks are lost, so prompt sync often and show a pending count |

**Events sent:** attendance submitted, absence confirmed, shortage reached. **Used by:** Exams, TC, Communications, Home.

## Parent app and Communications

**Job:** every important message demonstrably reaches a guardian. This is your first selling point, because missing notifications were the most repeated complaint in competitor reviews.

**Parent home:** child switcher and all-children feed, showing today's status, dues, homework and unread notices. Actions are pay, acknowledge, apply leave and message.

**Login:** phone OTP with WhatsApp backup, then a trusted device. Shared phones get a profile picker. Recovery never needs a school visit, unless the phone number is unknown.

**Message states:** draft, approved, scheduled, queued, sent, delivered, read, acknowledged, failed, fallback sent, cancelled.

| Message type        | Channel order                        | Needs approval         |
| ------------------- | ------------------------------------ | ---------------------- |
| Safety or urgent    | Push, WhatsApp, SMS together         | No, for named roles    |
| Absence             | Push, then WhatsApp                  | No, automatic rule     |
| Fee receipt         | Push and WhatsApp                    | No                     |
| Fee reminder        | App, then WhatsApp                   | Schedule approved once |
| Circular            | App, with WhatsApp summary if unread | Principal or delegate  |
| Homework            | App only                             | No                     |
| Whole-school notice | App and WhatsApp                     | Yes                    |

| Rule         | Behaviour                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language     | User language first, with per-language notice versions                                                                                                                                  |
| Bulk send    | Preview in recipient language, count, short undo window                                                                                                                                 |
| Teacher chat | Inside the app, office hours, no personal numbers, school-visible log                                                                                                                   |
| Limits       | Urgency tiers and digests prevent floods                                                                                                                                                |
| Cost         | Per-school budget, usage and alerts. [WhatsApp is charged per message](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md), so model this inside ₹299 |
| SMS          | [DLT templates and entity registration](https://www.plivo.com/docs/sms/concepts/dlt-registration-process) needed                                                                        |

| Edge case                | Handling                                              |
| ------------------------ | ----------------------------------------------------- |
| Parent has no smartphone | SMS and printed notices                               |
| Two guardians            | Each has their own delivery status                    |
| Restricted guardian      | No message, no access                                 |
| App uninstalled          | Falls back and marks the channel unreachable          |
| Wrong notice sent        | Recall where possible, then an automatic correction   |
| Phone number changes     | Verified update, old number removed from future sends |

**Measure for selling:** percentage of urgent alerts delivered within target time, reported to each school.

## Fees

**Job:** a parent sees the bill before paying, always gets a complete receipt, and the accountant closes each day without spreadsheets.

**Structure:** fee head, fee plan by class, instalment schedule, student assignment, invoice, payment and receipt.

**Invoice states:** draft, issued, part paid, paid, overdue, adjusted, written off.

**Payment states:** initiated, pending, succeeded, failed, reversed, refunded, unmatched.

| Screen          | Work done                                               |
| --------------- | ------------------------------------------------------- |
| Fee Plans       | Heads, amounts, instalments, late rules, state warnings |
| Student Fees    | Student's invoices, concessions, ledger and statement   |
| Fee Counter     | Search student, collect, print or share receipt         |
| Online Payments | UPI, card, net banking, later Autopay                   |
| Reconciliation  | Gateway and bank matches, unmatched queue               |
| Concessions     | Request, approval, end date                             |
| Refunds         | Slab calculation, approval, payout record               |
| Day Close       | Cashier totals, cash deposit and differences            |
| Dues            | Ageing, reminders and defaulter reports                 |

| Rule          | Behaviour                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Money         | Decimal maths, stored in paise                                                                              |
| Receipts      | Numbered per legal entity and financial year. Never edited; reversals and credit notes instead              |
| Webhooks      | Verified and [idempotent](https://razorpay.com/docs/webhooks/best-practices/), with a fallback status check |
| Separation    | Maker can't approve their own concession, refund or reversal                                                |
| RTE           | Exempt heads carried by the student's category                                                              |
| Fee limits    | State pack warns on increases or government-fixed fees                                                      |
| Tax class     | Every head has a statutory class. A CA reviews GST defaults                                                 |
| Dues pressure | App access and safety notices are never cut off for dues                                                    |

| Edge case                        | Handling                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Paid, but the app shows failure  | Reconciliation completes it, then sends a receipt                                  |
| Double payment                   | Credit or refund with trail                                                        |
| Cheque bounces                   | Receipt reversed, charge added, parent told                                        |
| Sibling at another entity        | Separate bills and receipts                                                        |
| Part payment                     | Allocated by school rule                                                           |
| Fee changed mid-year             | New plan version; explicit adjustment for students                                 |
| Student leaves                   | Proration, refund and deposit review                                               |
| Staff child                      | Concession head with approver                                                      |
| Offline counter internet failure | Queued receipts are not issued as final until synced; use a clear provisional slip |

**Events sent:** payment succeeded, invoice overdue, refund issued. **Later:** Tally export, Autopay and partner fee financing.

## Timetable, teaching and homework

**Job:** handle daily cover and classroom work first. Auto-generation and an LMS wait.

| Feature         | First-release behaviour                                                | Later                   |
| --------------- | ---------------------------------------------------------------------- | ----------------------- |
| Timetable       | Grid editor with clash checks; versions by effective date              | Auto-generate           |
| Teaching groups | Language and optional groups cross sections                            | Complex electives       |
| Substitution    | Rank free teachers by subject, class and duty count; notify and record | Lesson-note suggestions |
| My Classes      | Today's periods, section, homework, marks, flags                       | Syllabus analytics      |
| Homework        | Text, photo or PDF; parent app; due date                               | Submission and grading  |
| Class Diary     | Daily entry and parent view                                            | Lesson plan links       |
| Gradebook       | Marks entry, paste from Excel                                          | Rubrics                 |
| Parent meetings | Slots, booking, notes                                                  | Video meetings          |

**Timetable states:** draft, published, superseded.

| Rule                 | Behaviour                                                              |
| -------------------- | ---------------------------------------------------------------------- |
| Clash checks         | Teacher, room and teaching group, across institutions for shared staff |
| Published changes    | New version from a chosen date; history stays                          |
| State language rules | Create required subject slots by year                                  |
| Exam overlay         | Exam days can suspend normal periods                                   |

| Edge case                          | Handling                                            |
| ---------------------------------- | --------------------------------------------------- |
| Teacher on leave                   | Leave approval opens cover tasks                    |
| No substitute free                 | Coordinator sees the gap and combines or supervises |
| Teacher leaves mid-year            | Allocation ends by date, and replacement takes over |
| Attachment fails on a slow network | Shows retry and keeps text                          |
| Holiday moved                      | Period and homework dates adjust with a warning     |

## Exams and report cards

**Job:** marks enter once and become accurate report cards, while each board's rules stay in data.

**Exam cycle states:** planned, datesheet published, papers ready, conducted, marks open, marks locked, moderated, approved, published, archived.

**Mark entry states:** blank, entered, absent, medical, unfair means, exempt, not applicable, locked.

| Screen           | Work done                                       |
| ---------------- | ----------------------------------------------- |
| Exam Setup       | Name by class group, components, weights, dates |
| Datesheet        | Timetable overlay and clash check               |
| Marks            | Fast grid, paste from Excel, autosave, progress |
| Verify           | Class teacher, coordinator and principal locks  |
| Hall Tickets     | Optional, with eligibility warnings             |
| Seating & Duties | Basic room plan and invigilation roster         |
| Report Cards     | Template preview, remarks, bulk PDF, release    |
| Board Lists      | Validated export from Government Reports        |

| Rule                | Behaviour                                                   |
| ------------------- | ----------------------------------------------------------- |
| Blank is never zero | Publish is blocked with blanks unless an absent code exists |
| Grading             | Scheme version saved with each result                       |
| Locks               | Post-lock changes need a second person and reason           |
| Publication         | Scheduled release, parent notice and acknowledgement        |
| Dues                | Results and hall tickets aren't blocked by default          |
| Attempts            | Board records can hold more than one attempt                |
| Class 11            | Provisional until the relevant board result                 |
| Templates           | Per board, stage and year                                   |

**First packs:** CBSE school exams, internal assessment and report cards, then the first state pack sold. HPC follows when a customer's board or state requires it. Don't build every format upfront.

| Edge case                     | Handling                                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| Different exam names by class | Class-group labels                                                |
| Absent with a valid reason    | School policy decides retest or committee review                  |
| Student joined mid-year       | Missing components marked not applicable, with a calculation note |
| Marks changed after release   | New version, approval and parent correction                       |
| Language exemption            | Exempt code, with reason and evidence                             |
| Rounding differences          | Rule pack states the rounding method and sample tests             |
| Compartment or improvement    | Pending outcome; provisional placement                            |

**Before coding:** read CBSE's exam bye-laws and each first state's official pass rules. Yesterday's research didn't confirm compartment limits, moderation or grace marks.

## Certificates and TC

**Job:** request, check, issue and verify a document in minutes, with a permanent register.

**Request states:** requested, clearance pending, ready for review, approved, issued, delivered, cancelled, superseded.

| Document                        | First release                       |
| ------------------------------- | ----------------------------------- |
| Transfer Certificate            | Yes, with board and state templates |
| Bonafide, study                 | Yes                                 |
| Fee-paid or tuition certificate | Yes                                 |
| Conduct                         | Yes, by school policy               |
| Migration                       | Where a board requires it           |
| Report card reissue             | Linked to Exams                     |
| DigiLocker issue                | Later                               |

**TC flow:** parent or office request, clearance view, auto-filled draft, class teacher check, principal approval, numbered issue, QR copy, enrolment closed, government export task.

| Rule             | Behaviour                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dues             | Up to Class 8, warnings only, never a block. Above that, it is a school setting with legal advice                                                                     |
| Timing           | Timer follows state packs, such as Karnataka's [seven-day order](https://www.educationworld.in/karnataka-issue-tcs-within-7-days-or-face-action-private-schools-told) |
| Numbering        | Per institution, by type and year, with no reused numbers                                                                                                             |
| Issued copy      | Frozen, with hash and QR                                                                                                                                              |
| Correction       | New version, reason and link to the old one                                                                                                                           |
| Duplicate        | Marked as duplicate                                                                                                                                                   |
| Fields           | Includes board and state IDs, attendance figures and class details                                                                                                    |
| Sensitive fields | Caste and religion print only where required, and data access is logged                                                                                               |

| Edge case                  | Handling                                               |
| -------------------------- | ------------------------------------------------------ |
| Attendance incomplete      | Warning, and principal enters a reasoned value         |
| Student left long ago      | Older records can be imported or entered with evidence |
| State portal must issue TC | Record the external number and upload                  |
| School closes              | Handover plan and export                               |
| Wrong DOB discovered       | Approval with evidence, then new versions where needed |

**Public verification page:** QR shows document type, number, issue date and validity, with no extra student detail.

## Staff records and basic HR

**Job:** keep accurate staff records and cover absences. Delay full payroll, because rules are moving and errors are costly.

**Staff states:** invited, onboarding, active, on leave, notice period, left.

| Screen        | First-release behaviour                         |
| ------------- | ----------------------------------------------- |
| Staff Records | Employment, qualifications, documents, postings |
| Duties        | Dated exam, bus and class-teacher duties        |
| Leave         | Types, balance, approval and cover trigger      |
| Attendance    | Mobile or device import, later biometric        |
| Compliance    | Police check, TET, training and expiry alerts   |
| Exit          | No-dues checklist and access removal            |

| Rule             | Behaviour                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sensitive data   | PAN, Aadhaar, bank and salary hidden by role                                                                                                                                               |
| Duty permissions | Expire with the duty                                                                                                                                                                       |
| TET              | Tracks the [August 2028 deadline](https://www.onmanorama.com/news/india/2026/05/30/sc-rejects-review-pleas-against-tet-mandate-extends-deadline-to-aug-2028.html), with exceptions as data |
| Exit             | Removes access across all campuses the same day                                                                                                                                            |

### Payroll decision

V2 lists full statutory payroll. I recommend deferring it. Labour Code state rules, EPF and tax forms have all been changing, and tax forms were [reported renamed](https://www.businesstoday.in/personal-finance/tax/story/new-income-tax-act-2025-explained-12-key-tax-forms-changing-from-april-1-2026-530661-2026-05-10) in April 2026. A solo developer shouldn't carry liability for salary mistakes early on.

Instead, export attendance, leave and salary inputs for the school's accountant or payroll tool. Add payroll when a paying customer needs it, and when a CA can test it.

| Edge case                     | Handling                                   |
| ----------------------------- | ------------------------------------------ |
| Teacher posted to two schools | One employment, two postings, clash checks |
| Part-time teacher             | Load and days as dated postings            |
| Staff child in class          | Marks entry flagged                        |
| Former student joins staff    | Same person, new employment                |
| Expired police check          | Alert and optional duty block              |

## Mitra in the first release

Mitra should earn trust through answers and drafts first. Give it fuller actions once permissions, logs and data are proven.

| Stage               | Mitra can                                    | Example                                             |
| ------------------- | -------------------------------------------- | --------------------------------------------------- |
| A: Ask              | Answer with sources, within user permissions | "Which classes haven't marked attendance?"          |
| A: Guide            | Explain how to do a task                     | "How do I issue a TC?"                              |
| B: Draft            | Prepare text for review                      | Circular, reminder, report remark, translation      |
| B: Clean data       | Map messy Excel files for approval           | Student import                                      |
| C: Act with confirm | Preview, approve, undo                       | Assign a substitute, schedule reminders             |
| C: Watch            | Nightly tasks                                | Missing marks, overdue documents, deadline warnings |

**Not in the first release:** student tutor, voice for parents, behaviour or risk scores, autonomous agents, grading, and any automatic message to all parents.

**Technical rules:**

- Mitra calls the same permissioned APIs as the app, never raw SQL.
- Every prompt, source and action is logged.
- Sensitive fields such as health, caste, Aadhaar and custody are excluded by default.
- File content and parent messages are treated as data, never as instructions.
- Each tenant has a budget, and the product works if Mitra is off.
- Evaluation tests cover wrong-tenant access, prompt injection, regional language answers and refusals.
- Check model hosting and data terms before sending any personal data. V2 requires Indian-region inference, which needs a provider that actually offers it.

**Cost check:** at ₹299 per student per year, AI and WhatsApp costs come from a thin budget. Set fair-use limits before you sell "unlimited".

## Build order for one developer

Build the foundation first, then one narrow pilot, and treat the 13 May 2027 DPDP date as fixed. Stage C waits until schools are paying. Dates are left out because they depend on how much time you can give each week.

_(Diagram in the original document: solo build order · stages and gates, not to scale.)_

The accented stage must be solid before any real student data enters the system.

### Working rules for a solo developer

- Build one vertical journey at a time, from database to phone.
- Use managed services over self-hosting.
- Automate tests for permissions, money and rule packs before screens.
- Keep staging and backups from the beginning.
- Don't start Stage C during a pilot's busy period.
- Bring in paid help for a security review, a CA check of fees, and a lawyer's check of consent and contracts.
- Find a second person before going live with several schools. One person can't be on call forever, and schools rely on this during fee and exam peaks. Even a part-time support person helps.

### Timing with school calendars

For a June 2027 session in these state boards, or an April 2027 CBSE start, a new school needs setup before its year begins. The safest first pilot is a small part of the year: attendance and notices, then the next fee instalment. Schedule year rollover as a real test at that school's own year-end.

## Open questions and sources

### Decisions for you

- [ ] Does Health Connect stay minimal in the first release?
- [ ] Is full payroll deferred, with exports only?
- [ ] Which board and state does your first pilot use?
- [ ] Does ₹299 include WhatsApp, or is there a fair-use limit?
- [ ] Does a setup fee stay alongside ₹299?
- [ ] Who gives legal and CA review, and who supports schools with you?

### Facts still to confirm

- [ ] CBSE's latest APAAR and board-list instruction after July 2026.
- [ ] Whether the DPDP timeline has been shortened.
- [ ] Whether Karnataka withdrew its 1 km RTE exemption.
- [ ] Telangana's current fee law and RTE rollout.
- [ ] Andhra Pradesh and Tamil Nadu 2027–28 Class 1 age rules.
- [ ] Whether Tamil Nadu's fee law covers CBSE and ICSE schools.
- [ ] Tamil Nadu's current EMIS TC rule. The source found dates from 2020.
- [ ] Official Andhra Pradesh calendar, Telugu and portal rules.
- [ ] Karnataka and Andhra Pradesh language rules for private boards.

### Sources

Main inputs were the Campus Verse V2 Complete Product Document and Rebuild Blueprint, supplied on 4 November 2026, plus the School ERP Blueprint and Admin Portal and Platform Engineering Plan. State facts are linked in the State packs section. Key sources added today:

- [Tamil Nadu 2026–27 calendar report](https://www.dtnext.in/news/tamilnadu/tamil-nadu-155-holidays-210-working-days-for-schools-this-academic-year)
- [Tamil Nadu fee law report](https://thelogicalindian.com/tamil-nadu-passes-bill-to-regulate-private-school-fees-across-the-state-offering-relief-to-parents/)
- [Tamil Nadu RTE 2026](https://news.careers360.com/tn-rte-2026-registration-tamil-nadu-tnschools-gov-ews-application-begins-lkg-class-1-admissions-apply-may-18-sc-st-parents-family/amp)
- [Andhra Pradesh RTE 2026–27](https://school.careers360.com/articles/rte-andhra-pradesh-admission-2026-27)
- [Andhra Pradesh fee regulation report](https://www.deccanchronicle.com/southern-states/andhra-pradesh/parents-seek-action-against-high-fees-in-private-schools-1962218)
- [Telangana RTE order](https://www.deccanchronicle.com/southern-states/telangana/telangana-government-limits-rte-admissions-in-private-schools-1891291)
- [Telangana Telugu memo](https://news.careers360.com/telangana-class-10-students-exempt-non-telugu-compulsory-language-study-hc-petitions-schools-compliance-cbse-icse-ib-private-aided/amp)
- [Telangana 2026–27 calendar](https://www.deccanchronicle.com/southern-states/telangana/telangana-schools-to-have-227-working-days-1962064)
- [States outside the six-year rule](https://newsable.asianetnews.com/amp/india/class-1-admission-6-states-defy-centres-6-age-rule-30-comply-articleshow-yg2vtpf)
