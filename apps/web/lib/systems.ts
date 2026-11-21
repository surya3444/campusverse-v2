// The product map from the rule book (docs/rulebook/13-module-hierarchy.txt, §13.1): nine systems
// on one Campus Core, with Verse AI across them. Each entry is a rule-book module. The sidebar shows
// the `nav` links of live modules; /apps shows every module with its status. Keep
// docs/PLATFORM_MAP.md in step with this file.
import type { Area } from '@campusverse/ui';
import {
  Award,
  BadgeCheck,
  BookCheck,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  Building2,
  Bus,
  CalendarCheck,
  ContactRound,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Compass,
  DoorOpen,
  FileBadge,
  FileInput,
  FileSignature,
  FileSpreadsheet,
  FileStack,
  FlaskConical,
  Globe,
  Gavel,
  GraduationCap,
  HandCoins,
  HandHeart,
  Headset,
  HeartPulse,
  Hospital,
  Hotel,
  HeartHandshake,
  IndianRupee,
  Layers,
  KanbanSquare,
  KeyRound,
  Landmark,
  Library,
  ListChecks,
  ListOrdered,
  Megaphone,
  MessageSquareHeart,
  Mic,
  NotebookPen,
  Plane,
  PlugZap,
  Radar,
  Receipt,
  Scale,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Siren,
  Sparkles,
  Star,
  Stethoscope,
  Target,
  Upload,
  UserCheck,
  UserPlus,
  UserRoundCheck,
  Users,
  UsersRound,
  Wallet,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export type AppStatus = 'live' | 'building' | 'planned';
export type SystemKey =
  | 'enrollment'
  | 'academics'
  | 'students'
  | 'finance'
  | 'people'
  | 'operations'
  | 'health'
  | 'career'
  | 'quality'
  | 'core'
  | 'ai';

/** Institution profiles a module is for (§13 "For"). Absent means every profile. */
export type Profile = 'school' | 'college' | 'university';

/** The sidebar's profile for an institution's stored profile (rule book §12.3). */
export const profileOf = (stored: string | undefined): Profile =>
  stored === 'university' ? 'university' : stored?.endsWith('_college') ? 'college' : 'school';

/** Built on school classes so far: shown to schools only until each has its higher-education form. */
const SCHOOL: Profile[] = ['school'];

export type AppEntry = {
  key: string;
  Icon: LucideIcon;
  status: AppStatus;
  /** Where it opens on /apps. Live and building modules have one. */
  href?: string;
  /**
   * Sidebar links (label keys in en.nav); a link without its own icon uses the module's. One link
   * shows as a row of its own; two or more fold under the module's name, as the hub draws them.
   * `perm`: shown only to someone holding one of these (the screen checks again).
   */
  nav?: { key: string; href: string; Icon?: LucideIcon; for?: Profile[]; perm?: string[] }[];
  for?: Profile[];
};

export type SystemEntry = { key: SystemKey; Icon: LucideIcon; area: Area; apps: AppEntry[] };

const HE: Profile[] = ['college', 'university'];

export const SYSTEMS: SystemEntry[] = [
  {
    key: 'enrollment',
    Icon: UserPlus,
    area: 'rose',
    apps: [
      {
        key: 'admissionsCrm',
        Icon: UserPlus,
        status: 'live',
        href: '/admissions',
        nav: [
          { key: 'pipeline', href: '/admissions', Icon: KanbanSquare, for: SCHOOL },
          { key: 'leads', href: '/admissions/leads', Icon: ContactRound, for: SCHOOL },
          { key: 'followUps', href: '/admissions/follow-ups', Icon: CalendarCheck, for: SCHOOL },
          { key: 'bulkUpload', href: '/admissions/import', Icon: Upload, for: SCHOOL },
        ],
      },
      {
        key: 'applications',
        Icon: FileInput,
        status: 'live',
        href: '/admissions/applications',
        nav: [
          {
            key: 'applicationsList',
            href: '/admissions/applications?tab=verify',
            Icon: FileStack,
            for: SCHOOL,
          },
          { key: 'applicationForms', href: '/admissions/forms', Icon: Globe, for: SCHOOL },
        ],
      },
      {
        key: 'meritSeats',
        Icon: ListOrdered,
        status: 'live',
        href: '/admissions/draws',
        nav: [
          {
            key: 'seatDraws',
            href: '/admissions/draws',
            for: SCHOOL,
            perm: ['school.admission.manage'],
          },
        ],
      },
      {
        key: 'offersOnboarding',
        Icon: UserRoundCheck,
        status: 'live',
        href: '/admissions/applications?tab=offers',
        nav: [{ key: 'offers', href: '/admissions/applications?tab=offers', for: SCHOOL }],
      },
    ],
  },
  {
    key: 'academics',
    Icon: GraduationCap,
    area: 'violet',
    apps: [
      {
        key: 'academicStructure',
        Icon: Library,
        status: 'live',
        href: '/academic-structure',
        nav: [
          { key: 'academicStructure', href: '/academic-structure', for: HE },
          { key: 'setup', href: '/setup', Icon: ClipboardCheck, for: SCHOOL },
          { key: 'years', href: '/years', Icon: CalendarDays, for: SCHOOL },
          { key: 'classes', href: '/classes', for: SCHOOL },
          { key: 'subjects', href: '/subjects', for: SCHOOL },
          { key: 'yearEnd', href: '/year-end', Icon: CalendarRange, for: SCHOOL },
        ],
      },
      {
        key: 'courseRegistration',
        Icon: ClipboardList,
        status: 'live',
        href: '/course-registration',
        nav: [{ key: 'courseRegistration', href: '/course-registration' }],
        for: HE,
      },
      {
        key: 'timetable',
        Icon: CalendarClock,
        status: 'live',
        href: '/timetable',
        nav: [
          { key: 'timetableWeek', href: '/timetable', Icon: CalendarDays, for: SCHOOL },
          { key: 'myTimetable', href: '/my-timetable', Icon: CalendarClock, for: SCHOOL },
        ],
      },
      {
        key: 'attendance',
        Icon: CalendarCheck,
        status: 'live',
        href: '/attendance',
        nav: [
          { key: 'attendance', href: '/attendance', for: SCHOOL },
          { key: 'courseAttendance', href: '/course-attendance', for: HE },
        ],
      },
      {
        key: 'teaching',
        Icon: NotebookPen,
        status: 'live',
        href: '/homework',
        nav: [
          { key: 'homework', href: '/homework', for: SCHOOL },
          { key: 'syllabus', href: '/syllabus', Icon: ListChecks, for: SCHOOL },
        ],
      },
      {
        key: 'assessments',
        Icon: ListChecks,
        status: 'live',
        href: '/assessments',
        nav: [{ key: 'assessments', href: '/assessments', perm: ['assessment.bank.manage'] }],
      },
      {
        key: 'exams',
        Icon: BookCheck,
        status: 'live',
        href: '/exams',
        nav: [
          { key: 'exams', href: '/exams', for: SCHOOL },
          { key: 'examResults', href: '/exam-results', for: HE },
        ],
      },
      {
        key: 'obe',
        Icon: Target,
        status: 'live',
        href: '/obe',
        for: HE,
        nav: [
          { key: 'obeOutcomes', href: '/obe?tab=outcomes', Icon: Target, for: HE },
          { key: 'obeCourses', href: '/obe?tab=courses', Icon: ListChecks, for: HE },
          { key: 'obeAttainment', href: '/obe?tab=attainment', Icon: BadgeCheck, for: HE },
        ],
      },
      {
        key: 'feedback',
        Icon: MessageSquareHeart,
        status: 'live',
        href: '/surveys',
        nav: [{ key: 'surveys', href: '/surveys' }],
      },
      {
        key: 'library',
        Icon: BookOpen,
        status: 'live',
        href: '/library',
        nav: [{ key: 'library', href: '/library' }],
      },
      { key: 'research', Icon: FlaskConical, status: 'planned', for: ['university'] },
    ],
  },
  {
    key: 'students',
    Icon: Users,
    area: 'sky',
    apps: [
      {
        key: 'studentRecords',
        Icon: Users,
        status: 'live',
        href: '/students',
        nav: [{ key: 'students', href: '/students' }],
      },
      {
        key: 'certificates',
        Icon: FileBadge,
        status: 'live',
        href: '/certificates',
        nav: [{ key: 'certificates', href: '/certificates', for: SCHOOL }],
      },
      {
        key: 'mentoring',
        Icon: HandHeart,
        status: 'live',
        href: '/mentoring',
        nav: [
          {
            key: 'mentoring',
            href: '/mentoring',
            perm: [
              'mentoring.mentee.mentor',
              'mentoring.allocation.manage',
              'mentoring.escalation.counsel',
            ],
          },
        ],
      },
      { key: 'clubsEvents', Icon: Award, status: 'planned' },
    ],
  },
  {
    key: 'finance',
    Icon: IndianRupee,
    area: 'go',
    apps: [
      {
        key: 'fees',
        Icon: IndianRupee,
        status: 'live',
        href: '/fees',
        nav: [
          { key: 'feesHome', href: '/fees', Icon: IndianRupee },
          { key: 'feesPlans', href: '/fees/plans', Icon: Layers },
          { key: 'feesPayees', href: '/fees/payees', Icon: Landmark },
        ],
      },
      { key: 'scholarships', Icon: HandCoins, status: 'live', href: '/fees' },
      {
        key: 'accounts',
        Icon: Receipt,
        status: 'live',
        href: '/expenses',
        nav: [
          { key: 'expensesBills', href: '/expenses?tab=bills', Icon: Receipt },
          { key: 'expensesBudgets', href: '/expenses?tab=budgets', Icon: Wallet },
          { key: 'expensesVendors', href: '/expenses?tab=vendors', Icon: Building2 },
          { key: 'expensesCategories', href: '/expenses?tab=categories', Icon: ListChecks },
          { key: 'donations', href: '/donations', Icon: HeartHandshake },
        ],
      },
    ],
  },
  {
    key: 'people',
    Icon: BriefcaseBusiness,
    area: 'teal',
    apps: [
      {
        key: 'hr',
        Icon: BriefcaseBusiness,
        status: 'live',
        href: '/staff',
        nav: [{ key: 'staff', href: '/staff' }],
      },
      {
        key: 'staffAttendanceLeave',
        Icon: UserCheck,
        status: 'live',
        href: '/staff-attendance',
        nav: [
          { key: 'staffAttendance', href: '/staff-attendance' },
          { key: 'leaveMine', href: '/staff-leave?tab=mine', Icon: Plane },
          {
            key: 'leaveRequests',
            href: '/staff-leave?tab=requests',
            Icon: ClipboardCheck,
            perm: ['staff.leave.manage', 'staff.leave.approve'],
          },
          {
            key: 'leaveBalances',
            href: '/staff-leave?tab=balances',
            Icon: ListOrdered,
            perm: ['staff.leave.manage'],
          },
        ],
      },
      {
        key: 'appraisals',
        Icon: Star,
        status: 'live',
        href: '/appraisals',
        nav: [{ key: 'appraisals', href: '/appraisals' }],
      },
      {
        key: 'payroll',
        Icon: Wallet,
        status: 'live',
        href: '/payroll',
        nav: [
          { key: 'payrollMine', href: '/payroll?tab=mine', Icon: Receipt },
          {
            key: 'payrollRuns',
            href: '/payroll?tab=runs',
            Icon: CalendarCheck,
            perm: ['payroll.run.prepare', 'payroll.run.approve'],
          },
          {
            key: 'payrollSalaries',
            href: '/payroll?tab=salaries',
            Icon: Wallet,
            perm: ['payroll.salary.manage'],
          },
          {
            key: 'payrollSettlements',
            href: '/payroll?tab=settlements',
            Icon: UserCheck,
            perm: ['payroll.run.prepare'],
          },
          {
            key: 'payrollTds',
            href: '/payroll?tab=tds',
            Icon: Landmark,
            perm: ['payroll.run.prepare', 'payroll.run.approve'],
          },
        ],
      },
    ],
  },
  {
    key: 'operations',
    Icon: Boxes,
    area: 'amber',
    apps: [
      {
        key: 'transport',
        Icon: Bus,
        status: 'live',
        href: '/transport',
        nav: [
          { key: 'transportToday', href: '/transport?tab=today', Icon: Bus },
          { key: 'transportRiders', href: '/transport?tab=riders', Icon: Users },
          { key: 'transportRoutes', href: '/transport?tab=routes', Icon: Workflow },
          { key: 'transportVehicles', href: '/transport?tab=vehicles', Icon: Bus },
          { key: 'transportReports', href: '/transport?tab=reports', Icon: FileSpreadsheet },
        ],
      },
      {
        key: 'hostel',
        Icon: Hotel,
        status: 'live',
        href: '/hostel',
        nav: [
          { key: 'hostelRooms', href: '/hostel?tab=rooms', Icon: Hotel },
          { key: 'hostelRoll', href: '/hostel?tab=roll', Icon: ClipboardCheck },
          { key: 'hostelOutpasses', href: '/hostel?tab=outpasses', Icon: DoorOpen },
        ],
      },
      {
        key: 'assets',
        Icon: ClipboardList,
        status: 'live',
        href: '/assets',
        nav: [
          { key: 'assetsRegister', href: '/assets?tab=register', Icon: ClipboardList },
          { key: 'assetsStock', href: '/assets?tab=stock', Icon: Boxes },
          { key: 'assetsDisposed', href: '/assets?tab=disposed', Icon: ScrollText },
        ],
      },
      { key: 'facilities', Icon: Wrench, status: 'planned' },
      {
        key: 'visitors',
        Icon: DoorOpen,
        status: 'live',
        href: '/gate',
        nav: [{ key: 'gate', href: '/gate' }],
      },
      {
        key: 'helpdesk',
        Icon: Headset,
        status: 'live',
        href: '/helpdesk',
        nav: [{ key: 'helpdesk', href: '/helpdesk' }],
      },
    ],
  },
  {
    key: 'health',
    Icon: HeartPulse,
    area: 'rose',
    apps: [
      {
        key: 'healthRecords',
        Icon: HeartPulse,
        status: 'live',
        href: '/health',
        nav: [{ key: 'health', href: '/health' }],
      },
      { key: 'medicalVisits', Icon: Stethoscope, status: 'live', href: '/health?tab=medicines' },
      {
        key: 'emergency',
        Icon: Siren,
        status: 'live',
        href: '/emergency',
        nav: [{ key: 'sos', href: '/emergency', perm: ['health.emergency.raise'] }],
      },
      { key: 'counselling', Icon: MessageSquareHeart, status: 'planned' },
      { key: 'careNetwork', Icon: Hospital, status: 'planned' },
    ],
  },
  {
    key: 'career',
    Icon: Compass,
    area: 'violet',
    apps: [
      { key: 'placements', Icon: BriefcaseBusiness, status: 'planned', for: HE },
      { key: 'internships', Icon: UsersRound, status: 'planned' },
      { key: 'skillUp', Icon: BadgeCheck, status: 'planned' },
      { key: 'careerGuidance', Icon: Compass, status: 'planned' },
      { key: 'alumni', Icon: GraduationCap, status: 'planned' },
    ],
  },
  {
    key: 'quality',
    Icon: ShieldCheck,
    area: 'navy',
    apps: [
      { key: 'accreditation', Icon: Award, status: 'planned', for: HE },
      {
        key: 'govReports',
        Icon: Landmark,
        status: 'building',
        href: '/government-reports',
        nav: [{ key: 'govReports', href: '/government-reports' }],
      },
      {
        key: 'grievances',
        Icon: Scale,
        status: 'live',
        href: '/grievances',
        nav: [{ key: 'grievances', href: '/grievances' }],
      },
      { key: 'complianceMonitor', Icon: Radar, status: 'planned' },
    ],
  },
  {
    key: 'core',
    Icon: Building2,
    area: 'navy',
    apps: [
      {
        key: 'organisation',
        Icon: Building2,
        status: 'live',
        href: '/settings/organisation',
        nav: [{ key: 'organisation', href: '/settings/organisation' }],
      },
      {
        key: 'access',
        Icon: KeyRound,
        status: 'live',
        href: '/settings/roles',
        nav: [{ key: 'roles', href: '/settings/roles' }],
      },
      {
        key: 'rulePacks',
        Icon: Gavel,
        status: 'live',
        href: '/rule-packs',
        nav: [{ key: 'rulePacks', href: '/rule-packs' }],
      },
      {
        key: 'workflow',
        Icon: Workflow,
        status: 'live',
        href: '/my-work',
        nav: [{ key: 'approvals', href: '/settings/approvals' }],
      },
      {
        key: 'communications',
        Icon: Megaphone,
        status: 'live',
        href: '/notices',
        nav: [{ key: 'notices', href: '/notices' }],
      },
      { key: 'documents', Icon: FileSignature, status: 'planned' },
      {
        key: 'privacy',
        Icon: ShieldCheck,
        status: 'live',
        href: '/privacy',
        nav: [
          { key: 'privacyCoverage', href: '/privacy?tab=coverage', Icon: ShieldCheck },
          { key: 'privacyRequests', href: '/privacy?tab=requests', Icon: FileInput },
          { key: 'privacyBreaches', href: '/privacy?tab=breaches', Icon: Siren },
          { key: 'privacyCases', href: '/privacy?tab=cases', Icon: KeyRound },
        ],
      },
      {
        key: 'activityLog',
        Icon: ScrollText,
        status: 'live',
        href: '/activity-log',
        nav: [{ key: 'activityLog', href: '/activity-log' }],
      },
      { key: 'reports', Icon: FileSpreadsheet, status: 'planned' },
      { key: 'integrations', Icon: PlugZap, status: 'planned' },
      {
        key: 'dataImport',
        Icon: Upload,
        status: 'live',
        href: '/data-import',
        nav: [{ key: 'dataImport', href: '/data-import' }],
      },
    ],
  },
  {
    key: 'ai',
    Icon: Sparkles,
    area: 'teal',
    apps: [
      { key: 'verse', Icon: Sparkles, status: 'live', href: '/ask' },
      { key: 'analysis', Icon: ScanSearch, status: 'planned' },
      { key: 'agents', Icon: Workflow, status: 'planned' },
      { key: 'watch', Icon: Radar, status: 'planned' },
      { key: 'companion', Icon: GraduationCap, status: 'planned' },
      { key: 'voice', Icon: Mic, status: 'planned' },
    ],
  },
];
