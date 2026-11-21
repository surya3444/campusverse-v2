import { Id } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  addNote,
  caseDetail,
  committeeCases,
  committees,
  moveCase,
  myCases,
  raiseCase,
  recordMeeting,
  saveCommittee,
  setMembers,
  type GrievanceDeps,
} from '@campusverse/shared-grievances';
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
const Place = z.object({ institutionId: Id });
const Kind = z.enum([
  'internal_complaints',
  'anti_ragging',
  'sc_st_cell',
  'grievance_redressal',
  'other',
]);
const Committee = Place.extend({
  kind: Kind,
  name: z.string().trim().min(3).max(120),
  decideDays: z.number().int().min(1).max(365).optional(),
  active: z.boolean().default(true),
});
const Members = Place.extend({
  members: z
    .array(
      z.union([
        z.object({ personId: Id, role: z.enum(['chair', 'member']) }),
        z.object({
          outsideName: z.string().trim().min(2).max(120),
          role: z.literal('outside_member'),
        }),
      ]),
    )
    .max(30),
});
const Meeting = Place.extend({
  heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes: z.string().trim().min(3).max(8000),
});
const Raise = Place.extend({
  committeeId: Id,
  subject: z.string().trim().min(3).max(160),
  details: z.string().trim().min(10).max(8000),
  anonymous: z.boolean().default(false),
  aboutStudentId: Id.optional(),
});
const Note = Place.extend({ body: z.string().trim().min(2).max(4000) });
const Move = Place.extend({
  to: z.enum(['inquiry', 'decided', 'appealed', 'closed']),
  text: z.string().trim().max(4000).optional(),
});

/** Quality & Compliance › Grievances & Committees (rule book §13.11, §15). */
@Controller('grievances')
@UseGuards(ActorGuard)
export class GrievancesController {
  private readonly deps: GrievanceDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get('committees')
  committees(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return committees(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('committees')
  addCommittee(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveCommittee(this.deps, actorOf(req), Committee.parse(body));
  }

  @Put('committees/:id')
  updateCommittee(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveCommittee(this.deps, actorOf(req), { id: Id.parse(id), ...Committee.parse(body) });
  }

  @Put('committees/:id/members')
  @HttpCode(204)
  async members(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setMembers(this.deps, actorOf(req), {
      committeeId: Id.parse(id),
      ...Members.parse(body),
    });
  }

  @Post('committees/:id/meetings')
  meeting(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return recordMeeting(this.deps, actorOf(req), {
      committeeId: Id.parse(id),
      ...Meeting.parse(body),
    });
  }

  @Get('committees/:id/cases')
  committeeCases(
    @Param('id') id: string,
    @Query('institutionId') i: string,
    @Req() req: AuthedRequest,
  ) {
    return committeeCases(this.deps, actorOf(req), {
      committeeId: Id.parse(id),
      institutionId: Id.parse(i),
    });
  }

  @Get('mine')
  mine(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return myCases(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('cases')
  raise(@Body() body: unknown, @Req() req: AuthedRequest) {
    return raiseCase(this.deps, actorOf(req), Raise.parse(body));
  }

  @Get('cases/:id')
  case(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return caseDetail(this.deps, actorOf(req), {
      caseId: Id.parse(id),
      institutionId: Id.parse(i),
    });
  }

  @Post('cases/:id/notes')
  @HttpCode(204)
  async note(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await addNote(this.deps, actorOf(req), { caseId: Id.parse(id), ...Note.parse(body) });
  }

  @Post('cases/:id/move')
  @HttpCode(204)
  async move(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await moveCase(this.deps, actorOf(req), { caseId: Id.parse(id), ...Move.parse(body) });
  }
}
