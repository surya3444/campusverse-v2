import {
  AdmissionFormInput,
  ApplicationCodeRequest,
  ApplicationStatusRequest,
  Id,
  OnlineApplicationInput,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import { normaliseIndianMobile, type Otp } from '@campusverse/platform-identity';
import type { Actor } from '@campusverse/platform-permissions';
import {
  admissionForms,
  applicationStatus,
  publicForm,
  requestApplicationCode,
  saveAdmissionForm,
  submitOnlineApplication,
  type AdmissionsDeps,
} from '@campusverse/school-admissions';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { SmsSimulator } from '../simulation.js';
import { ADMISSIONS, APPLY, DB, type AuthedRequest } from './deps.js';
import { ActorGuard } from './guards.js';

type Apply = { otp: Otp | null; simulator: SmsSimulator | null };

/**
 * The public online application form (docs/specs/ONLINE_APPLICATIONS.md): no session. Every call
 * is rate-limited per network address; codes also per number.
 */
@Controller('public/apply')
export class ApplyController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APPLY) private readonly apply: Apply,
  ) {}

  private otp(): Otp {
    if (!this.apply.otp) throw new ServiceUnavailableException({ code: 'online_form_unavailable' });
    return this.apply.otp;
  }

  @Get(':slug')
  async form(@Param('slug') slug: string, @Req() req: AuthedRequest) {
    await this.otp().checkLimit('view', req.ip, 300);
    const f = await publicForm(this.db, slug);
    if (!f) throw new NotFoundException({ code: 'form_not_found' });
    return f;
  }

  /** Always 202 for a known form; in simulation the code comes back as a simulated SMS. */
  @Post(':slug/code')
  @HttpCode(202)
  async code(@Param('slug') slug: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { phone } = ApplicationCodeRequest.parse(body);
    const r = await requestApplicationCode(this.db, this.otp(), { slug, phone, ip: req.ip });
    if (r === 'unknown_form') throw new NotFoundException({ code: 'form_not_found' });
    if (r === 'bad_phone') throw new UnprocessableEntityException({ code: 'bad_phone' });
    const e164 = normaliseIndianMobile(phone);
    const simulated = this.apply.simulator && e164 ? this.apply.simulator.take(e164) : null;
    return simulated ? { simulated } : {};
  }

  @Post(':slug')
  async submit(@Param('slug') slug: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await this.otp().checkLimit('submit', req.ip, 30);
    return submitOnlineApplication(this.db, this.otp(), {
      slug,
      ...OnlineApplicationInput.parse(body),
    });
  }

  @Post(':slug/status')
  @HttpCode(200)
  async status(@Param('slug') slug: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await this.otp().checkLimit('status', req.ip, 30);
    return {
      applications: await applicationStatus(this.db, this.otp(), {
        slug,
        ...ApplicationStatusRequest.parse(body),
      }),
    };
  }
}

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** The office's side: setting up the form (`school.admission.manage`). */
@Controller('school/admissions/forms')
@UseGuards(ActorGuard)
export class AdmissionFormsController {
  constructor(@Inject(ADMISSIONS) private readonly deps: AdmissionsDeps) {}

  @Get()
  list(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return admissionForms(this.deps, actorOf(req), Id.parse(institutionId));
  }

  @Post()
  create(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveAdmissionForm(this.deps, actorOf(req), AdmissionFormInput.parse(body));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveAdmissionForm(this.deps, actorOf(req), {
      ...AdmissionFormInput.parse(body),
      formId: Id.parse(id),
    });
  }
}
