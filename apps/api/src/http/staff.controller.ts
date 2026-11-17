import {
  CheckInInput,
  DocumentCheckInput,
  DocumentMeta,
  Id,
  LeaveAdjustInput,
  LeaveAskInput,
  LeaveDecisionInput,
  LeaveQuoteInput,
  LeaveTypeInput,
  MarkDayInput,
  NewStaffInput,
  StaffCheckInput,
  StaffAttendanceSettingsInput,
  StaffDetailsInput,
} from '@campusverse/contracts';
import { withTenant, type Db } from '@campusverse/db';
import {
  addDocument,
  checkDocument,
  createStaff,
  displayNames,
  documentCheck,
  listDocuments,
  openDocument,
  recordStaffCheck,
  staffChecks,
  staffDetails,
  updateStaffDetails,
  type PeopleDeps,
} from '@campusverse/people-records';
import {
  FileRefused,
  cleanFileBytes,
  storeFile,
  type ObjectStore,
} from '@campusverse/platform-documents';
import type { Actor } from '@campusverse/platform-permissions';
import { holidaysBetween } from '@campusverse/school-attendance';
import {
  adjustLeave,
  askLeave,
  attendanceSettings,
  cancelLeave,
  checkIn,
  decideLeave,
  leaveBalances,
  leaveQuote,
  leaveRequests,
  leaveTypes,
  markDay,
  monthReport,
  myDay,
  myLeave,
  payrollInputs,
  register,
  saveLeaveType,
  updateAttendanceSettings,
} from '@campusverse/shared-staff-attendance';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { DB, PEOPLE, PERMISSIONS, STORE, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

/** Staff records and every person's documents (Milestone 20). */
@Controller('people')
@UseGuards(ActorGuard)
export class StaffController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
    @Inject(STORE) private readonly store: ObjectStore,
    @Inject(PEOPLE) private readonly people: PeopleDeps,
  ) {}

  @Post('staff')
  async create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const i = NewStaffInput.parse(body);
    return {
      personId: await createStaff(this.people, actorOf(req), {
        institutionId: i.institutionId,
        name: i.name,
        phone: i.phone,
        employeeCode: i.employeeCode ?? null,
        designation: i.designation ?? null,
        department: i.department ?? null,
        employmentType: i.employmentType ?? null,
        joinedOn: i.joinedOn,
        gender: i.gender ?? null,
        dateOfBirth: i.dateOfBirth ?? null,
        workEmail: i.workEmail ?? null,
        workRole: i.workRole ?? null,
        ...(i.custom ? { custom: i.custom } : {}),
      }),
    };
  }

  @Get('staff/:id/checks')
  checks(@Param('id') id: string, @Req() req: AuthedRequest) {
    return staffChecks(this.people, actorOf(req), Id.parse(id));
  }

  @Post('staff/:id/checks')
  async recordCheck(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await recordStaffCheck(
        this.people,
        actorOf(req),
        Id.parse(id),
        StaffCheckInput.parse(body),
      ),
    };
  }

  @Get('staff/:id/details')
  details(@Param('id') id: string, @Req() req: AuthedRequest) {
    return staffDetails(this.people, actorOf(req), Id.parse(id));
  }

  @Post('staff/:id/details')
  @HttpCode(204)
  async updateDetails(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await updateStaffDetails(
      this.people,
      actorOf(req),
      Id.parse(id),
      StaffDetailsInput.parse(body),
    );
  }

  @Get(':id/documents')
  async documents(@Param('id') id: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const list = await listDocuments(this.people, actor, Id.parse(id));
    const ids = list.documents
      .flatMap((d) => [d.uploadedBy, d.checkedBy])
      .filter((x): x is string => !!x);
    return {
      ...list,
      names: await withTenant(this.db, actor.orgId, (tx) => displayNames(tx, ids)),
    };
  }

  /** Multipart: the fields folder, kind, title (and expiresOn) before the file. */
  @Post(':id/documents')
  async addDocument(@Param('id') id: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const personId = Id.parse(id);
    const file = await req.file();
    if (!file) throw new BadRequestException({ code: 'file_missing' });
    const field = (k: string) => {
      const f = file.fields[k];
      return f && !Array.isArray(f) && 'value' in f ? String(f.value) : undefined;
    };
    const meta = DocumentMeta.parse({
      folder: field('folder'),
      kind: field('kind'),
      title: field('title'),
      expiresOn: field('expiresOn') || null,
    });
    if (!DOCUMENT_TYPES.has(file.mimetype)) throw new FileRefused('file_type');
    const check = await documentCheck(this.people, actor, personId, 'change');
    const fileId = await storeFile(this.db, this.permissions, this.store, actor, check, {
      purpose: 'document',
      fileName: file.filename,
      contentType: file.mimetype,
      bytes: new Uint8Array(await file.toBuffer()),
    });
    return {
      documentId: await addDocument(this.people, actor, personId, {
        ...meta,
        expiresOn: meta.expiresOn ?? null,
        fileId,
      }),
      fileId,
    };
  }

  @Post('documents/:id/check')
  @HttpCode(204)
  async check(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const i = DocumentCheckInput.parse(body);
    await checkDocument(this.people, actorOf(req), Id.parse(id), {
      status: i.status,
      note: i.note ?? null,
    });
  }

  /** Opens a document in the browser. Every opening is audited; a file still being scanned is a 404. */
  @Get('documents/:id/file')
  async file(@Param('id') id: string, @Req() req: AuthedRequest, @Res() reply: FastifyReply) {
    const actor = actorOf(req);
    const doc = await openDocument(this.people, actor, Id.parse(id));
    const f = await cleanFileBytes(this.db, this.store, actor.orgId, doc.fileId).catch(() => null);
    if (!f) throw new NotFoundException({ code: 'file_not_ready' });
    const name = f.fileName.replace(/[^\w.\- ]/g, '_');
    await reply
      .header('content-type', f.contentType)
      .header('content-disposition', `inline; filename="${name}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(f.bytes));
  }
}

/** Staff attendance: one's own check-ins, the office register, settings and the month. */
@Controller('staff-attendance')
@UseGuards(ActorGuard)
export class StaffAttendanceController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
  ) {}

  @Post('check')
  check(@Body() body: unknown, @Req() req: AuthedRequest) {
    const i = CheckInInput.parse(body);
    return checkIn(this.db, this.permissions, actorOf(req), {
      institutionId: i.institutionId,
      direction: i.direction,
      eventId: i.eventId,
      source: i.source,
      at: i.at,
      location: i.location,
    });
  }

  @Get('me')
  me(
    @Query('institutionId') institutionId: string,
    @Query('date') date: string,
    @Req() req: AuthedRequest,
  ) {
    return myDay(this.db, actorOf(req), Id.parse(institutionId), Day.parse(date));
  }

  @Get('register')
  async register(
    @Query('institutionId') institutionId: string,
    @Query('date') date: string,
    @Req() req: AuthedRequest,
  ) {
    const actor = actorOf(req);
    const r = await register(
      this.db,
      this.permissions,
      actor,
      Id.parse(institutionId),
      Day.parse(date),
    );
    const ids = r.staff.map((x) => x.day?.markedBy).filter((x): x is string => !!x);
    return { ...r, names: await withTenant(this.db, actor.orgId, (tx) => displayNames(tx, ids)) };
  }

  @Post('mark')
  @HttpCode(204)
  async mark(@Body() body: unknown, @Req() req: AuthedRequest) {
    const i = MarkDayInput.parse(body);
    await markDay(this.db, this.permissions, actorOf(req), { ...i, reason: i.reason ?? null });
  }

  @Get('settings')
  settings(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return attendanceSettings(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Post('settings')
  @HttpCode(204)
  async updateSettings(
    @Query('institutionId') institutionId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await updateAttendanceSettings(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(institutionId),
      StaffAttendanceSettingsInput.parse(body),
    );
  }

  @Get('report')
  report(
    @Query('institutionId') institutionId: string,
    @Query('month') month: string,
    @Req() req: AuthedRequest,
  ) {
    return monthReport(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(institutionId),
      Month.parse(month),
    );
  }
}

const Year = z.coerce.number().int().min(2000).max(2100).optional();

/**
 * Staff leave (docs/specs/STAFF_LEAVE.md): types, one's own leave, the office's requests and
 * balances, decisions, and the month's payroll inputs. School holidays come from school
 * attendance (this app is where the two meet).
 */
@Controller('staff-leave')
@UseGuards(ActorGuard)
export class StaffLeaveController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
  ) {}

  @Get('types')
  types(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return leaveTypes(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Post('types')
  createType(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveLeaveType(this.db, this.permissions, actorOf(req), LeaveTypeInput.parse(body));
  }

  @Put('types/:id')
  updateType(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveLeaveType(this.db, this.permissions, actorOf(req), {
      ...LeaveTypeInput.parse(body),
      id: Id.parse(id),
    });
  }

  @Get('me')
  me(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return myLeave(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Post('quote')
  quote(@Body() body: unknown, @Req() req: AuthedRequest) {
    return leaveQuote(
      this.db,
      this.permissions,
      holidaysBetween,
      actorOf(req),
      LeaveQuoteInput.parse(body),
    );
  }

  @Post('requests')
  ask(@Body() body: unknown, @Req() req: AuthedRequest) {
    return askLeave(
      this.db,
      this.permissions,
      holidaysBetween,
      actorOf(req),
      LeaveAskInput.parse(body),
    );
  }

  @Get('requests')
  requests(
    @Query('institutionId') institutionId: string,
    @Query('year') year: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return leaveRequests(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(institutionId),
      Year.parse(year),
    );
  }

  @Post('requests/:id/decide')
  @HttpCode(204)
  async decide(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await decideLeave(this.db, this.permissions, holidaysBetween, actorOf(req), {
      requestId: Id.parse(id),
      ...LeaveDecisionInput.parse(body),
    });
  }

  @Post('requests/:id/cancel')
  @HttpCode(204)
  async cancel(@Param('id') id: string, @Req() req: AuthedRequest) {
    await cancelLeave(this.db, this.permissions, actorOf(req), Id.parse(id));
  }

  @Get('balances')
  balances(
    @Query('institutionId') institutionId: string,
    @Query('year') year: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return leaveBalances(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(institutionId),
      Year.parse(year),
    );
  }

  @Post('adjustments')
  @HttpCode(204)
  async adjust(@Body() body: unknown, @Req() req: AuthedRequest) {
    await adjustLeave(this.db, this.permissions, actorOf(req), LeaveAdjustInput.parse(body));
  }

  @Get('payroll')
  payroll(
    @Query('institutionId') institutionId: string,
    @Query('month') month: string,
    @Req() req: AuthedRequest,
  ) {
    return payrollInputs(
      this.db,
      this.permissions,
      holidaysBetween,
      actorOf(req),
      Id.parse(institutionId),
      Month.parse(month),
    );
  }
}
