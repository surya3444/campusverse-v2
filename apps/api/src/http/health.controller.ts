import {
  HealthBreakGlassInput,
  HealthPlaceInput,
  HealthRecordInput,
  HealthVisitInput,
  Id,
} from '@campusverse/contracts';
import type { Actor } from '@campusverse/platform-permissions';
import {
  healthRecord,
  healthTotals,
  openBreakGlass,
  recordVisit,
  saveHealthRecord,
  visitsToday,
  type HealthDeps,
} from '@campusverse/shared-health';
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
import { HEALTH, type AuthedRequest } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Health Connect (rule book §13.9): the vault, sick-room visits, totals and break-glass. */
@Controller('health')
@UseGuards(ActorGuard)
export class StudentHealthController {
  constructor(@Inject(HEALTH) private readonly deps: HealthDeps) {}

  @Get('totals')
  totals(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return healthTotals(
      this.deps,
      actorOf(req),
      HealthPlaceInput.parse({ institutionId: i }).institutionId,
    );
  }

  @Get('visits')
  visits(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return visitsToday(
      this.deps,
      actorOf(req),
      HealthPlaceInput.parse({ institutionId: i }).institutionId,
    );
  }

  @Get('students/:id')
  record(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return healthRecord(this.deps, actorOf(req), {
      studentId: Id.parse(id),
      institutionId: HealthPlaceInput.parse({ institutionId: i }).institutionId,
    });
  }

  @Put('students/:id')
  @HttpCode(204)
  async save(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await saveHealthRecord(this.deps, actorOf(req), {
      studentId: Id.parse(id),
      ...HealthRecordInput.parse(body),
    });
  }

  @Post('students/:id/visits')
  visit(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const v = HealthVisitInput.parse(body);
    return recordVisit(this.deps, actorOf(req), {
      studentId: Id.parse(id),
      institutionId: v.institutionId,
      notes: { complaint: v.complaint, care: v.care },
      outcome: v.outcome,
      parentTold: v.parentTold,
    });
  }

  /** Break-glass: recorded for ever, expires in an hour, tells the Data Protection Officer. */
  @Post('students/:id/emergency')
  emergency(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return openBreakGlass(this.deps, actorOf(req), {
      studentId: Id.parse(id),
      ...HealthBreakGlassInput.parse(body),
    });
  }
}
