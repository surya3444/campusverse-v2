import {
  AdminEnrol,
  AdminInvite,
  AdminEnrolVerify,
  AdminSignIn,
  AdminSignInVerify,
  AuditQuery,
  CustomerCreate,
  CustomerQuery,
  CustomerStatusChange,
  FlagDefault,
  FlagSet,
  Id,
  IncidentOpen,
  IncidentStepInput,
  PackDraftInput,
  PlanChange,
  PlanSave,
  StaffCreate,
  SupportRequest,
  SwitchSet,
} from '@campusverse/contracts';
import {
  completeRegistration,
  completeSignIn,
  cancelInvite,
  createCustomer,
  inviteAdmin,
  listInvites,
  createStaff,
  customerDetail,
  decideApproval,
  deliveryHealth,
  disableStaff,
  endGrant,
  listApprovals,
  listCustomers,
  listFlags,
  listGrants,
  listIncidents,
  openIncident,
  recordIncidentStep,
  listPlans,
  listStaff,
  listSwitches,
  registrationOptions,
  reissueEnrolment,
  requestStatusChange,
  requestSupportAccess,
  savePlan,
  searchAudit,
  setFlag,
  setFlagDefault,
  setPlan,
  setSwitch,
  signInOptions,
  signOutStaff,
  supportView,
  type Staff,
} from '@campusverse/platform-control';
import {
  discardPackDraft,
  draftPackVersion,
  packCatalogue,
  releasePackVersion,
} from '@campusverse/platform-rulepacks';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
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
import { CONTROL, type AuthedRequest, type ControlDeps } from './deps.js';
import { bearer, StaffGuard } from './guards.js';

const staffOf = (req: AuthedRequest): Staff => {
  if (!req.staff) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.staff;
};

/** Staff passkey enrolment and sign-in. Only the admin app's server calls these. */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(@Inject(CONTROL) private readonly c: ControlDeps) {}

  @Post('enrol/options')
  @HttpCode(200)
  enrolOptions(@Body() body: unknown) {
    return registrationOptions(this.c.db, this.c.rp, AdminEnrol.parse(body).token);
  }

  @Post('enrol/verify')
  @HttpCode(200)
  enrolVerify(@Body() body: unknown) {
    const b = AdminEnrolVerify.parse(body);
    return completeRegistration(this.c.db, this.c.rp, {
      enrolToken: b.token,
      challengeId: b.challengeId,
      response: b.response as unknown as RegistrationResponseJSON,
    });
  }

  @Post('sign-in/options')
  @HttpCode(200)
  signInOptions(@Body() body: unknown) {
    return signInOptions(this.c.db, this.c.rp, AdminSignIn.parse(body).email);
  }

  @Post('sign-in/verify')
  @HttpCode(200)
  signInVerify(@Body() body: unknown) {
    const b = AdminSignInVerify.parse(body);
    return completeSignIn(this.c.db, this.c.rp, {
      challengeId: b.challengeId,
      response: b.response as unknown as AuthenticationResponseJSON,
    });
  }

  @Post('sign-out')
  @HttpCode(204)
  async signOut(@Req() req: AuthedRequest) {
    const token = bearer(req);
    if (token) await signOutStaff(this.c.db, token);
  }
}

/** The super admin portal: customers, plans, flags, switches, approvals, support, audit, health. */
@Controller('admin')
@UseGuards(StaffGuard)
export class AdminController {
  constructor(@Inject(CONTROL) private readonly c: ControlDeps) {}

  @Get('me')
  me(@Req() req: AuthedRequest) {
    return staffOf(req);
  }

  @Get('customers')
  customers(@Query() query: unknown, @Req() req: AuthedRequest) {
    return listCustomers(this.c.db, staffOf(req), this.c.ports, CustomerQuery.parse(query));
  }

  @Post('customers')
  createCustomer(@Body() body: unknown, @Req() req: AuthedRequest) {
    return createCustomer(this.c.db, staffOf(req), this.c.ports, CustomerCreate.parse(body));
  }

  @Get('customers/:orgId')
  customer(@Param('orgId') orgId: string, @Req() req: AuthedRequest) {
    return customerDetail(this.c.db, staffOf(req), this.c.ports, Id.parse(orgId));
  }

  @Post('customers/:orgId/plan')
  @HttpCode(204)
  async plan(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setPlan(this.c.db, staffOf(req), Id.parse(orgId), PlanChange.parse(body).planCode);
  }

  @Post('customers/:orgId/status')
  status(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return requestStatusChange(this.c.db, staffOf(req), {
      orgId: Id.parse(orgId),
      ...CustomerStatusChange.parse(body),
    });
  }

  @Post('customers/:orgId/flags')
  @HttpCode(204)
  async flag(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setFlag(this.c.db, staffOf(req), { orgId: Id.parse(orgId), ...FlagSet.parse(body) });
  }

  @Post('customers/:orgId/support')
  support(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return requestSupportAccess(this.c.db, staffOf(req), {
      orgId: Id.parse(orgId),
      ...SupportRequest.parse(body),
    });
  }

  @Get('customers/:orgId/support-view')
  supportView(@Param('orgId') orgId: string, @Req() req: AuthedRequest) {
    return supportView(this.c.db, staffOf(req), this.c.ports, Id.parse(orgId));
  }

  @Get('flags')
  flags(@Req() req: AuthedRequest) {
    return listFlags(this.c.db, staffOf(req));
  }

