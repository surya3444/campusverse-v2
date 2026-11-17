// Request and response contracts shared by the API, web and mobile. One source of truth.
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Every error from the API has this shape (Build Guide, "API rules"). */
export type ApiError = {
  code: string;
  message: string;
  field?: string;
  details?: unknown;
  requestId: string;
  retryable: boolean;
};

export const OtpRequest = z.object({ phone: z.string().min(10).max(20) });
export const OtpVerify = z.object({
  phone: z.string().min(10).max(20),
  code: z.string().regex(/^\d{6}$/),
  device: z.object({ id: z.uuid().optional(), label: z.string().trim().min(1).max(80) }),
});
export const Refresh = z.object({ refreshToken: z.string().min(20).max(200) });

export const StructureInput = z.object({
  board: z.enum(['CBSE']),
  yearLabel: z.string().regex(/^\d{4}-\d{2}$/),
  starts: isoDate,
  ends: isoDate,
  classes: z
    .array(
      z.object({
        code: z.string().max(6),
        sections: z.number().int().min(1).max(26),
        capacity: z.number().int().min(1).max(80),
      }),
    )
    .min(1)
    .max(20),
  subjects: z
    .record(
      z.string(),
      z.array(z.enum(['ENG', 'HIN', 'MAT', 'EVS', 'SCI', 'SST', 'TL3', 'ART'])).max(12),
    )
    .optional(),
});

export const ImportKind = z.enum(['students', 'staff']);
export const Id = z.uuid();

/** A list someone downloaded, for the audit log (ids and counts only). */
export const ExportRecord = z.object({
  list: z.enum([
    'students',
    'staff',
    'staff_attendance',
    'staff_payroll',
    'fee_dues',
    'attendance_register',
    'transport_riders',
    'transport_boarding',
    'transport_ridership',
    'transport_papers',
    'udise_students',
  ]),
  /** The school, or the section for a register. */
  scopeId: z.uuid(),
  rows: z.number().int().min(0).max(100_000),
});

// People records
export const StudentUpdate = z.object({
  status: z.enum(['applicant', 'active', 'on_leave', 'left', 'passed_out', 'alumni']).optional(),
  gender: z.enum(['female', 'male', 'other', 'not_stated']).optional(),
  custom: z.record(z.string().max(41), z.unknown()).optional(),
});
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
export const StudentDetailsInput = z.object({
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', '']).nullable().optional(),
  motherTongue: optText(40),
  religion: optText(40),
  socialCategory: z
    .enum(['general', 'obc', 'sc', 'st', 'ews', 'not_stated', ''])
    .nullable()
    .optional(),
  nationality: optText(40),
  placeOfBirth: optText(80),
  addressLine: optText(300),
  city: optText(80),
  pincode: z
    .string()
    .regex(/^([1-9][0-9]{5})?$/)
    .nullable()
    .optional(),
  stateCode: z
    .string()
    .regex(/^([A-Z]{2})?$/)
    .nullable()
    .optional(),
  previousSchool: optText(160),
  disability: optText(200),
  medicalNotes: optText(500),
});
export const NameCorrection = z.object({
  legalName: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(3).max(500),
  source: z.enum(['correction', 'board']),
});
export const ApaarInput = z.discriminatedUnion('status', [
  z.object({ status: z.literal('present'), id: z.string().max(20) }),
  z.object({
    status: z.enum(['refused', 'not_generated']),
    note: z.string().trim().min(3).max(500),
  }),
]);
export const AadhaarInput = z.object({ aadhaar: z.string().max(20).nullable() });
export const PenInput = z.object({ pen: z.string().max(20).nullable() });
export const AbcInput = z.object({ abc: z.string().max(20).nullable() });
export const RevealInput = z.object({
  kind: z.enum(['aadhaar', 'apaar', 'abc']),
  reason: z.string().trim().min(5).max(500),
});
export const ReasonInput = z.object({ reason: z.string().trim().min(5).max(500) });
export const GuardianLinkUpdate = z.object({
  feePayer: z.boolean().optional(),
  canLogin: z.boolean().optional(),
  canPickup: z.boolean().optional(),
  restriction: z
    .object({ reason: z.string().trim().min(5).max(500) })
    .nullable()
    .optional(),
});
export const DocumentInput = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  requirement: z.enum(['required', 'conditional', 'optional']),
  status: z.enum(['pending', 'received', 'verified', 'rejected']),
  fileId: z.uuid().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
export const StaffUpdate = z.object({
  designation: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['invited', 'onboarding', 'active', 'on_leave', 'notice']).optional(),
  joinedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  pan: z.string().max(20).nullable().optional(),
});
export const StaffExit = z.object({
  lastDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(500),
});
export const SectionChange = z.object({
  personId: z.uuid(),
  sectionId: z.uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rollNumber: z.number().int().positive().nullable().optional(),
  reason: z.string().trim().min(3).max(500),
});

// Attendance
export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Markable = z.enum(['present', 'absent', 'late', 'half_day', 'school_duty']);
export const AttendanceMarks = z.array(z.object({ personId: z.uuid(), status: Markable })).max(200);
/** One queued device event. The event id is the idempotency key: the server accepts it once. */
const SyncEnvelope = z.object({
  eventId: z.uuid(),
  deviceId: z.string().min(1).max(100),
  actorId: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
});
export const AttendanceSyncEvent = SyncEnvelope.extend({
  type: z.literal('attendance.mark'),
  payload: z.object({ sectionId: z.uuid(), onDate: Day, marks: AttendanceMarks }),
});
/** One tap of the bus attendant (Milestone 18 step 3). */
export const TransportSyncEvent = SyncEnvelope.extend({
  type: z.literal('transport.mark'),
  payload: z.object({
    institutionId: z.uuid(),
    tripId: z.uuid(),
    personId: z.uuid(),
    kind: z.enum(['boarded', 'not_boarded', 'dropped', 'nobody_at_stop', 'handed_to_school']),
    stopId: z.uuid().nullable().optional(),
  }),
});
export const SyncEvent = z.discriminatedUnion('type', [AttendanceSyncEvent, TransportSyncEvent]);
export const SyncBatch = z.object({ events: z.array(SyncEvent).min(1).max(50) });
export const AttendanceCorrection = z.object({
  personId: z.uuid(),
  onDate: Day,
  status: z.enum([
    'present',
    'absent',
    'late',
    'half_day',
    'approved_leave',
    'medical_leave',
    'school_duty',
  ]),
  reason: z.string().trim().min(3).max(500),
});
export const ConflictResolution = z.object({ apply: z.boolean() });
export const SectionDayInput = z.object({ sectionId: z.uuid(), onDate: Day });
export const SubstituteInput = SectionDayInput.extend({ personId: z.uuid() });
export const LeaveRequestInput = z.object({
  studentId: z.uuid(),
  kind: z.enum(['leave', 'medical']),
  from: Day,
  to: Day,
  reason: z.string().trim().min(3).max(500),
});
export const LeaveDecision = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
});
export const HolidayInput = z.object({
  onDate: Day,
  name: z.string().trim().min(2).max(100),
});
export const CondonationInput = z.object({
  personId: z.uuid(),
  reason: z.string().trim().min(3).max(1000),
  deadline: Day,
  fileIds: z.array(z.uuid()).max(10).optional(),
});
export const CondonationDecision = z.object({
  grant: z.boolean(),
  note: z.string().trim().min(3).max(1000),
});
export const AttendanceSettingsInput = z.object({
  alertDelayMinutes: z.number().int().min(0).max(480),
  signOffRequired: z.boolean(),
});

