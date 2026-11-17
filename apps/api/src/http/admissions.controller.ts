import {
  ApplicationMove,
  ApplicationUpdate,
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
  applicationDetail,
  confirm,
  enrolApplicant,
  moveApplication,
  offer,
  pipeline,
  setSeats,
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
import { ADMISSIONS, CERTIFICATES, DB, type AuthedRequest } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};
const YearLabel = z.string().regex(/^\d{4}-\d{2}$/);

/** Enquiry to enrolment. */
@Controller('school/admissions')
@UseGuards(ActorGuard)
export class AdmissionsController {
  constructor(@Inject(ADMISSIONS) private readonly deps: AdmissionsDeps) {}

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

  @Get('applications/:id')
  detail(@Param('id') id: string, @Req() req: AuthedRequest) {
    return applicationDetail(this.deps, actorOf(req), Id.parse(id));
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
