import type { ApiError } from '@campusverse/contracts';
import { RateLimited } from '@campusverse/platform-identity';
import { PermissionDenied } from '@campusverse/platform-permissions';
import { PeopleError } from '@campusverse/people-records';
import { AttendanceError } from '@campusverse/school-attendance';
import { EnrolmentError } from '@campusverse/school-enrolment';
import { SetupError } from '@campusverse/school-setup';
import { NoticeError } from '@campusverse/shared-communications';
import { FinanceError } from '@campusverse/shared-finance';
import { AdmissionError } from '@campusverse/school-admissions';
import { CertificateError } from '@campusverse/school-certificates';
import { ExamError } from '@campusverse/school-exams';
import { RolloverError } from '@campusverse/school-rollover';
import { ControlError } from '@campusverse/platform-control';
import { VerseError } from '@campusverse/platform-verse';
import { AccessError } from '@campusverse/platform-access';
import { FieldError } from '@campusverse/platform-fields';
import { FileRefused } from '@campusverse/platform-documents';
import { OrganisationError } from '@campusverse/platform-organisation';
import { LeaveError, StaffAttendanceError } from '@campusverse/shared-staff-attendance';
import { TransportError } from '@campusverse/shared-transport';
import { HomeworkError } from '@campusverse/school-homework';
import { ExpenseError } from '@campusverse/shared-expenses';
import { GateError } from '@campusverse/shared-gate';
import { HostelError } from '@campusverse/shared-hostel';
import { SyllabusError } from '@campusverse/school-syllabus';
import { HelpdeskError } from '@campusverse/shared-helpdesk';
import { PrivacyError } from '@campusverse/platform-consent';
import { HealthError } from '@campusverse/shared-health';
import { ReturnsError } from '@campusverse/school-returns';
import { AcademicsError } from '@campusverse/academics-structure';
import { RegistrationError } from '@campusverse/academics-registration';
import { ExamError as CollegeExamError } from '@campusverse/academics-exams';
import { AttendanceError as CourseAttendanceError } from '@campusverse/academics-attendance';
import { ObeError } from '@campusverse/academics-obe';
import { ApprovalError } from '@campusverse/platform-workflow';
import { RulePackError } from '@campusverse/platform-rulepacks';
import { AssetError } from '@campusverse/shared-assets';
import { AppraisalError } from '@campusverse/people-appraisals';
import { LibraryError } from '@campusverse/shared-library';
import { TimetableError } from '@campusverse/school-timetable';
import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

const SETUP_STATUS: Record<string, number> = {
  institution_not_found: 404,
  import_not_found: 404,
  import_in_use: 409,
  next_year_exists: 409,
  year_closed: 409,
  year_not_found: 404,
  year_not_ended: 409,
  year_not_closed: 409,
  import_not_previewed: 409,
  import_not_committed: 409,
  not_xlsx: 400,
  empty_file: 400,
  file_too_large: 413,
  too_many_rows: 413,
  not_invited: 404,
};

