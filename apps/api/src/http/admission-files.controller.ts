import { ApplicantDocumentMeta, DocumentCheckInput, Id } from '@campusverse/contracts';
import { withTenant, type Db } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import {
  FileRefused,
  cleanFileBytes,
  storeFile,
  type ObjectStore,
} from '@campusverse/platform-documents';
import type { Actor } from '@campusverse/platform-permissions';
import {
  addApplicationDocument,
  applicationCheck,
  applicationDocuments,
  applicationPhoto,
  checkApplicationDocument,
  openApplicationDocument,
  setApplicationPhoto,
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
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  ADMISSIONS,
  DB,
  PERMISSIONS,
  STORE,
  type AuthedRequest,
  type Permissions,
} from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};
const IMAGES = new Set(['image/jpeg', 'image/png']);
const DOCUMENTS = new Set(['application/pdf', 'image/jpeg', 'image/png']);

/** An applicant's photo and papers (Milestone 21); they move to the student's record on enrolment. */
@Controller('school/admissions/applications')
@UseGuards(ActorGuard)
export class AdmissionFilesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
    @Inject(STORE) private readonly store: ObjectStore,
    @Inject(ADMISSIONS) private readonly deps: AdmissionsDeps,
  ) {}

  private async send(reply: FastifyReply, orgId: string, fileId: string | null, inline = false) {
    if (!fileId) throw new NotFoundException({ code: 'no_file' });
    const f = await cleanFileBytes(this.db, this.store, orgId, fileId).catch(() => null);
    if (!f) throw new NotFoundException({ code: 'file_not_ready' });
    if (inline)
      reply.header(
        'content-disposition',
        `inline; filename="${f.fileName.replace(/[^\w.\- ]/g, '_')}"`,
      );
    await reply
      .header('content-type', f.contentType)
      .header('cache-control', inline ? 'private, no-store' : 'private, max-age=300')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(f.bytes));
  }

  @Get(':id/documents')
  async documents(@Param('id') id: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const documents = await applicationDocuments(this.deps, actor, Id.parse(id));
    const ids = documents
      .flatMap((d) => [d.uploadedBy, d.checkedBy])
      .filter((x): x is string => !!x);
    return {
      documents,
      names: await withTenant(this.db, actor.orgId, (tx) => displayNames(tx, ids)),
    };
  }

  /** Multipart: folder, kind and title before the file. */
  @Post(':id/documents')
  async add(@Param('id') id: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const applicationId = Id.parse(id);
    const file = await req.file();
    if (!file) throw new BadRequestException({ code: 'file_missing' });
    const field = (k: string) => {
      const f = file.fields[k];
      return f && !Array.isArray(f) && 'value' in f ? String(f.value) : undefined;
    };
    const meta = ApplicantDocumentMeta.parse({
      folder: field('folder'),
      kind: field('kind'),
      title: field('title'),
    });
    if (!DOCUMENTS.has(file.mimetype)) throw new FileRefused('file_type');
    const check = await applicationCheck(this.deps, actor, applicationId);
    const fileId = await storeFile(this.db, this.permissions, this.store, actor, check, {
      purpose: 'document',
      fileName: file.filename,
      contentType: file.mimetype,
      bytes: new Uint8Array(await file.toBuffer()),
    });
    return {
      documentId: await addApplicationDocument(this.deps, actor, applicationId, {
        ...meta,
        fileId,
      }),
    };
  }

  @Post('documents/:id/check')
  @HttpCode(204)
  async check(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const i = DocumentCheckInput.parse(body);
    await checkApplicationDocument(this.deps, actorOf(req), Id.parse(id), {
      status: i.status,
      note: i.note ?? null,
    });
  }

  @Get('documents/:id/file')
  async file(@Param('id') id: string, @Req() req: AuthedRequest, @Res() reply: FastifyReply) {
    const actor = actorOf(req);
    const { fileId } = await openApplicationDocument(this.deps, actor, Id.parse(id));
    await this.send(reply, actor.orgId, fileId, true);
  }

  @Post(':id/photo')
  async uploadPhoto(@Param('id') id: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const applicationId = Id.parse(id);
    const file = await req.file();
    if (!file) throw new BadRequestException({ code: 'file_missing' });
    if (!IMAGES.has(file.mimetype)) throw new FileRefused('file_type');
    const check = await applicationCheck(this.deps, actor, applicationId);
    const fileId = await storeFile(this.db, this.permissions, this.store, actor, check, {
      purpose: 'photo',
      fileName: file.filename,
      contentType: file.mimetype,
      bytes: new Uint8Array(await file.toBuffer()),
    });
    await setApplicationPhoto(this.deps, actor, applicationId, fileId);
    return { fileId };
  }

  @Get(':id/photo')
  async photo(@Param('id') id: string, @Req() req: AuthedRequest, @Res() reply: FastifyReply) {
    const actor = actorOf(req);
    await this.send(reply, actor.orgId, await applicationPhoto(this.deps, actor, Id.parse(id)));
  }
}