// Notices and the parent app
export const Language = z.enum(['en', 'kn', 'te', 'ta', 'hi', 'ur']);
export const NoticeCompose = z.object({
  kind: z.enum(['notice', 'circular', 'urgent']),
  audience: z.discriminatedUnion('type', [
    z.object({ type: z.literal('school') }),
    z.object({ type: z.literal('groups'), groupIds: z.array(z.uuid()).min(1).max(200) }),
  ]),
  needsAck: z.boolean(),
  versions: z
    .array(
      z.object({
        language: Language,
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(6),
});
export const LanguageInput = z.object({ language: Language });
export const PushTokenInput = z.object({ token: z.string().regex(/^[\w:[\]-]{10,300}$/) });

// Fees. Every amount is whole paise.
const Paise = z.number().int().safe();
const PositivePaise = Paise.positive();
export const FeeHeadInput = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/),
  name: z.string().trim().min(1).max(100),
  taxClass: z.enum(['education_exempt', 'taxable']),
  rteExempt: z.boolean(),
  refundable: z.boolean(),
});
export const FeePlanInput = z.object({
  planId: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  groupIds: z.array(z.uuid()).min(1).max(100),
  lines: z
    .array(z.object({ headId: z.uuid(), amountPaise: PositivePaise }))
    .min(1)
    .max(30),
  instalments: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        dueOn: isoDate,
        shareBp: z.number().int().min(1).max(10_000),
      }),
    )
    .min(1)
    .max(12),
  lateFeePaise: Paise.min(0),
  graceDays: z.number().int().min(0).max(90),
});
export const InvoiceAdjustment = z.object({
  amountPaise: Paise.refine((n) => n !== 0, 'Use a non-zero amount'),
  reason: z.string().trim().min(3).max(500),
});
export const CollectInput = z.object({
  studentId: z.uuid(),
  amountPaise: PositivePaise,
  method: z.enum(['cash', 'cheque', 'upi', 'card']),
  instrumentRef: z.string().trim().max(60).nullable().optional(),
});
/** Writes that move money carry this header; a retry with the same key returns the same result. */
export const IdempotencyKey = z.string().regex(/^[\w-]{8,100}$/);
export const ConcessionRequest = z.object({
  studentId: z.uuid(),
  headId: z.uuid().nullable(),
  kind: z.enum(['percent', 'amount']),
  value: PositivePaise,
  category: z.enum(['rte', 'staff_child', 'sibling', 'merit', 'need', 'other']),
  from: isoDate,
  to: isoDate,
  reason: z.string().trim().min(3).max(500),
});
export const Decision = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
  payoutRef: z.string().trim().max(100).nullable().optional(),
});
export const RefundRequest = z.object({
  amountPaise: PositivePaise,
  reason: z.string().trim().min(3).max(500),
});
export const ReversalRequest = z.object({
  reason: z.string().trim().min(3).max(500),
  chargePaise: Paise.min(0),
});
export const DayCloseInput = z.object({
  countedCashPaise: Paise.min(0),
  depositRef: z.string().trim().max(100).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export const ReminderInput = z.object({ minDaysOverdue: z.number().int().min(1).max(365) });

// Admissions and certificates
const Phone = z.string().regex(/^\+91[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
export const EnquiryInput = z.object({
  yearLabel: z.string().regex(/^\d{4}-\d{2}$/),
  classId: z.uuid(),
  category: z.enum(['general', 'rte', 'staff', 'management']),
  source: z.enum(['walk_in', 'phone', 'website', 'referral', 'rte_portal', 'other']),
  childName: z.string().trim().min(1).max(200),
  dateOfBirth: isoDate.nullable().optional(),
  gender: z.enum(['female', 'male', 'other', 'not_stated']).nullable().optional(),
  guardianName: z.string().trim().min(1).max(200),
  guardianPhone: Phone,
  guardianRelationship: z
    .enum(['mother', 'father', 'guardian', 'grandparent', 'sibling', 'other'])
    .optional(),
  nextFollowUp: isoDate.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  custom: z.record(z.string().max(41), z.unknown()).optional(),
});
// Online application forms (docs/specs/ONLINE_APPLICATIONS.md).
export const AdmissionFormInput = z.object({
  institutionId: z.uuid(),
  yearLabel: z.string().regex(/^\d{4}-\d{2}$/),
  title: z.string().trim().min(1).max(120),
  intro: z.string().max(600).default(''),
  classIds: z.array(z.uuid()).min(1).max(30),
  open: z.boolean(),
  closesOn: isoDate.nullable(),
});
export const ApplicationCodeRequest = z.object({ phone: z.string().min(10).max(16) });
export const ApplicationStatusRequest = z.object({
  phone: z.string().min(10).max(16),
  code: z.string().regex(/^\d{6}$/),
});
export const OnlineApplicationInput = z.object({
  phone: z.string().min(10).max(16),
  code: z.string().regex(/^\d{6}$/),
  childName: z.string().trim().min(1).max(200),
  dateOfBirth: isoDate,
  gender: z.enum(['female', 'male', 'other', 'not_stated']),
  classId: z.uuid(),
  guardianName: z.string().trim().min(1).max(200),
  guardianRelationship: z.enum(['mother', 'father', 'guardian', 'grandparent', 'sibling', 'other']),
  custom: z.record(z.string().max(41), z.unknown()).default({}),
  consent: z.literal(true),
});
export const ApplicationMove = z.object({
  to: z.enum([
    'contacted',
    'applied',
    'documents_pending',
    'under_review',
    'waitlisted',
    'lost',
    'withdrawn',
    'rejected',
  ]),
  reason: z.string().trim().max(500).nullable().optional(),
});
export const ApplicationUpdate = z.object({
  dateOfBirth: isoDate.nullable().optional(),
  gender: z.enum(['female', 'male', 'other', 'not_stated']).nullable().optional(),
  previousSchool: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  nextFollowUp: isoDate.nullable().optional(),
  ageOverride: z
    .object({
      reason: z.string().trim().min(3).max(500),
      orderRef: z.string().trim().min(2).max(100),
    })
    .nullable()
    .optional(),
  custom: z.record(z.string().max(41), z.unknown()).optional(),
});
export const EnrolInput = z.object({ sectionId: z.uuid(), from: isoDate });
export const SeatsInput = z.object({
  yearLabel: z.string().regex(/^\d{4}-\d{2}$/),
  classId: z.uuid(),
  category: z.enum(['general', 'rte', 'staff', 'management']),
  seats: z.number().int().min(0).max(2000),
});
export const CertificateRequest = z.object({
  studentId: z.uuid(),
  kind: z.enum(['tc', 'bonafide', 'fee_paid']),
  purpose: z.string().trim().max(200).nullable().optional(),
  leavingDate: isoDate.nullable().optional(),
  leavingReason: z.string().trim().max(300).nullable().optional(),
});
const Fields = z.array(z.tuple([z.string().max(100), z.string().max(500)])).max(40);
export const DraftEdit = z.object({ fields: Fields, reason: z.string().trim().min(3).max(500) });
export const Reissue = z.object({
  mode: z.enum(['correction', 'duplicate']),
  reason: z.string().trim().min(3).max(500),
  fields: Fields.optional(),
});
export const PortalExport = z.object({
  externalNumber: z.string().trim().max(100).nullable().optional(),
});

// Exams and rollover. Marks travel as text ("72.5", "AB") and are parsed exactly on the server.
const MarkText = z.string().trim().max(10);
export const ExamCreate = z.object({
  yearId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  classIds: z.array(z.uuid()).min(1).max(20),
  maxMarks: z.string().regex(/^\d{1,4}(\.\d{1,2})?$/),
  startsOn: isoDate.nullable().optional(),
  endsOn: isoDate.nullable().optional(),
});
export const MarksSave = z.object({
  sectionId: z.uuid(),
  entries: z
    .array(z.object({ studentId: z.uuid(), mark: MarkText }))
    .min(1)
    .max(200),
});
export const MarkChange = z.object({
  studentId: z.uuid(),
  mark: MarkText,
  reason: z.string().trim().min(3).max(500),
});
export const RemarkInput = z.object({
  studentId: z.uuid(),
  remark: z.string().trim().min(2).max(300),
});
export const YearSpan = z.object({ fromYearId: z.uuid(), toYearId: z.uuid() });
const KeepApart = z.array(z.tuple([z.uuid(), z.uuid()])).max(100);
export const SectionPlanInput = YearSpan.extend({
  classId: z.uuid(),
  plan: z.record(z.uuid(), z.uuid()),
  keepApart: KeepApart,
});
export const RolloverCommit = YearSpan.extend({
  overrides: z
    .array(
      z.object({
        studentId: z.uuid(),
        outcome: z.enum(['promoted', 'detained', 'passed_out']),
        reason: z.string().trim().min(3).max(500),
        nextSectionId: z.uuid().nullable().optional(),
      }),
    )
    .max(2000),
});

// Super admin (control).
export const StaffEmail = z.email().max(200);
export const AdminEnrol = z.object({ token: z.string().min(20).max(200) });
/** A WebAuthn response from the browser; the server library checks every field. */
const WebAuthnResponse = z.looseObject({
  id: z.string().min(1).max(1024),
  type: z.literal('public-key'),
});
export const AdminEnrolVerify = AdminEnrol.extend({
  challengeId: z.uuid(),
  response: WebAuthnResponse,
});
export const AdminSignIn = z.object({ email: StaffEmail });
export const AdminSignInVerify = z.object({
  challengeId: z.union([z.uuid(), z.literal('')]),
  response: WebAuthnResponse,
});
export const CustomerCreate = z.object({
  schoolName: z.string().trim().min(2).max(120),
  state: z.enum(['AP', 'TS', 'KA', 'TN']),
  board: z.enum(['CBSE']),
  ownerName: z.string().trim().min(2).max(100),
  ownerPhone: z.string().min(10).max(20),
  planCode: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
});
export const CustomerQuery = z.object({
  search: z.string().trim().min(1).max(80).optional(),
  status: z.enum(['active', 'suspended', 'closed']).optional(),
});
const Reason = z.string().trim().min(3).max(500);
export const CustomerStatusChange = z.object({
  status: z.enum(['active', 'suspended', 'closed']),
  reason: Reason,
});
export const PlanChange = z.object({ planCode: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/) });
export const FlagSet = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/),
  enabled: z.boolean().nullable(),
});
export const FlagDefault = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/),
  defaultOn: z.boolean(),
});
export const SwitchSet = z.object({
  key: z.enum(['messaging_off', 'payments_off', 'writes_off']),
  orgId: z.uuid().nullable(),
  on: z.boolean(),
  reason: Reason,
});
export const PlanSave = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  name: z.string().trim().min(2).max(60),
  studentLimit: z.number().int().positive().nullable(),
  pricePaise: z.number().int().min(0).max(100_000_000),
  features: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,47}$/)).max(20),
});
export const SupportRequest = z.object({
  reason: Reason,
  ticket: z.string().trim().min(2).max(40),
  minutes: z.number().int().min(15).max(240),
});
export const StaffCreate = z.object({
  name: z.string().trim().min(2).max(100),
  email: StaffEmail,
  role: z.enum(['owner', 'support']),
});
export const AuditQuery = z.object({
  orgId: z.uuid().optional(),
  staffId: z.uuid().optional(),
  action: z
    .string()
    .regex(/^[a-z_.]{1,60}$/)
    .optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// Verse AI.
export const VerseAsk = z.object({
  institutionId: z.uuid(),
  question: z.string().trim().min(2).max(1000),
  page: z.string().max(200).nullable().optional(),
  /** Follow-ups in one conversation see its last few turns (decision 0021). */
  conversationId: z.uuid().nullable().optional(),
});

// Incidents (super admin).
export const IncidentOpen = z.object({
  title: z.string().trim().min(3).max(200),
  details: z.string().trim().min(10).max(5000),
  discoveredAt: z.iso.datetime({ offset: true }),
  personalData: z.boolean(),
  orgIds: z.array(z.uuid()).max(500),
});
export const IncidentStepInput = z.object({
  step: z.enum(['certin_reported', 'board_notified', 'schools_notified', 'closed']),
  note: z.string().trim().min(3).max(2000).optional(),
});

// Onboarding (invited organisation admin).
const StateCodeInput = z.enum(['AP', 'TS', 'KA', 'TN']);
const Optional = <T extends z.ZodType>(t: T) =>
  z.preprocess((v) => (v === '' ? null : v), t.nullable().optional());
const AddressInput = {
  addressLine: Optional(z.string().trim().max(300)),
  city: Optional(z.string().trim().max(100)),
  district: Optional(z.string().trim().max(100)),
  pincode: Optional(z.string().regex(/^[1-9][0-9]{5}$/)),
};
export const InstitutionInput = z.object({
  type: z.enum(['school', 'college', 'university']),
  /** Colleges are affiliated or autonomous (rule book §12.3); left out, the type's default. */
  profile: z.enum(['school', 'affiliated_college', 'autonomous_college', 'university']).optional(),
  name: z.string().trim().min(2).max(160),
  /** A school's board, or a college's affiliating university / a university's regulator. */
  authorityCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,16}$/),
  stateCode: StateCodeInput,
  udiseCode: Optional(z.string().regex(/^[0-9]{11}$/)),
  affiliationNumber: Optional(z.string().trim().max(40)),
  establishedYear: Optional(z.number().int().min(1800).max(2100)),
  medium: Optional(z.string().trim().max(40)),
  lowestClass: Optional(z.string().trim().max(10)),
  highestClass: Optional(z.string().trim().max(10)),
  phone: Optional(
    z
      .string()
      .regex(/^(\+91)?[0-9]{10}$/)
      .transform((p) => (p.startsWith('+91') ? p : `+91${p}`)),
  ),
  email: Optional(z.email().max(200)),
  website: Optional(z.url({ protocol: /^https?$/ }).max(200)),
  ...AddressInput,
});
export const CampusInput = z.object({
  name: z.string().trim().min(2).max(120),
  stateCode: StateCodeInput,
  ...AddressInput,
  institutions: z.array(InstitutionInput).min(1).max(20),
});
export const OnboardingComplete = z
  .object({
    admin: z.object({
      name: z.string().trim().min(2).max(100),
      designation: z.string().trim().min(2).max(80),
      email: Optional(z.email().max(200)),
    }),
    organisation: z.object({
      name: z.string().trim().min(2).max(120),
      legalEntityName: z.string().trim().min(2).max(160),
      gstin: Optional(z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/)),
    }),
    campuses: z.array(CampusInput).min(1).max(20),
  })
  .superRefine((v, ctx) => {
    // Schools follow the CBSE board for now (the class templates are CBSE's); a profile must fit its type.
    v.campuses.forEach((c, ci) =>
      c.institutions.forEach((i, ii) => {
        const path = ['campuses', ci, 'institutions', ii];
        if (i.type === 'school' && i.authorityCode !== 'CBSE')
          ctx.addIssue({ code: 'custom', path: [...path, 'authorityCode'], message: 'board' });
        const fits =
          !i.profile ||
          (i.type === 'school' && i.profile === 'school') ||
          (i.type === 'college' && i.profile.endsWith('_college')) ||
          (i.type === 'university' && i.profile === 'university');
        if (!fits) ctx.addIssue({ code: 'custom', path: [...path, 'profile'], message: 'profile' });
      }),
    );
  });
