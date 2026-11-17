// Every permission a staff role can hold, by area, and which ones are sensitive: a sensitive
// grant waits for a second owner (decision 0020). Words for each live in the app's language file.
// Parent-only grants (their own messages, paying online) are not here: they belong to the parent
// role and only ever apply to the parent's own children.

export const AREAS = [
  'setup',
  'academics',
  'people',
  'admissions',
  'attendance',
  'exams',
  'timetable',
  'homework',
  'syllabus',
  'library',
  'gate',
  'hostel',
  'helpdesk',
  'health',
  'compliance',
  'assets',
  'certificates',
  'fees',
  'expenses',
  'transport',
  'messages',
  'ai',
  'access',
] as const;
export type Area = (typeof AREAS)[number];

type Entry = { area: Area; sensitive: boolean };
const e = (area: Area, sensitive = false): Entry => ({ area, sensitive });

export const CATALOGUE: Record<string, Entry> = {
  'platform.organisation.manage': e('setup'),
  'platform.rules.read': e('setup'),
  'platform.rules.adopt': e('setup', true),
  'school.setup.read': e('setup'),
  'school.setup.manage': e('setup'),
  'school.enrolment.change': e('setup'),
  'school.rollover.manage': e('setup', true),
  'platform.file.upload': e('setup'),
  'platform.file.read': e('setup'),
  'platform.consent.publish_notice': e('setup'),
  'platform.consent.record': e('setup'),
  'platform.consent.verify_guardian': e('setup'),

  'academics.structure.read': e('academics'),
  'academics.structure.manage': e('academics'),
  'academics.enrolment.manage': e('academics'),
  'academics.registration.manage': e('academics'),
  'academics.registration.approve': e('academics'),
  'academics.exam.marks': e('academics'),
  'academics.exam.manage': e('academics'),
  'academics.exam.publish': e('academics', true),
  'academics.attendance.mark': e('academics'),
  'academics.attendance.read': e('academics'),
  'academics.attendance.condone': e('academics'),
  'academics.obe.read': e('academics'),
  'academics.obe.manage': e('academics'),

  'people.appraisal.manage': e('people', true),
  'payroll.salary.manage': e('people', true),
  'payroll.run.prepare': e('people'),
  'payroll.run.approve': e('people', true),
  'people.student.read': e('people'),
  'people.student.read_full': e('people'),
  'people.student.update': e('people'),
  'people.student.reveal': e('people', true),
  'people.staff.read': e('people'),
  'people.staff.update': e('people'),
  'people.staff.create': e('people'),
  'people.staff.documents': e('people', true),
  'people.staff.exit': e('people', true),
  'people.staff.reveal': e('people', true),

  'school.admission.manage': e('admissions'),
  'school.admission.offer': e('admissions'),
  'school.admission.enrol': e('admissions'),

  'school.attendance.read': e('attendance'),
  'school.attendance.mark': e('attendance'),
  'school.attendance.manage': e('attendance'),
  'school.attendance.sign_off': e('attendance'),
  'school.attendance.leave_request': e('attendance'),
  'school.attendance.leave_decide': e('attendance'),
  'staff.attendance.read': e('attendance'),
  'staff.attendance.manage': e('attendance'),
  'staff.leave.manage': e('attendance'),
  'staff.leave.approve': e('attendance'),

  'school.exam.read': e('exams'),
  'school.timetable.read': e('timetable'),
  'school.timetable.manage': e('timetable'),
  'school.cover.manage': e('timetable'),
  'school.homework.read': e('homework'),
  'school.homework.set': e('homework'),
  'school.homework.manage': e('homework'),
  'school.syllabus.read': e('syllabus'),
  'school.syllabus.teach': e('syllabus'),
  'school.syllabus.manage': e('syllabus'),
  'library.book.read': e('library'),
  'library.book.manage': e('library'),
  'gate.visitor.read': e('gate'),
  'gate.visitor.manage': e('gate'),
  'gate.visitor.bar': e('gate'),
  'gate.visit.expect': e('gate'),
  'gate.pass.issue': e('gate'),
  'hostel.resident.read': e('hostel'),
  'hostel.room.manage': e('hostel'),
  'hostel.rollcall.mark': e('hostel'),
  'hostel.outpass.decide': e('hostel'),
  'helpdesk.ticket.handle': e('helpdesk'),
  'helpdesk.setup.manage': e('helpdesk'),

  'health.record.read': e('health', true),
  'health.record.update': e('health', true),
  'health.visit.record': e('health', true),
  'health.report.read': e('health'),
  'health.emergency.open': e('health', true),

  'school.returns.read': e('compliance'),
  'assets.item.read': e('assets'),
  'assets.item.manage': e('assets'),
  'assets.stock.manage': e('assets'),
  'school.exam.manage': e('exams'),
  'school.exam.enter_marks': e('exams'),
  'school.exam.lock': e('exams'),
  'school.exam.publish': e('exams', true),

  'school.certificate.request': e('certificates'),
  'school.certificate.check': e('certificates'),
  'school.certificate.approve': e('certificates'),
  'school.certificate.issue': e('certificates', true),
  'platform.document.issue': e('certificates', true),

  'finance.invoice.read': e('fees'),
  'finance.plan.manage': e('fees', true),
  'finance.invoice.issue': e('fees', true),
  'finance.payment.collect': e('fees', true),
  'finance.payment.reconcile': e('fees', true),
  'finance.day.close': e('fees', true),
  'finance.concession.request': e('fees'),
  'finance.concession.approve': e('fees', true),
  'finance.refund.request': e('fees'),
  'finance.refund.approve': e('fees', true),
  'finance.reversal.request': e('fees'),
  'finance.reversal.approve': e('fees', true),

  'expenses.bill.read': e('expenses'),
  'expenses.bill.record': e('expenses'),
  'expenses.bill.approve': e('expenses', true),
  'expenses.bill.pay': e('expenses'),
  'expenses.setup.manage': e('expenses'),

  'transport.trip.read': e('transport'),
  'transport.route.manage': e('transport'),
  'transport.vehicle.manage': e('transport'),
  'transport.assignment.manage': e('transport'),
  'transport.trip.attend': e('transport'),
  'transport.trip.drive': e('transport'),
  'transport.ride.skip': e('transport'),

  'communications.notice.compose': e('messages'),
  'communications.notice.approve': e('messages'),
  'communications.notice.send_urgent': e('messages', true),
  'communications.notice.track': e('messages'),

  'platform.verse.ask': e('ai'),

  'platform.role.read': e('access'),
  'platform.activity.read': e('access'),
  'platform.privacy.manage': e('access', true),
  'platform.role.manage': e('access', true),
  'platform.role.approve': e('access', true),
  'platform.role.assign': e('access', true),
  'platform.fields.manage': e('access', true),
  'platform.workflow.manage': e('access', true),
};

