import {
  CampusChange,
  Id,
  MyProfileChange,
  NewCampus,
  NewSchool,
  OrganisationChange,
  ViewChoice,
} from '@campusverse/contracts';
import { withTenant, type Db } from '@campusverse/db';
import {
  myProfile,
  photoCheck,
  photoOf,
  setPhoto,
  updateMyProfile,
  type PeopleDeps,
} from '@campusverse/people-records';
import {
  FileRefused,
  cleanFileBytes,
  fileState,
  storeFile,
  type ObjectStore,
} from '@campusverse/platform-documents';
import {
  addCampus,
  addInstitution,
  brandFiles,
  myView,
  organisationProfile,
  saveView,
  setCampusPhoto,
  setOrganisationLogo,
  updateCampus,
  updateOrganisation,
} from '@campusverse/platform-organisation';
import type { Actor, Resource } from '@campusverse/platform-permissions';
import { institutionImage, setInstitutionImage } from '@campusverse/school-setup';
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
import { sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { DB, PEOPLE, PERMISSIONS, STORE, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

const IMAGES = new Set(['image/jpeg', 'image/png']);

/** Photos, logos, the organisation and campuses, and one's own profile (Milestone 19). */
@Controller()
@UseGuards(ActorGuard)
export class ProfilesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
    @Inject(STORE) private readonly store: ObjectStore,
    @Inject(PEOPLE) private readonly people: PeopleDeps,
  ) {}

  /** One image from a multipart upload, stored under the given permission check. */
  private async image(
    req: AuthedRequest,
    purpose: string,
    check: { permission: string; resource: Resource },
  ): Promise<string> {
    const file = await req.file();
    if (!file) throw new BadRequestException({ code: 'file_missing' });
    if (!IMAGES.has(file.mimetype)) throw new FileRefused('file_type');
    return storeFile(this.db, this.permissions, this.store, actorOf(req), check, {
      purpose,
      fileName: file.filename,
      contentType: file.mimetype,
      bytes: new Uint8Array(await file.toBuffer()),
    });
  }

  /** Sends a clean image; a file still being scanned is a 404 the screen retries. */
  private async send(reply: FastifyReply, orgId: string, fileId: string | null) {
    if (!fileId) throw new NotFoundException({ code: 'no_image' });
    const f = await cleanFileBytes(this.db, this.store, orgId, fileId).catch(() => null);
    if (!f) throw new NotFoundException({ code: 'file_not_ready' });
    await reply
      .header('content-type', f.contentType)
      .header('cache-control', 'private, max-age=300')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(f.bytes));
  }

  @Get('files/:id/state')
  async state(@Param('id') id: string, @Req() req: AuthedRequest) {
    const state = await withTenant(this.db, actorOf(req).orgId, (tx) =>
      fileState(tx, Id.parse(id)),
    );
    if (!state) throw new NotFoundException({ code: 'file_not_found' });
    return { state };
  }

  // People's photos ---------------------------------------------------------------------------

  @Post('people/:id/photo')
  async uploadPhoto(@Param('id') id: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const personId = id === 'me' ? actor.personId : Id.parse(id);
    const check = await photoCheck(this.people, actor, personId, 'change');
    if (check === 'self') throw new Error('unreachable');
    const fileId = await this.image(req, 'photo', check);
    await setPhoto(this.people, actor, personId, fileId);
    return { fileId };
  }

  @Post('people/:id/photo/remove')
  @HttpCode(204)
  async removePhoto(@Param('id') id: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    await setPhoto(this.people, actor, id === 'me' ? actor.personId : Id.parse(id), null);
  }

  @Get('people/:id/photo')
  async photo(@Param('id') id: string, @Req() req: AuthedRequest, @Res() reply: FastifyReply) {
    const actor = actorOf(req);
    const fileId = await photoOf(this.people, actor, id === 'me' ? actor.personId : Id.parse(id));
    await this.send(reply, actor.orgId, fileId);
  }

  @Get('people/me/profile')
  me(@Req() req: AuthedRequest) {
    return myProfile(this.people, actorOf(req));
  }

  @Post('people/me/profile')
  @HttpCode(204)
  async updateMe(@Body() body: unknown, @Req() req: AuthedRequest) {
    const change = MyProfileChange.parse(body);
    await updateMyProfile(this.people, actorOf(req), {
      ...(change.email !== undefined ? { email: change.email } : {}),
      ...(change.preferredLanguage ? { preferredLanguage: change.preferredLanguage } : {}),
    });
  }

  // The organisation and campuses --------------------------------------------------------------

  /** The person's view: what they may look at, and what they chose. */
  @Get('organisation/view')
  view(@Req() req: AuthedRequest) {
    return myView(this.db, actorOf(req));
  }

  @Post('organisation/view')
  @HttpCode(200)
  setView(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveView(this.db, actorOf(req), ViewChoice.parse(body));
  }

  @Get('organisation/profile')
  organisation(@Req() req: AuthedRequest) {
    return organisationProfile(this.db, this.permissions, actorOf(req));
  }

  @Post('organisation/profile')
  @HttpCode(204)
  async updateOrganisation(@Body() body: unknown, @Req() req: AuthedRequest) {
    await updateOrganisation(
      this.db,
      this.permissions,
      actorOf(req),
      OrganisationChange.parse(body),
    );
  }

  /** Which logo and photo files are current: for the sidebar, documents and campus cards. */
  @Get('organisation/brand')
  brand(@Req() req: AuthedRequest) {
    return withTenant(this.db, actorOf(req).orgId, (tx) => brandFiles(tx));
  }

  @Post('organisation/logo')
  async uploadLogo(@Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const fileId = await this.image(req, 'logo', {
      permission: 'platform.organisation.manage',
      resource: { orgId: actor.orgId },
    });
    await setOrganisationLogo(this.db, this.permissions, actor, fileId);
    return { fileId };
  }

  @Get('organisation/logo')
  async logo(@Req() req: AuthedRequest, @Res() reply: FastifyReply) {
    const actor = actorOf(req);
    const files = await withTenant(this.db, actor.orgId, (tx) => brandFiles(tx));
    await this.send(reply, actor.orgId, files.organisation);
  }

  @Post('organisation/campuses')
  async addCampus(@Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      campusId: await addCampus(this.db, this.permissions, actorOf(req), NewCampus.parse(body)),
    };
  }

  @Post('organisation/campuses/:id')
  @HttpCode(204)
  async updateCampus(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await updateCampus(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(id),
      CampusChange.parse(body),
    );
  }

  @Post('organisation/campuses/:id/photo')
  async uploadCampusPhoto(@Param('id') id: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const fileId = await this.image(req, 'photo', {
      permission: 'platform.organisation.manage',
      resource: { orgId: actor.orgId },
    });
    await setCampusPhoto(this.db, this.permissions, actor, Id.parse(id), fileId);
    return { fileId };
  }

  @Get('organisation/campuses/:id/photo')
  async campusPhoto(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
    @Res() reply: FastifyReply,
  ) {
    const actor = actorOf(req);
    const files = await withTenant(this.db, actor.orgId, (tx) => brandFiles(tx));
    await this.send(reply, actor.orgId, files.campuses[Id.parse(id)] ?? null);
  }

  @Post('organisation/campuses/:id/institutions')
  async addSchool(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = NewSchool.parse(body);
    return {
      institutionId: await addInstitution(
        this.db,
        this.permissions,
        actorOf(req),
        Id.parse(id),
        input.profile === 'school'
          ? {
              profile: 'school',
              name: input.name,
              authorityCode: input.authorityCode,
              lowestClass: input.lowestClass ?? null,
              highestClass: input.highestClass ?? null,
            }
          : { profile: input.profile, name: input.name, authorityCode: input.authorityCode },
      ),
    };
  }

  // The school's logo and the principal's signature -----------------------------------------------

  @Post('school/setup/:id/logo')
  uploadSchoolLogo(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.uploadSchoolImage(id, 'logo', req);
  }

  @Post('school/setup/:id/signature')
  uploadSignature(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.uploadSchoolImage(id, 'signature', req);
  }

  @Get('school/setup/:id/logo')
  schoolLogo(@Param('id') id: string, @Req() req: AuthedRequest, @Res() reply: FastifyReply) {
    return this.schoolImage(id, 'logo', req, reply);
  }

  @Get('school/setup/:id/signature')
  signature(@Param('id') id: string, @Req() req: AuthedRequest, @Res() reply: FastifyReply) {
    return this.schoolImage(id, 'signature', req, reply);
  }

  private async uploadSchoolImage(id: string, kind: 'logo' | 'signature', req: AuthedRequest) {
    const actor = actorOf(req);
    const institutionId = Id.parse(id);
    const place = await withTenant(this.db, actor.orgId, async (tx) => {
      const [row] = await tx.execute<{ campusId: string }>(sqlCampus(institutionId));
      return row ? { campusId: row.campusId, institutionId } : null;
    });
    if (!place) throw new NotFoundException({ code: 'institution_not_found' });
    const fileId = await this.image(req, kind, {
      permission: 'school.setup.manage',
      resource: { orgId: actor.orgId, place },
    });
    await setInstitutionImage(this.db, this.permissions, actor, institutionId, kind, fileId);
    return { fileId };
  }

  private async schoolImage(
    id: string,
    kind: 'logo' | 'signature',
    req: AuthedRequest,
    reply: FastifyReply,
  ) {
    const actor = actorOf(req);
    const fileId = await institutionImage(this.db, this.permissions, actor, Id.parse(id), kind);
    await this.send(reply, actor.orgId, fileId);
  }
}

const sqlCampus = (institutionId: string) => sql`
  select campus_id::text as "campusId" from institution
  where org_id = app_current_org() and id = ${institutionId}`;
