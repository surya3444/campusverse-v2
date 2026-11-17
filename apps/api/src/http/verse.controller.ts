import { Id, VerseAsk } from '@campusverse/contracts';
import {
  askVerse,
  confirmAction,
  conversation,
  conversations,
  dismissAction,
  verseUsage,
  type VerseDeps,
} from '@campusverse/platform-verse';
import type { Actor } from '@campusverse/platform-permissions';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { VERSE, type AuthedRequest } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Verse AI: ask with the person's own permissions; answers carry sources and are labelled AI. */
@Controller('verse')
@UseGuards(ActorGuard)
export class VerseController {
  constructor(@Inject(VERSE) private readonly deps: VerseDeps) {}

  @Post('ask')
  @HttpCode(200)
  ask(@Body() body: unknown, @Req() req: AuthedRequest) {
    return askVerse(this.deps, actorOf(req), VerseAsk.parse(body));
  }

  /** Runs an action Verse AI prepared, for the person it was prepared for (decision 0021). */
  @Post('actions/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id') id: string, @Req() req: AuthedRequest) {
    return confirmAction(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('actions/:id/dismiss')
  @HttpCode(200)
  dismiss(@Param('id') id: string, @Req() req: AuthedRequest) {
    return dismissAction(this.deps, actorOf(req), Id.parse(id));
  }

  @Get('conversations')
  conversations(@Req() req: AuthedRequest) {
    return conversations(this.deps, actorOf(req));
  }

  @Get('conversations/:id')
  conversation(@Param('id') id: string, @Req() req: AuthedRequest) {
    return conversation(this.deps, actorOf(req), Id.parse(id));
  }

  @Get('usage')
  usage(@Req() req: AuthedRequest) {
    return verseUsage(this.deps.db, actorOf(req).orgId);
  }
}
