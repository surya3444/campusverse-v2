import { ApaarReconcileInput, Id } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import type { PeopleDeps } from '@campusverse/people-records';
import { reconcileApaar, udiseReadiness, type ReturnsDeps } from '@campusverse/school-returns';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DB, PEOPLE, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Quality & Compliance › Government Reports for schools (rule book §13.11). */
@Controller('returns')
@UseGuards(ActorGuard)
export class ReturnsController {
  private readonly deps: ReturnsDeps;
  constructor(
    @Inject(DB) db: Db,
    @Inject(PERMISSIONS) permissions: Permissions,
    @Inject(PEOPLE) people: PeopleDeps,
  ) {
    this.deps = { db, permissions, keys: people.keys };
  }

  @Get('udise')
  udise(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return udiseReadiness(this.deps, actorOf(req), Id.parse(i));
  }

  /** A UDISE+ APAAR list: a dry run, or with apply, the IDs that may be stored. */
  @Post('apaar')
  apaar(@Body() body: unknown, @Req() req: AuthedRequest) {
    return reconcileApaar(this.deps, actorOf(req), ApaarReconcileInput.parse(body));
  }
}
