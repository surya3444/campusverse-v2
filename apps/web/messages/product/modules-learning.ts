// Live modules of Enrollment, Academics and Students, explained for the public product pages.
import type { ModuleContent } from './types';

export const LEARNING_MODULES: Record<string, ModuleContent> = {
  admissionsCrm: {
    tagline: 'Every enquiry, every follow-up, every seat, in one pipeline.',
    overview:
      'The Admissions CRM is where the season is run. Enquiries arrive from walk-ins, calls, web forms and campaigns with their source; counsellors move families through clear stages; seats are set by class and category so nobody is offered a seat that doesn’t exist; and the pipeline shows where every family stands.',
    capabilities: [
      [
        'Enquiries from every source',
        'Walk-in, phone, web form, campaign or the RTE portal, each tagged so you know what works.',
      ],
      [
        'A pipeline with rules',
        'Only allowed moves between stages; closing an application needs a reason.',
      ],
      [
        'Duplicate and sibling checks',
        'The same phone and child in a year is one enquiry; a current parent’s phone flags a sibling.',
      ],
      [
        'Seats by class and category',
        'Offered, confirmed and enrolled each hold a seat; the count never goes negative.',
      ],
      [
        'Waitlist that moves itself',
        'A lapsed offer frees its seat and offers the next family on the waitlist.',
      ],
      [
        'Your own questions',
        'Add the fields your school asks; they travel with the application to the student record.',
      ],
    ],
    steps: [
      ['Capture', 'Record the enquiry with the child’s class, the family’s phone and the source.'],
      ['Follow up', 'Move the family along the stages as calls and visits happen.'],
      ['Decide', 'Offer within the seats, hold on the waitlist, or close with a reason.'],
      ['Hand over', 'A confirmed family goes to enrolment in one step.'],
    ],
    roles: [
      ['Counsellor', 'Captures enquiries and keeps families moving.'],
      ['Principal', 'Sets seats and makes offers.'],
      ['Administrator', 'Sees the whole season and its sources.'],
    ],
    guardrails: [
      'Age outside the board’s rule needs an override with an order reference',
      'RTE applications only from the RTE portal source',
      'Every move is written to the application’s own history',
    ],
    related: ['applications', 'offersOnboarding', 'studentRecords'],
  },
  applications: {
    tagline: 'Online application forms families can finish on a phone.',
    overview:
      'Each admission year gets an online form with its own public link. Families confirm their mobile number with a code, fill in the child’s and guardians’ details, and see where their application stands in plain words. Papers and the child’s photo are checked by the office, and all of it moves to the student’s record on enrolment.',
    capabilities: [
      [
        'A form per year',
        'A public link per admission year, with the classes and questions you choose.',
      ],
      [
        'Verified mobile numbers',
        'A code to the family’s phone, checked last so a form mistake doesn’t use it up.',
      ],
      [
        'Status in family words',
        'Families check their application without signing in or calling the office.',
      ],
      [
        'Papers checked one by one',
        'Birth certificate, previous TC and others marked verified or returned with a note.',
      ],
      [
        'The child’s photo',
        'Uploaded once, checked, and carried to the student record and ID card.',
      ],
      [
        'Audited without an account',
        'Even submissions from the public are written to the activity log.',
      ],
    ],
    steps: [
      ['Publish', 'Open the form for the admission year and share the link.'],
      ['Apply', 'The family fills it in on a phone and confirms their number.'],
      ['Check', 'The office verifies papers and the photo.'],
      ['Move on', 'The application joins the pipeline for an offer.'],
    ],
    roles: [
      ['Parent and applicant', 'Fills in the form and follows its status.'],
      ['Front office', 'Checks papers and answers questions.'],
      ['Admissions head', 'Opens the form and reviews applications.'],
    ],
    guardrails: [
      'A code confirms the phone before anything is submitted',
      'Papers open only for the people working the application, every opening audited',
    ],
    related: ['admissionsCrm', 'offersOnboarding', 'certificates'],
  },
  offersOnboarding: {
    tagline: 'Offer, confirm and enrol in one step.',
    overview:
      'An offer is made only against a published fee plan for the class and a free seat, so the family sees the full bill first. Offers lapse after seven days. When a family confirms, enrolment creates the student record, places the child in a section with the next roll number, issues the fee invoices, links the guardian with parent access and sends a welcome message with how to sign in.',
    capabilities: [
      ['Offers with full disclosure', 'No offer without a published fee plan for the class.'],
      ['Seven-day offers', 'An unconfirmed offer lapses and the seat goes to the waitlist.'],
      [
        'Enrolment in one transaction',
        'Student record, admission number, section, roll number and invoices together.',
      ],
      [
        'Parent access straight away',
        'The guardian is linked with the parent role and gets a welcome message.',
      ],
      ['Papers carried over', 'The photo and every checked paper move to the student’s documents.'],
      [
        'A handover checklist',
        'What the office still needs, such as documents pending or RTE paperwork.',
      ],
    ],
    steps: [
      ['Offer', 'Choose the family in the pipeline and send the offer.'],
      ['Confirm', 'The family confirms before the offer lapses.'],
      ['Enrol', 'Pick the section and start date; everything else is created for you.'],
      ['Welcome', 'The family receives the class, admission number and how to sign in.'],
    ],
    roles: [
      ['Principal', 'Makes offers.'],
      ['Office', 'Enrols confirmed families and completes the checklist.'],
      ['Parent', 'Confirms and signs in to the app.'],
    ],
    guardrails: [
      'Instalments already due are not billed to a late joiner',
      'Admission numbers per year with no gaps',
      'The welcome message goes once per student, whatever the retries',
    ],
    related: ['admissionsCrm', 'studentRecords', 'fees'],
  },
  academicStructure: {
    tagline: 'Years, classes and sections, or programmes, regulations and batches.',
    overview:
      'Academic Structure is the map everything else follows. Schools set up a year with classes, sections and subjects, copy it to the next year in one step, see every year’s classes and headcounts, and close a year once its records are final. Colleges and universities define programmes, versioned regulations course by course, and batches that keep their regulation and advance by terms.',
    capabilities: [
      [
        'Setup guide',
        'The year, classes, sections and subjects in a few steps, with capacities and class teachers.',
      ],
      [
        'Programmes and regulations',
        'Versioned regulations with courses, credits and internal assessment components.',
      ],
      [
        'Batches that keep their rules',
        'A batch admitted under a regulation stays on it when the curriculum changes.',
      ],
      [
        'Next year in one step',
        'Classes, sections and subjects copied to the next year from the calendar.',
      ],
      [
        'Every year at a glance',
        'Classes, sections, class teachers and headcounts for any year, past or next.',
      ],
      [
        'Closing a year',
        'A closed year is read-only; reopening needs a reason in the activity log.',
      ],
    ],
    steps: [
      ['Choose a profile', 'School, affiliated or autonomous college, or university.'],
      ['Build the structure', 'Classes and sections, or programmes, regulations and batches.'],
      ['Run the year', 'Every module works on this structure through the year.'],
      ['Advance and close', 'Promote or advance terms, set up the next year, lock the old one.'],
    ],
    roles: [
      ['Academic coordinator', 'Builds and maintains the structure.'],
      ['Principal or dean', 'Approves and closes years.'],
      ['Office', 'Enrols students into sections or batches.'],
    ],
    guardrails: [
      'Batches advance by terms, never by copying a year',
      'Section changes end the old enrolment and keep its history',
    ],
    related: ['timetable', 'courseRegistration', 'exams'],
  },
  courseRegistration: {
    tagline: 'The right courses for the right term, within the credit rules.',
    overview:
      'Each batch term gets a registration window with dates, minimum and maximum credits and seats for each elective. Students get every compulsory course of the term and choose their electives; the selection is checked against the credit limits and seats as they choose. Registrations are approved, or returned with a reason, by someone other than the person who entered them.',
    capabilities: [
      [
        'Windows per batch term',
        'Dates, credit limits from the programme’s framework, and elective seats.',
      ],
      [
        'Compulsory courses included',
        'Core, lab and project courses of the term added automatically.',
      ],
      [
        'Electives with seats',
        'Seats are counted under a lock, so two students never take the last one.',
      ],
      [
        'Only this term’s courses',
        'Courses come from the batch’s regulation for its current term, never another semester.',
      ],
      ['Approval or return', 'With a reason; a returned registration frees its seats.'],
      ['Changes in the window', 'A change resubmits for approval.'],
    ],
    steps: [
      ['Open', 'Set the window, credits and seats for the batch term.'],
      ['Register', 'Students choose electives within the rules.'],
      ['Approve', 'The adviser approves or returns with a reason.'],
      ['Teach', 'Approved registrations drive attendance and exams.'],
    ],
    roles: [
      ['Student', 'Chooses electives.'],
      ['Faculty adviser', 'Approves or returns registrations.'],
      ['Academic office', 'Opens windows and watches seats.'],
    ],
    guardrails: [
      'Never lists another semester’s courses',
      'Nobody approves a registration they entered',
    ],
    related: ['academicStructure', 'attendance', 'exams'],
  },
  timetable: {
    tagline: 'Clash-free weeks, by hand or generated under your rules.',
    overview:
      'Build each section’s week on the bell schedule, cell by cell, or let the generator do it from periods per week and subject teachers. The generator keeps the rules you set and prefers what you ask for, shows the week before anything changes, and places exactly what you saw. Publish from a date; teachers on leave get cover from ranked free teachers.',
    capabilities: [
      ['Bell schedules', 'Periods, breaks and working days per version.'],
      [
        'A generator with rules',
        'Teachers’ days off and unavailable times, most periods a day and week, double periods, labs.',
      ],
      [
        'Preferences',
        'Morning or afternoon subjects, the class teacher first, the same period daily, compact or balanced days.',
      ],
      [
        'Preview, then place',
        'See the week section by section, try another arrangement, then place it.',
      ],
      [
        'Teaching groups',
        'Sections that split by subject, such as second languages, in one period.',
      ],
      ['Cover for absences', 'Free teachers ranked for each lesson of an absent teacher.'],
    ],
    steps: [
      ['Schedule', 'Set the bell: periods, breaks and days.'],
      ['Generate', 'Choose rules and preferences and run the generator.'],
      ['Adjust', 'Change any cell; clashes are refused, naming the other section.'],
      ['Publish', 'From a date; the week shows in every app.'],
    ],
    roles: [
      ['Timetable coordinator', 'Builds, generates and publishes.'],
      ['Teacher', 'Sees their week and cover periods.'],
      ['Parent', 'Sees the child’s day.'],
    ],
    guardrails: [
      'No teacher, section or room is ever in two places at once',
      'Published versions are frozen; changes are a new version',
      'A shared teacher can’t clash with another school’s timetable',
    ],
    related: ['academicStructure', 'attendance', 'hr'],
  },
  attendance: {
    tagline: 'Attendance in seconds, even offline, with parents told.',
    overview:
      'Teachers mark the day for schools, or period by period for colleges, from the web or the app, offline if the network drops; the marks sync once when it returns. Parents hear about an absence, holidays and leave are handled, and shortage against the attendance rule is shown with condonation through approvals.',
    capabilities: [
      [
        'Day or period attendance',
        'The school register by day, or college attendance by period and course.',
      ],
      ['Works offline', 'Marked on the phone and synced exactly once.'],
      ['Absence alerts', 'Parents told about an absence, and told again if it’s corrected.'],
      [
        'Leave and holidays',
        'Parents ask for leave in the app; holidays are declared with a preview.',
      ],
      [
        'Shortage and condonation',
        'Shortage against the credits rule, condonation through the approval engine.',
      ],
      ['Corrections with a trail', 'A changed mark keeps who changed it and why.'],
    ],
    steps: [
      ['Mark', 'The teacher marks the section or period.'],
      ['Sync', 'Offline marks arrive once the phone is online.'],
      ['Inform', 'Parents hear about absences.'],
      ['Review', 'Shortage, leave and condonation handled by the office.'],
    ],
    roles: [
      ['Teacher', 'Marks attendance.'],
      ['Class teacher', 'Corrects and approves leave.'],
      ['Parent', 'Sees the day and asks for leave.'],
    ],
    guardrails: [
      'A closed year’s register can’t change',
      'Exam eligibility reads attendance, never a copy of it',
    ],
    related: ['timetable', 'exams', 'studentRecords'],
  },
  teaching: {
    tagline: 'Homework, the class diary, syllabus coverage and lesson plans.',
    overview:
      'Teachers set homework for one or more sections with photos or PDFs, and parents see it with a done tick. The class diary keeps the day’s notes. The syllabus is planned in units by month, ticked off per section, and coverage shows which sections are behind; lesson plans sit beside it.',
    capabilities: [
      ['Homework with files', 'Up to three photos or PDFs, due today to 60 days ahead.'],
      [
        'Parents in the loop',
        'Guardians see open homework and tick it done; a new due date tells them again.',
      ],
      ['The class diary', 'Entries per section and day, general notes by the class teacher.'],
      ['Syllabus units', 'Planned by month for each class and subject.'],
      ['Coverage by section', 'Covered against expected, with sections that are behind.'],
      ['Lesson plans', 'One per section, subject and day.'],
    ],
    steps: [
      ['Plan', 'Units of the syllabus by month.'],
      ['Teach', 'Lesson plans and the class diary.'],
      ['Assign', 'Homework to the sections you teach.'],
      ['Track', 'Coverage and homework done counts.'],
    ],
    roles: [
      ['Teacher', 'Sets homework, writes the diary, ticks the syllabus.'],
      ['Academic coordinator', 'Watches coverage across sections.'],
      ['Parent', 'Sees homework and marks it done.'],
    ],
    guardrails: [
      'Teachers set homework only where they teach',
      'Attachments open only for staff or guardians of children in those sections',
    ],
    related: ['timetable', 'exams', 'attendance'],
  },
  exams: {
    tagline: 'From marks entry to report cards and hall tickets.',
    overview:
      'Exams and results are run from the board’s or university’s rules. Schools create exams by class, enter marks in a grid with codes for absent and exempt, lock and publish with report cards. Colleges get internal assessment components from the regulation, SGPA and CGPA on the UGC scale, results published only after approval, supplementary and revaluation exams, eligibility checks and QR hall tickets.',
    capabilities: [
      [
        'Marks in a grid',
        'Typed like a spreadsheet, with codes for absent and exempt and checks against the maximum.',
      ],
      ['Grading from the rules', 'CBSE for schools, UGC 10-point with SGPA and CGPA for colleges.'],
      ['Approval before publishing', 'Results publish only after a second person approves.'],
      ['Report cards', 'Issued as documents with a QR check.'],
      [
        'Eligibility and hall tickets',
        'From attendance and overdue fees, with ineligibility notices and QR hall tickets.',
      ],
      ['Re-exams', 'Supplementary and revaluation, with the better result kept.'],
    ],
    steps: [
      ['Set up', 'Exams, papers and the date sheet.'],
      ['Enter', 'Marks per paper and section; submit and lock.'],
      ['Approve', 'Results checked and approved.'],
      ['Publish', 'Report cards and results to students and parents.'],
    ],
    roles: [
      ['Exam cell', 'Sets up exams, locks and publishes.'],
      ['Teacher', 'Enters marks for their papers.'],
      ['Principal or controller', 'Approves results.'],
    ],
    guardrails: [
      'A frozen result keeps its grading scheme even when the rule pack changes',
      'A closed year’s marks can’t change',
    ],
    related: ['attendance', 'obe', 'certificates'],
  },
  obe: {
    tagline: 'Outcome-based education where the numbers add up.',
    overview:
      'Programmes keep versioned outcomes (POs and PSOs). Each course defines its outcomes (COs), maps them in the CO–PO matrix and tags assessment items to COs. Direct attainment is computed from the marks, and programme outcomes are computed only from course outcomes, so a PO can never show “at target” while its COs are below.',
    capabilities: [
      ['Versioned programme outcomes', 'POs and PSOs per programme, kept per version.'],
      ['Course outcomes', 'COs for each course of a regulation.'],
      ['The CO–PO matrix', 'Mapping strengths for every course.'],
      ['Tagged assessment items', 'Each question or component linked to its COs.'],
      ['Direct attainment', 'Computed from the marks students actually got.'],
      ['POs from COs only', 'Programme attainment rolled up from course attainment.'],
    ],
    steps: [
      ['Define', 'Programme outcomes and course outcomes.'],
      ['Map', 'The CO–PO matrix and tagged items.'],
      ['Assess', 'Marks entered as usual.'],
      ['Attain', 'Attainment computed for courses and the programme.'],
    ],
    roles: [
      ['Faculty', 'Define COs and tag items.'],
      ['Department head', 'Reviews the matrix and attainment.'],
      ['IQAC', 'Uses attainment as accreditation evidence.'],
    ],
    guardrails: ['POs are never “at target” while their COs are below'],
    related: ['exams', 'academicStructure'],
  },
  library: {
    tagline: 'Catalogue, circulation and fines that flow to fees.',
    overview:
      'The library catalogue holds titles and copies by accession number. Books are issued to students and staff within their limits, returned with late fines worked out, renewed while renewals remain, or marked lost at the copy’s price. Overdue lists show the class or staff member, and parents see what their child has borrowed.',
    capabilities: [
      ['The catalogue', 'Search by title, author, ISBN, subject or accession number.'],
      ['Copies by accession number', 'Unique per institution, the next free numbers suggested.'],
      ['Issue within limits', 'Students and staff each have their own limit and loan days.'],
      ['Returns and fines', 'Days late times the daily fine, waived only with a reason.'],
      ['Lost and found', 'A lost copy charges its price; a found copy goes back.'],
      ['Parents’ view', 'What the child has borrowed and what’s due.'],
    ],
    steps: [
      ['Catalogue', 'Add titles and copies.'],
      ['Issue', 'Find the borrower and issue.'],
      ['Return or renew', 'Fines worked out on late returns.'],
      ['Follow up', 'Overdue lists and fines owed.'],
    ],
    roles: [
      ['Librarian', 'Runs the desk.'],
      ['Student and staff', 'Borrow books.'],
      ['Parent', 'Sees the child’s loans.'],
    ],
    guardrails: ['Copies are withdrawn with a reason, never deleted'],
    related: ['fees', 'studentRecords'],
  },
  studentRecords: {
    tagline: 'One lifelong learner record across every institution.',
    overview:
      'The student record holds identity, guardians, documents and history in one place, across every institution of a group. A teacher sees the overview, the office sees more, a parent sees only their own child. Aadhaar is checked and sealed, APAAR and ABC are optional and never block anything, PEN is kept for the TC. Documents live in folders with versions, and every opening is audited.',
    capabilities: [
      [
        'A record shaped by permission',
        'Teachers, the office and parents each see what they should.',
      ],
      [
        'Guardians',
        'Relationships, contacts, who may collect, and restrictions that apply at once.',
      ],
      [
        'Identifiers handled properly',
        'Aadhaar sealed and shown as the last four; a full view needs a reason and is audited.',
      ],
      ['Documents with versions', 'Folders, checks and rejections with a note.'],
      [
        'History that stays',
        'Name corrections keep the old name; section changes keep the old enrolment.',
      ],
      ['Your own fields', 'Add what your school records; it appears on the record.'],
    ],
    steps: [
      ['Create', 'From enrolment or an import.'],
      ['Maintain', 'Details, guardians and documents kept current.'],
      ['Use', 'Every module reads the same record.'],
      ['Carry', 'The record follows the learner across institutions.'],
    ],
    roles: [
      ['Office', 'Keeps records current.'],
      ['Teacher', 'Sees overview and placement.'],
      ['Parent', 'Sees their own child.'],
    ],
    guardrails: [
      'A restricted guardian loses access everywhere at once',
      'Shared records never read academic tables directly',
    ],
    related: ['offersOnboarding', 'certificates', 'attendance'],
  },
  certificates: {
    tagline: 'Certificates and ID cards, issued and verifiable.',
    overview:
      'Transfer, bonafide and fee-paid certificates are requested, checked by one person, approved by another and issued as frozen PDFs with a QR code and a number that never repeats. Anyone can check a certificate at the public verification page. ID cards print for one student or a whole section on A4 sheets, ten to a page.',
    capabilities: [
      ['Request, check, approve, issue', 'Each step by a different person where it matters.'],
      ['QR verification', 'A public page confirms the certificate is genuine.'],
      [
        'Numbers that never repeat',
        'Per kind and year, with duplicates issued as numbered copies.',
      ],
      ['TC with the facts', 'Admission date, attendance, conduct and PEN, from the record.'],
      ['ID cards', 'Photo, class, roll and admission numbers, valid till the year’s end.'],
      ['Portal exports recorded', 'When a TC is reported to a government portal.'],
    ],
    steps: [
      ['Request', 'From the student’s record.'],
      ['Check', 'Dues and facts verified.'],
      ['Approve', 'By the principal.'],
      ['Issue', 'A frozen PDF with a QR code.'],
    ],
    roles: [
      ['Office', 'Requests and issues.'],
      ['Teacher', 'Checks the facts.'],
      ['Principal', 'Approves.'],
    ],
    guardrails: [
      'Issued documents are append-only; corrections are a new version',
      'Health details never appear on ID cards',
    ],
    related: ['studentRecords', 'fees'],
  },
};