  @Post('flags/default')
  @HttpCode(204)
  async flagDefault(@Body() body: unknown, @Req() req: AuthedRequest) {
    await setFlagDefault(this.c.db, staffOf(req), FlagDefault.parse(body));
  }

  @Get('switches')
  switches(@Req() req: AuthedRequest) {
    return listSwitches(this.c.db, staffOf(req));
  }

  @Post('switches')
  @HttpCode(204)
  async setSwitch(@Body() body: unknown, @Req() req: AuthedRequest) {
    await setSwitch(this.c.db, staffOf(req), SwitchSet.parse(body));
  }

  @Get('plans')
  plans(@Req() req: AuthedRequest) {
    return listPlans(this.c.db, staffOf(req));
  }

  @Post('plans')
  @HttpCode(204)
  async savePlan(@Body() body: unknown, @Req() req: AuthedRequest) {
    await savePlan(this.c.db, staffOf(req), PlanSave.parse(body));
  }

  @Get('approvals')
  approvals(@Req() req: AuthedRequest) {
    return listApprovals(this.c.db, staffOf(req));
  }

  @Post('approvals/:id/decide')
  @HttpCode(204)
  async decide(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await decideApproval(this.c.db, staffOf(req), {
      approvalId: Id.parse(id),
      ...z.object({ approve: z.boolean() }).parse(body),
    });
  }

  @Get('support')
  grants(@Req() req: AuthedRequest) {
    return listGrants(this.c.db, staffOf(req));
  }

  @Post('support/:id/end')
  @HttpCode(204)
  async endGrant(@Param('id') id: string, @Req() req: AuthedRequest) {
    await endGrant(this.c.db, staffOf(req), Id.parse(id));
  }

  @Get('audit')
  audit(@Query() query: unknown, @Req() req: AuthedRequest) {
    return searchAudit(this.c.db, staffOf(req), AuditQuery.parse(query));
  }

  @Get('health')
  health(@Req() req: AuthedRequest) {
    return deliveryHealth(this.c.db, staffOf(req), this.c.ports);
  }

  @Get('staff')
  staff(@Req() req: AuthedRequest) {
    return listStaff(this.c.db, staffOf(req));
  }

  @Post('staff')
  createStaff(@Body() body: unknown, @Req() req: AuthedRequest) {
    return createStaff(this.c.db, staffOf(req), StaffCreate.parse(body));
  }

  @Post('staff/:id/enrolment')
  async reissue(@Param('id') id: string, @Req() req: AuthedRequest) {
    return { enrolToken: await reissueEnrolment(this.c.db, staffOf(req), Id.parse(id)) };
  }

  @Post('staff/:id/disable')
  @HttpCode(204)
  async disable(@Param('id') id: string, @Req() req: AuthedRequest) {
    await disableStaff(this.c.db, staffOf(req), Id.parse(id));
  }

  @Get('incidents')
  incidents(@Req() req: AuthedRequest) {
    return listIncidents(this.c.db, staffOf(req));
  }

  @Post('incidents')
  openIncident(@Body() body: unknown, @Req() req: AuthedRequest) {
    return openIncident(this.c.db, staffOf(req), IncidentOpen.parse(body));
  }

  @Post('incidents/:id/steps')
  @HttpCode(204)
  async incidentStep(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await recordIncidentStep(this.c.db, staffOf(req), {
      incidentId: Id.parse(id),
      ...IncidentStepInput.parse(body),
    });
  }

  /** Invites an organisation admin; they build their organisation themselves in onboarding. */
  @Post('invites')
  async invite(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = AdminInvite.parse(body);
    const r = await inviteAdmin(this.c.db, staffOf(req), input);
    // With simulated SMS, the invitation text comes back to show on screen.
    const simulated = this.c.simulateSms
      ? {
          channel: 'sms' as const,
          to: `…${r.phone.slice(-4)}`,
          text: `${input.name}, your Campusverse account is ready. Sign in at ${this.c.appOrigin}/login with this number to set up your organisation.`,
        }
      : null;
    return { inviteId: r.inviteId, ...(simulated ? { simulated } : {}) };
  }

  @Get('invites')
  invites(@Req() req: AuthedRequest) {
    return listInvites(this.c.db, staffOf(req));
  }

  @Post('invites/:id/cancel')
  @HttpCode(204)
  async cancelInvite(@Param('id') id: string, @Req() req: AuthedRequest) {
    await cancelInvite(this.c.db, staffOf(req), Id.parse(id));
  }

  // Rule packs (rule book §15.1): draft, test, release by a second owner -------------------------

  @Get('rule-packs')
  rulePacks(@Req() req: AuthedRequest) {
    return packCatalogue(this.c.db, staffOf(req));
  }

  @Post('rule-packs')
  draftRulePack(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = PackDraftInput.parse(body);
    return draftPackVersion(this.c.db, staffOf(req), {
      ...input,
      sources: input.sources.map(({ url, ...s }) => ({ ...s, ...(url ? { url } : {}) })),
    });
  }

  @Post('rule-packs/:id/release')
  @HttpCode(204)
  async releaseRulePack(@Param('id') id: string, @Req() req: AuthedRequest) {
    await releasePackVersion(this.c.db, staffOf(req), Id.parse(id));
  }

  @Post('rule-packs/:id/discard')
  @HttpCode(204)
  async discardRulePack(@Param('id') id: string, @Req() req: AuthedRequest) {
    await discardPackDraft(this.c.db, staffOf(req), Id.parse(id));
  }
}
