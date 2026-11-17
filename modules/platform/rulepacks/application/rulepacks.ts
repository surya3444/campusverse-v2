// Campus Core › Rule Packs (rule book §15.1, §12.4 decision 11): the catalogue Campusverse staff
// keep (draft, test, release by a second person) and each institution's switch to a version from
// a date. Modules ask `packFor` for the payload in force at an institution on a date; version 1
// of every pack is built into packages/rules, so nothing breaks before anyone releases a version.
import type { Db, Tx } from '@campusverse/db';
import { withTenant } from '@campusverse/db';
import { ControlError, controlStep, staffCan, type Staff } from '@campusverse/platform-control';
import { command } from '@campusverse/platform-events';
import { institutionInfo } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import {
  PACKS,
  isPackCode,
  packsFor,
  runPackTests,
  validatePack,
  type BoardPack,
  type CourseAttendanceRules,
  type CreditFramework,
  type CreditsPack,
  type GradingRules,
  type GratuityRules,
  type LabourPack,
  type PackCode,
  type PackKind,
  type PackTest,
  type PayrollRules,
  type Source,
  type StatePack,
} from '@campusverse/rules';
import { sql } from 'drizzle-orm';

type Permissions = ReturnType<typeof createPermissions>;
export type RulePackDeps = { db: Db; permissions: Permissions };
export const PACK_ADOPTED = 'platform.rules.adopted.v1';

export type RulePackErrorCode =
  | 'unknown_pack'
  | 'institution_not_found'
  | 'pack_not_for_institution'
  | 'version_not_found'
  | 'before_effective';

export class RulePackError extends Error {
  constructor(readonly code: RulePackErrorCode) {
    super(`rule packs: ${code}`);
    this.name = 'RulePackError';
  }
}

type Resolved = {
  pack: PackCode;
  version: number;
  effectiveFrom: string;
  payload: unknown;
  sources: Source[];
  notes: string;
  builtin: boolean;
  /** From when this institution follows it; null for the built-in version nobody switched to. */
  fromDate: string | null;
};

async function released(tx: Tx, pack: PackCode, version: number) {
  if (version === 1) return null;
  const [v] = await tx.execute<{
    effectiveFrom: string;
    payload: unknown;
    sources: Source[];
    notes: string;
  }>(sql`
    select effective_from::text as "effectiveFrom", payload, sources, notes
    from control.rule_pack_version where pack = ${pack} and version = ${version} and status = 'released'`);
  return v ?? null;
}

/**
 * The version of a pack an institution follows on a date, with its payload: the latest switch
 * on or before that date, else the built-in version 1. Call inside the tenant.
 */
export async function packFor(
  tx: Tx,
  institutionId: string,
  pack: PackCode,
  on: string,
): Promise<Resolved> {
  const [a] = await tx.execute<{ version: number; fromDate: string }>(sql`
    select version, from_date::text as "fromDate" from rule_pack_adoption
    where org_id = app_current_org() and institution_id = ${institutionId} and pack = ${pack}
      and from_date <= ${on}::date
    order by from_date desc, id desc limit 1`);
  const v = a ? await released(tx, pack, a.version) : null;
  if (a && v) return { pack, version: a.version, ...v, builtin: false, fromDate: a.fromDate };
  const b = PACKS[pack].builtin;
  return {
    pack,
    version: 1,
    effectiveFrom: b.effectiveFrom,
    payload: b.payload,
    sources: b.sources,
    notes: b.notes,
    builtin: true,
    fromDate: a?.fromDate ?? null,
  };
}

/** PF, ESI and the state's professional tax in force at an institution on a date. */
export async function payrollRulesAt(
  tx: Tx,
  institutionId: string,
  on: string,
): Promise<PayrollRules> {
  const i = await institutionInfo(tx, institutionId);
  const labour = await packFor(tx, institutionId, 'labour.central', on);
  const state = `state.${i?.stateCode ?? ''}`;
  const st = isPackCode(state) ? await packFor(tx, institutionId, state, on) : null;
  const l = labour.payload as LabourPack;
  const sp = st ? (st.payload as StatePack) : null;
  // A version released before LWF was in the pack leaves it undefined: the built-in values stand in.
  const lwf =
    !st || !sp
      ? null
      : sp.lwf !== undefined
        ? sp.lwf
        : ((PACKS[st.pack].builtin.payload as StatePack).lwf ?? null);
  return {
    pf: l.pf,
    esi: l.esi,
    pt: sp ? sp.pt : null,
    lwf,
    source: labour.sources[0] ?? { title: '', readOn: '', verified: false },
  };
}

