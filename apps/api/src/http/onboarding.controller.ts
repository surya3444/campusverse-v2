import { OnboardingComplete, OnboardingDraft } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import { pendingInvite, saveInviteDraft } from '@campusverse/platform-control';
import { completeOnboarding } from '@campusverse/school-setup';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DB, type AuthedRequest } from './deps.js';
import { SessionGuard } from './guards.js';

const accountOf = (req: AuthedRequest) => {
  if (!req.session) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.session.accountId;
};

/**
 * Onboarding for an invited organisation admin: signed in, but with no organisation yet, so a
 * session is enough (no profile). Everything is scoped to this login's own open invite.
 */
@Controller('onboarding')
@UseGuards(SessionGuard)
export class OnboardingController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async state(@Req() req: AuthedRequest) {
    const invite = await pendingInvite(this.db, accountOf(req));
    if (!invite) throw new NotFoundException({ code: 'not_invited' });
    const { name, email, planName, draft } = invite;
    return { name, email, phone: `…${invite.phone.slice(-4)}`, planName, draft };
  }

  @Post('draft')
  @HttpCode(204)
  async draft(@Body() body: unknown, @Req() req: AuthedRequest) {
    await saveInviteDraft(this.db, accountOf(req), OnboardingDraft.parse(body).draft);
  }

  @Post('complete')
  complete(@Body() body: unknown, @Req() req: AuthedRequest) {
    return completeOnboarding(this.db, accountOf(req), OnboardingComplete.parse(body));
  }
}
