import {
  AdmissionFormInput,
  ApplicationCodeRequest,
  ApplicationStatusRequest,
  Id,
  OnlineApplicationInput,
  SendPapersInput,
  StartApplicationInput,
} from '@campusverse/contracts';
import { FileRefused } from '@campusverse/platform-documents';
import type { Db } from '@campusverse/db';
import { normaliseIndianMobile, type Otp } from '@campusverse/platform-identity';
import type { Actor } from '@campusverse/platform-permissions';
import {
  admissionForms,
  applicationStatus,
  publicForm,
  requestApplicationCode,
  saveAdmissionForm,
  sendPapers,
  startApplication,
  submitOnlineApplication,
  uploadPaper,
  type AdmissionsDeps,
} from '@campusverse/school-admissions';
import {
  BadRequestException,
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
import { ADMISSIONS, APPLY, DB, type ApplyDeps, type AuthedRequest } from './deps.js';
import { ActorGuard } from './guards.js';

const PAPER_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

/**
 * The public online application form (docs/specs/ONLINE_APPLICATIONS.md): no session. Every call
 * is rate-limited per network address; codes also per number.
 */
@Controller('public/apply')
export class ApplyController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APPLY) private readonly apply: ApplyDeps,
  ) {}

  private otp(): Otp {
    if (!this.apply.otp) throw new ServiceUnavailableException({ code: 'online_form_unavailable' });
    return this.apply.otp;
  }

  private secret(): string {
    if (!this.apply.secret)
      throw new ServiceUnavailableException({ code: 'online_form_unavailable' });
    return this.apply.secret;
  }

  /** The form; with ?invite= a personal link, which is marked opened. */
  @Get(':slug')
  async form(
    @Param('slug') slug: string,
    @Query('invite') invite: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    await this.otp().checkLimit('view', req.ip, 300);
    const f = await publicForm(this.db, slug, invite ?? null);
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

  /** The code proves the mobile: a session for uploading papers and submitting. */
  @Post(':slug/start')
  @HttpCode(200)
  async start(@Param('slug') slug: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await this.otp().checkLimit('start', req.ip, 30);
    return startApplication(this.db, this.otp(), this.secret(), {
      slug,
      ...StartApplicationInput.parse(body),
    });
  }

  /** Multipart: session and kind before the file (PDF, JPEG or PNG). */
  @Post(':slug/papers')
  async paper(@Param('slug') slug: string, @Req() req: AuthedRequest) {
    await this.otp().checkLimit('paper', req.ip, 60);
    const file = await req.file();
    if (!file) throw new BadRequestException({ code: 'file_missing' });
    const field = (k: string) => {
      const f = file.fields[k];
      return f && !Array.isArray(f) && 'value' in f ? String(f.value) : '';
    };
    if (!PAPER_TYPES.has(file.mimetype)) throw new FileRefused('file_type');
    return uploadPaper(this.db, this.apply.store, this.secret(), {
      slug,
      session: field('session'),
      kind: field('kind'),
      fileName: file.filename,
      contentType: file.mimetype,
      bytes: new Uint8Array(await file.toBuffer()),
    });
  }

  @Post(':slug')
  async submit(@Param('slug') slug: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await this.otp().checkLimit('submit', req.ip, 30);
    return submitOnlineApplication(this.db, this.secret(), {
      slug,
      ...OnlineApplicationInput.parse(body),
    });
  }

  /** Papers the school asked for, sent with a papers link or after Check an application. */
  @Post(':slug/send-papers')
  @HttpCode(200)
  async sendPapers(@Param('slug') slug: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await this.otp().checkLimit('submit', req.ip, 30);
    return sendPapers(this.db, this.secret(), { slug, ...SendPapersInput.parse(body) });
  }

  @Post(':slug/status')
  @HttpCode(200)
  async status(@Param('slug') slug: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await this.otp().checkLimit('status', req.ip, 30);
    return {
      applications: await applicationStatus(this.db, this.otp(), this.secret(), {
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
