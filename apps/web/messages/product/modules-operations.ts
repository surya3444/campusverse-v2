// Live modules of Finance, People, Operations and Health Connect, for the public product pages.
import type { ModuleContent } from './types';

export const OPERATIONS_MODULES: Record<string, ModuleContent> = {
  fees: {
    tagline: 'Plans, invoices, the counter, online payments and dues.',
    overview:
      'Fees runs from the plan to the receipt. Fee heads carry their tax class and refund rules; plans are versioned by class or batch and instalment. Invoices are issued with a preview, collected at the counter or online, oldest dues first, with a complete receipt every time. Dues by age, reminders and the cashier’s day close keep the books honest.',
    capabilities: [
      [
        'Versioned fee plans',
        'A fee change mid-year is a new version of the same plan, never an edit.',
      ],
      [
        'Invoices with a preview',
        'One invoice per student, plan and instalment, so issuing twice bills nobody twice.',
      ],
      [
        'The counter',
        'Cash, cheque, card and UPI with an idempotency key, so a retry returns the same receipt.',
      ],
      [
        'Online payments',
        'Payment links with verified webhooks and status checks if a webhook is lost.',
      ],
      [
        'Gap-free receipts',
        'Numbered per legal entity and financial year, with a snapshot of what was printed.',
      ],
      [
        'Dues and reminders',
        'Dues by age; reminders once a day at most, and app access never cut for dues.',
      ],
    ],
    steps: [
      ['Plan', 'Fee heads and the plan for each class or batch.'],
      ['Issue', 'Invoices from the plan, previewed first.'],
      ['Collect', 'At the counter or online, with receipts.'],
      ['Close', 'Count the cash and close the day.'],
    ],
    roles: [
      ['Accountant', 'Plans, issues and closes the day.'],
      ['Cashier', 'Collects at the counter.'],
      ['Parent', 'Sees the bill and pays online.'],
    ],
    guardrails: [
      'Receipts are append-only; corrections are credit notes',
      'A closed day stops that cashier’s counter',
      'Money is kept in whole paise everywhere',
    ],
    related: ['scholarships', 'accounts', 'transport'],
  },
  scholarships: {
    tagline: 'Concessions and scholarships with a second approval.',
    overview:
      'Concessions, scholarships and waivers are requested against a student and approved by someone else before they apply. Approved concessions apply when invoices are issued, and every decision is recorded with who asked, who approved and why.',
    capabilities: [
      ['Requests with reasons', 'A concession is asked for with the amount or share and a reason.'],
      [
        'A second approver',
        'The person who asked can never approve; the database enforces it too.',
      ],
      ['Applied on issue', 'Approved concessions reduce the invoices as they’re issued.'],
      ['RTE waivers', 'Heads marked for RTE are waived for RTE students.'],
      ['Pending approvals', 'One list of what’s waiting, oldest first.'],
      ['A full trail', 'Every request and decision in the activity log.'],
    ],
    steps: [
      ['Ask', 'Request a concession for a student.'],
      ['Decide', 'A second person approves or rejects.'],
      ['Apply', 'Invoices reflect the concession.'],
      ['Report', 'Concessions given, by head and reason.'],
    ],
    roles: [
      ['Office', 'Requests concessions.'],
      ['Principal or finance officer', 'Approves them.'],
    ],
    guardrails: ['Maker and checker are always two different people'],
    related: ['fees', 'workflow'],
  },
  accounts: {
    tagline: 'Bills, approvals, vouchers and budgets for what you spend.',
    overview:
      'Every bill is recorded with its photo, vendor and GST, approved through the approval engine with amount limits and escalation, then paid and closed. Categories and vendors are shared across the organisation, and each bill shows where it stands against the budget.',
    capabilities: [
      ['Bills with photos', 'Vendor or payee, number, date, amount and GST with the bill’s image.'],
      ['No duplicates', 'The same vendor’s bill number is refused a second time.'],
      [
        'Approvals with limits',
        'Steps and amount limits from the approval designer, with escalation.',
      ],
      ['Worklists', 'Waiting, to pay, paid and closed.'],
      ['Budget position', 'Each bill against its category’s budget.'],
      ['Vendors with GSTIN', 'Shared across the organisation.'],
    ],
    steps: [
      ['Record', 'The office records the bill and its photo.'],
      ['Approve', 'Through the steps the amount requires.'],
      ['Pay', 'Mark paid with the reference.'],
      ['Close', 'Closed bills stay on record.'],
    ],
    roles: [
      ['Office', 'Records bills.'],
      ['Approvers', 'Decide by amount.'],
      ['Accountant', 'Pays and closes.'],
    ],
    guardrails: ['The person who recorded a bill can never approve it'],
    related: ['workflow', 'fees'],
  },
  hr: {
    tagline: 'Every kind of staff on one record, with the right access.',
    overview:
      'Add teachers, office staff, drivers, bus attendants, security guards, wardens, nurses and support staff such as housekeeping and cooks. Each gets the matching app access, or none, and a category. Safety checks for people who work with children are tracked with renewals. Documents, sealed bank and identity details, and exits that end access everywhere complete the record.',
    capabilities: [
      ['Add by what they do', 'Pick the work role and the right access comes with it.'],
      ['Teaching, office and support', 'Staff grouped and filtered by category.'],
      [
        'Safety checks',
        'Police verification; licence and medical fitness for drivers; renewals added, never overwritten.',
      ],
      [
        'Documents in folders',
        'Appointment letters and papers with versions, every opening audited.',
      ],
      ['Sealed details', 'Aadhaar, PAN and bank account encrypted, shown as the last four.'],
      ['Exit', 'Ends every role and allocation after the last day.'],
    ],
    steps: [
      ['Add', 'Name, mobile and what they do.'],
      ['Complete', 'Details, documents and safety checks.'],
      ['Work', 'Attendance, leave and payroll on the same record.'],
      ['Exit', 'Access ends everywhere at once.'],
    ],
    roles: [
      ['Administrator', 'Adds staff and records checks.'],
      ['Principal', 'Sees the staff list and checks due.'],
      ['Staff member', 'Keeps their own profile current.'],
    ],
    guardrails: [
      'Administrators and principals are given only in Access',
      'Checks are append-only; the latest of each kind counts',
    ],
    related: ['staffAttendanceLeave', 'payroll', 'transport'],
  },
  staffAttendanceLeave: {
    tagline: 'Check-ins, the day register and leave with balances.',
    overview:
      'Staff check themselves in and out from the web or the app, with the location kept against the campus gate. The office keeps the day register, where a mark wins over check-ins. Leave is asked for in working days, against balances, approved through the approval engine.',
    capabilities: [
      ['Self check-in', 'From the web or app, offline-safe, flagged when off campus.'],
      ['The day register', 'The office marks present, absent, half day, leave or duty.'],
      ['Settings', 'Start and end of day, grace minutes and what counts as a full day.'],
      ['Leave in working days', 'Sundays and school holidays don’t count.'],
      ['Balances', 'Leave types with balances and adjustments.'],
      ['Monthly report', 'Days and totals per staff member.'],
    ],
    steps: [
      ['Check in', 'Staff check in on arrival.'],
      ['Register', 'The office confirms the day.'],
      ['Ask', 'Staff ask for leave.'],
      ['Decide', 'Through approvals, balances updated.'],
    ],
    roles: [
      ['Staff member', 'Checks in and asks for leave.'],
      ['Office', 'Keeps the register.'],
      ['Approver', 'Decides leave.'],
    ],
    guardrails: ['Changing a marked day needs a reason'],
    related: ['hr', 'payroll', 'timetable'],
  },
  appraisals: {
    tagline: 'Fair reviews with weighted criteria.',
    overview:
      'Appraisal cycles have weighted criteria. Opening a cycle creates a review for every staff member, previewed first. Each person rates themselves, their reviewer rates every criterion with a comment, and the person sees the reviewer’s ratings only when the review is done, then acknowledges it.',
    capabilities: [
      ['Cycles with criteria', 'Weighted criteria per cycle.'],
      ['Preview before opening', 'See who will be reviewed and by whom.'],
      ['Self-review first', 'Every criterion rated by the person.'],
      ['Reviewer ratings', 'With a required comment.'],
      ['Weighted scores', 'Worked out to the hundredth.'],
      ['Acknowledgement', 'The person acknowledges the finished review.'],
    ],
    steps: [
      ['Design', 'Criteria and weights.'],
      ['Open', 'Reviews created for every staff member.'],
      ['Review', 'Self-review, then the reviewer.'],
      ['Close', 'Scores and acknowledgements.'],
    ],
    roles: [
      ['HR', 'Runs cycles.'],
      ['Reviewer', 'Rates their team.'],
      ['Staff member', 'Self-reviews and acknowledges.'],
    ],
    guardrails: ['Appraisals are sensitive data, opt-in per role'],
    related: ['hr', 'payroll'],
  },
  payroll: {
    tagline: 'Payroll under the Labour Codes, on time.',
    overview:
      'Salary structures per staff member with a warning when wages fall below half the pay. The month’s run is prepared with a preview, never for a future period and never “all paid” with nothing credited. Arrears come from back-dated revisions. Final settlements include gratuity and are due within two working days of the last day. ECR, ESI, LWF, TDS challans and Form 16 Part B figures are produced from the run.',
    capabilities: [
      ['Salary structures', 'Components with the 50% wage rule warning.'],
      ['The month’s run', 'Prepared with a preview, approved and paid.'],
      ['Arrears', 'Worked out from back-dated revisions.'],
      ['Final settlements', 'With gratuity and the two-working-day deadline.'],
      ['Statutory files', 'PF ECR, ESI monthly file, LWF by state.'],
      ['TDS', 'Challans, the 24Q worksheet and Form 16 Part B figures.'],
    ],
    steps: [
      ['Structure', 'Salaries and revisions.'],
      ['Prepare', 'The month’s run with a preview.'],
      ['Pay', 'Approve, pay and send payslips.'],
      ['File', 'Statutory files and challans.'],
    ],
    roles: [
      ['Accountant', 'Prepares and pays.'],
      ['Principal', 'Approves the run.'],
      ['Staff member', 'Sees payslips.'],
    ],
    guardrails: [
      'Never a run for a future period',
      'Never “all paid” with nothing credited',
      'Settlements flagged when the deadline nears',
    ],
    related: ['hr', 'staffAttendanceLeave', 'accounts'],
  },
  transport: {
    tagline: 'Buses with live trips, safety checks and parents told.',
    overview:
      'Vehicles carry their papers; a bus without fitness, insurance or permit can’t run without a reason on record. Routes have stops in time order, fare zones and a usual crew, and no driver or attendant joins a route without valid safety checks. On the day, the attendant taps each child on and off, the driver shares the bus’s position, parents are told at boarding and drop, and the trip ends only after the empty-bus check.',
    capabilities: [
      [
        'Vehicles and papers',
        'Registration, fitness, insurance, permit and pollution with expiry.',
      ],
      ['Routes and stops', 'Stops in time order with fare zones, pickup and drop.'],
      ['Crew with valid checks', 'Licence, police verification and medical fitness required.'],
      ['Live trips', 'The attendant’s taps, the driver’s position and SOS.'],
      ['Parents told', 'Boarded, dropped and “not taking the bus today”.'],
      ['The empty-bus check', 'A trip can’t end “empty” while a child is marked on board.'],
    ],
    steps: [
      ['Set up', 'Vehicles, stops, routes and crew.'],
      ['Assign', 'Children to routes from their stop.'],
      ['Run', 'Trips with taps, position and alerts.'],
      ['Report', 'Boarding logs, ridership and papers due.'],
    ],
    roles: [
      ['Transport in-charge', 'Sets up and watches trips.'],
      ['Driver and attendant', 'Run the trip in the app.'],
      ['Parent', 'Sees the bus and skips a day.'],
    ],
    guardrails: [
      'Positions are kept 30 days, then deleted',
      'A child found on board after the trip alerts the in-charge',
    ],
    related: ['fees', 'hr', 'studentRecords'],
  },
  hostel: {
    tagline: 'Rooms, beds, roll calls and outpasses.',
    overview:
      'Hostels have rooms with numbered beds; each student gets one bed and each bed one student, in the right hostel for the student’s gender. Wardens take the night or morning roll call, issue outpasses or decide parents’ requests from the app, and see who is overdue back. Parents see their child’s bed, roll calls and outpasses.',
    capabilities: [
      ['Rooms and beds', 'Boys’, girls’ or mixed hostels with numbered beds.'],
      ['Allocation', 'One bed per student, moves keeping their dates.'],
      ['Roll call', 'Every resident marked; those on a pass start on leave.'],
      ['Outpasses', 'Asked for by parents or issued by the warden; overdue when not back.'],
      ['Who may collect', 'Checked against the guardians on record.'],
      ['Parents’ view', 'Bed, roll calls and outpasses.'],
    ],
    steps: [
      ['Set up', 'Hostels, rooms and beds.'],
      ['Allocate', 'Students to beds.'],
      ['Run', 'Roll calls and outpasses.'],
      ['Watch', 'Overdue returns and occupancy.'],
    ],
    roles: [
      ['Warden', 'Runs roll calls and outpasses.'],
      ['Parent', 'Asks for outpasses and follows the child.'],
    ],
    guardrails: ['A restricted guardian can never take a child out'],
    related: ['fees', 'visitors', 'studentRecords'],
  },
  assets: {
    tagline: 'The asset register and consumable stock.',
    overview:
      'Every asset has a tag, a location, a custodian and a condition, each change a line in its history; disposed assets stay on record. Consumable stock is received and issued against its balance, never below zero, with a low-stock flag at the reorder level.',
    capabilities: [
      ['The asset register', 'Searchable by category, location and custodian.'],
      ['Tags', 'Unique per school, the next free one suggested.'],
      ['History', 'Moves, custodian and condition changes kept.'],
      ['Stock items', 'Received and issued against the balance.'],
      ['Reorder levels', 'Low stock flagged.'],
      ['Disposal', 'Recorded, never deleted.'],
    ],
    steps: [
      ['Set up', 'Categories and locations.'],
      ['Register', 'Assets with tags and custodians.'],
      ['Move', 'Issue stock and move assets.'],
      ['Review', 'Figures and low stock.'],
    ],
    roles: [
      ['Store keeper', 'Keeps the register and stock.'],
      ['Custodian', 'Holds assets.'],
    ],
    guardrails: ['Stock never goes below zero'],
    related: ['accounts', 'helpdesk'],
  },
  visitors: {
    tagline: 'Visitors in and out, and early-leave passes.',
    overview:
      'The gate knows visitors by mobile number across every campus. Walk-ins and expected visitors are checked in with a host who is staff, and out again. A barred visitor is refused everywhere. Early-leave passes name a guardian on record or a named person, and are checked again at the gate.',
    capabilities: [
      ['Check-in and out', 'Walk-ins and expected visitors with their host.'],
      ['Expected visitors', 'Any staff member can expect a visitor and host them.'],
      ['Bars', 'Bar and lift with a reason, across every campus.'],
      ['Early-leave passes', 'For today, to a guardian or named person.'],
      ['Inside now', 'Who is on campus and who is expected.'],
      ['History', 'Search visits by name, phone or vehicle.'],
    ],
    steps: [
      ['Expect', 'Staff register expected visitors.'],
      ['Check in', 'The guard checks visitors in.'],
      ['Pass', 'Early-leave passes for students.'],
      ['Check out', 'Visitors leave and the day is recorded.'],
    ],
    roles: [
      ['Security guard', 'Runs the gate.'],
      ['Staff', 'Expect visitors.'],
      ['Office', 'Issues passes.'],
    ],
    guardrails: ['A restricted guardian is refused however their name is typed'],
    related: ['hostel', 'studentRecords'],
  },
  helpdesk: {
    tagline: 'Help requests from staff and parents, answered on time.',
    overview:
      'Staff raise tickets for themselves and parents raise them about their own child. Categories set the hours to answer and who handles them; urgent tickets get half the time. Handlers work queues of open, overdue and waiting tickets with replies and internal notes; requesters can reopen within seven days.',
    capabilities: [
      ['Tickets from staff and parents', 'Numbered per school.'],
      ['Categories with hours', 'Due times and default assignees.'],
      ['Queues', 'Open, overdue, waiting and resolved.'],
      ['Replies and notes', 'Internal notes only for people working the ticket.'],
      ['Reopen', 'Within seven days of resolution.'],
      ['Verse AI help', 'Summaries and drafted replies for handlers.'],
    ],
    steps: [
      ['Raise', 'A ticket in a category.'],
      ['Assign', 'To the category’s handler.'],
      ['Resolve', 'Replies until it’s done.'],
      ['Review', 'Figures by category.'],
    ],
    roles: [
      ['Parent and staff', 'Raise tickets.'],
      ['Handler', 'Answers them.'],
    ],
    guardrails: ['Assignees must be staff of the school'],
    related: ['communications', 'assets'],
  },
  healthRecords: {
    tagline: 'Health records in a vault, with totals for leaders.',
    overview:
      'Each student’s allergies, conditions and vaccinations are kept in Health Connect’s own vault with separate keys. School nurses see what they need; owners and principals see totals, never names. Other systems get a status only. In an emergency, break-glass access needs a reason, alerts the data protection officer and expires.',
    capabilities: [
      ['The health vault', 'Separate storage and keys for health data.'],
      ['Allergies and conditions', 'With vaccinations and notes.'],
      ['Totals, never names', 'For owners and principals.'],
      ['Statuses for others', 'Such as “medical leave”, without details.'],
      ['Break-glass', 'Reasoned, alerted to the DPO and time-limited.'],
      ['Case grants', 'Access to one student’s record for one purpose.'],
    ],
    steps: [
      ['Consent', 'The guardian consents to health records.'],
      ['Record', 'The nurse records allergies and conditions.'],
      ['Use', 'Statuses flow to attendance; totals to leaders.'],
      ['Protect', 'Every view logged.'],
    ],
    roles: [
      ['School nurse', 'Keeps records.'],
      ['Principal', 'Sees totals.'],
      ['Parent', 'Consents and sees their child’s record.'],
    ],
    guardrails: [
      'Named health data never appears on an owner’s dashboard',
      'Counselling notes are never read by Verse AI',
    ],
    related: ['studentRecords', 'privacy', 'attendance'],
  },
};