export const OnboardingDraft = z.object({ draft: z.record(z.string(), z.unknown()) });
/** Self-serve sign-up (rule book §11): who they are and what they run. */
export const SelfSignup = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().min(10).max(20),
  email: Optional(z.email().max(200)),
  organisation: z.string().trim().min(2).max(120),
  kind: z.enum(['school', 'college', 'university']),
  stateCode: StateCodeInput,
});
export const AdminInvite = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().min(10).max(20),
  email: Optional(z.email().max(200)),
  planCode: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
});

// School profile (settings): the same fields onboarding asks for, each optional.
export const SchoolProfileChange = InstitutionInput.pick({
  name: true,
  udiseCode: true,
  affiliationNumber: true,
  establishedYear: true,
  medium: true,
  lowestClass: true,
  highestClass: true,
  addressLine: true,
  city: true,
  district: true,
  pincode: true,
  phone: true,
  email: true,
  website: true,
})
  .partial()
  .extend({ custom: z.record(z.string().max(41), z.unknown()).optional() });

// Owner-defined fields (decision 0020). Values are checked against the definition on the server.
export const FieldEntity = z.enum([
  'organisation',
  'campus',
  'institution',
  'admission',
  'staff',
  'student',
  'guardian',
]);
export const FieldType = z.enum([
  'text',
  'long_text',
  'number',
  'date',
  'yes_no',
  'choice',
  'multi_choice',
  'phone',
  'email',
  'file',
]);
const FieldCommon = {
  label: z.string().min(1).max(80),
  help: z.string().max(200).nullable().optional(),
  options: z.array(z.string().max(80)).max(100).optional(),
  required: z.boolean().optional(),
  section: z.string().max(60).nullable().optional(),
};
export const FieldDefinitionInput = z.object({ ...FieldCommon, type: FieldType });
export const FieldUpdateInput = z.object(FieldCommon);
export const FieldOrderInput = z.object({ ids: z.array(Id).max(60) });
export const FieldRetireInput = z.object({ retired: z.boolean() });
export const FieldValuesInput = z.record(z.string().max(41), z.unknown());

// Roles and access (decision 0020).
const Permission = z.string().regex(/^[a-z_]+\.[a-z_]+\.[a-z_]+$/);
export const RoleCreateInput = z.object({
  name: z.string().min(1).max(60),
  copyFrom: Id.nullable().optional(),
});
export const RoleNameInput = z.object({ name: z.string().min(1).max(60) });
export const RolePermissionsInput = z.object({ permissions: z.array(Permission).max(200) });
export const GrantDecisionInput = z.object({
  decision: z.enum(['approved', 'rejected', 'confirmed_alone']),
  reason: z.string().max(300).nullable().optional(),
});
export const AssignAccessInput = z.object({
  personId: Id,
  roleId: Id,
  scope: z.object({ type: z.enum(['organisation', 'campus', 'institution']), id: Id }),
  from: Day,
  until: Day.nullable(),
});
export const EndAccessInput = z.object({ lastDay: Day });

