import { z } from 'zod';
import { withTenant } from '@campusverse/db';
import { organisationTree } from '@campusverse/platform-organisation';
import {
  Id,
  ImportKind,
  NewSubject,
  OfferingInput,
  SchoolProfileChange,
  StructureInput,
  SubjectChange,
  TeacherInput,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  addSubject,
  applyStructure,
  classesOverview,
  closeYear,
  reopenYear,
  setUpNextYear,
  assignTeacher,
  setOffering,
  subjectsOverview,
  updateSubject,
  commitImport,
  getImport,
  importTemplate,
  listInstitutions,
  planStructure,
  previewImport,
  previewInvites,
  schoolProfile,
  sendInvites,
  setupOverview,
  setupReadiness,
  undoImport,
  updateSchoolProfile,
} from '@campusverse/school-setup';
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
import { DB, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/**
 * The setup wizard's steps. Bulk writes follow preview → commit → status: commits return 202
 * and a worker applies them; the client polls the import.
 */
@Controller('school/setup')
@UseGuards(ActorGuard)
export class SetupController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
  ) {}

  @Get('institutions')
  institutions(@Req() req: AuthedRequest) {
    return listInstitutions(this.db, actorOf(req));
  }

  @Get(':institutionId/profile')
  profile(@Param('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return schoolProfile(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Post(':institutionId/profile')
  @HttpCode(204)
  async updateProfile(
    @Param('institutionId') institutionId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await updateSchoolProfile(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(institutionId),
      SchoolProfileChange.parse(body),
    );
  }

  @Get(':institutionId/classes')
  classes(@Param('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return classesOverview(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Get(':institutionId/subjects')
  subjects(@Param('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return subjectsOverview(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Post(':institutionId/subjects')
  async addSubject(
    @Param('institutionId') institutionId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return {
      subjectId: await addSubject(
        this.db,
        this.permissions,
        actorOf(req),
        Id.parse(institutionId),
        NewSubject.parse(body),
      ),
    };
  }

  @Post(':institutionId/subjects/:subjectId')
  @HttpCode(204)
  async updateSubject(
    @Param('institutionId') institutionId: string,
    @Param('subjectId') subjectId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const c = SubjectChange.parse(body);
    await updateSubject(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(institutionId),
      Id.parse(subjectId),
      {
        name: c.name,
        kind: c.kind,
        retired: c.retired,
      },
    );
  }

  @Post(':institutionId/offerings')
  @HttpCode(204)
  async offering(
    @Param('institutionId') institutionId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await setOffering(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(institutionId),
      OfferingInput.parse(body),
    );
  }

  @Post(':institutionId/teachers')
  @HttpCode(204)
  async teacher(
    @Param('institutionId') institutionId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await assignTeacher(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(institutionId),
      TeacherInput.parse(body),
    );
  }

  /** The organisation, its campuses and their institutions: the scope switcher. */
  @Get('tree')
  tree(@Req() req: AuthedRequest) {
    return withTenant(this.db, actorOf(req).orgId, (tx) => organisationTree(tx));
  }

  @Get(':institutionId')
  overview(@Param('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return setupOverview(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  /** Pure preview of the year, classes, sections and subjects. Nothing is written. */
  @Post(':institutionId/structure/preview')
  @HttpCode(200)
  previewStructure(@Body() body: unknown) {
    return planStructure(StructureInput.parse(body));
  }

  @Post(':institutionId/structure')
  async applyStructure(
    @Param('institutionId') institutionId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const { yearId, plan } = await applyStructure(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(institutionId),
      StructureInput.parse(body),
    );
    return { yearId, totals: plan.totals };
  }

  /** Locks an ended year: attendance, marks and subject teachers can no longer change. */
  @Post(':institutionId/years/:yearId/close')
  @HttpCode(204)
  async closeYear(
    @Param('institutionId') institutionId: string,
    @Param('yearId') yearId: string,
    @Req() req: AuthedRequest,
  ) {
    await closeYear(this.db, this.permissions, actorOf(req), {
      institutionId: Id.parse(institutionId),
      yearId: Id.parse(yearId),
    });
  }

  @Post(':institutionId/years/:yearId/reopen')
  @HttpCode(204)
  async reopenYear(
    @Param('institutionId') institutionId: string,
    @Param('yearId') yearId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await reopenYear(this.db, this.permissions, actorOf(req), {
      institutionId: Id.parse(institutionId),
      yearId: Id.parse(yearId),
      reason: z.object({ reason: z.string().max(300) }).parse(body).reason,
    });
  }

  /** Year end: the next year with this year's classes, sections and subjects. */
  @Post(':institutionId/next-year')
  nextYear(@Param('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return setUpNextYear(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  /** Multipart upload of one .xlsx file (field "file"). Returns the preview. */
  @Post(':institutionId/imports/:kind')
  async previewImport(
    @Param('institutionId') institutionId: string,
    @Param('kind') kind: string,
    @Query('source') source: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    const file = await req.file();
    if (!file) throw new BadRequestException({ code: 'file_missing' });
    return previewImport(this.db, this.permissions, actorOf(req), {
      institutionId: Id.parse(institutionId),
      kind: ImportKind.parse(kind),
      fileName: file.filename.slice(0, 200) || 'upload.xlsx',
      bytes: await file.toBuffer(),
      source: source === 'v1' ? 'v1' : 'xlsx',
    });
  }

  @Get('imports/:batchId')
  async getImport(@Param('batchId') batchId: string, @Req() req: AuthedRequest) {
    const batch = await getImport(this.db, this.permissions, actorOf(req), Id.parse(batchId));
    if (!batch) throw new NotFoundException({ code: 'import_not_found' });
    return batch;
  }

  @Post('imports/:batchId/commit')
  @HttpCode(202)
  async commit(@Param('batchId') batchId: string, @Req() req: AuthedRequest) {
    await commitImport(this.db, this.permissions, actorOf(req), Id.parse(batchId));
    return { status: 'committing' };
  }

  @Post('imports/:batchId/undo')
  @HttpCode(200)
  async undo(@Param('batchId') batchId: string, @Req() req: AuthedRequest) {
    await undoImport(this.db, this.permissions, actorOf(req), Id.parse(batchId));
    return { status: 'undone' };
  }

  @Get(':institutionId/invites')
  invites(@Param('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return previewInvites(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Post(':institutionId/invites')
  @HttpCode(202)
  async sendInvites(@Param('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    await sendInvites(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
    return { status: 'sending' };
  }

  @Get(':institutionId/readiness')
  readiness(@Param('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return setupReadiness(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Get('templates/:kind')
  async template(@Param('kind') kind: string, @Res() reply: FastifyReply) {
    const k = ImportKind.parse(kind);
    await reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="campus-verse-${k}.xlsx"`)
      .send(await importTemplate(k));
  }
}