/** Gratuity rules in force at an institution on a date (the built-in ones if a version has none). */
export async function gratuityRulesAt(
  tx: Tx,
  institutionId: string,
  on: string,
): Promise<GratuityRules> {
  const p = (await packFor(tx, institutionId, 'labour.central', on)).payload as LabourPack;
  return p.gratuity ?? (PACKS['labour.central'].builtin.payload.gratuity as GratuityRules);
}

/** The grading scale in force at an institution on a date (the built-in one if a version has none). */
export async function gradingAt(tx: Tx, institutionId: string, on: string): Promise<GradingRules> {
  const p = (await packFor(tx, institutionId, 'ugc.credits', on)).payload as CreditsPack;
  return p.grading ?? (PACKS['ugc.credits'].builtin.payload.grading as GradingRules);
}

/**
 * A school board's rules (attendance minimum, grades and pass mark, promotion) in force at an
 * institution on a date, with the version's first source. Null for a board without a pack.
 */
export async function boardRulesAt(
  tx: Tx,
  institutionId: string,
  board: string,
  on: string,
): Promise<{ rules: BoardPack; source: Source; version: number } | null> {
  const code = `board.${board.toLowerCase()}`;
  if (!isPackCode(code) || PACKS[code].kind !== 'board') return null;
  const r = await packFor(tx, institutionId, code, on);
  return {
    rules: r.payload as BoardPack,
    version: r.version,
    source: r.sources[0] ?? { title: '', readOn: '', verified: false },
  };
}

/** Days the institution's state gives to issue a TC, in force on a date; null where none is set. */
export async function tcDeadlineAt(
  tx: Tx,
  institutionId: string,
  on: string,
): Promise<{ days: number; source: Source } | null> {
  const code = `state.${(await institutionInfo(tx, institutionId))?.stateCode ?? ''}`;
  if (!isPackCode(code)) return null;
  const r = await packFor(tx, institutionId, code, on);
  const days = (r.payload as StatePack).tcDeadlineDays;
  return days
    ? {
        days,
        source: r.sources.find((x) => /\bTC/.test(x.title)) ??
          r.sources[0] ?? { title: '', readOn: '', verified: false },
      }
    : null;
}

/** Course attendance thresholds in force at an institution on a date (built in if a version has none). */
export async function courseAttendanceAt(
  tx: Tx,
  institutionId: string,
  on: string,
): Promise<CourseAttendanceRules> {
  const p = (await packFor(tx, institutionId, 'ugc.credits', on)).payload as CreditsPack;
  return p.attendance ?? (PACKS['ugc.credits'].builtin.payload.attendance as CourseAttendanceRules);
}

/** A program's credit framework in force at its institution on a date. */
export async function creditFrameworkAt(
  tx: Tx,
  institutionId: string,
  code: string | null,
  on: string,
): Promise<CreditFramework | null> {
  if (!code) return null;
  const p = (await packFor(tx, institutionId, 'ugc.credits', on)).payload as CreditsPack;
  const f = p.frameworks[code];
  return f ? { ...f, source: { title: '', readOn: on, verified: false } } : null;
}

// ---------------------------------------------------------------------------------------------
// Institutions: which packs apply, and switching to a new version
// ---------------------------------------------------------------------------------------------

export type InstitutionPack = {
  pack: PackCode;
  kind: PackKind;
  title: string;
  inUse: Resolved;
  /** A switch already recorded for a later date. */
  scheduled: { version: number; fromDate: string } | null;
  /** Released versions newer than the one in use. */
  available: {
    version: number;
    effectiveFrom: string;
    notes: string;
    sources: Source[];
    tests: number;
  }[];
};

export async function institutionPacks(
  deps: RulePackDeps,
  actor: Actor,
  institutionId: string,
): Promise<InstitutionPack[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const i = await institutionInfo(tx, institutionId);
    if (!i) throw new RulePackError('institution_not_found');
    await deps.permissions.assertCan(tx, actor, 'platform.rules.read', {
      orgId: actor.orgId,
      place: { campusId: i.campusId, institutionId },
    });
    const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    const today = d?.d ?? '';
    const out: InstitutionPack[] = [];
    for (const pack of packsFor(i)) {
      const inUse = await packFor(tx, institutionId, pack, today);
      const [later] = await tx.execute<{ version: number; fromDate: string }>(sql`
        select version, from_date::text as "fromDate" from rule_pack_adoption
        where org_id = app_current_org() and institution_id = ${institutionId} and pack = ${pack}
          and from_date > ${today}::date
        order by from_date, id desc limit 1`);
      const available = await tx.execute<InstitutionPack['available'][number]>(sql`
        select version, effective_from::text as "effectiveFrom", notes, sources,
          jsonb_array_length(tests) as tests
        from control.rule_pack_version
        where pack = ${pack} and status = 'released' and version > ${inUse.version}
        order by version`);
      out.push({
        pack,
        kind: PACKS[pack].kind,
        title: PACKS[pack].title,
        inUse,
        scheduled: later ?? null,
        available: [...available],
      });
    }
    return out;
  });
}