// Milestone 19: the organisation, campuses and one's own profile.
const OfficePhone = z.string().regex(/^\+91[0-9]{10}$/);
const Email = z.email().max(200);
const Url = z
  .string()
  .regex(/^https?:\/\//)
  .max(200);
export const OrganisationChange = z
  .object({
    name: z.string().min(2).max(120),
    legalName: z.string().min(2).max(160),
    gstin: z
      .string()
      .regex(/^[0-9]{2}[A-Z0-9]{13}$/)
      .nullable(),
    tan: z
      .string()
      .regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/)
      .nullable(),
    registeredAddress: z.string().max(300).nullable(),
    phone: OfficePhone.nullable(),
    email: Email.nullable(),
    website: Url.nullable(),
    brandColour: z
      .string()
      .regex(/^#[0-9a-f]{6}$/)
      .nullable(),
    custom: z.record(z.string().max(41), z.unknown()),
  })
  .partial();
export const CampusChange = z
  .object({
    name: z.string().min(2).max(120),
    addressLine: z.string().max(300).nullable(),
    city: z.string().max(100).nullable(),
    district: z.string().max(100).nullable(),
    stateCode: z.string().regex(/^[A-Z]{2}$/),
    pincode: z
      .string()
      .regex(/^[1-9][0-9]{5}$/)
      .nullable(),
    phone: OfficePhone.nullable(),
    email: Email.nullable(),
    latitude: z
      .string()
      .regex(/^-?\d{1,2}(\.\d{1,6})?$/)
      .nullable(),
    longitude: z
      .string()
      .regex(/^-?\d{1,3}(\.\d{1,6})?$/)
      .nullable(),
    geofenceMetres: z.number().int().min(50).max(2000),
    custom: z.record(z.string().max(41), z.unknown()),
  })
  .partial();
export const NewCampus = CampusChange.extend({
  name: z.string().min(2).max(120),
  stateCode: z.string().regex(/^[A-Z]{2}$/),
});
/** A school (CBSE for now), or a college or university under its affiliating body (rule book §12.3). */
export const NewSchool = z.discriminatedUnion('profile', [
  z.object({
    profile: z.literal('school'),
    name: z.string().min(2).max(160),
    authorityCode: z.literal('CBSE'),
    lowestClass: z.string().max(10).nullable().optional(),
    highestClass: z.string().max(10).nullable().optional(),
  }),
  z.object({
    profile: z.enum(['affiliated_college', 'autonomous_college', 'university']),
    name: z.string().min(2).max(160),
    authorityCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{2,32}$/),
  }),
]);
export const MyProfileChange = z
  .object({
    email: Email.nullable(),
    preferredLanguage: z.enum(['en', 'kn', 'te', 'ta', 'hi', 'mr', 'ur']),
  })
  .partial();

// Milestone 20: staff, documents and staff attendance.
const Mobile = z.string().regex(/^\+91[6-9]\d{9}$/);
export const NewStaffInput = z.object({
  institutionId: Id,
  name: z.string().min(2).max(120),
  phone: Mobile,
  employeeCode: z
    .string()
    .regex(/^[A-Za-z0-9/_-]{1,30}$/)
    .nullable()
    .optional(),
  designation: z.string().max(80).nullable().optional(),
  department: z.string().max(80).nullable().optional(),
  employmentType: z
    .enum(['permanent', 'probation', 'contract', 'part_time', 'visiting'])
    .nullable()
    .optional(),
  joinedOn: Day,
  gender: z.enum(['female', 'male', 'other', 'not_stated']).nullable().optional(),
  dateOfBirth: Day.nullable().optional(),
  workEmail: z.email().max(200).nullable().optional(),
  workRole: z
    .enum(['teacher', 'office', 'driver', 'bus_attendant', 'security', 'warden', 'nurse'])
    .nullable()
    .optional(),
  custom: z.record(z.string().max(41), z.unknown()).optional(),
});
export const StaffCheckInput = z
  .object({
    kind: z.enum(['police_verification', 'driving_licence', 'medical_fitness', 'psv_badge']),
    reference: z.string().trim().min(1).max(60).nullable().optional(),
    checkedOn: Day,
    validUntil: Day.nullable().optional(),
    note: z.string().max(300).nullable().optional(),
  })
  .refine((c) => !c.validUntil || c.validUntil >= c.checkedOn, { path: ['validUntil'] });
export const StaffDetailsInput = z
  .object({
    department: z.string().max(80).nullable(),
    employmentType: z
      .enum(['permanent', 'probation', 'contract', 'part_time', 'visiting'])
      .nullable(),
    qualifications: z.string().max(500).nullable(),
    experienceMonths: z.number().int().min(0).max(720).nullable(),
    gender: z.enum(['female', 'male', 'other', 'not_stated']).nullable(),
    dateOfBirth: Day.nullable(),
    emergencyName: z.string().max(120).nullable(),
    emergencyPhone: Mobile.nullable(),
    aadhaar: z.string().max(20).nullable(),
    bankAccount: z.string().max(30).nullable(),
    bankIfsc: z
      .string()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .nullable(),
    pfUan: z
      .string()
      .regex(/^[0-9]{12}$/)
      .nullable(),
    esiNumber: z
      .string()
      .regex(/^[0-9]{10,17}$/)
      .nullable(),
    custom: z.record(z.string().max(41), z.unknown()),
  })
  .partial();
export const DocumentMeta = z.object({
  folder: z.enum([
    'identity',
    'academic',
    'qualifications',
    'employment',
    'payroll',
    'medical',
    'transfer',
    'other',
  ]),
  kind: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  title: z.string().min(1).max(120),
  expiresOn: Day.nullable().optional(),
});
export const DocumentCheckInput = z.object({
  status: z.enum(['verified', 'rejected']),
  note: z.string().max(300).nullable().optional(),
});
export const CheckInInput = z.object({
  institutionId: Id,
  direction: z.enum(['in', 'out']),
  eventId: Id,
  source: z.enum(['web', 'app']),
  at: z.iso.datetime({ offset: true }).optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyMetres: z.number().int().min(0).max(100_000).optional(),
    })
    .nullable()
    .optional(),
});
export const MarkDayInput = z.object({
  institutionId: Id,
  onDate: Day,
  personId: Id,
  status: z.enum(['present', 'absent', 'half_day', 'on_leave', 'on_duty']),
  reason: z.string().max(300).nullable().optional(),
});
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const StaffAttendanceSettingsInput = z.object({
  startsAt: Clock,
  endsAt: Clock,
  lateAfterMinutes: z.number().int().min(0).max(180),
  earlyBeforeMinutes: z.number().int().min(0).max(180),
  fullDayMinutes: z.number().int().min(60).max(720),
  requireOnCampus: z.boolean(),
});

// The library (docs/specs/LIBRARY.md).
const Accession = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9/-]{1,20}$/);
export const LibrarySettingsInput = z.object({
  studentLoanDays: z.number().int().min(1).max(365),
  staffLoanDays: z.number().int().min(1).max(365),
  studentLimit: z.number().int().min(1).max(50),
  staffLimit: z.number().int().min(1).max(50),
  renewals: z.number().int().min(0).max(10),
  finePerDayPaise: z.number().int().min(0).max(100_000),
});
export const LibraryTitleInput = z.object({
  institutionId: Id,
  title: z.string().trim().min(1).max(300),
  authors: z.string().max(300).default(''),
  isbn: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
    .pipe(z.string().regex(/^[0-9]{9}[0-9X]$|^[0-9]{13}$/))
    .nullable()
    .default(null),
  publisher: z.string().max(200).default(''),
  year: z.number().int().min(1500).max(2100).nullable().default(null),
  subject: z.string().max(100).default(''),
  language: z.string().max(50).default(''),
  shelf: z.string().max(50).default(''),
});
export const LibraryCopiesInput = z.object({
  institutionId: Id,
  accessionNos: z.array(Accession).min(1).max(50),
  acquiredOn: Day.nullable().default(null),
  pricePaise: z.number().int().min(0).max(100_000_000).nullable().default(null),
});
export const LibraryIssueInput = z.object({
  institutionId: Id,
  accessionNo: Accession,
  personId: Id,
});
export const LibraryReturnInput = z.object({ institutionId: Id, accessionNo: Accession });
export const LibraryReasonInput = z.object({
  institutionId: Id,
  reason: z.string().trim().min(3).max(300),
});
export const LibraryPlaceInput = z.object({ institutionId: Id });

