import 'reflect-metadata';
import multipart from '@fastify/multipart';
import { Controller, Get, Inject, Module, type DynamicModule } from '@nestjs/common';
import type { Db } from '@campusverse/db';
import { sql } from 'drizzle-orm';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AttendanceController } from './http/attendance.controller.js';
import { AuthController } from './http/auth.controller.js';
import { academicPlacement } from '@campusverse/academics-structure';
import { admissionInProgress } from '@campusverse/school-admissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import { schoolAudience } from '@campusverse/school-setup';
import { campusAudience } from './audience.js';
import type { ObjectStore } from '@campusverse/platform-documents';
import { ExamsController, RolloverController } from './http/exams.controller.js';
import { AdminAuthController, AdminController } from './http/admin.controller.js';
import { VerseController } from './http/verse.controller.js';
import { OnboardingController } from './http/onboarding.controller.js';
import { verseDeps } from './verse.js';
import { activeStudentCount } from '@campusverse/people-records';
import { flagOn, switchOn } from '@campusverse/platform-control';
import { deliveryCounts } from '@campusverse/shared-communications';
import { provisionSchool, supportSummary } from '@campusverse/school-setup';
import { deriveKeys } from '@campusverse/crypto';
import {
  ADMISSIONS,
  CERTIFICATES,
  EXAMS,
  ROLLOVER,
  CONTROL,
  VERSE,
  SMS_SIMULATOR,
  APPLY,
  HEALTH,
  MFA_KEYS,
  STORE,
  DB,
  FINANCE,
  OTP,
  PEOPLE,
  PERMISSIONS,
  type ApplyDeps,
  type ControlDeps,
  type Deps,
} from './http/deps.js';
import {
  AdmissionsController,
  CertificatesController,
  VerifyController,
} from './http/admissions.controller.js';
import { FinanceController, FinanceWebhookController } from './http/finance.controller.js';
import { NoticesController } from './http/notices.controller.js';
import { ParentController } from './http/parent.controller.js';
import { PeopleController } from './http/people.controller.js';
import { ApiExceptionFilter } from './http/errors.js';
import { ActorGuard, SessionGuard, StaffGuard } from './http/guards.js';
import { SetupController } from './http/setup.controller.js';
import { ProfilesController } from './http/profiles.controller.js';
import { AdmissionFilesController } from './http/admission-files.controller.js';
import { HomeworkController } from './http/homework.controller.js';
import { ExpensesController } from './http/expenses.controller.js';
import { GateController } from './http/gate.controller.js';
import { HostelController } from './http/hostel.controller.js';
import { SyllabusController } from './http/syllabus.controller.js';
import { HelpdeskController } from './http/helpdesk.controller.js';
import { MentoringController } from './http/mentoring.controller.js';
import { GrievancesController } from './http/grievances.controller.js';
import { SurveysController } from './http/surveys.controller.js';
import { AssessmentsController } from './http/assessments.controller.js';
import { ConsentController, PrivacyController } from './http/privacy.controller.js';
import { StudentHealthController } from './http/health.controller.js';
import { AcademicsController } from './http/academics.controller.js';
import { CourseAttendanceController } from './http/course-attendance.controller.js';
import { ObeController } from './http/obe.controller.js';
import { WorkflowController } from './http/workflow.controller.js';
import { RulePacksController } from './http/rulepacks.controller.js';
import { ReturnsController } from './http/returns.controller.js';
import { AssetsController } from './http/assets.controller.js';
import { AppraisalsController } from './http/appraisals.controller.js';
import { RecordController } from './http/record.controller.js';
import { PayrollController } from './http/payroll.controller.js';
import { LibraryController } from './http/library.controller.js';
import { AdmissionFormsController, ApplyController } from './http/apply.controller.js';
import {
  StaffAttendanceController,
  StaffController,
  StaffLeaveController,
} from './http/staff.controller.js';
import { CalendarController, TimetableController } from './http/timetable.controller.js';
import { TransportController } from './http/transport.controller.js';
import {
  AccessController,
  ActivityController,
  FieldsController,
} from './http/access.controller.js';

@Controller('health')
class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Liveness: the process answers (load balancer health check). */
  @Get()
  health() {
    return { ok: true };
  }

  /** Readiness: the database answers too (deploy smoke test). */
  @Get('ready')
  async ready() {
    await this.db.execute(sql`select 1`);
    return { ok: true };
  }
}

/** Without file storage (some tests), issuing certificates fails loudly instead of losing files. */
const noStore: ObjectStore = {
  put: () => Promise.reject(new Error('No file storage configured')),
  get: () => Promise.resolve(null),
  size: () => Promise.resolve(null),
  signedUpload: () => Promise.reject(new Error('No file storage configured')),
  signedDownload: () => Promise.reject(new Error('No file storage configured')),
};

