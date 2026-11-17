import {
  ConsentDecisionInput,
  GuardianRevokeInput,
  GuardianVerifyInput,
  Id,
  PrivacyBreachInput,
  PrivacyBreachStepInput,
  PrivacyNoticeInput,
  PrivacyRequestInput,
  PrivacyRequestStateInput,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import {
  breaches,
  markBreachStep,
  notices,
  privacyOverview,
  publishNextNotice,
  recordBreach,
  recordRightsRequest,
  recordConsent,
  revokeGuardianCheck,
  rightsRequests,
  setRightsRequestState,
  studentConsent,
  verifyGuardian,
  type PrivacyDeps,
} from '@campusverse/platform-consent';
import type { Actor } from '@campusverse/platform-permissions';
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
const View = z.enum(['open', 'overdue', 'closed']);

/** Campus Core › Privacy & Consent (rule book §13.12): the Data Protection Officer's console. */
@Controller('privacy')
@UseGuards(ActorGuard)
export class PrivacyController {
  private readonly deps: PrivacyDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get('overview')
  overview(@Req() req: AuthedRequest) {
    return privacyOverview(this.deps, actorOf(req));
  }

  @Get('notices')
  notices(@Req() req: AuthedRequest) {
    return notices(this.deps, actorOf(req));
  }

  @Post('notices')
  publish(@Body() body: unknown, @Req() req: AuthedRequest) {
    return publishNextNotice(this.deps, actorOf(req), PrivacyNoticeInput.parse(body));
  }

  @Get('requests')
  requests(@Query('view') view: string | undefined, @Req() req: AuthedRequest) {
    return rightsRequests(this.deps, actorOf(req), View.parse(view ?? 'open'));
  }

  @Post('requests')
  record(@Body() body: unknown, @Req() req: AuthedRequest) {
    return recordRightsRequest(this.deps, actorOf(req), PrivacyRequestInput.parse(body));
  }

  @Post('requests/:id/state')
  @HttpCode(204)
  async state(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setRightsRequestState(this.deps, actorOf(req), {
      requestId: Id.parse(id),
      ...PrivacyRequestStateInput.parse(body),
    });
  }

  @Get('breaches')
  breaches(@Req() req: AuthedRequest) {
    return breaches(this.deps, actorOf(req));
  }

  @Post('breaches')
  breach(@Body() body: unknown, @Req() req: AuthedRequest) {
    return recordBreach(this.deps, actorOf(req), PrivacyBreachInput.parse(body));
  }

  @Post('breaches/:id/step')
  @HttpCode(204)
  async step(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await markBreachStep(this.deps, actorOf(req), {
      breachId: Id.parse(id),
      ...PrivacyBreachStepInput.parse(body),
    });
  }
}

/** A student's consent, purpose by purpose: guardians decide for their own child; the office records paper forms. */
@Controller('consent')
@UseGuards(ActorGuard)
export class ConsentController {
  private readonly deps: PrivacyDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get('students/:id')
  student(@Param('id') id: string, @Req() req: AuthedRequest) {
    return studentConsent(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('students/:id')
  async decide(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const d = ConsentDecisionInput.parse(body);
    return {
      id: await recordConsent(this.deps.db, this.deps.permissions, actorOf(req), {
        studentId: Id.parse(id),
        ...d,
      }),
    };
  }

  @Post('guardians/:id/verify')
  @HttpCode(204)
  async verify(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await verifyGuardian(this.deps, actorOf(req), {
      guardianId: Id.parse(id),
      ...GuardianVerifyInput.parse(body),
    });
  }

  @Post('guardians/:id/revoke')
  @HttpCode(204)
  async revoke(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await revokeGuardianCheck(this.deps, actorOf(req), {
      guardianId: Id.parse(id),
      ...GuardianRevokeInput.parse(body),
    });
  }
}