// Visitors and gate (docs/specs/VISITORS_GATE.md). Phones as typed: 98450 12345, +91…, 0…
export const GateMobile = z
  .string()
  .transform((v) =>
    v.replace(/[\s()-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, ''),
  )
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'))
  .transform((d) => `+91${d}`);
export const GatePurpose = z.enum([
  'parent_meeting',
  'staff_meeting',
  'admission_enquiry',
  'delivery',
  'vendor',
  'interview',
  'official',
  'other',
]);
export const GateCheckInInput = z.object({
  institutionId: Id,
  visitId: Id.nullable().default(null),
  phone: GateMobile,
  name: z.string().trim().min(1).max(200),
  purpose: GatePurpose,
  note: z.string().max(300).default(''),
  hostPersonId: Id.nullable().default(null),
  partySize: z.number().int().min(1).max(50).default(1),
  vehicleNo: z.string().max(20).default(''),
  badgeNo: z.string().max(20).default(''),
});
export const GateExpectInput = z.object({
  institutionId: Id,
  phone: GateMobile,
  name: z.string().trim().min(1).max(200),
  purpose: GatePurpose,
  note: z.string().max(300).default(''),
  partySize: z.number().int().min(1).max(50).default(1),
  expectedOn: Day,
});
export const GateBarInput = z.object({
  institutionId: Id,
  phone: GateMobile,
  name: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(3).max(300),
});
export const GateReasonInput = z.object({
  institutionId: Id,
  reason: z.string().trim().min(3).max(300),
});
export const GatePlaceInput = z.object({ institutionId: Id });
export const GatePassInput = z.object({
  institutionId: Id,
  studentId: Id,
  collector: z.union([
    z.object({ guardianId: Id }),
    z.object({
      name: z.string().trim().min(1).max(200),
      relation: z.string().trim().min(1).max(50),
      phone: GateMobile,
    }),
  ]),
  reason: z.string().trim().min(3).max(300),
});

// Expenses (docs/specs/EXPENSES.md). Money in paise.
const BillPaise = z.number().int().min(1).max(100_000_000_000);
const FinancialYear = z.string().regex(/^\d{4}-\d{2}$/);
export const ExpenseCategoryInput = z.object({
  institutionId: Id,
  name: z.string().trim().min(1).max(80),
  active: z.boolean().default(true),
});
export const ExpenseVendorInput = z.object({
  institutionId: Id,
  name: z.string().trim().min(1).max(200),
  phone: GateMobile.nullable().default(null),
  email: z.email().max(200).nullable().default(null),
  gstin: z
    .string()
    .transform((v) => v.replace(/\s/g, '').toUpperCase())
    .pipe(z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'Enter a 15-character GSTIN'))
    .nullable()
    .default(null),
  address: z.string().max(500).default(''),
  active: z.boolean().default(true),
});
export const ExpenseBillInput = z
  .object({
    institutionId: Id,
    categoryId: Id,
    vendorId: Id.nullable().default(null),
    payee: z.string().max(200).default(''),
    billNo: z.string().max(50).default(''),
    billDate: Day,
    description: z.string().trim().min(1).max(500),
    amountPaise: BillPaise,
    taxPaise: z.number().int().min(0).max(100_000_000_000).default(0),
    fileId: Id.nullable().default(null),
  })
  .refine((b) => b.taxPaise <= b.amountPaise, {
    message: 'GST can’t be more than the amount',
    path: ['taxPaise'],
  })
  .refine((b) => b.vendorId || b.payee.trim(), {
    message: 'Pick a vendor or name the payee',
    path: ['payee'],
  });
export const ExpenseDecisionInput = z.object({
  institutionId: Id,
  approve: z.boolean(),
  note: z.string().max(300).default(''),
});
export const ExpensePayInput = z.object({
  institutionId: Id,
  mode: z.enum(['cash', 'bank_transfer', 'cheque', 'upi', 'card']),
  reference: z.string().max(100).default(''),
  paidOn: Day,
});
export const ExpenseBudgetInput = z.object({
  institutionId: Id,
  categoryId: Id,
  financialYear: FinancialYear,
  amountPaise: z.number().int().min(0).max(100_000_000_000),
});
export const ExpensePlaceInput = z.object({ institutionId: Id });

// Hostel (docs/specs/HOSTEL.md).
export const HostelInput = z.object({
  institutionId: Id,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['boys', 'girls', 'mixed']),
  active: z.boolean().default(true),
});
export const HostelRoomInput = z.object({
  institutionId: Id,
  number: z.string().trim().min(1).max(20),
  floor: z.string().max(20).default(''),
  beds: z.number().int().min(1).max(20),
  active: z.boolean().default(true),
});
export const HostelAllocateInput = z.object({
  institutionId: Id,
  roomId: Id,
  bedNo: z.number().int().min(1).max(20),
  studentId: Id,
});
export const HostelMoveInput = HostelAllocateInput.omit({ studentId: true });
export const HostelReasonInput = z.object({
  institutionId: Id,
  reason: z.string().trim().min(3).max(300),
});
export const HostelRollCallInput = z.object({
  institutionId: Id,
  session: z.enum(['night', 'morning']),
  marks: z
    .array(z.object({ studentId: Id, status: z.enum(['present', 'absent', 'on_leave']) }))
    .max(2000),
});
const HostelCollector = z.union([
  z.object({ guardianId: Id }),
  z.object({
    name: z.string().trim().min(1).max(200),
    relation: z.string().trim().min(1).max(50),
    phone: GateMobile,
  }),
]);
export const OutpassRequestInput = z.object({
  studentId: Id,
  leavesOn: Day,
  backBy: Day,
  reason: z.string().trim().min(3).max(300),
  collector: HostelCollector,
});
export const OutpassIssueInput = OutpassRequestInput.extend({ institutionId: Id });
export const OutpassDecisionInput = z.object({
  institutionId: Id,
  approve: z.boolean(),
  note: z.string().max(300).default(''),
});
export const HostelPlaceInput = z.object({ institutionId: Id });

// Syllabus and lesson plans (docs/specs/SYLLABUS.md).
export const SyllabusUnitInput = z.object({
  institutionId: Id,
  classId: Id,
  subjectId: Id,
  title: z.string().trim().min(1).max(200),
  plannedMonth: z
    .string()
    .regex(/^\d{4}-\d{2}(-01)?$/)
    .transform((m) => (m.length === 7 ? `${m}-01` : m))
    .nullable()
    .default(null),
  periods: z.number().int().min(1).max(200).nullable().default(null),
  notes: z.string().max(1000).default(''),
});
export const SyllabusMoveInput = z.object({ institutionId: Id, direction: z.enum(['up', 'down']) });
export const SyllabusTickInput = z.object({
  institutionId: Id,
  sectionId: Id,
  done: z.boolean(),
  onDate: Day.nullable().default(null),
  note: z.string().max(300).default(''),
});
export const LessonPlanInput = z.object({
  institutionId: Id,
  sectionId: Id,
  subjectId: Id,
  onDate: Day,
  unitId: Id.nullable().default(null),
  plan: z.string().trim().min(1).max(2000),
});
export const SyllabusPlaceInput = z.object({ institutionId: Id });

// Helpdesk (docs/specs/HELPDESK.md).
export const HelpdeskCategoryInput = z.object({
  institutionId: Id,
  name: z.string().trim().min(1).max(80),
  hours: z.number().int().min(1).max(720),
  assigneePersonId: Id.nullable().default(null),
  audience: z.enum(['parents', 'staff', 'both']).default('both'),
  active: z.boolean().default(true),
});
export const HelpdeskRaiseInput = z
  .object({
    institutionId: Id.nullable().default(null),
    studentId: Id.nullable().default(null),
    categoryId: Id,
    subject: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(4000),
    priority: z.enum(['normal', 'urgent']).default('normal'),
  })
  .refine((r) => r.institutionId || r.studentId, { message: 'Give the school or the child' });
export const HelpdeskReplyInput = z.object({
  body: z.string().trim().min(1).max(4000),
  internal: z.boolean().default(false),
  state: z.enum(['open', 'in_progress', 'waiting', 'resolved']).nullable().default(null),
});
export const HelpdeskStateInput = z.object({
  state: z.enum(['open', 'in_progress', 'waiting', 'resolved']),
});
export const HelpdeskAssignInput = z.object({ personId: Id.nullable() });