/** Every failure leaves in one shape: code, message, field, requestId, retryable. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('api');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const base = { requestId: String(req.id), retryable: false };
    let status = 500;
    let body: ApiError = {
      ...base,
      code: 'internal',
      message: 'Something went wrong. Try again.',
      retryable: true,
    };

    if (exception instanceof ZodError) {
      const issue = exception.issues[0];
      status = 400;
      body = {
        ...base,
        code: 'invalid_input',
        message: issue?.message ?? 'Invalid input',
        field: issue?.path.join('.') ?? '',
      };
    } else if (exception instanceof PermissionDenied) {
      status = 403;
      body = {
        ...base,
        code: 'forbidden',
        message: "You don't have permission to do this.",
        details: { reason: exception.reason },
      };
    } else if (exception instanceof TimetableError) {
      status = exception.code.endsWith('_not_found') ? 404 : 422;
      body = {
        ...base,
        code: exception.code,
        message: exception.code.replaceAll('_', ' '),
        ...(exception.details ? { details: exception.details } : {}),
      };
    } else if (exception instanceof SetupError) {
      status = SETUP_STATUS[exception.code] ?? 422;
      body = {
        ...base,
        code: exception.code,
        message: exception.code.replaceAll('_', ' '),
        details: exception.details,
      };
    } else if (
      exception instanceof FileRefused ||
      exception instanceof OrganisationError ||
      exception instanceof StaffAttendanceError ||
      exception instanceof LeaveError ||
      exception instanceof HomeworkError ||
      exception instanceof LibraryError ||
      exception instanceof GateError ||
      exception instanceof ExpenseError ||
      exception instanceof HostelError ||
      exception instanceof SyllabusError ||
      exception instanceof HelpdeskError ||
      exception instanceof PrivacyError ||
      exception instanceof HealthError ||
      exception instanceof ReturnsError ||
      exception instanceof AcademicsError ||
      exception instanceof RegistrationError ||
      exception instanceof CollegeExamError ||
      exception instanceof CourseAttendanceError ||
      exception instanceof ObeError ||
      exception instanceof ApprovalError ||
      exception instanceof RulePackError ||
      exception instanceof AssetError ||
      exception instanceof AppraisalError ||
      exception instanceof TransportError
    ) {
      status =
        exception.code === 'file_size' ? 413 : exception.code.endsWith('_not_found') ? 404 : 422;
      body = {
        ...base,
        code: exception.code,
        message: exception.code.replaceAll('_', ' '),
        // What's left, when leave runs over its balance.
        ...(exception instanceof LeaveError && exception.detail
          ? { details: exception.detail }
          : {}),
        // Which crew member's safety checks are missing.
        ...(exception instanceof TransportError && exception.details
          ? { details: exception.details }
          : {}),
        // The library's limit, or accession numbers already in use.
        ...(exception instanceof LibraryError && exception.details
          ? { details: exception.details }
          : {}),
        // Why a visitor is barred, for the guard.
        ...(exception instanceof HostelError && exception.details
          ? { details: exception.details }
          : {}),
        ...(exception instanceof ExpenseError && exception.details
          ? { details: exception.details }
          : {}),
        ...(exception instanceof GateError && exception.details
          ? { details: exception.details }
          : {}),
        // Which courses or limits a registration broke.
        ...(exception instanceof RegistrationError && exception.details
          ? { details: exception.details }
          : {}),
        ...(exception instanceof CollegeExamError && exception.details
          ? { details: exception.details }
          : {}),
      };
    } else if (exception instanceof FieldError || exception instanceof AccessError) {
      // Field problems by key, or the permissions involved, so the screen can point at them.
      status = exception.code === 'not_found' ? 404 : 422;
      body = {
        ...base,
        code: exception.code,
        message: exception.code.replaceAll('_', ' '),
        details:
          exception instanceof FieldError
            ? { problems: exception.problems }
            : { permissions: exception.permissions },
      };
    } else if (
      exception instanceof PeopleError ||
      exception instanceof EnrolmentError ||
      exception instanceof AttendanceError ||
      exception instanceof NoticeError ||
      exception instanceof FinanceError ||
      exception instanceof AdmissionError ||
      exception instanceof CertificateError ||
      exception instanceof ExamError ||
      exception instanceof RolloverError ||
      exception instanceof VerseError
    ) {
      status = exception.code.endsWith('_not_found')
        ? 404
        : [
              'already_holiday',
              'case_already_open',
              'not_awaiting_sign_off',
              'not_a_draft',
              'not_approved',
              'already_sent',
              'already_acknowledged',
              'day_closed',
              'reversal_open',
              'head_exists',
              'not_a_draft',
              'duplicate',
              'tc_already_open',
              'no_seat',
              'already_rolled_over',
              'new_year_in_use',
              'action_expired',
            ].includes(exception.code)
          ? 409
          : 422;
      body = { ...base, code: exception.code, message: exception.code.replaceAll('_', ' ') };
    } else if (exception instanceof ControlError) {
      status =
        exception.code === 'forbidden'
          ? 403
          : exception.code.endsWith('_not_found')
            ? 404
            : ['passkey_not_verified', 'challenge_expired', 'enrolment_expired'].includes(
                  exception.code,
                )
              ? 401
              : [
                    'staff_exists',
                    'already_in_status',
                    'incident_step_done',
                    'already_invited',
                  ].includes(exception.code)
                ? 409
                : 422;
      body = { ...base, code: exception.code, message: exception.code.replaceAll('_', ' ') };
    } else if (exception instanceof RateLimited) {
      status = 429;
      reply.header('retry-after', String(exception.retryAfterSeconds));
      body = {
        ...base,
        code: 'rate_limited',
        message: 'Too many attempts. Wait and try again.',
        retryable: true,
      };
    } else if ((exception as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      status = 413;
      body = { ...base, code: 'file_too_large', message: 'The file is larger than 5 MB.' };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = {
        ...base,
        code: typeof r === 'object' && r && 'code' in r ? String(r.code) : 'http_error',
        message: exception.message,
      };
    }

    // Never log request bodies: they carry children's data.
    if (status >= 500)
      this.log.error(
        `${body.requestId} ${req.method} ${req.routeOptions.url} ${(exception as Error)?.message}`,
      );
    void reply.status(status).send(body);
  }
}
