import {
  AssignAccessInput,
  EndAccessInput,
  ExportRecord,
  FieldDefinitionInput,
  FieldEntity,
  FieldOrderInput,
  FieldRetireInput,
  FieldUpdateInput,
  GrantDecisionInput,
  Id,
  RoleCreateInput,
  RoleNameInput,
  RolePermissionsInput,
  CaseGrantInput,
  ExplainAccessInput,
} from '@campusverse/contracts';
import { withTenant, type Db } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import {
  AREAS,
  CATALOGUE,
  accessOf,
  accessOverview,
  assignAccess,
  caseGrants,
  createRole,
  dataClassOf,
  decideGrant,
  endAccess,
  endCase,
  explainAccess,
  grantCase,
  renameRole,
  setRolePermissions,
} from '@campusverse/platform-access';
import {
  activityLog,
  auditTrail,
  recordExport,
  recordStamps,
  sealAuditLog,
  verifyAuditLog,
} from '@campusverse/platform-audit';
import { z } from 'zod';
import {
  defineField,
  listFields,
  orderFields,
  retireField,
  updateField,
} from '@campusverse/platform-fields';
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
import { DB, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const LogFilter = z.object({
  before: Id.optional(),
  dataClass: z.enum(['operational', 'personal', 'sensitive', 'restricted']).optional(),
  actor: Id.optional(),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Owner-defined fields: anyone signed in reads the definitions (forms need them); owners edit. */
@Controller('fields')
@UseGuards(ActorGuard)
export class FieldsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
  ) {}

  @Get(':entity')
  list(
    @Param('entity') entity: string,
    @Query('retired') retired: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return withTenant(this.db, actorOf(req).orgId, (tx) =>
      listFields(tx, FieldEntity.parse(entity), { includeRetired: retired === '1' }),
    );
  }

  @Post(':entity')
  async define(@Param('entity') entity: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = FieldDefinitionInput.parse(body);
    return {
      id: await defineField(this.db, this.permissions, actorOf(req), FieldEntity.parse(entity), {
        label: input.label,
        type: input.type,
        help: input.help ?? null,
        options: input.options ?? [],
        required: input.required ?? false,
        section: input.section ?? null,
      }),
    };
  }

  @Post(':entity/order')
  @HttpCode(204)
  async order(@Param('entity') entity: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { ids } = FieldOrderInput.parse(body);
    await orderFields(this.db, this.permissions, actorOf(req), FieldEntity.parse(entity), ids);
  }

  @Post('item/:id')
  @HttpCode(204)
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = FieldUpdateInput.parse(body);
    await updateField(this.db, this.permissions, actorOf(req), Id.parse(id), {
      label: input.label,
      help: input.help ?? null,
      options: input.options ?? [],
      required: input.required ?? false,
      section: input.section ?? null,
    });
  }

  @Post('item/:id/retire')
  @HttpCode(204)
  async retire(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { retired } = FieldRetireInput.parse(body);
    await retireField(this.db, this.permissions, actorOf(req), Id.parse(id), retired);
  }
}

/** Roles, grants waiting for a second owner, and who holds what where. */
@Controller('access')
@UseGuards(ActorGuard)
export class AccessController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
  ) {}

  private names(orgId: string, ids: (string | null)[]) {
    return withTenant(this.db, orgId, (tx) =>
      displayNames(
        tx,
        ids.filter((x): x is string => !!x),
      ),
    );
  }

  @Get('roles')
  async roles(@Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const view = await accessOverview(this.db, this.permissions, actor);
    return {
      ...view,
      me: actor.personId,
      areas: AREAS,
      catalogue: CATALOGUE,
      // Rule book §10.3: what kind of data each permission reaches.
      classes: Object.fromEntries(Object.keys(CATALOGUE).map((p) => [p, dataClassOf(p)])),
      names: await this.names(actor.orgId, [
        ...view.owners,
        ...view.requests.flatMap((r) => [r.requestedBy, r.decidedBy]),
      ]),
    };
  }

  @Post('roles')
  createRole(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = RoleCreateInput.parse(body);
    return createRole(this.db, this.permissions, actorOf(req), {
      name: input.name,
      copyFrom: input.copyFrom ?? null,
    });
  }

  @Post('roles/:id/name')
  @HttpCode(204)
  async rename(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await renameRole(
      this.db,
      this.permissions,
      actorOf(req),
      Id.parse(id),
      RoleNameInput.parse(body).name,
    );
  }

  @Post('roles/:id/permissions')
  setPermissions(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { permissions } = RolePermissionsInput.parse(body);
    return setRolePermissions(this.db, this.permissions, actorOf(req), Id.parse(id), permissions);
  }

  @Post('requests/:id')
  @HttpCode(204)
  async decide(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = GrantDecisionInput.parse(body);
    await decideGrant(this.db, this.permissions, actorOf(req), Id.parse(id), {
      decision: input.decision,
      reason: input.reason ?? null,
    });
  }

  @Get('people')
  async people(@Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const assignments = await accessOf(this.db, this.permissions, actor);
    return {
      assignments,
      names: await this.names(
        actor.orgId,
        assignments.map((a) => a.personId),
      ),
    };
  }

  @Post('assignments')
  async assign(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = AssignAccessInput.parse(body);
    return { id: await assignAccess(this.db, this.permissions, actorOf(req), input) };
  }

  @Post('assignments/:id/end')
  @HttpCode(204)
  async end(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { lastDay } = EndAccessInput.parse(body);
    await endAccess(this.db, this.permissions, actorOf(req), Id.parse(id), lastDay);
  }

  // Case grants and the access explainer (rule book §10.3) ---------------------------------------

  @Get('cases')
  cases(@Req() req: AuthedRequest) {
    return caseGrants({ db: this.db, permissions: this.permissions }, actorOf(req));
  }

  @Post('cases')
  async grant(@Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await grantCase(
        { db: this.db, permissions: this.permissions },
        actorOf(req),
        CaseGrantInput.parse(body),
      ),
    };
  }

  @Post('cases/:id/end')
  @HttpCode(204)
  async endCase(@Param('id') id: string, @Req() req: AuthedRequest) {
    await endCase({ db: this.db, permissions: this.permissions }, actorOf(req), Id.parse(id));
  }

  @Post('explain')
  explain(@Body() body: unknown, @Req() req: AuthedRequest) {
    return explainAccess(
      { db: this.db, permissions: this.permissions },
      actorOf(req),
      ExplainAccessInput.parse(body),
    );
  }
}