// Assets and inventory (docs/specs/ASSETS.md).
const AssetTag = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9/-]{1,20}$/);
const Condition = z.enum(['good', 'needs_repair', 'broken']);
export const AssetNamedInput = z.object({
  institutionId: Id,
  kind: z.enum(['category', 'location']),
  name: z.string().trim().min(1).max(80),
  active: z.boolean().default(true),
});
export const AssetInput = z.object({
  institutionId: Id,
  tag: AssetTag,
  name: z.string().trim().min(1).max(200),
  categoryId: Id,
  locationId: Id.nullable().default(null),
  custodianPersonId: Id.nullable().default(null),
  condition: Condition.default('good'),
  purchasedOn: Day.nullable().default(null),
  costPaise: z.number().int().min(0).max(100_000_000_000).nullable().default(null),
  vendor: z.string().max(200).default(''),
  serialNo: z.string().max(100).default(''),
  warrantyUntil: Day.nullable().default(null),
  notes: z.string().max(1000).default(''),
});
export const AssetUpdateInput = z.object({
  institutionId: Id,
  locationId: Id.nullable().optional(),
  custodianPersonId: Id.nullable().optional(),
  condition: Condition.optional(),
  note: z.string().max(300).default(''),
});
export const AssetDisposeInput = z.object({
  institutionId: Id,
  reason: z.string().trim().min(3).max(300),
});
export const StockItemInput = z.object({
  institutionId: Id,
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(20),
  reorderLevel: z.number().int().min(0).max(1_000_000).default(0),
  active: z.boolean().default(true),
});
export const StockMoveInput = z.object({
  institutionId: Id,
  direction: z.enum(['in', 'out']),
  quantity: z.number().int().min(1).max(1_000_000),
  note: z.string().max(300).default(''),
  issuedToPersonId: Id.nullable().default(null),
});

// Appraisals (docs/specs/APPRAISALS.md).
export const AppraisalCycleInput = z
  .object({
    institutionId: Id,
    name: z.string().trim().min(1).max(120),
    opensOn: Day,
    closesOn: Day,
    criteria: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(120),
          description: z.string().max(500).default(''),
          weight: z.number().int().min(1).max(5).default(1),
        }),
      )
      .min(1)
      .max(30),
  })
  .refine((c) => c.closesOn >= c.opensOn, {
    message: 'Closes before it opens',
    path: ['closesOn'],
  });
export const AppraisalPlaceInput = z.object({ institutionId: Id });
export const AppraisalRatingsInput = z.object({
  ratings: z
    .array(
      z.object({
        criterionId: Id,
        score: z.number().int().min(1).max(5),
        comment: z.string().max(500).default(''),
      }),
    )
    .min(1)
    .max(30),
  comment: z.string().max(2000).default(''),
});
export const AppraisalAckInput = z.object({ reply: z.string().max(1000).default('') });
export const AppraisalReviewerInput = z.object({ institutionId: Id, personId: Id });

// Homework and the class diary (docs/specs/HOMEWORK.md).
export const HomeworkInput = z.object({
  institutionId: Id,
  sectionIds: z.array(Id).min(1).max(20),
  subjectId: Id,
  title: z.string().trim().min(1).max(120),
  details: z.string().max(2000).default(''),
  dueOn: Day,
  fileIds: z.array(Id).max(3).default([]),
});
export const HomeworkEdit = HomeworkInput.pick({
  title: true,
  details: true,
  dueOn: true,
  fileIds: true,
});
export const HomeworkDoneInput = z.object({ done: z.boolean() });
export const DiaryInput = z.object({
  sectionId: Id,
  onDate: Day,
  subjectId: Id.nullable(),
  body: z.string().trim().min(1).max(1000),
});
export const DiaryEdit = DiaryInput.pick({ body: true });

// Staff leave (docs/specs/STAFF_LEAVE.md). Days are whole or half.
const HalfDays = z.number().refine((n) => Number.isInteger(n * 2), 'whole or half days');
export const LeaveTypeInput = z.object({
  code: z.string().regex(/^[A-Z0-9]{1,6}$/),
  name: z.string().trim().min(1).max(60),
  paid: z.boolean(),
  daysPerYear: HalfDays.min(0).max(366).nullable(),
  carryForwardMax: HalfDays.min(0).max(366),
  halfDay: z.boolean(),
  active: z.boolean(),
});
export const LeaveAskInput = z.object({
  institutionId: Id,
  personId: Id.optional(),
  typeId: Id,
  from: Day,
  to: Day,
  halfDay: z.boolean(),
  reason: z.string().trim().min(1).max(300),
});
export const LeaveQuoteInput = LeaveAskInput.omit({ reason: true });
export const LeaveDecisionInput = z.object({
  approve: z.boolean(),
  note: z.string().max(300).nullable().optional(),
});
export const LeaveAdjustInput = z.object({
  institutionId: Id,
  personId: Id,
  typeId: Id,
  year: z.number().int().min(2000).max(2100),
  days: HalfDays.min(-366)
    .max(366)
    .refine((n) => n !== 0, 'not zero'),
  reason: z.string().trim().min(1).max(300),
});

// Milestone 21: applicant papers and subjects.
export const ApplicantDocumentMeta = z.object({
  folder: z.enum(['identity', 'academic', 'medical', 'transfer', 'other']),
  kind: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  title: z.string().min(1).max(120),
});
export const FieldValues = z.record(z.string().max(41), z.unknown());
const SubjectKind = z.enum(['scholastic', 'co_scholastic', 'language', 'elective']);
export const NewSubject = z.object({
  code: z.string().regex(/^[A-Za-z0-9]{2,8}$/),
  name: z.string().min(1).max(80),
  kind: SubjectKind,
});
export const SubjectChange = z.object({
  name: z.string().min(1).max(80).optional(),
  kind: SubjectKind.optional(),
  retired: z.boolean().optional(),
});
export const OfferingInput = z.object({
  classId: Id,
  subjectId: Id,
  offered: z.boolean(),
  periodsPerWeek: z.number().int().min(0).max(20).nullable().optional(),
});
export const TeacherInput = z.object({
  sectionId: Id,
  subjectId: Id.nullable(),
  personId: Id.nullable(),
});

// Milestone 22: an exam paper's date, time, room and invigilator.
export const PaperScheduleInput = z.object({
  onDate: Day.nullable(),
  startsAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  durationMinutes: z.number().int().min(5).max(480).nullable(),
  room: z.string().max(40).nullable(),
  invigilatorId: Id.nullable(),
});

// Milestone 18 step 1: transport setup (docs/specs/TRANSPORT.md).
export const VehicleInput = z.object({
  institutionId: Id,
  id: Id.optional(),
  registration: z.string().min(4).max(20),
  kind: z.enum(['bus', 'van', 'auto']),
  seats: z.number().int().min(1).max(120),
  ownedBy: z.enum(['school', 'contractor']),
  contractorName: z.string().max(120).nullable().optional(),
  active: z.boolean(),
});
export const VehicleDocumentInput = z.object({
  institutionId: Id,
  kind: z.enum(['registration', 'fitness', 'insurance', 'permit', 'pollution']),
  number: z.string().max(60).nullable().optional(),
  validUntil: Day,
  fileId: Id.nullable().optional(),
});
export const StopInput = z.object({
  institutionId: Id,
  id: Id.optional(),
  name: z.string().trim().min(1).max(80),
  landmark: z.string().max(120).nullable().optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable()
    .optional(),
  fareZone: z.number().int().min(1).max(20).nullable().optional(),
  active: z.boolean(),
});
export const RouteInput = z.object({
  institutionId: Id,
  id: Id.optional(),
  name: z.string().trim().min(1).max(80),
  direction: z.enum(['pickup', 'drop']),
  vehicleId: Id.nullable().optional(),
  driverPersonId: Id.nullable().optional(),
  attendantPersonId: Id.nullable().optional(),
  active: z.boolean(),
  stops: z
    .array(z.object({ stopId: Id, plannedAt: Clock }))
    .min(1)
    .max(200),
});

// Connected school (docs/specs/CONNECTED_SCHOOL.md): a fare zone's yearly fee, set on Transport.
export const ZoneFeeInput = z.object({
  institutionId: Id,
  amountPaise: z.number().int().min(100).max(100_000_000),
  instalments: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        dueOn: isoDate,
        shareBp: z.number().int().min(1).max(10_000),
      }),
    )
    .min(1)
    .max(12),
});

// Milestone 18 step 2: riders.
export const RiderInput = z.object({
  institutionId: Id,
  personId: Id,
  routeId: Id,
  stopId: Id,
  from: Day,
});
export const EndRiderInput = z.object({ institutionId: Id, lastDay: Day });
export const RiderImportInput = z.object({
  institutionId: Id,
  from: Day,
  rows: z
    .array(
      z.object({
        reference: z.string().trim().min(1).max(40),
        route: z.string().trim().min(1).max(80),
        direction: z.enum(['pickup', 'drop']),
        stop: z.string().trim().min(1).max(80),
      }),
    )
    .min(1)
    .max(5000),
});

