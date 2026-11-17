import {
  DiaryEdit,
  DiaryInput,
  HomeworkDoneInput,
  HomeworkEdit,
  HomeworkInput,
  Id,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import {
  FileRefused,
  cleanFileBytes,
  cleanFileLink,
  storeFile,
  type ObjectStore,
} from '@campusverse/platform-documents';
import type { Actor } from '@campusverse/platform-permissions';
import {
  childHomework,
  editDiary,
  editHomework,
  homeworkFile,
  homeworkUploadCheck,
  markDone,
  myClasses,
  sectionHomework,
  setHomework,
  withdrawHomework,
  writeDiary,
  type HomeworkDeps,
} from '@campusverse/school-homework';
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
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { DB, PERMISSIONS, STORE, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};
const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

/** Homework and the class diary (docs/specs/HOMEWORK.md), for staff and for guardians. */
@Controller('school/homework')
@UseGuards(ActorGuard)
export class HomeworkController {
  private readonly deps: HomeworkDeps;
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
    @Inject(STORE) private readonly store: ObjectStore,
  ) {
    this.deps = { db, permissions };
  }

  @Get('classes')
  classes(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return myClasses(this.deps, actorOf(req), Id.parse(institutionId));
  }

  @Get('sections/:id')
  section(@Param('id') id: string, @Req() req: AuthedRequest) {
    return sectionHomework(this.deps, actorOf(req), Id.parse(id));
  }

  /** Multipart: one photo or PDF, before the homework is saved. Returns its file id. */
  @Post('files')
  async upload(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const file = await req.file();
    if (!file) throw new BadRequestException({ code: 'file_missing' });
    if (!FILE_TYPES.has(file.mimetype)) throw new FileRefused('file_type');
    const check = await homeworkUploadCheck(this.deps, actor, Id.parse(institutionId));
    const fileId = await storeFile(this.db, this.permissions, this.store, actor, check, {
      purpose: 'homework',
      fileName: file.filename,
      contentType: file.mimetype,
      bytes: new Uint8Array(await file.toBuffer()),
    });
    return { fileId, fileName: file.filename, contentType: file.mimetype };
  }

  @Post()
  set(@Body() body: unknown, @Req() req: AuthedRequest) {
    return setHomework(this.deps, actorOf(req), HomeworkInput.parse(body));
  }

  @Put(':id')
  edit(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return editHomework(this.deps, actorOf(req), {
      homeworkId: Id.parse(id),
      ...HomeworkEdit.parse(body),
    });
  }

  @Post(':id/withdraw')
  @HttpCode(204)
  async withdraw(@Param('id') id: string, @Req() req: AuthedRequest) {
    await withdrawHomework(this.deps, actorOf(req), Id.parse(id));
  }

  /** Opens an attachment; a guardian passes the child (`studentId`). A file still being scanned is a 404. */
  @Get(':id/files/:fileId')
  async file(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Query('studentId') studentId: string | undefined,
    @Req() req: AuthedRequest,
    @Res() reply: FastifyReply,
  ) {
    const actor = actorOf(req);
    const allowed = await homeworkFile(this.deps, actor, {
      homeworkId: Id.parse(id),
      fileId: Id.parse(fileId),
      studentId: studentId ? Id.parse(studentId) : undefined,
    });
    const f = await cleanFileBytes(this.db, this.store, actor.orgId, allowed).catch(() => null);
    if (!f) throw new NotFoundException({ code: 'file_not_ready' });
    const name = f.fileName.replace(/[^\w.\- ]/g, '_');
    await reply
      .header('content-type', f.contentType)
      .header('content-disposition', `inline; filename="${name}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(f.bytes));
  }

  /** A five-minute link to an attachment, for the app (a guardian passes the child). */
  @Get(':id/files/:fileId/link')
  async fileLink(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Query('studentId') studentId: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    const actor = actorOf(req);
    const allowed = await homeworkFile(this.deps, actor, {
      homeworkId: Id.parse(id),
      fileId: Id.parse(fileId),
      studentId: studentId ? Id.parse(studentId) : undefined,
    });
    const url = await cleanFileLink(this.db, this.store, actor.orgId, allowed).catch(() => null);
    if (!url) throw new NotFoundException({ code: 'file_not_ready' });
    return { url };
  }

  @Post('diary')
  diary(@Body() body: unknown, @Req() req: AuthedRequest) {
    return writeDiary(this.deps, actorOf(req), DiaryInput.parse(body));
  }

  @Put('diary/:id')
  @HttpCode(204)
  async editEntry(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await editDiary(this.deps, actorOf(req), { entryId: Id.parse(id), ...DiaryEdit.parse(body) });
  }

  /** A guardian's view of one child. */
  @Get('children/:id')
  child(@Param('id') id: string, @Req() req: AuthedRequest) {
    return childHomework(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':id/children/:studentId/done')
  @HttpCode(204)
  async done(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await markDone(this.deps, actorOf(req), {
      homeworkId: Id.parse(id),
      studentId: Id.parse(studentId),
      ...HomeworkDoneInput.parse(body),
    });
  }
}
