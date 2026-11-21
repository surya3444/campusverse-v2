// The nine systems, Campus Core and Verse AI, explained in depth for the public product pages.
import type { SystemKey } from '../../lib/systems';
import type { SystemContent } from './types';

export const SYSTEM_CONTENT: Record<SystemKey, SystemContent> = {
  enrollment: {
    headline: 'From the first enquiry to the first day, without a single form typed twice.',
    overview:
      'Enrollment runs the whole admissions season: leads from walk-ins, web forms and campaigns; online applications with papers checked by an officer; seats by class and category; offers with a fee disclosure; and enrolment that creates the student, the section place, the roll number, the fee invoices and the parent’s sign-in in one step.',
    outcomes: [
      [
        'A fair, visible pipeline',
        'Every family moves through clear stages, and nobody is offered a seat that isn’t there.',
      ],
      [
        'Fees disclosed up front',
        'An offer can only be made against a published fee plan, so families see the bill first.',
      ],
      [
        'One-step enrolment',
        'The admission becomes a student record, a roll number, fee invoices and a parent login together.',
      ],
      [
        'Sibling and duplicate checks',
        'The same child twice is caught, and a known parent’s phone flags a sibling instead of creating a stranger.',
      ],
    ],
    journey: [
      [
        'Enquiry',
        'Walk-ins, calls and web forms land as enquiries with their source and follow-ups.',
      ],
      [
        'Application',
        'Families apply online with a code to their phone, and papers are checked one by one.',
      ],
      [
        'Offer',
        'Within the seats for the class and category, with the fee plan shown; an offer lapses after seven days.',
      ],
      [
        'Confirmation',
        'The family confirms; a lapsed offer frees the seat for the next on the waitlist.',
      ],
      [
        'Enrolment',
        'The student joins a section with a roll number, invoices and a welcome message to the parent.',
      ],
    ],
    roles: [
      'Admissions counsellor',
      'Front office',
      'Principal',
      'Administrator',
      'Parent and applicant',
    ],
    connects: [
      [
        'students',
        'The admitted child becomes one lifelong student record, papers and photo included.',
      ],
      ['finance', 'Enrolment issues the fee invoices from the class’s published plan.'],
      ['core', 'The parent’s sign-in, consent and the welcome message come from Campus Core.'],
    ],
    india: [
      'Age eligibility per class from the board’s rule pack, with an override that needs an order reference',
      'RTE applications only from the RTE portal source, kept separate from general seats',
    ],
  },
  academics: {
    headline: 'Plan, teach, assess and certify, on one academic record.',
    overview:
      'Academics holds the structure of learning and everything done with it. Schools run years, classes and sections; colleges and universities run programmes, versioned regulations and batches that move term by term. On top sit timetables, attendance, homework and syllabus, course registration, exams and results, outcome-based education and the library.',
    outcomes: [
      [
        'Structure that keeps its history',
        'A batch keeps the regulation it was admitted under, even after the curriculum changes.',
      ],
      [
        'Clash-free weeks',
        'Timetables, by hand or generated, never put a teacher, section or room in two places.',
      ],
      [
        'Results you can defend',
        'Grading comes from the board’s or UGC’s rules and results publish only after approval.',
      ],
      [
        'Outcomes that add up',
        'Programme outcomes are computed from course outcomes, never “at target” while the evidence says otherwise.',
      ],
    ],
    journey: [
      [
        'Structure',
        'Set up the year with classes and sections, or programmes, regulations and batches.',
      ],
      [
        'Plan',
        'Subjects and periods per week, teachers allocated, the timetable built and published.',
      ],
      [
        'Teach',
        'Attendance each day or period, homework, the class diary, syllabus coverage and lesson plans.',
      ],
      [
        'Assess',
        'Exams, internal components, marks entry with locks and approvals, report cards and hall tickets.',
      ],
      [
        'Advance',
        'Promotions at year end for schools, terms for colleges; the closed year is locked.',
      ],
    ],
    roles: [
      'Academic coordinator',
      'Principal or dean',
      'Teacher and faculty',
      'Exam cell',
      'Librarian',
      'Student and parent',
    ],
    connects: [
      ['students', 'Every mark, attendance day and certificate belongs to the one student record.'],
      [
        'finance',
        'Library fines and exam eligibility from overdue fees flow between Academics and Fees.',
      ],
      ['quality', 'Attainment and attendance evidence feeds accreditation and government reports.'],
    ],
    india: [
      'CBSE grading and promotion rules for schools; UGC 10-point grading with SGPA and CGPA for colleges',
      'Attendance shortage against the credits rule pack (75% and 65% thresholds), with condonation through approvals',
      'ABC credits and NAD file for higher education; UDISE+ readiness and APAAR for schools',
    ],
  },
  students: {
    headline: 'One lifelong record per learner, from admission to transfer certificate.',
    overview:
      'Students keeps a single record for every learner across every institution of a group: identity, guardians, documents in folders with versions, identifiers sealed or kept as the law requires, and the history of where they studied. Certificates and ID cards are produced from it, with a QR code anyone can check.',
    outcomes: [
      [
        'One person, one record',
        'A student who moves from the school to the group’s college keeps one record with two memberships.',
      ],
      [
        'Identifiers handled properly',
        'Aadhaar is checked and sealed, APAAR and ABC are optional and never block anything, PEN is printed where the TC needs it.',
      ],
      [
        'Certificates that verify',
        'Transfer, bonafide and fee certificates carry a QR code and a number that never repeats.',
      ],
      [
        'Guardians who stay correct',
        'A restricted guardian loses access at once; name corrections keep the old name and its source.',
      ],
    ],
    journey: [
      ['Admit', 'The record is created by enrolment or an import, with guardians and papers.'],
      [
        'Keep current',
        'Details, guardians, documents and consent are updated with every change audited.',
      ],
      [
        'Certify',
        'Certificates and ID cards are requested, checked, approved and issued from the record.',
      ],
      ['Leave', 'A transfer certificate ends the enrolment; the record and its history stay.'],
    ],
    roles: ['Office staff', 'Class teacher', 'Principal', 'Parent'],
    connects: [
      ['academics', 'Where the student sits, their marks and attendance come from Academics.'],
      ['finance', 'Fee status appears on the record and dues are checked before a TC.'],
      ['health', 'Other systems see a health status, never the health record itself.'],
    ],
    india: [
      'APAAR present, refused or not generated, with a reason, under DPDP consent',
      'Transfer certificate deadlines from the board’s rule pack; dues never block a TC by default',
    ],
  },
  finance: {
    headline: 'Bill, collect, account for and report every rupee.',
    overview:
      'Finance runs fees and the money the institution spends. Fee plans by class and instalment, concessions and scholarships with a second approval, a counter with gap-free receipts, online payments, reminders and dues by age; on the other side, bills from vendors with their photos, approvals with amount limits, vouchers and budgets.',
    outcomes: [
      [
        'Receipts that never break',
        'Numbered per legal entity and financial year with no gaps; a correction is a credit note, never an edit.',
      ],
      [
        'Every day closed',
        'Each cashier counts cash against collections and a closed day stops that counter.',
      ],
      [
        'Approvals that hold',
        'Concessions, refunds and bills need someone other than the person who entered them.',
      ],
      [
        'Fees that follow life',
        'Transport and hostel fees follow the bus seat or bed; later joiners aren’t billed for instalments already due.',
      ],
    ],
    journey: [
      [
        'Plan',
        'Fee heads and versioned plans by class, batch and instalment, published before anyone is billed.',
      ],
      ['Bill', 'Invoices issued from the plan with a preview; issuing twice bills nobody twice.'],
      [
        'Collect',
        'At the counter or online, oldest dues first, with a complete receipt every time.',
      ],
      [
        'Follow up',
        'Dues by age and reminders once a day at most; access to the app never cut off for dues.',
      ],
      [
        'Account',
        'Day close, refunds and reversals through approvals, and spending against budgets.',
      ],
    ],
    roles: ['Accountant and cashier', 'Finance officer', 'Principal', 'Parent'],
    connects: [
      ['enrollment', 'Enrolment issues the new student’s invoices from the plan.'],
      ['operations', 'Bus seats and hostel beds bring their fees with them.'],
      ['people', 'Payroll prepares the salary run that Finance pays.'],
    ],
    india: [
      'Receipts per financial year (April to March) with tax classes per fee head',
      'RTE fee waivers on the heads that carry them',
      'State fee-increase warnings from the rule pack',
    ],
  },
  people: {
    headline: 'Hire, run, pay and develop every kind of staff, lawfully.',
    overview:
      'People keeps one staff record across a group’s institutions: teachers, office staff, drivers, attendants, security, wardens and support staff, each with the right app access and the safety checks their role needs. Attendance and leave, appraisals, and payroll under the Labour Codes run on the same record.',
    outcomes: [
      [
        'The right access from day one',
        'Add a driver and they get the driver’s app; add support staff and they get none.',
      ],
      [
        'Children kept safe',
        'Police verification for everyone who meets children; licence and medical fitness for drivers.',
      ],
      [
        'Pay on time, by the rules',
        'The 50% wage rule, gratuity, final settlements within two working days, ECR, ESI and TDS.',
      ],
      [
        'Fair appraisals',
        'Weighted criteria, self-review first, and ratings shown only when the reviewer is done.',
      ],
    ],
    journey: [
      ['Join', 'A staff record with role, category, documents and safety checks.'],
      ['Work', 'Check-in from the web or app, the office’s day register, and leave with balances.'],
      ['Grow', 'Appraisal cycles with self-review and the reviewer’s ratings.'],
      ['Pay', 'Salary structures, the month’s run with a preview, payslips and statutory files.'],
      [
        'Leave',
        'Exit ends every role at once; the final settlement is due within two working days.',
      ],
    ],
    roles: ['HR and administration', 'Principal', 'Accountant', 'Every staff member'],
    connects: [
      ['academics', 'Teachers’ allocations and timetables use the one staff record.'],
      ['operations', 'Routes only accept drivers and attendants whose checks are valid.'],
      ['finance', 'The salary run is paid and accounted for in Finance.'],
    ],
    india: [
      'Labour Codes: the 50% wage rule, gratuity for fixed-term staff, wages within two working days of the last day',
      'PF ECR, ESI monthly file, Labour Welfare Fund by state, TDS challans and Form 16 Part B figures',
    ],
  },
  operations: {
    headline: 'Run the physical campus safely.',
    overview:
      'Operations covers what keeps children safe and the campus running: buses with live trips and the empty-bus check, hostels with roll calls and outpasses, the gate with visitors and early-leave passes, the dead-stock register and consumable stock, and a helpdesk for staff and parents.',
    outcomes: [
      [
        'Every child accounted for',
        'Boarded, dropped, back in the hostel or collected at the gate, with parents told.',
      ],
      [
        'No unsafe crew',
        'A vehicle without fitness, insurance or permit, or a driver without a licence, can’t run unnoticed.',
      ],
      [
        'Nobody leaves with the wrong person',
        'A restricted guardian is refused at the gate, however their name is typed.',
      ],
      [
        'Stock that adds up',
        'Issues never take stock below zero, and every asset keeps its history.',
      ],
    ],
    journey: [
      [
        'Set up',
        'Vehicles with papers, stops and routes; hostels and rooms; locations and stock items.',
      ],
      ['Assign', 'Children to routes and beds; custodians to assets.'],
      [
        'Run the day',
        'Trips with the attendant’s taps, roll calls, visitors in and out, passes and tickets.',
      ],
      [
        'Keep watch',
        'Alerts to parents and the in-charge, papers due, overdue outpasses and low stock.',
      ],
    ],
    roles: [
      'Transport in-charge',
      'Driver and attendant',
      'Warden',
      'Security guard',
      'Store keeper',
      'Parent',
    ],
    connects: [
      ['finance', 'Transport and hostel fees follow allocations.'],
      ['people', 'Crew and wardens come from the staff record with their checks.'],
      ['students', 'Who may collect a child comes from the guardians on the record.'],
    ],
    india: [
      'School transport safety: vehicle fitness, insurance and permit; driver licence and police verification',
    ],
  },
  health: {
    headline: 'Keep students safe and healthy, privately.',
    overview:
      'Health Connect keeps health information in its own vault with its own keys. Health records hold allergies, conditions and vaccinations; school nurses record visits; leaders see totals, never names. When someone must see a record in an emergency, break-glass access needs a reason, alerts the data protection officer and expires.',
    outcomes: [
      [
        'A vault, not a spreadsheet',
        'Health data is sealed separately; other systems only ever see a status such as “medical leave”.',
      ],
      ['Totals without names', 'Owners and principals see how many, never who.'],
      [
        'Emergencies without shortcuts',
        'Break-glass is logged, reasoned, alerted and time-limited.',
      ],
    ],
    journey: [
      ['Record', 'Allergies, conditions and vaccinations, with the parent’s consent.'],
      ['Care', 'Visits to the health room recorded by the nurse.'],
      ['Inform', 'A status for attendance and parents told when it matters.'],
      ['Protect', 'Access by case grant or break-glass only, every view in the activity log.'],
    ],
    roles: ['School nurse', 'Counsellor', 'Principal (totals only)', 'Parent'],
    connects: [
      ['students', 'The record links to the student without exposing health details.'],
      ['core', 'Consent, case grants and the activity log come from Campus Core.'],
    ],
    india: [
      'DPDP: health data is opt-in per role, and children’s data needs verified guardian consent',
    ],
  },
  career: {
    headline: 'Make students employable and keep them connected.',
    overview:
      'Career Connect is coming next: placements from job notifications to offers, internships with mentor feedback, skill-up programmes with completion tracking, resume and interview preparation for every student, and an alumni and mentor network. It will read the academic record only with the student’s consent, and paid content will stay hidden from students under 18.',
    outcomes: [
      [
        'A placement cell with infrastructure',
        'Drives, applications, interviews and offers tracked end to end.',
      ],
      [
        'Preparation for everyone',
        'Resume and interview tools for every student, not only the top of the class.',
      ],
      ['Consent first', 'Recruiters see what a student chooses to share.'],
    ],
    journey: [
      ['Prepare', 'Skill-up programmes, resumes and mock interviews from second year.'],
      ['Apply', 'Placement drives and internships with eligibility from the record.'],
      ['Place', 'Interviews, offers and joining tracked to the end.'],
      ['Stay connected', 'Alumni and mentors who come back to help the next batch.'],
    ],
    roles: ['Placement officer', 'Student', 'Recruiter', 'Alumni mentor'],
    connects: [
      ['academics', 'Eligibility reads marks and attendance, with consent.'],
      ['students', 'The lifelong record carries placements and certificates.'],
    ],
    india: [],
  },
  quality: {
    headline: 'Prove quality and meet every regulatory duty from live data.',
    overview:
      'Quality & Compliance turns the work done every day into the evidence regulators ask for. UDISE+ readiness and the ABC and NAD files are rolling out now; accreditation for NAAC and NBA, grievances and committees, and a compliance monitor with an obligation register are coming next.',
    outcomes: [
      [
        'Reports from real records',
        'Government returns built from attendance, enrolment and results, not retyped.',
      ],
      ['Readiness before deadlines', 'What’s missing for UDISE+ is shown before the portal opens.'],
      ['Regulation as data', 'A new circular becomes a rule pack version, not a software release.'],
    ],
    journey: [
      ['Collect', 'Evidence gathers as academics, people and finance do their work.'],
      ['Check', 'Readiness and gaps shown per return.'],
      ['File', 'Files in the formats the portals take.'],
      ['Improve', 'Grievances, committees and actions tracked to closure.'],
    ],
    roles: ['IQAC coordinator', 'Principal', 'Office staff'],
    connects: [
      ['academics', 'Attainment, attendance and results are the evidence.'],
      ['core', 'Rule packs hold the regulation and the activity log holds the proof.'],
    ],
    india: ['UDISE+ readiness and APAAR reconciliation', 'ABC credits and the NAD file'],
  },
  core: {
    headline: 'The shared services every system inherits.',
    overview:
      'Campus Core is what makes nine systems feel like one product: the organisation tree from group to department, identity and access by role, scope and data class, rule packs for regulation, one approval engine, one communications service, privacy and consent, the tamper-evident activity log and the data import centre.',
    outcomes: [
      [
        'One way to approve',
        'Bills, refunds, results, leave and notices all go through the same approval engine.',
      ],
      [
        'Access that explains itself',
        'Check access shows exactly why someone can or can’t see something.',
      ],
      [
        'Regulation without releases',
        'Rule packs are versioned, tested and released by a second owner on a date.',
      ],
      ['A log you can trust', 'Every change and export sealed in a hash chain, kept in India.'],
    ],
    journey: [
      ['Organise', 'Group, campuses, institutions and departments, each with its profile.'],
      ['Grant', 'Roles at a scope, with data classes and case grants for sensitive data.'],
      ['Govern', 'Rule packs, approval chains with amount limits, and consent.'],
      [
        'Communicate',
        'Notices and messages by SMS, WhatsApp, push and in-app, tracked to delivery.',
      ],
      ['Prove', 'The activity log and data rights requests answered on time.'],
    ],
    roles: ['Owner', 'Administrator', 'Data protection officer'],
    connects: [
      ['enrollment', 'Parent sign-in, consent and welcome messages.'],
      ['finance', 'Approvals with amount limits for bills, refunds and concessions.'],
      ['academics', 'Rule packs for grading, credits and promotion.'],
    ],
    india: [
      'DPDP: purpose-wise consent, guardian verification (Rule 10), data rights and a breach register',
      'CERT-In: activity logs kept 180 days or more in India',
      'SMS templates registered under DLT',
    ],
  },
  ai: {
    headline: 'Ask, analyse and act across every system, within your permissions.',
    overview:
      'Verse AI is one assistant across Campusverse. It uses the same permissioned tools as the screens, so it only ever sees what you may see. It answers with its sources, drafts messages and reminders that a person sends, and needs a second approver for sensitive actions. It never trains on your data and never profiles or advertises to children.',
    outcomes: [
      ['Answers with sources', 'Every answer points to the records it came from.'],
      ['Drafts, not surprises', 'Nothing leaves draft without a person.'],
      [
        'Safe by class of action',
        'Reading, drafting, reversible actions and sensitive actions each have their own rule.',
      ],
    ],
    journey: [
      ['Ask', 'In plain words, in the language you work in.'],
      ['Check', 'The policy guard checks your permission before any tool runs.'],
      ['Answer or draft', 'With sources, or as a draft to review.'],
      [
        'Act with consent',
        'One confirm for reversible actions; a second approver for sensitive ones.',
      ],
    ],
    roles: ['Principal', 'Office staff', 'Teacher'],
    connects: [
      ['core', 'Every Verse AI step is written to the activity log.'],
      ['finance', 'Dues and collections, read through the same permissions as the screens.'],
    ],
    india: ['Students under 18 get study help only; nothing is ever advertised to children'],
  },
};