// Milestone 18 step 3: trips.
export const StartTripInput = z.object({
  institutionId: Id,
  routeId: Id,
  overrideReason: z.string().trim().min(3).max(500).optional(),
});
export const EndTripInput = z
  .object({
    institutionId: Id,
    outcome: z.enum(['empty', 'child_found']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.outcome === 'empty' || (v.note ?? '').length >= 3, {
    message: 'Say what was found',
    path: ['note'],
  });

// Milestone 19: timetable.
const Hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const ScheduleInput = z.object({
  name: z.string().trim().min(1).max(80),
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  periods: z
    .array(
      z.object({
        startsAt: Hm,
        endsAt: Hm,
        kind: z.enum(['class', 'break']),
        label: z.string().trim().max(40).nullable().optional(),
      }),
    )
    .min(1)
    .max(16),
});
export const NewTimetableInput = ScheduleInput.extend({ institutionId: Id });
export const CopyTimetableInput = z.object({ name: z.string().trim().min(1).max(80) });
export const SlotInput = z.object({
  sectionId: Id,
  weekday: z.number().int().min(1).max(7),
  period: z.number().int().min(1).max(16),
  subjectId: Id.nullable(),
  teacherPersonId: Id.nullable().optional(),
  room: z.string().trim().max(40).nullable().optional(),
});
export const PublishTimetableInput = z.object({ effectiveFrom: Day });
export const GroupInput = z.object({
  name: z.string().trim().min(1).max(60),
  sectionIds: z.array(Id).min(1).max(40),
});
export const GroupSlotInput = z.object({
  weekday: z.number().int().min(1).max(7),
  period: z.number().int().min(1).max(16),
  lessons: z
    .array(
      z.object({
        subjectId: Id,
        teacherPersonId: Id.nullable().optional(),
        room: z.string().trim().max(40).nullable().optional(),
      }),
    )
    .max(12),
});
const PerDay = z.number().int().min(1).max(16);
export const GenerateRules = z.object({
  mode: z.enum(['fill', 'rebuild']),
  maxSamePerDay: z.number().int().min(1).max(4),
  teacherMaxPerDay: PerDay,
  teacherMaxInARow: PerDay,
  subjects: z.record(
    Id,
    z.object({
      doubles: z.number().int().min(0).max(4).optional(),
      time: z.enum(['any', 'morning', 'afternoon']).optional(),
      maxPerDay: z.number().int().min(1).max(4).optional(),
      rooms: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    }),
  ),
  teachers: z.record(
    Id,
    z.object({
      offDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
      offPeriods: z.array(z.number().int().min(1).max(16)).max(16).optional(),
      offCells: z
        .array(z.string().regex(/^[1-7]:([1-9]|1[0-6])$/))
        .max(112)
        .optional(),
      maxPerDay: PerDay.optional(),
    }),
  ),
});
export const GenerateInput = z.object({ rules: GenerateRules.optional() });
export const CoverInput = z
  .object({
    institutionId: Id,
    date: Day,
    slotId: Id,
    kind: z.enum(['teacher', 'combined', 'supervised']),
    coveringPersonId: Id.nullable().optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => (v.kind === 'teacher') === !!v.coveringPersonId, {
    message: 'A covering teacher, only when a teacher covers',
    path: ['coveringPersonId'],
  });

// Milestone 18 step 5: parents.
export const SkipRideInput = z.object({ date: Day, cancel: z.boolean().optional() });

// Milestone 18 step 4: driving.
export const PositionsInput = z.object({
  institutionId: Id,
  points: z
    .array(
      z.object({
        at: z.iso.datetime({ offset: true }),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        speedKmh: z.number().min(0).max(300).nullable().optional(),
        accuracyM: z.number().int().min(0).max(100_000).nullable().optional(),
      }),
    )
    .min(1)
    .max(120),
});
export const SosInput = z.object({
  institutionId: Id,
  note: z.string().trim().max(500).optional(),
  at: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
});

// Payroll (docs/specs/PAYROLL.md).
const SalaryPaise = z.number().int().min(0).max(100_000_000);
export const SalaryInput = z.object({
  institutionId: Id,
  personId: Id,
  effectiveFrom: isoDate,
  basic: SalaryPaise,
  da: SalaryPaise,
  hra: SalaryPaise,
  conveyance: SalaryPaise,
  special: SalaryPaise,
  other: SalaryPaise,
  pf: z.boolean(),
  esi: z.boolean(),
  pt: z.boolean(),
  tdsPaise: SalaryPaise,
  otherDeductionPaise: SalaryPaise,
});
export const PayrollMonthInput = z.object({
  institutionId: Id,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
export const PayrollPaidInput = z.object({
  paidOn: isoDate,
  mode: z.enum(['bank', 'cash', 'cheque']),
  reference: z.string().trim().max(80).nullable(),
});

// Privacy & Consent (rule book §13.12, §15).
const IsoInstant = z.iso.datetime({ offset: true });
export const PrivacyNoticeInput = z.object({
  purpose: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,40}$/),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .default('en'),
  body: z.string().trim().min(20).max(8000),
});
export const PrivacyRequestInput = z.object({
  kind: z.enum(['access', 'correction', 'erasure', 'grievance', 'nomination', 'withdraw_consent']),
  requesterName: z.string().trim().min(1).max(120),
  requesterContact: z.string().trim().min(3).max(160).nullable().default(null),
  subjectPersonId: Id.nullable().default(null),
  details: z.string().trim().min(1).max(4000),
  receivedAt: IsoInstant.nullable().default(null),
});
export const PrivacyRequestStateInput = z
  .object({
    state: z.enum(['open', 'in_progress', 'done', 'rejected']),
    outcome: z.string().trim().min(1).max(4000).nullable().default(null),
  })
  .refine((r) => !['done', 'rejected'].includes(r.state) || r.outcome, {
    message: 'Write down the outcome before closing the request',
    path: ['outcome'],
  });
export const PrivacyBreachInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(4000),
  severity: z.enum(['low', 'medium', 'high']),
  affectedCount: z.number().int().min(0).nullable().default(null),
  discoveredAt: IsoInstant,
});
export const PrivacyBreachStepInput = z.object({
  step: z.enum(['cert_in', 'board', 'people', 'close']),
  at: IsoInstant.nullable().default(null),
});

// Health Connect (rule book §13.9).
const VaultText = (max: number) => z.string().trim().max(max).default('');
export const HealthPlaceInput = z.object({ institutionId: Id });
export const HealthRecordInput = z.object({
  institutionId: Id,
  vault: z.object({
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().default(null),
    allergies: VaultText(1000),
    conditions: VaultText(2000),
    medicines: VaultText(1000),
    responderNotes: VaultText(500),
  }),
});
export const HealthVisitInput = z.object({
  institutionId: Id,
  complaint: z.string().trim().min(1).max(1000),
  care: z.string().trim().max(2000).default(''),
  outcome: z.enum(['back_to_class', 'rested', 'sent_home', 'referred']),
  parentTold: z.boolean().default(false),
});
export const HealthBreakGlassInput = z.object({
  institutionId: Id,
  reason: z.string().trim().min(10).max(500),
});
export const ConsentDecisionInput = z.object({
  noticeId: Id,
  guardianId: Id,
  decision: z.enum(['granted', 'withdrawn']),
  source: z.enum(['app', 'office', 'paper']),
});

// Academics › Academic Structure (rule book §13.2, §12.4 decisions 2–3).
const Code = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(new RegExp(`^[A-Z0-9][A-Z0-9-]{1,${max - 1}}$`));
export const ProgramInput = z.object({
  institutionId: Id,
  code: Code(20),
  name: z.string().trim().min(2).max(160),
  level: z.enum(['certificate', 'diploma', 'ug', 'pg', 'doctoral']),
  termKind: z.enum(['semester', 'trimester', 'year']),
  terms: z.number().int().min(1).max(16),
  framework: z.string().max(20).nullable().default(null),
});
export const RegulationInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,11}$/),
  effectiveFrom: Day,
  minCredits: z.number().positive().max(9999).nullable().default(null),
});
export const CurriculumCourseInput = z.object({
  code: Code(20),
  title: z.string().trim().min(2).max(160),
  termNumber: z.number().int().min(1).max(16),
  kind: z.enum(['core', 'elective', 'open_elective', 'lab', 'project', 'value_added']),
  lecture: z.number().int().min(0).max(12),
  tutorial: z.number().int().min(0).max(12),
  practical: z.number().int().min(0).max(24),
  credits: z.number().min(0).max(30).multipleOf(0.5),
  /** Internal assessment components, weights adding up to 100 (checked by the module). */
  cieComponents: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        maxMarks: z.number().positive().max(200),
        weight: z.number().positive().max(100),
      }),
    )
    .min(1)
    .max(8)
    .nullable()
    .default(null),
});
const SectionName = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,7}$/);
export const BatchInput = z.object({
  regulationId: Id,
  startYear: z.number().int().min(2000).max(2100),
  label: z.string().trim().min(2).max(40).nullable().default(null),
  intake: z.number().int().positive().max(100000).nullable().default(null),
  sections: z.array(SectionName).min(1).max(26),
  capacity: z.number().int().min(1).max(500),
  startsOn: Day,
  endsOn: Day,
});
export const SectionInput = z.object({
  name: SectionName,
  capacity: z.number().int().min(1).max(500),
});
export const AdvanceTermInput = z.object({
  fromTerm: z.number().int().min(1).max(16),
  next: z.object({ startsOn: Day, endsOn: Day }).nullable(),
});
export const BatchEnrolInput = z.object({
  sectionId: Id,
  name: z.string().trim().min(2).max(160),
  dateOfBirth: Day.nullable().default(null),
  registerNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9/-]{1,30}$/)
    .nullable()
    .default(null),
});

