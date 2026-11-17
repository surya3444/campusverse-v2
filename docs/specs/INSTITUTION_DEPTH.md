# Institution depth (Milestones 18–22)

Status: Milestones 18–22 built (6 November 2026). Not built from this spec: invigilation duties as time-boxed permissions, hall seating plans, moderation as a separate step, co-scholastic grade entry, and "Ask about this" / form suggestions in Verse AI. Written from the owner's review request: complete profiles, organisation, campus and institution setup with logos, admissions, student and staff records with photos and organised documents, subjects, end-to-end exams, student and staff attendance, strict role-based access, AI first, owner-defined fields everywhere, every action logged and the actor's name shown where the change happened. Owner decisions (6 November): AI providers Claude and OpenAI, switchable; staff attendance by self check-in and the office register; custom roles with a second owner's approval for sensitive grants; custom fields in all four areas, in this order: organisation/campus/institution, admissions, staff, students and guardians.

## Milestone 18: Foundations

**Exit check:** an owner builds a role, a second owner approves its sensitive permissions, the role is assigned to a person for one institution, and that person can do exactly what the role allows and nothing more. Any record shows who created and last changed it, with a History panel. Owners add their own fields to organisation, campus and institution, and those fields appear in the forms and are logged when changed. Photos and documents upload, are scanned, and open through a short-lived link.

| Part             | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who did this     | `RecordStamp` on every record screen: "Created by A · 3 Nov" and "Last changed by B · 2 h ago". `History` panel: the record's audit events, newest first, with the person's name and photo, the action in words, and the reason when one was given. Names come from the person table at read time; audit rows keep ids only                                                                                                                                                                                                                       |
| Custom fields    | Owners define fields per entity (`organisation`, `campus`, `institution`, `admission`, `staff`, `student`, `guardian`): label, key, type (text, long text, number, date, yes/no, single choice, multiple choice, phone, email, file), required, help text, order, section, active. Values live in `custom_field_value` (one row per record and field, typed JSON), validated on the server against the definition. Retiring a field hides it and keeps its values. Changes are audited with the field key, never the value, for personal entities |
| Files            | One upload component for photos (crop to square, JPEG ≤ 2 MB) and documents (PDF, JPEG, PNG ≤ 10 MB). Uses the existing `stored_file` flow: ticket, upload to object storage (the S3 emulator locally; S3 in AWS), scan, then visible. Downloads through short-lived signed links, audited for personal documents                                                                                                                                                                                                                                 |
| Roles and access | Settings → Roles: every role with its permissions grouped by area, in words. Owners duplicate or create roles from the permission catalogue. Sensitive permissions (money, identity numbers, roles and access, data export, custom field definitions) are granted only after a second owner approves. Settings → People and access: who holds which role, where (organisation, campus or institution), from when to when; assign and end. A person can't grant what they don't hold. The last owner can't be removed                              |

## Milestone 19: Organisation, campus, institution and profiles

**Exit check:** the owner sets the organisation's logo, legal details and letterhead; adds a campus and a school after onboarding; each person sets their own photo and contact details; logos appear in the sidebar, on receipts, certificates and report cards.

- Organisation: name, legal entity, GSTIN, PAN (sealed, last four in clear), registered address, logo (square and wide), brand colour for documents, custom fields.
- Campus: name, address, geo-location (for staff check-in), photo, contacts, custom fields. Add, rename, close.
- Institution: everything from onboarding plus logo, principal's signature image (for certificates), affiliation details, custom fields. Add a school to a campus after onboarding; colleges and universities stay "coming soon".
- My profile: photo, name as shown, phone (change needs a code to the new number), email, preferred language. Everyone, including parents.

## Milestone 20: Staff and staff attendance

**Exit check:** the office creates a staff member with photo and documents, assigns roles; the teacher checks in from the phone within the campus geofence; the office sees the day's staff register, corrects a mark with a reason, and the month's staff attendance report adds up.

- Staff record: personal details, contact, employee code, designation, department, joining date, employment type, qualifications, experience, bank details (sealed), PAN and Aadhaar (sealed), emergency contact, custom fields, photo. Exit with date and reason.
- Staff documents in folders: Identity, Qualifications, Employment, Payroll, Other. Each document: kind, file, status (received, verified, rejected with reason), expiry date where it applies, version history.
- Staff attendance: check-in and check-out (web and app) with time and optional location; inside the campus geofence or flagged; the office register per day (present, absent, half day, on leave, on duty) with corrections that need a reason; late and early-leave rules per institution; monthly report and export.

## Milestone 21: Students, admissions and subjects

**Exit check:** an applicant's documents and photo are collected during admission and carry into the student record on enrolment; the student's documents sit in folders with versions; owners' extra admission questions appear on the enquiry form; subjects are added, mapped to classes and teachers, and retired without breaking past marks.

- Admissions: photo and documents per applicant; the owner's extra questions; a timeline of every step with who did it; documents move to the student on enrolment.
- Student record: photo, folders (Identity, Academic, Medical, Transfer, Other), versions, verification by staff with name and time, custom fields for students and guardians.
- Subjects screen: add, rename, code, type (scholastic, co-scholastic, language, elective), offering per class, teacher per section, periods per week; retire keeps history.

## Milestone 22: Exams end to end and AI first

**Exit check:** an exam is planned with a timetable, marks are entered and moderated, results are analysed, report cards published to parents; Verse AI answers with the school's live data from more modules and can switch between Claude and OpenAI without changing a screen.

- Exams: date sheet per class, invigilation duties, hall seating, absent and exempt marks, remarks on screen, co-scholastic grades, moderation step, result analysis (class average, subject toppers, pass rate), report card preview.
- AI: provider adapter for OpenAI beside Claude (`VERSE_PROVIDER` = `claude` | `openai`; key from configuration); tools for staff attendance, admissions, documents pending, subjects and exams; "Ask about this" on record screens; suggestions on forms (map Excel columns, draft remarks), always reviewed by a person before saving. Personal data still goes to a model only after the hosting and terms review (decision 0015).

## Open questions and defaults

| Question                   | Default built                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Who counts as an owner?    | Holders of the `owner` role at organisation scope; the onboarding admin is the first                                                          |
| One owner only?            | Sensitive grants wait until a second owner exists; until then the single owner can grant them with a typed confirmation, logged as unapproved |
| Custom field limits        | 60 active fields per entity; choice lists up to 100 options                                                                                   |
| Geofence radius            | 200 m from the campus location; outside is allowed but flagged                                                                                |
| Photo retention after exit | Kept with the record under the retention policy                                                                                               |