/**
 * Switches an institution to a released version (or back to the built-in version 1) from a date,
 * not before the version takes effect. Earlier dates keep the version they had.
 */
export async function adoptPackVersion(
  deps: RulePackDeps,
  actor: Actor,
  input: { institutionId: string; pack: string; version: number; fromDate: string },
): Promise<void> {
  if (!isPackCode(input.pack)) throw new RulePackError('unknown_pack');
  const pack = input.pack;
  const place = await withTenant(deps.db, actor.orgId, (tx) =>
    institutionInfo(tx, input.institutionId),
  );
  if (!place) throw new RulePackError('institution_not_found');
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'platform.rules.adopt',
      resource: {
        orgId: actor.orgId,
        place: { campusId: place.campusId, institutionId: input.institutionId },
      },
    },
    async (tx) => {
      if (!packsFor(place).includes(pack)) throw new RulePackError('pack_not_for_institution');
      const effectiveFrom =
        input.version === 1
          ? PACKS[pack].builtin.effectiveFrom
          : (await released(tx, pack, input.version))?.effectiveFrom;
      if (!effectiveFrom) throw new RulePackError('version_not_found');
      if (input.fromDate < effectiveFrom) throw new RulePackError('before_effective');
      await tx.execute(sql`
        insert into rule_pack_adoption (org_id, institution_id, pack, version, from_date, adopted_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${pack}, ${input.version}, ${input.fromDate}::date,
          ${actor.personId})`);
      return {
        result: undefined,
        audit: {
          action: 'platform.rules.adopt',
          entityType: 'institution',
          entityId: input.institutionId,
          dataClass: 'operational',
          detail: { pack, version: input.version, from: input.fromDate },
        },
        events: [
          {
            type: PACK_ADOPTED,
            payload: {
              institutionId: input.institutionId,
              pack,
              version: input.version,
              fromDate: input.fromDate,
            },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Campusverse staff: the catalogue
// ---------------------------------------------------------------------------------------------

export type TestResult = { name: string; passed: boolean; got: unknown; expect: unknown };
export type CatalogueVersion = {
  id: string | null;
  version: number;
  effectiveFrom: string;
  status: 'built_in' | 'draft' | 'released';
  notes: string;
  payload: unknown;
  sources: Source[];
  tests: PackTest[];
  results: TestResult[];
  draftedBy: string | null;
  draftedByMe: boolean;
  releasedAt: string | null;
};
export type CataloguePack = {
  pack: PackCode;
  kind: PackKind;
  title: string;
  versions: CatalogueVersion[];
};

const assertStaff = (staff: Staff, action: 'rules.draft' | 'rules.release') => {
  if (!staffCan(staff.role, action)) throw new ControlError('forbidden', { action });
};

/** Every pack with its built-in version and every drafted or released version, tests run. */
export async function packCatalogue(db: Db, staff: Staff): Promise<CataloguePack[]> {
  assertStaff(staff, 'rules.draft');
  const rows = await db.execute<{
    id: string;
    pack: string;
    version: number;
    effectiveFrom: string;
    status: 'draft' | 'released';
    notes: string;
    payload: unknown;
    sources: Source[];
    tests: PackTest[];
    draftedById: string;
    draftedBy: string;
    releasedAt: string | null;
  }>(sql`
    select v.id::text, v.pack, v.version, v.effective_from::text as "effectiveFrom", v.status, v.notes,
      v.payload, v.sources, v.tests, v.drafted_by::text as "draftedById", s.name as "draftedBy",
      v.released_at::text as "releasedAt"
    from control.rule_pack_version v join control.staff s on s.id = v.drafted_by
    order by v.pack, v.version desc`);
  return (Object.keys(PACKS) as PackCode[]).map((pack) => {
    const b = PACKS[pack].builtin;
    return {
      pack,
      kind: PACKS[pack].kind,
      title: PACKS[pack].title,
      versions: [
        ...rows
          .filter((r) => r.pack === pack)
          .map(({ draftedById, ...r }) => ({
            ...r,
            draftedByMe: draftedById === staff.staffId,
            results: runPackTests(pack, r.payload, r.tests),
          })),
        {
          id: null,
          version: 1,
          effectiveFrom: b.effectiveFrom,
          status: 'built_in' as const,
          notes: b.notes,
          payload: b.payload,
          sources: b.sources,
          tests: b.tests,
          results: runPackTests(pack, b.payload, b.tests),
          draftedBy: null,
          draftedByMe: false,
          releasedAt: null,
        },
      ],
    };
  });
}

/**
 * Drafts the next version of a pack (or replaces the open draft): its payload must fit the pack's
 * shape; test cases are run and returned, and may fail while drafting.
 */
export async function draftPackVersion(
  db: Db,
  staff: Staff,
  input: {
    pack: string;
    effectiveFrom: string;
    payload: unknown;
    sources: Source[];
    tests: PackTest[];
    notes: string;
  },
): Promise<{ id: string; version: number; results: TestResult[] }> {
  if (!isPackCode(input.pack)) throw new ControlError('unknown_pack');
  const pack = input.pack;
  const valid = validatePack(pack, input.payload);
  if (!valid.ok) throw new ControlError('invalid_payload', { error: valid.error });
  const results = runPackTests(pack, input.payload, input.tests);
  const row = await controlStep(
    db,
    staff,
    'rules.draft',
    { action: 'rules.drafted', detail: { pack, effectiveFrom: input.effectiveFrom } },
    async (tx) => {
      const [open] = await tx.execute<{ id: string; version: number }>(sql`
        select id::text, version from control.rule_pack_version where pack = ${pack} and status = 'draft'`);
      if (open) {
        await tx.execute(sql`
          update control.rule_pack_version set effective_from = ${input.effectiveFrom}::date,
            payload = ${JSON.stringify(input.payload)}::jsonb, sources = ${JSON.stringify(input.sources)}::jsonb,
            tests = ${JSON.stringify(input.tests)}::jsonb, notes = ${input.notes}, drafted_by = ${staff.staffId},
            drafted_at = now()
          where id = ${open.id}`);
        return open;
      }
      const [r] = await tx.execute<{ id: string; version: number }>(sql`
        insert into control.rule_pack_version (pack, version, effective_from, payload, sources, tests, notes, drafted_by)
        select ${pack}, greatest(1, coalesce(max(version), 1)) + 1, ${input.effectiveFrom}::date,
          ${JSON.stringify(input.payload)}::jsonb, ${JSON.stringify(input.sources)}::jsonb,
          ${JSON.stringify(input.tests)}::jsonb, ${input.notes}, ${staff.staffId}
        from control.rule_pack_version where pack = ${pack}
        returning id::text, version`);
      if (!r) throw new Error('draftPackVersion: no row');
      return r;
    },
  );
  return { ...row, results };
}

/**
 * Releases a draft: an owner who didn't draft it (the review), and only when every test case
 * passes. From then on it never changes; institutions switch to it from a date.
 */
export async function releasePackVersion(db: Db, staff: Staff, id: string): Promise<void> {
  assertStaff(staff, 'rules.release');
  await controlStep(
    db,
    staff,
    'rules.release',
    { action: 'rules.released', detail: { id } },
    async (tx) => {
      const [v] = await tx.execute<{
        pack: string;
        status: string;
        draftedBy: string;
        payload: unknown;
        tests: PackTest[];
      }>(sql`
      select pack, status, drafted_by::text as "draftedBy", payload, tests
      from control.rule_pack_version where id = ${id} for update`);
      if (!v || v.status !== 'draft' || !isPackCode(v.pack)) throw new ControlError('not_found');
      if (v.draftedBy === staff.staffId) throw new ControlError('own_draft');
      const failed = runPackTests(v.pack, v.payload, v.tests).filter((r) => !r.passed);
      if (failed.length)
        throw new ControlError('tests_failing', { failed: failed.map((f) => f.name).join(', ') });
      await tx.execute(sql`
      update control.rule_pack_version set status = 'released', released_by = ${staff.staffId}, released_at = now()
      where id = ${id}`);
    },
  );
}

/** Throws a draft away. Released versions can't be removed. */
export async function discardPackDraft(db: Db, staff: Staff, id: string): Promise<void> {
  await controlStep(
    db,
    staff,
    'rules.draft',
    { action: 'rules.discarded', detail: { id } },
    async (tx) => {
      await tx.execute(
        sql`delete from control.rule_pack_version where id = ${id} and status = 'draft'`,
      );
    },
  );
}