/**
 * Who did what to a record. Stamps (created and last changed by) show to staff on any record
 * they can open; the full History needs platform.activity.read. Names are resolved here, so
 * audit rows keep ids only.
 */
@Controller('activity')
@UseGuards(ActorGuard)
export class ActivityController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
  ) {}

  @Get('stamps')
  stamps(@Query('ids') ids: string | undefined, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const list = (ids ?? '')
      .split(',')
      .filter(Boolean)
      .slice(0, 100)
      .map((x) => Id.parse(x));
    return withTenant(this.db, actor.orgId, async (tx) => {
      const staff = await this.permissions.can(tx, actor, 'people.staff.read', {
        orgId: actor.orgId,
      });
      const owner = await this.permissions.can(tx, actor, 'platform.activity.read', {
        orgId: actor.orgId,
      });
      if (!staff.allowed && !owner.allowed) return { stamps: {}, names: {} };
      const stamps = await recordStamps(tx, list);
      const people = Object.values(stamps).flatMap((s) => [s.createdBy, s.changedBy]);
      return {
        stamps,
        names: await displayNames(
          tx,
          people.filter((x): x is string => !!x),
        ),
      };
    });
  }

  /** Called by the web before a list downloads, so the log shows who took which list. */
  @Post('exports')
  @HttpCode(204)
  async exported(@Body() body: unknown, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const input = ExportRecord.parse(body);
    await withTenant(this.db, actor.orgId, (tx) => recordExport(tx, actor, input));
  }

  /** The organisation's activity log (Campus Core › Activity Log), newest first, 50 at a time. */
  @Get('log')
  log(
    @Query('before') before: string | undefined,
    @Query('dataClass') dataClass: string | undefined,
    @Query('actor') actor: string | undefined,
    @Query('day') day: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    const a = actorOf(req);
    const filter = LogFilter.parse({ before, dataClass, actor, day });
    return withTenant(this.db, a.orgId, async (tx) => {
      await this.permissions.assertCan(tx, a, 'platform.activity.read', { orgId: a.orgId });
      // Opening the log seals what's new since the last seal (tamper evidence, rule book §13.12).
      if (!filter.before) await sealAuditLog(tx);
      const entries = await activityLog(tx, {
        before: filter.before ?? null,
        dataClass: filter.dataClass ?? null,
        actorPersonId: filter.actor ?? null,
        onOrBefore: filter.day ?? null,
      });
      return {
        entries,
        names: await displayNames(
          tx,
          entries.map((e) => e.actorPersonId).filter((x): x is string => !!x),
        ),
        next: entries.length === 50 ? (entries.at(-1)?.id ?? null) : null,
      };
    });
  }

  /** Recomputes the log's hash chain and compares every seal. */
  @Get('verify')
  verify(@Req() req: AuthedRequest) {
    const a = actorOf(req);
    return withTenant(this.db, a.orgId, async (tx) => {
      await this.permissions.assertCan(tx, a, 'platform.activity.read', { orgId: a.orgId });
      return verifyAuditLog(tx);
    });
  }

  @Get(':id')
  history(@Param('id') id: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    return withTenant(this.db, actor.orgId, async (tx) => {
      await this.permissions.assertCan(tx, actor, 'platform.activity.read', { orgId: actor.orgId });
      const trail = await auditTrail(tx, Id.parse(id), 100);
      return {
        trail,
        names: await displayNames(
          tx,
          trail.map((e) => e.actorPersonId).filter((x): x is string => !!x),
        ),
      };
    });
  }
}
