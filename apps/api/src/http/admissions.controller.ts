import {
  ActivityInput,
  ApplicationMove,
  ApplicationUpdate,
  FollowUpDone,
  FollowUpInput,
  InviteInput,
  LeadImportOptions,
  LeadUpdate,
  PapersRequestInput,
  CertificateRequest,
  DraftEdit,
  EnquiryInput,
  EnrolInput,
  Id,
  PortalExport,
  ReasonInput,
  Reissue,
  SeatsInput,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import { verifyDocument } from '@campusverse/platform-documents';
import type { Actor } from '@campusverse/platform-permissions';
import {
  addEnquiry,
  admissionYears,
  applicationRecord,
  cancelInvite,
  completeFollowUp,
  confirm,
  counsellors,
  followUps,
  importLeads,
  invites,
  leadImports,
  logActivity,
  previewLeadImport,
  requestPapers,
  scheduleFollowUp,
  sendInvite,
  studentAdmission,
  undoLeadImport,
  updateLead,
  verifyApplication,
  discardDraw,
  drawDetail,
  draws,
  enrolApplicant,
  moveApplication,
  offer,
  pipeline,
  publishDraw,
  setSeats,
  startDraw,
  updateApplication,
  type AdmissionsDeps,
} from '@campusverse/school-admissions';
import {
  approveCertificate,
  cancelCertificate,
  certificateDetail,
  checkCertificate,
  editDraft,
  idCards,
  issueCertificate,
  listCertificates,
  recordPortalExport,
  reissueCertificate,
  requestCertificate,
  type CertificateDeps,
} from '@campusverse/school-certificates';
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
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { ADMISSIONS, APPLY, CERTIFICATES, DB, type ApplyDeps, type AuthedRequest } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};
const YearLabel = z.string().regex(/^\d{4}-\d{2}$/);
const Draw = z.object({
  yearLabel: YearLabel,
  classId: Id,
  category: z.enum(['general', 'rte', 'staff', 'management']),
  method: z.enum(['lottery', 'first_come']),
  siblingFirst: z.boolean(),
  seed: z
    .string()
    .trim()
    .max(64)
    .regex(/^[\w .:-]*$/)
    .nullable()
    .default(null),
});
const Discard = z.object({ reason: z.string().trim().min(3).max(500) });

/** Enquiry to enrolment. */
@Controller('school/admissions')
@UseGuards(ActorGuard)
export class AdmissionsController {
  constructor(
    @Inject(ADMISSIONS) private readonly deps: AdmissionsDeps,
    @Inject(APPLY) private readonly apply: ApplyDeps,
  ) {}

  /** A sheet from a multipart upload, with its option fields. */
  private async sheet(req: AuthedRequest) {
    const file = await req.file();
    if (!file) throw new BadRequestException({ code: 'file_missing' });
    const fields = Object.fromEntries(
      Object.entries(file.fields).flatMap(([k, f]) =>
        f && !Array.isArray(f) && 'value' in f && k !== 'file' ? [[k, String(f.value)]] : [],
      ),
    );
    return {
      fileName: file.filename,
      bytes: new Uint8Array(await file.toBuffer()),
      fields: fields as Record<string, string>,
    };
  }

  /** The school's years admissions work in (set up in Academic years). */
  @Get(':institutionId/years')
  years(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return admissionYears(this.deps, actorOf(req), Id.parse(id));
  }

  /** Staff who can own leads here. */
  @Get(':institutionId/counsellors')
  counsellors(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return counsellors(this.deps, actorOf(req), Id.parse(id));
  }

  @Get(':institutionId/follow-ups')
  followUps(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return followUps(this.deps, actorOf(req), Id.parse(id));
  }

  @Get(':institutionId/invites')
  invites(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return invites(this.deps, actorOf(req), Id.parse(id));
  }