// Academics › Course Registration (rule book §13.2).
export const RegistrationWindowInput = z.object({
  opensOn: Day,
  closesOn: Day,
  minCredits: z.number().min(0).max(60).multipleOf(0.5),
  maxCredits: z.number().min(0).max(60).multipleOf(0.5),
  caps: z
    .array(z.object({ courseId: Id, seats: z.number().int().min(1).max(5000) }))
    .max(200)
    .default([]),
});
export const RegisterInput = z.object({
  studentId: Id,
  electiveIds: z.array(Id).max(50),
});
export const RegistrationDecisionInput = z.object({
  decision: z.enum(['approve', 'return']),
  note: z.string().trim().max(500).nullable().default(null),
});

// Campus Core › Workflow & Approvals (rule book §12.4 decision 6).
const RoleKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
export const ApprovalStepsInput = z.object({
  process: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  institutionId: Id.nullable().default(null),
  steps: z
    .array(
      z.object({
        role: RoleKey,
        minAmountPaise: z.number().int().min(0).nullable().default(null),
        hours: z.number().int().min(1).max(720).nullable().default(null),
        escalateTo: RoleKey.nullable().default(null),
      }),
    )
    .max(6),
});

// Privacy & Consent › guardian verification (DPDP Rule 10).
export const GuardianVerifyInput = z.object({
  method: z.enum(['known_record', 'document_seen']),
  document: z
    .enum(['aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id', 'other'])
    .nullable()
    .default(null),
  note: z.string().trim().max(300).nullable().default(null),
});
export const GuardianRevokeInput = z.object({ note: z.string().trim().min(1).max(300) });

// Campus Core › Rule Packs (rule book §15.1).
export const PackAdoptInput = z.object({
  institutionId: Id,
  pack: z.string().regex(/^[a-z]+\.[A-Za-z_]+$/),
  version: z.number().int().min(1),
  fromDate: Day,
});
const PackSource = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.url().optional(),
  readOn: Day,
  verified: z.boolean(),
});
export const PackDraftInput = z.object({
  pack: z.string().regex(/^[a-z]+\.[A-Za-z_]+$/),
  effectiveFrom: Day,
  payload: z.unknown(),
  sources: z.array(PackSource).min(1).max(10),
  tests: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        check: z.string().min(1).max(60),
        input: z.record(z.string(), z.unknown()),
        expect: z.unknown(),
      }),
    )
    .min(1)
    .max(100),
  notes: z.string().trim().min(1).max(2000),
});

// Identity & Access (rule book §10.3): case grants and the access explainer.
export const CaseGrantInput = z.object({
  granteeId: Id,
  permission: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  subjectId: Id,
  reason: z.string().trim().min(10).max(500),
  hours: z.number().int().min(1).max(168),
});
export const ExplainAccessInput = z.object({
  personId: Id,
  permission: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  institutionId: Id.nullable().default(null),
  subjectId: Id.nullable().default(null),
});

// Payroll › Final settlement (rule book §13.7, Labour Codes).
export const SettlementPrepareInput = z.object({ institutionId: Id, personId: Id });
export const SettlementDecisionInput = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).nullable().default(null),
});
export const SettlementPaidInput = z.object({
  paidOn: Day,
  reference: z.string().trim().min(1).max(80),
});
/** TDS on salaries (rule book §13.7): a challan against a salary month, and a quarter or year to read. */
export const TdsChallanInput = z.object({
  institutionId: Id,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  bsrCode: z.string().regex(/^\d{7}$/),
  challanSerial: z.string().regex(/^\d{5}$/),
  depositedOn: Day,
  amountPaise: z.number().int().positive(),
});
export const TdsQuarterQuery = z.object({
  institutionId: Id,
  fy: z.coerce.number().int().min(2000).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
});
export const TdsYearQuery = TdsQuarterQuery.omit({ quarter: true });

// Academics › Exams & Results for colleges (rule book §13.2).
const MarkValue = z.number().min(0).max(100).multipleOf(0.25).nullable();
export const MarksInput = z.object({
  rows: z
    .array(
      z.object({
        studentId: Id,
        cie: MarkValue,
        see: MarkValue,
        absent: z.boolean().default(false),
        scores: z.array(z.number().min(0).max(200).multipleOf(0.25).nullable()).max(8).optional(),
      }),
    )
    .max(500),
});
export const CourseLockInput = z.object({ locked: z.boolean() });
export const ResultsDecisionInput = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).nullable().default(null),
});
/** College attendance (rule book §13.2): one period of a course for a section, and condonation. */
export const CourseAttendanceQuery = z.object({
  sectionId: Id,
  courseId: Id,
  onDate: Day,
  period: z.coerce.number().int().min(1).max(12),
});
export const CourseAttendanceInput = CourseAttendanceQuery.extend({
  period: z.number().int().min(1).max(12),
  marks: z
    .array(z.object({ studentId: Id, status: z.enum(['present', 'absent', 'on_duty']) }))
    .max(500),
});
export const CourseCondonationInput = z.object({
  courseId: Id,
  studentId: Id,
  reason: z.string().trim().min(3).max(500),
});

/** Re-exams (rule book §13.2): one registered on a published grade, and its new end-exam mark. */
export const ReexamInput = z.object({
  term: z.number().int().min(1).max(16),
  studentId: Id,
  courseId: Id,
  kind: z.enum(['revaluation', 'supplementary']),
});
export const ReexamMarkInput = z.object({
  see: z.number().min(0).max(100).multipleOf(0.25).nullable(),
  absent: z.boolean(),
});
/** A batch's students from a file (onboarding a college). */
export const EnrolFileInput = z.object({
  csv: z.string().min(1).max(2_000_000),
  apply: z.boolean(),
});
/** OBE (rule book §13.2): a programme's outcome set, and a course's COs. */
export const OutcomeSetDraftInput = z.object({ effectiveFrom: Day });
export const OutcomeSetInput = z.object({
  vision: z.string().trim().max(2000).nullable(),
  mission: z.string().trim().max(2000).nullable(),
  targetPercent: z.number().gt(0).max(100),
  level1Percent: z.number().min(0).max(100),
  level2Percent: z.number().min(0).max(100),
  level3Percent: z.number().min(0).max(100),
  cieWeight: z.number().min(0).max(100),
  targetLevel: z.number().gt(0).max(3),
  outcomes: z
    .array(
      z.object({
        kind: z.enum(['peo', 'po', 'pso']),
        code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2,4}[0-9]{1,2}$/),
        statement: z.string().trim().min(3).max(600),
      }),
    )
    .max(60),
});
export const CourseOutcomesInput = z.object({
  cos: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^CO[0-9]{1,2}$/),
        statement: z.string().trim().min(3).max(600),
        mappings: z.record(z.string(), z.number().int().min(1).max(3)),
        items: z.array(z.string().regex(/^(see|cie|cie:[0-7])$/)).max(9),
      }),
    )
    .max(12),
});

/** Hall tickets: every ready student, or named ones (released despite fees with a reason). */
export const HallTicketInput = z.object({
  studentIds: z.array(Id).max(500).optional(),
  releaseReason: z.string().trim().min(3).max(300).nullable().optional(),
});

// Government Reports › APAAR reconciliation (rule book §15).
export const ApaarReconcileInput = z.object({
  institutionId: Id,
  csv: z.string().min(1).max(2_000_000),
  apply: z.boolean().default(false),
});
