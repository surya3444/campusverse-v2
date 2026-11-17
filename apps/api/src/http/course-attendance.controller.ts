import {
  CourseCondonationInput,
  CourseAttendanceInput,
  CourseAttendanceQuery,
  Id,
  ResultsDecisionInput,
} from '@campusverse/contracts';
import {
  attendanceBoard,
  attendanceSheet,
  decideCondonation,
  requestCondonation,
  takeAttendance,
  type AttendanceDeps,
} from '@campusverse/academics-attendance';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DB, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Academics › Attendance for colleges (rule book §13.2): periods, standings, condonation. */
@Controller('academics')
@UseGuards(ActorGuard)
export class CourseAttendanceController {
  private readonly deps: AttendanceDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get('batches/:id/attendance')
  board(@Param('id') id: string, @Req() req: AuthedRequest) {
    return attendanceBoard(this.deps, actorOf(req), Id.parse(id));
  }

  @Get('batches/:id/attendance/sheet')
  sheet(@Param('id') id: string, @Query() query: unknown, @Req() req: AuthedRequest) {
    return attendanceSheet(this.deps, actorOf(req), {
      batchId: Id.parse(id),
      ...CourseAttendanceQuery.parse(query),
    });
  }

  @Post('batches/:id/attendance')
  async take(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await takeAttendance(this.deps, actorOf(req), {
        batchId: Id.parse(id),
        ...CourseAttendanceInput.parse(body),
      }),
    };
  }

  @Post('batches/:id/condonations')
  async condone(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await requestCondonation(this.deps, actorOf(req), {
        batchId: Id.parse(id),
        ...CourseCondonationInput.parse(body),
      }),
    };
  }

  @Post('condonations/:id/decision')
  async decide(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      outcome: await decideCondonation(this.deps, actorOf(req), {
        condonationId: Id.parse(id),
        ...ResultsDecisionInput.parse(body),
      }),
    };
  }
}
