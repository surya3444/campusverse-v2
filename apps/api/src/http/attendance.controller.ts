import {
  AttendanceCorrection,
  AttendanceSettingsInput,
  CondonationDecision,
  CondonationInput,
  ConflictResolution,
  HolidayInput,
  Id,
  LeaveDecision,
  LeaveRequestInput,
  SectionDayInput,
  SubstituteInput,
  SyncBatch,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import { acceptMarks } from '@campusverse/shared-transport';
import type { Actor } from '@campusverse/platform-permissions';
import {
  acceptSyncEvents,
  assignSubstitute,
  attendanceDay,
  attendanceTrend,
  attendanceSettings,
  correctAttendance,
  decideCondonation,
  decideLeave,
  declareHoliday,
  markingSheet,
  studentAttendance,
  monthlyRegister,
  noticeProof,
  openCondonation,
  openConflicts,
  pendingLeave,
  previewHoliday,
  requestLeave,
  resolveConflict,
  sendShortageNotice,
  shortageReport,
  signOff,
  updateAttendanceSettings,
  type AttendanceDeps,
} from '@campusverse/school-attendance';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { DB, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};
const OptionalDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

@Controller()
@UseGuards(ActorGuard)
export class AttendanceController {
  private readonly deps: AttendanceDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  /**
   * Offline sync: a device's queued events, each accepted once by its event id. Every answer is
   * final for that event, so the device drops it; only a 5xx means "send again later".
   */
  @Post('sync/events')
  @HttpCode(200)
  async sync(@Body() body: unknown, @Req() req: AuthedRequest) {
    // One queue per device: class attendance and bus marks travel together.
    const events = SyncBatch.parse(body).events;
    const actor = actorOf(req);
    return {
      results: [
        ...(await acceptSyncEvents(
          this.deps,
          actor,
          events.filter((e) => e.type === 'attendance.mark'),
        )),
        ...(await acceptMarks(
          this.deps.db,
          this.deps.permissions,
          actor,
          events.filter((e) => e.type === 'transport.mark'),
        )),
      ],
    };
  }

  @Get('school/attendance/:institutionId/day')
  day(
    @Param('institutionId') id: string,
    @Query('date') date: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return attendanceDay(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...(date ? { onDate: OptionalDay.parse(date) } : {}),
    });
  }

  /** The last seven days, for the dashboard's weekly chart. */
  @Get('school/attendance/:institutionId/trend')
  trend(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return attendanceTrend(this.deps, actorOf(req), Id.parse(id));
  }

  @Get('school/attendance/students/:studentId')
  student(@Param('studentId') id: string, @Req() req: AuthedRequest) {
    return studentAttendance(this.deps, actorOf(req), Id.parse(id));
  }

  @Get('school/attendance/sections/:sectionId')
  sheet(
    @Param('sectionId') id: string,
    @Query('date') date: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return markingSheet(this.deps, actorOf(req), {
      sectionId: Id.parse(id),
      ...(date ? { onDate: OptionalDay.parse(date) } : {}),
    });
  }

  @Get('school/attendance/sections/:sectionId/register')
  register(
    @Param('sectionId') id: string,
    @Query('month') month: string,
    @Req() req: AuthedRequest,
  ) {
    return monthlyRegister(this.deps, actorOf(req), {
      sectionId: Id.parse(id),
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .parse(month),
    });
  }

  @Post('school/attendance/corrections')
  @HttpCode(204)
  async correct(@Body() body: unknown, @Req() req: AuthedRequest) {
    await correctAttendance(this.deps, actorOf(req), AttendanceCorrection.parse(body));
  }

  @Post('school/attendance/sign-off')
  @HttpCode(204)
  async signOff(@Body() body: unknown, @Req() req: AuthedRequest) {
    await signOff(this.deps, actorOf(req), SectionDayInput.parse(body));
  }

  @Post('school/attendance/substitutes')
  @HttpCode(204)
  async substitute(@Body() body: unknown, @Req() req: AuthedRequest) {
    await assignSubstitute(this.deps, actorOf(req), SubstituteInput.parse(body));
  }

  @Get('school/attendance/:institutionId/conflicts')
  conflicts(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return openConflicts(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('school/attendance/conflicts/:id/resolve')
  @HttpCode(204)
  async resolve(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await resolveConflict(this.deps, actorOf(req), {
      conflictId: Id.parse(id),
      ...ConflictResolution.parse(body),
    });
  }

  @Get('school/attendance/:institutionId/leave')
  leave(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return pendingLeave(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('school/attendance/leave')
  requestLeave(@Body() body: unknown, @Req() req: AuthedRequest) {
    return requestLeave(this.deps, actorOf(req), LeaveRequestInput.parse(body));
  }

  @Post('school/attendance/leave/:id/decide')
  @HttpCode(204)
  async decideLeave(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await decideLeave(this.deps, actorOf(req), {
      leaveId: Id.parse(id),
      ...LeaveDecision.parse(body),
    });
  }

  /** Bulk: preview first (counts), then declare. */
  @Post('school/attendance/:institutionId/holidays/preview')
  @HttpCode(200)
  previewHoliday(
    @Param('institutionId') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return previewHoliday(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...HolidayInput.parse(body),
    });
  }

  @Post('school/attendance/:institutionId/holidays')
  declareHoliday(
    @Param('institutionId') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return declareHoliday(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...HolidayInput.parse(body),
    });
  }

  @Get('school/attendance/:institutionId/shortage')
  shortage(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return shortageReport(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('school/attendance/shortage/:personId/notice')
  notice(@Param('personId') id: string, @Req() req: AuthedRequest) {
    return sendShortageNotice(this.deps, actorOf(req), { personId: Id.parse(id) });
  }

  @Get('school/attendance/notices/:id')
  proof(@Param('id') id: string, @Req() req: AuthedRequest) {
    return noticeProof(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('school/attendance/condonation')
  condone(@Body() body: unknown, @Req() req: AuthedRequest) {
    return openCondonation(this.deps, actorOf(req), CondonationInput.parse(body));
  }

  @Post('school/attendance/condonation/:id/decide')
  @HttpCode(204)
  async decideCondonation(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await decideCondonation(this.deps, actorOf(req), {
      caseId: Id.parse(id),
      ...CondonationDecision.parse(body),
    });
  }

  @Get('school/attendance/:institutionId/settings')
  settings(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return attendanceSettings(this.deps, actorOf(req), Id.parse(id));
  }

  @Put('school/attendance/:institutionId/settings')
  @HttpCode(204)
  async updateSettings(
    @Param('institutionId') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await updateAttendanceSettings(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...AttendanceSettingsInput.parse(body),
    });
  }
}
