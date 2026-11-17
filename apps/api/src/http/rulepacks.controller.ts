import { Id, PackAdoptInput } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  adoptPackVersion,
  institutionPacks,
  type RulePackDeps,
} from '@campusverse/platform-rulepacks';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
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

/** Campus Core › Rule Packs (rule book §15.1): the versions an institution follows, and switching. */
@Controller('rule-packs')
@UseGuards(ActorGuard)
export class RulePacksController {
  private readonly deps: RulePackDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get()
  packs(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return institutionPacks(this.deps, actorOf(req), Id.parse(institutionId));
  }

  @Post('adopt')
  @HttpCode(204)
  async adopt(@Body() body: unknown, @Req() req: AuthedRequest) {
    await adoptPackVersion(this.deps, actorOf(req), PackAdoptInput.parse(body));
  }
}