@Module({})
class ApiModule {
  static with(deps: Deps): DynamicModule {
    return {
      module: ApiModule,
      controllers: [
        HealthController,
        AuthController,
        SetupController,
        ProfilesController,
        AdmissionFilesController,
        StaffController,
        StaffAttendanceController,
        StaffLeaveController,
        HomeworkController,
        LibraryController,
        GateController,
        ExpensesController,
        HostelController,
        SyllabusController,
        HelpdeskController,
        MentoringController,
        GrievancesController,
        SurveysController,
        AssessmentsController,
        PrivacyController,
        ConsentController,
        StudentHealthController,
        AcademicsController,
        CourseAttendanceController,
        ObeController,
        WorkflowController,
        RulePacksController,
        ReturnsController,
        AssetsController,
        AppraisalsController,
        RecordController,
        PayrollController,
        TimetableController,
        CalendarController,
        TransportController,
        FieldsController,
        AccessController,
        ActivityController,
        PeopleController,
        AttendanceController,
        NoticesController,
        ParentController,
        FinanceController,
        FinanceWebhookController,
        AdmissionsController,
        CertificatesController,
        VerifyController,
        ApplyController,
        AdmissionFormsController,
        ExamsController,
        RolloverController,
        AdminAuthController,
        AdminController,
        VerseController,
        OnboardingController,
      ],
      providers: [
        { provide: DB, useValue: deps.db },
        { provide: PERMISSIONS, useValue: deps.permissions },
        { provide: OTP, useValue: deps.otp },
        {
          provide: PEOPLE,
          // Each academic type answers placement questions for the shared people module.
          useValue: {
            db: deps.db,
            permissions: deps.permissions,
            keys: deps.keys,
            placements: [schoolPlacement, academicPlacement],
          },
        },
        {
          provide: FINANCE,
          useValue: {
            db: deps.db,
            permissions: deps.permissions,
            audience: campusAudience,
            placements: [schoolPlacement, academicPlacement],
            // Donations are refused from families with an admission in progress.
            admissionInProgress,
            gateway: deps.gateway ?? null,
            returnUrl: deps.paymentReturnUrl,
            // Super admin: the customer's online_payments flag and the payments_off switch.
            onlinePaymentsAllowed: async (orgId: string) =>
              (await flagOn(deps.db, 'online_payments', orgId)) &&
              !(await switchOn(deps.db, 'payments_off', orgId)),
          },
        },
        {
          provide: ADMISSIONS,
          useValue: { db: deps.db, permissions: deps.permissions, audience: schoolAudience },
        },
        {
          provide: CERTIFICATES,
          useValue: {
            db: deps.db,
            permissions: deps.permissions,
            store: deps.store ?? noStore,
            verifyBaseUrl: deps.verifyBaseUrl ?? 'http://localhost:3000/verify',
          },
        },
        {
          provide: EXAMS,
          useValue: {
            db: deps.db,
            permissions: deps.permissions,
            store: deps.store ?? noStore,
            verifyBaseUrl: deps.verifyBaseUrl ?? 'http://localhost:3000/verify',
          },
        },
        { provide: ROLLOVER, useValue: { db: deps.db, permissions: deps.permissions } },
        {
          provide: HEALTH,
          useValue: {
            db: deps.db,
            permissions: deps.permissions,
            keys: deps.healthKeys ?? deriveKeys(deps.keys, 'health'),
          },
        },
        {
          provide: CONTROL,
          useValue: {
            db: deps.db,
            rp: { origin: deps.adminOrigin ?? 'http://localhost:3001', name: 'Campusverse Admin' },
            simulateSms: !!deps.smsSimulator,
            appOrigin: new URL(deps.verifyBaseUrl ?? 'http://localhost:3000/verify').origin,
            ports: {
              students: activeStudentCount,
              deliveries: deliveryCounts,
              supportSummary,
              provision: async (c) => {
                const r = await provisionSchool(deps.db, {
                  schoolName: c.schoolName,
                  group: null,
                  board: c.board as 'CBSE',
                  state: c.state as 'KA',
                  owner: { name: c.ownerName, phone: c.ownerPhone },
                });
                return { orgId: r.orgId, institutionId: r.institutionId };
              },
            },
          } satisfies ControlDeps,
        },
        { provide: SMS_SIMULATOR, useValue: deps.smsSimulator ?? null },
        { provide: MFA_KEYS, useValue: deriveKeys(deps.keys, 'identity-mfa') },
        {
          provide: APPLY,
          useValue: {
            otp: deps.applyOtp ?? null,
            simulator: deps.applySimulator ?? null,
            secret: deps.applySecret ?? null,
            store: deps.store ?? noStore,
            origin: new URL(deps.verifyBaseUrl ?? 'http://localhost:3000/verify').origin,
          } satisfies ApplyDeps,
        },
        { provide: STORE, useValue: deps.store ?? noStore },
        {
          provide: VERSE,
          useValue: verseDeps(deps, deps.verseModel ?? null, deps.store ?? noStore),
        },
        SessionGuard,
        ActorGuard,
        StaffGuard,
      ],
    };
  }
}

/** Builds the API. main.ts listens; tests use it with inject(). */
export async function createApi(
  deps: Deps,
  { accessLog = false }: { accessLog?: boolean } = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: 1024 * 1024,
    genReqId: () => randomUUID(),
    // One JSON line per request (CloudWatch). The route pattern, never the URL: paths and query
    // strings carry ids, names and phone numbers, which must not reach logs.
    logger: accessLog && {
      level: 'info',
      serializers: {
        req: (r: FastifyRequest) => ({ method: r.method, url: r.routeOptions.url ?? 'unmatched' }),
        res: (r: { statusCode: number }) => ({ statusCode: r.statusCode }),
      },
    },
    // Requests from private addresses come through our own proxies (the load balancer, the web
    // and admin servers), which add the client's address; the public can't connect from these.
    trustProxy: ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  });
  const app = await NestFactory.create<NestFastifyApplication>(ApiModule.with(deps), adapter, {
    logger: ['error', 'warn'],
    // Webhook signatures are checked over the exact bytes received.
    rawBody: true,
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 } });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return app;
}