export const isSensitive = (permission: string) => CATALOGUE[permission]?.sensitive ?? true;

/**
 * Data classes (rule book §10.3): what kind of data a permission reaches. Sensitive data (health,
 * counselling, category and caste certificates, identity numbers) is opt-in per role and is the
 * only class a case grant can open.
 */
export const DATA_CLASSES = ['public', 'internal', 'personal', 'financial', 'sensitive'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

const AREA_CLASS: Record<Area, DataClass> = {
  setup: 'internal',
  academics: 'internal',
  people: 'personal',
  admissions: 'personal',
  attendance: 'personal',
  exams: 'personal',
  timetable: 'internal',
  homework: 'internal',
  syllabus: 'internal',
  library: 'internal',
  gate: 'personal',
  hostel: 'personal',
  helpdesk: 'internal',
  health: 'sensitive',
  compliance: 'personal',
  assets: 'internal',
  certificates: 'personal',
  fees: 'financial',
  expenses: 'financial',
  transport: 'personal',
  messages: 'personal',
  ai: 'internal',
  access: 'internal',
};
const CLASS_EXCEPTIONS: Record<string, DataClass> = {
  'health.report.read': 'internal',
  'people.student.reveal': 'sensitive',
  'people.staff.reveal': 'sensitive',
  'people.staff.documents': 'sensitive',
  'platform.privacy.manage': 'sensitive',
  'platform.consent.record': 'personal',
  'platform.consent.verify_guardian': 'personal',
  'academics.enrolment.manage': 'personal',
  'academics.registration.manage': 'personal',
  'academics.registration.approve': 'personal',
  'academics.attendance.mark': 'personal',
  'academics.attendance.read': 'personal',
  'academics.attendance.condone': 'personal',
  'academics.obe.read': 'internal',
  'academics.obe.manage': 'internal',
  'academics.exam.marks': 'personal',
  'academics.exam.manage': 'personal',
  'academics.exam.publish': 'personal',
};

export function dataClassOf(permission: string): DataClass {
  if (permission in CLASS_EXCEPTIONS) return CLASS_EXCEPTIONS[permission] ?? 'internal';
  if (permission.startsWith('payroll.')) return 'financial';
  const area = CATALOGUE[permission]?.area;
  return area ? AREA_CLASS[area] : 'sensitive';
}

/** Roles nobody edits: the owner holds everything; the parent role is about one's own children. */
export const LOCKED_ROLES = new Set(['owner', 'parent']);

export type GrantPlan = {
  /** Applied now: not sensitive. */
  add: string[];
  /** Waits for a second owner. */
  request: string[];
  /** Removing access is always immediate. */
  remove: string[];
};

export type PlanError = 'locked' | 'unknown_permission' | 'not_held';

/**
 * What changing a role's permissions to `wanted` does: which grants apply now, which wait for
 * approval, and which go. The actor can only give what they hold themselves.
 */
export function planGrants(input: {
  roleKey: string;
  current: string[];
  pending: string[];
  wanted: string[];
  actorHolds: Set<string>;
}): { ok: true; plan: GrantPlan } | { ok: false; error: PlanError; permissions: string[] } {
  if (LOCKED_ROLES.has(input.roleKey)) return { ok: false, error: 'locked', permissions: [] };
  const wanted = [...new Set(input.wanted)];
  const unknown = wanted.filter((p) => !CATALOGUE[p]);
  if (unknown.length) return { ok: false, error: 'unknown_permission', permissions: unknown };
  const adding = wanted.filter((p) => !input.current.includes(p) && !input.pending.includes(p));
  const notHeld = adding.filter((p) => !input.actorHolds.has(p));
  if (notHeld.length) return { ok: false, error: 'not_held', permissions: notHeld };
  return {
    ok: true,
    plan: {
      add: adding.filter((p) => !isSensitive(p)),
      request: adding.filter(isSensitive),
      remove: input.current.filter((p) => !wanted.includes(p)),
    },
  };
}

/** A key for a new role from its name: custom_ plus letters and digits. */
export function roleKey(name: string, taken: Set<string>): string {
  const base = `custom_${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`
    .replace(/_+$/, '')
    .slice(0, 36);
  const start = base === 'custom' ? 'custom_role' : base;
  let key = start;
  for (let n = 2; taken.has(key); n++) key = `${start}_${n}`;
  return key;
}

/**
 * Named health data is for the medical role only (rule book §10.3: "group owners and principals
 * see health totals, never names, unless granted for a case"). Owners hold everything else in the
 * catalogue; these reach anyone else only through a role a second owner approves.
 */
export const NAMED_HEALTH = ['health.record.read', 'health.record.update', 'health.visit.record'];
