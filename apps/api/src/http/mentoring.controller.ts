import { Id } from '@campusverse/contracts';
import { academicPlacement } from '@campusverse/academics-structure';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  allocation,
  assignMentor,
  closeEscalation,
  escalate,
  escalations,
  menteeLog,
  myMentees,
  recordCheckIn,
  scheduleCheckIn,
  type MentoringDeps,
} from '@campusverse/shared-mentoring';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
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
const Place = z.object({ institutionId: Id });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Assign = Place.extend({ mentorId: Id, studentIds: z.array(Id).min(1).max(500) });
const Schedule = Place.extend({ on: Day });
const Record = Place.extend({
  meetingId: Id.optional(),
  state: z.enum(['held', 'missed', 'cancelled']),
  notes: z.string().trim().max(2000).nullable().default(null),
  concern: z.enum(['fine', 'watch', 'concern']).nullable().default(null),
});
const Escalate = Place.extend({
  to: z.enum(['hod', 'counsellor', 'parent']),
  reason: z.string().trim().min(10).max(1000),
});
const Close = Place.extend({ note: z.string().trim().min(3).max(1000) });

/** Students › Mentoring (rule book §13.5, §16.4; docs/specs/MENTORING.md). */
@Controller('mentoring')
@UseGuards(ActorGuard)
export class MentoringController {
  private readonly deps: MentoringDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions, placements: [schoolPlacement, academicPlacement] };
  }

  @Get('allocation')
  allocation(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return allocation(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('assign')
  assign(@Body() body: unknown, @Req() req: AuthedRequest) {
    return assignMentor(this.deps, actorOf(req), Assign.parse(body));
  }

  @Get('mentees')
  mentees(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return myMentees(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('mentees/:id')
  log(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return menteeLog(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      studentId: Id.parse(id),
    });
  }

  @Post('mentees/:id/schedule')
  schedule(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return scheduleCheckIn(this.deps, actorOf(req), {
      studentId: Id.parse(id),
      ...Schedule.parse(body),
    });
  }

  @Post('mentees/:id/check-ins')
  record(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return recordCheckIn(this.deps, actorOf(req), {
      studentId: Id.parse(id),
      ...Record.parse(body),
    });
  }

  @Post('mentees/:id/escalate')
  escalate(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return escalate(this.deps, actorOf(req), { studentId: Id.parse(id), ...Escalate.parse(body) });
  }

  @Get('escalations')
  escalations(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return escalations(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('escalations/:id/close')
  @HttpCode(204)
  async close(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await closeEscalation(this.deps, actorOf(req), {
      escalationId: Id.parse(id),
      ...Close.parse(body),
    });
  }
}