  /** A personal form link for a lead or a new family; the office sends the message. */
  @Post(':institutionId/invites')
  invite(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return sendInvite(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      purpose: 'apply',
      origin: this.apply.origin,
      ...InviteInput.parse(body),
    });
  }

  @Post('invites/:id/cancel')
  @HttpCode(204)
  async cancelInvite(@Param('id') id: string, @Req() req: AuthedRequest) {
    await cancelInvite(this.deps, actorOf(req), Id.parse(id));
  }

  @Get(':institutionId/imports')
  imports(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return leadImports(this.deps, actorOf(req), Id.parse(id));
  }

  /** Multipart: yearLabel, then an .xlsx or .csv. Nothing is written. */
  @Post(':institutionId/imports/preview')
  @HttpCode(200)
  async previewImport(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    const s = await this.sheet(req);
    return previewLeadImport(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      yearLabel: YearLabel.parse(s.fields.yearLabel),
      fileName: s.fileName,
      bytes: s.bytes,
    });
  }

  /** Multipart: yearLabel, source, campaign, ownerPersonId, then the same file. */
  @Post(':institutionId/imports')
  async importLeads(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    const s = await this.sheet(req);
    const o = LeadImportOptions.parse({
      ...s.fields,
      campaign: s.fields.campaign || null,
      ownerPersonId: s.fields.ownerPersonId || null,
    });
    return importLeads(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      fileName: s.fileName,
      bytes: s.bytes,
      ...o,
    });
  }

  @Post('imports/:id/undo')
  undoImport(@Param('id') id: string, @Req() req: AuthedRequest) {
    return undoLeadImport(this.deps, actorOf(req), Id.parse(id));
  }

  /** How a student was admitted, for their record. */
  @Get('students/:studentId')
  async studentAdmission(@Param('studentId') id: string, @Req() req: AuthedRequest) {
    return { admission: await studentAdmission(this.deps, actorOf(req), Id.parse(id)) };
  }

  @Get(':institutionId')
  pipeline(
    @Param('institutionId') id: string,
    @Query('year') year: string,
    @Req() req: AuthedRequest,
  ) {
    return pipeline(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      yearLabel: YearLabel.parse(year),
    });
  }

  @Post(':institutionId/enquiries')
  enquire(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return addEnquiry(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...EnquiryInput.parse(body),
    });
  }

  @Post(':institutionId/seats')
  @HttpCode(204)
  async seats(
    @Param('institutionId') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await setSeats(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...SeatsInput.parse(body),
    });
  }

  @Get(':institutionId/draws')
  draws(
    @Param('institutionId') id: string,
    @Query('year') year: string,
    @Req() req: AuthedRequest,
  ) {
    return draws(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      yearLabel: YearLabel.parse(year),
    });
  }

  @Post(':institutionId/draws')
  draw(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return startDraw(this.deps, actorOf(req), { institutionId: Id.parse(id), ...Draw.parse(body) });
  }

  @Get('draws/:id')
  drawDetail(@Param('id') id: string, @Req() req: AuthedRequest) {
    return drawDetail(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('draws/:id/publish')
  publishDraw(@Param('id') id: string, @Req() req: AuthedRequest) {
    return publishDraw(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('draws/:id/discard')
  @HttpCode(204)
  async discardDraw(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await discardDraw(this.deps, actorOf(req), { drawId: Id.parse(id), ...Discard.parse(body) });
  }

  @Get('applications/:id')
  detail(@Param('id') id: string, @Req() req: AuthedRequest) {
    return applicationRecord(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('applications/:id/lead')
  @HttpCode(204)
  async lead(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await updateLead(this.deps, actorOf(req), {
      applicationId: Id.parse(id),
      ...LeadUpdate.parse(body),
    });
  }

  @Post('applications/:id/activity')
  @HttpCode(204)
  async activity(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await logActivity(this.deps, actorOf(req), {
      applicationId: Id.parse(id),
      ...ActivityInput.parse(body),
    });
  }

  @Post('applications/:id/follow-ups')
  @HttpCode(204)
  async followUp(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await scheduleFollowUp(this.deps, actorOf(req), {
      applicationId: Id.parse(id),
      ...FollowUpInput.parse(body),
    });
  }

  @Post('follow-ups/:id/done')
  @HttpCode(204)
  async followUpDone(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await completeFollowUp(this.deps, actorOf(req), {
      followUpId: Id.parse(id),
      ...FollowUpDone.parse(body),
    });
  }

  @Post('applications/:id/verify')
  @HttpCode(204)
  async verify(@Param('id') id: string, @Req() req: AuthedRequest) {
    await verifyApplication(this.deps, actorOf(req), Id.parse(id));
  }

  /** Papers needed: the application waits and the family gets a link listing them. */
  @Post('applications/:id/request-papers')
  requestPapers(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return requestPapers(this.deps, actorOf(req), {
      applicationId: Id.parse(id),
      origin: this.apply.origin,
      ...PapersRequestInput.parse(body),
    });
  }

  @Post('applications/:id/update')
  @HttpCode(204)
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await updateApplication(this.deps, actorOf(req), {
      applicationId: Id.parse(id),
      ...ApplicationUpdate.parse(body),
    });
  }

  @Post('applications/:id/move')
  @HttpCode(204)
  async move(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await moveApplication(this.deps, actorOf(req), {
      applicationId: Id.parse(id),
      ...ApplicationMove.parse(body),
    });
  }

  @Post('applications/:id/offer')
  offer(@Param('id') id: string, @Req() req: AuthedRequest) {
    return offer(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('applications/:id/confirm')
  @HttpCode(204)
  async confirm(@Param('id') id: string, @Req() req: AuthedRequest) {
    await confirm(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('applications/:id/enrol')
  enrol(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return enrolApplicant(this.deps, actorOf(req), {
      applicationId: Id.parse(id),
      ...EnrolInput.parse(body),
    });
  }
}

/** Request, check, approve, issue, reissue: the certificate register. */
@Controller('school/certificates')
@UseGuards(ActorGuard)
export class CertificatesController {
  constructor(@Inject(CERTIFICATES) private readonly deps: CertificateDeps) {}

  @Get('institution/:institutionId')
  list(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return listCertificates(this.deps, actorOf(req), Id.parse(id));
  }

  /** ID cards for a section, or one student in it, as a printable PDF (A4, ten to a sheet). */
  @Get('id-cards')
  async idCards(
    @Query('sectionId') sectionId: string | undefined,
    @Query('studentId') studentId: string | undefined,
    @Req() req: AuthedRequest,
    @Res() reply: FastifyReply,
  ) {
    const r = await idCards(this.deps, actorOf(req), {
      sectionId: sectionId ? Id.parse(sectionId) : null,
      studentId: studentId ? Id.parse(studentId) : null,
    });
    await reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${r.fileName}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(r.pdf));
  }

  @Post()
  request(@Body() body: unknown, @Req() req: AuthedRequest) {
    return requestCertificate(this.deps, actorOf(req), CertificateRequest.parse(body));
  }

  @Get(':id')
  detail(@Param('id') id: string, @Req() req: AuthedRequest) {
    return certificateDetail(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':id/draft')
  @HttpCode(204)
  async draft(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await editDraft(this.deps, actorOf(req), { requestId: Id.parse(id), ...DraftEdit.parse(body) });
  }

  @Post(':id/check')
  @HttpCode(204)
  async check(@Param('id') id: string, @Req() req: AuthedRequest) {
    await checkCertificate(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':id/approve')
  @HttpCode(204)
  async approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    await approveCertificate(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':id/issue')
  issue(@Param('id') id: string, @Req() req: AuthedRequest) {
    return issueCertificate(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':id/reissue')
  reissue(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return reissueCertificate(this.deps, actorOf(req), {
      requestId: Id.parse(id),
      ...Reissue.parse(body),
    });
  }

  @Post(':id/cancel')
  @HttpCode(204)
  async cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await cancelCertificate(this.deps, actorOf(req), {
      requestId: Id.parse(id),
      ...ReasonInput.parse(body),
    });
  }

  @Post(':id/portal-export')
  @HttpCode(204)
  async portal(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await recordPortalExport(this.deps, actorOf(req), {
      requestId: Id.parse(id),
      ...PortalExport.parse(body),
    });
  }
}

/** The public QR check: no session. What the document is and whether it stands; nothing about the student. */
@Controller('public/verify')
export class VerifyController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(':code')
  async verify(@Param('code') code: string) {
    const v = await verifyDocument(this.db, code);
    if (!v) throw new NotFoundException({ code: 'not_found' });
    return {
      kind: v.kind,
      number: v.number,
      version: v.version,
      issuedAt: v.issuedAt,
      status: v.status,
    };
  }
}
