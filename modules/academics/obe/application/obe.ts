// Academics › OBE (rule book §13.2: Program Outcomes; Course Outcomes & Mapping; Attainment; P1
// item 17). Outcome sets are versioned per program (drafted, then published and frozen); COs belong
// to a regulation's course; the matrix and item tags are kept per CO. Attainment is worked out from
// a published term's first-attempt marks (academics/exams `termMarks`).
import { termMarks } from '@campusverse/academics-exams';
import { batchFacts, curriculum } from '@campusverse/academics-structure';
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { writeAudit, type AuditEntry } from '@campusverse/platform-audit';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  coAttainment,
  outcomeAttainment,
  type CoResult,
  type Settings,
} from '../domain/attainment.js';

type Permissions = ReturnType<typeof createPermissions>;
export type ObeDeps = { db: Db; permissions: Permissions };

export const OBE_READ = 'academics.obe.read';
export const OBE_MANAGE = 'academics.obe.manage';

export type ObeErrorCode =
  | 'program_not_found'
  | 'set_not_found'
  | 'draft_exists'
  | 'set_published'
  | 'no_outcomes'
  | 'outcomes_invalid'
  | 'settings_invalid'
  | 'course_not_found'
  | 'no_outcome_set'
  | 'course_outcomes_invalid'
  | 'batch_not_found'
  | 'term_not_published';

export class ObeError extends Error {
  constructor(readonly code: ObeErrorCode) {
    super(`obe: ${code}`);
    this.name = 'ObeError';
  }
}

const KINDS = ['peo', 'po', 'pso'] as const;
type Kind = (typeof KINDS)[number];
const CODE = /^[A-Z]{2,4}[0-9]{1,2}$/;
const ITEM = /^(see|cie|cie:[0-7])$/;

/** The program's institution place, if the actor holds the permission there (else refused). */
async function atProgram(
  deps: ObeDeps,
  tx: Tx,
  actor: Actor,
  programId: string,
  permission: string,
) {
  const [p] = await tx.execute<{ institutionId: string }>(sql`
    select institution_id::text as "institutionId" from academic_program
    where org_id = app_current_org() and id = ${programId}`);
  const place = p ? await placeOf(tx, p.institutionId) : null;
  if (!place) throw new ObeError('program_not_found');
  const resource = { orgId: actor.orgId, place };
  if (
    permission === OBE_READ &&
    (await deps.permissions.can(tx, actor, OBE_MANAGE, resource)).allowed
  )
    return;
  await deps.permissions.assertCan(tx, actor, permission, resource);
}

const audit = (tx: Tx, actor: Actor, entry: AuditEntry) => writeAudit(tx, actor, entry);

export type Outcome = { id: string; kind: Kind; code: string; statement: string };
export type OutcomeSet = Settings & {
  id: string;
  version: number;
  status: 'draft' | 'published';
  effectiveFrom: string;
  vision: string | null;
  mission: string | null;
  outcomes: Outcome[];
};

const setSelect = sql`
  select id::text, version, status, effective_from::text as "effectiveFrom", vision, mission,
    target_percent::float as "targetPercent", level1_percent::float as "level1Percent",
    level2_percent::float as "level2Percent", level3_percent::float as "level3Percent",
    cie_weight::float as "cieWeight", target_level::float as "targetLevel"
  from obe_outcome_set where org_id = app_current_org()`;

async function outcomesOf(tx: Tx, setIds: string[]): Promise<Map<string, Outcome[]>> {
  const out = new Map<string, Outcome[]>();
  if (!setIds.length) return out;
  const rows = await tx.execute<Outcome & { setId: string }>(sql`
    select id::text, set_id::text as "setId", kind, code, statement from obe_outcome
    where org_id = app_current_org() and set_id = any(${`{${setIds.join(',')}}`}::uuid[])
    order by array_position(array['peo','po','pso'], kind), position`);
  for (const { setId, ...o } of rows) out.set(setId, [...(out.get(setId) ?? []), o]);
  return out;
}

/** A program's outcome sets, newest first, with their outcomes. */
export async function outcomeSets(
  deps: ObeDeps,
  actor: Actor,
  programId: string,
): Promise<OutcomeSet[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await atProgram(deps, tx, actor, programId, OBE_READ);
    const sets = await tx.execute<
      Omit<OutcomeSet, 'outcomes'>
    >(sql`${setSelect} and program_id = ${programId}
      order by version desc`);
    const outcomes = await outcomesOf(
      tx,
      sets.map((x) => x.id),
    );
    return sets.map((x) => ({ ...x, outcomes: outcomes.get(x.id) ?? [] }));
  });
}

/** The set a program's COs map to now: the latest published, else the draft. Call inside the tenant. */
async function currentSet(tx: Tx, programId: string) {
  const [x] = await tx.execute<
    Omit<OutcomeSet, 'outcomes'>
  >(sql`${setSelect} and program_id = ${programId}
    order by (status = 'published') desc, version desc limit 1`);
  return x ?? null;
}

/**
 * Starts a new version: a copy of the latest published set (outcomes, settings, and every CO's
 * mappings carried to the new outcomes by code), or an empty first version.
 */
export async function draftOutcomeSet(
  deps: ObeDeps,
  actor: Actor,
  input: { programId: string; effectiveFrom: string },
): Promise<string> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await atProgram(deps, tx, actor, input.programId, OBE_MANAGE);
    const [last] = await tx.execute<{ id: string; version: number }>(sql`
      select id::text, version from obe_outcome_set where org_id = app_current_org()
        and program_id = ${input.programId} order by version desc limit 1`);
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into obe_outcome_set (org_id, program_id, version, effective_from, vision, mission, target_percent,
        level1_percent, level2_percent, level3_percent, cie_weight, target_level, created_by_person_id)
      select app_current_org(), ${input.programId}, ${(last?.version ?? 0) + 1}, ${input.effectiveFrom}::date,
        s.vision, s.mission, coalesce(s.target_percent, 60), coalesce(s.level1_percent, 50),
        coalesce(s.level2_percent, 60), coalesce(s.level3_percent, 70), coalesce(s.cie_weight, 40),
        coalesce(s.target_level, 2), ${actor.personId}
      from (select 1) one left join obe_outcome_set s on s.org_id = app_current_org() and s.id = ${last?.id ?? null}::uuid
      on conflict do nothing returning id::text`);
    if (!row) throw new ObeError('draft_exists');
    if (last) {
      await tx.execute(sql`
        insert into obe_outcome (org_id, set_id, kind, code, statement, position)
        select org_id, ${row.id}, kind, code, statement, position from obe_outcome
        where org_id = app_current_org() and set_id = ${last.id}`);
      await tx.execute(sql`
        insert into obe_co_mapping (org_id, course_outcome_id, outcome_id, level)
        select m.org_id, m.course_outcome_id, n.id, m.level
        from obe_co_mapping m
        join obe_outcome o on o.org_id = m.org_id and o.id = m.outcome_id and o.set_id = ${last.id}
        join obe_outcome n on n.org_id = o.org_id and n.set_id = ${row.id} and n.code = o.code
        where m.org_id = app_current_org()`);
    }
    await audit(tx, actor, {
      action: 'academics.obe.set_draft',
      entityType: 'obe_outcome_set',
      entityId: row.id,
      dataClass: 'operational',
      detail: { programId: input.programId, version: (last?.version ?? 0) + 1 },
    });
    return row.id;
  });
}

/**
 * Saves a draft: vision, mission, targets and levels, and its PEOs, POs and PSOs (kept by code, so
 * mappings to an outcome survive a reworded statement; outcomes left out are removed).
 */
export async function saveOutcomeSet(
  deps: ObeDeps,
  actor: Actor,
  input: Settings & {
    setId: string;
    vision: string | null;
    mission: string | null;
    outcomes: { kind: Kind; code: string; statement: string }[];
  },
): Promise<void> {
  const codes = input.outcomes.map((o) => o.code);
  if (
    input.outcomes.length > 60 ||
    new Set(codes).size !== codes.length ||
    input.outcomes.some(
      (o) => !KINDS.includes(o.kind) || !CODE.test(o.code) || o.statement.trim().length < 3,
    )
  )
    throw new ObeError('outcomes_invalid');
  if (
    !(input.level1Percent < input.level2Percent && input.level2Percent < input.level3Percent) ||
    input.level3Percent > 100 ||
    input.targetPercent <= 0 ||
    input.targetPercent > 100 ||
    input.cieWeight < 0 ||
    input.cieWeight > 100 ||
    input.targetLevel <= 0 ||
    input.targetLevel > 3
  )
    throw new ObeError('settings_invalid');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [x] = await tx.execute<{ programId: string; status: string }>(sql`
      select program_id::text as "programId", status from obe_outcome_set
      where org_id = app_current_org() and id = ${input.setId} for update`);
    if (!x) throw new ObeError('set_not_found');
    await atProgram(deps, tx, actor, x.programId, OBE_MANAGE);
    if (x.status !== 'draft') throw new ObeError('set_published');
    await tx.execute(sql`
      update obe_outcome_set set vision = ${input.vision?.trim() || null}, mission = ${input.mission?.trim() || null},
        target_percent = ${input.targetPercent}, level1_percent = ${input.level1Percent},
        level2_percent = ${input.level2Percent}, level3_percent = ${input.level3Percent},
        cie_weight = ${input.cieWeight}, target_level = ${input.targetLevel}
      where org_id = app_current_org() and id = ${input.setId}`);
    await tx.execute(sql`
      delete from obe_outcome where org_id = app_current_org() and set_id = ${input.setId}
        and not (code = any(${`{${codes.join(',')}}`}::text[]))`);
    for (const [i, o] of input.outcomes.entries())
      await tx.execute(sql`
        insert into obe_outcome (org_id, set_id, kind, code, statement, position)
        values (app_current_org(), ${input.setId}, ${o.kind}, ${o.code}, ${o.statement.trim()}, ${i + 1})
        on conflict (org_id, set_id, code) do update set kind = excluded.kind, statement = excluded.statement,
          position = excluded.position`);
    await audit(tx, actor, {
      action: 'academics.obe.set_save',
      entityType: 'obe_outcome_set',
      entityId: input.setId,
      dataClass: 'operational',
      detail: { outcomes: input.outcomes.length, targetLevel: input.targetLevel },
    });
  });
}

/** Publishes a draft (at least one PO): from now on it never changes. */
export async function publishOutcomeSet(deps: ObeDeps, actor: Actor, setId: string): Promise<void> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [x] = await tx.execute<{ programId: string; status: string }>(sql`
      select program_id::text as "programId", status from obe_outcome_set
      where org_id = app_current_org() and id = ${setId} for update`);
    if (!x) throw new ObeError('set_not_found');
    await atProgram(deps, tx, actor, x.programId, OBE_MANAGE);
    if (x.status !== 'draft') throw new ObeError('set_published');
    const [n] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from obe_outcome where org_id = app_current_org() and set_id = ${setId} and kind = 'po'`);
    if (!n?.n) throw new ObeError('no_outcomes');
    await tx.execute(sql`
      update obe_outcome_set set status = 'published', published_at = now()
      where org_id = app_current_org() and id = ${setId}`);
    await audit(tx, actor, {
      action: 'academics.obe.set_publish',
      entityType: 'obe_outcome_set',
      entityId: setId,
      dataClass: 'operational',
      detail: { programId: x.programId },
    });
  });
}

export type CourseOutcome = {
  id: string;
  code: string;
  statement: string;
  /** Matrix levels by outcome id (of the current set). */
  mappings: Record<string, number>;
  items: string[];
};

export type CourseOutcomesView = {
  course: { courseId: string; code: string; title: string; termNumber: number };
  /** The course's internal assessment components, for tagging. */
  components: { name: string; maxMarks: number }[] | null;
  set: { id: string; version: number; status: string; outcomes: Outcome[] } | null;
  cos: CourseOutcome[];
};

async function courseOf(tx: Tx, regulationId: string, courseId: string) {
  const [r] = await tx.execute<{ programId: string }>(sql`
    select program_id::text as "programId" from academic_regulation
    where org_id = app_current_org() and id = ${regulationId}`);
  const c = r
    ? (await curriculum(tx, regulationId)).find((x) => x.courseId === courseId)
    : undefined;
  if (!r || !c) throw new ObeError('course_not_found');
  return { programId: r.programId, course: c };
}

async function cosOf(tx: Tx, regulationId: string, courseIds: string[], setId: string | null) {
  if (!courseIds.length) return new Map<string, CourseOutcome[]>();
  const cos = await tx.execute<{
    id: string;
    courseId: string;
    code: string;
    statement: string;
  }>(sql`
    select id::text, course_id::text as "courseId", code, statement from obe_course_outcome
    where org_id = app_current_org() and regulation_id = ${regulationId}
      and course_id = any(${`{${courseIds.join(',')}}`}::uuid[]) order by position`);
  const ids = `{${cos.map((c) => c.id).join(',')}}`;
  const maps = setId
    ? await tx.execute<{ coId: string; outcomeId: string; level: number }>(sql`
        select m.course_outcome_id::text as "coId", m.outcome_id::text as "outcomeId", m.level
        from obe_co_mapping m join obe_outcome o on o.org_id = m.org_id and o.id = m.outcome_id
        where m.org_id = app_current_org() and o.set_id = ${setId} and m.course_outcome_id = any(${ids}::uuid[])`)
    : [];
  const tags = await tx.execute<{ coId: string; item: string }>(sql`
    select course_outcome_id::text as "coId", item from obe_item_tag
    where org_id = app_current_org() and course_outcome_id = any(${ids}::uuid[]) order by item`);
  const out = new Map<string, CourseOutcome[]>();
  for (const c of cos)
    out.set(c.courseId, [
      ...(out.get(c.courseId) ?? []),
      {
        id: c.id,
        code: c.code,
        statement: c.statement,
        mappings: Object.fromEntries(
          maps.filter((m) => m.coId === c.id).map((m) => [m.outcomeId, m.level]),
        ),
        items: tags.filter((t) => t.coId === c.id).map((t) => t.item),
      },
    ]);
  return out;
}

/** A course's COs, their matrix row against the program's current outcomes, and what measures each. */
export async function courseOutcomes(
  deps: ObeDeps,
  actor: Actor,
  input: { regulationId: string; courseId: string },
): Promise<CourseOutcomesView> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const { programId, course } = await courseOf(tx, input.regulationId, input.courseId);
    await atProgram(deps, tx, actor, programId, OBE_READ);
    const set = await currentSet(tx, programId);
    const outcomes = set ? ((await outcomesOf(tx, [set.id])).get(set.id) ?? []) : [];
    return {
      course: {
        courseId: course.courseId,
        code: course.code,
        title: course.title,
        termNumber: course.termNumber,
      },
      components: course.cieComponents?.map(({ name, maxMarks }) => ({ name, maxMarks })) ?? null,
      set: set ? { id: set.id, version: set.version, status: set.status, outcomes } : null,
      cos:
        (await cosOf(tx, input.regulationId, [course.courseId], set?.id ?? null)).get(
          course.courseId,
        ) ?? [],
    };
  });
}

/**
 * Saves a course's COs (kept by code), each with its matrix row (outcome code → 1–3, against the
 * current set; PEOs aren't mapped) and the items that measure it.
 */
export async function saveCourseOutcomes(
  deps: ObeDeps,
  actor: Actor,
  input: {
    regulationId: string;
    courseId: string;
    cos: { code: string; statement: string; mappings: Record<string, number>; items: string[] }[];
  },
): Promise<void> {
  const codes = input.cos.map((c) => c.code);
  if (
    input.cos.length > 12 ||
    new Set(codes).size !== codes.length ||
    input.cos.some(
      (c) =>
        !/^CO[0-9]{1,2}$/.test(c.code) ||
        c.statement.trim().length < 3 ||
        c.items.some((i) => !ITEM.test(i)) ||
        Object.values(c.mappings).some((l) => ![1, 2, 3].includes(l)),
    )
  )
    throw new ObeError('course_outcomes_invalid');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const { programId, course } = await courseOf(tx, input.regulationId, input.courseId);
    await atProgram(deps, tx, actor, programId, OBE_MANAGE);
    const set = await currentSet(tx, programId);
    if (!set) throw new ObeError('no_outcome_set');
    const outcomes = (await outcomesOf(tx, [set.id])).get(set.id) ?? [];
    const byCode = new Map(outcomes.filter((o) => o.kind !== 'peo').map((o) => [o.code, o.id]));
    const parts = course.cieComponents?.length ?? 0;
    if (
      input.cos.some(
        (c) =>
          Object.keys(c.mappings).some((k) => !byCode.has(k)) ||
          c.items.some((i) => i.startsWith('cie:') && Number(i.slice(4)) >= parts),
      )
    )
      throw new ObeError('course_outcomes_invalid');
    await tx.execute(sql`
      delete from obe_course_outcome where org_id = app_current_org() and regulation_id = ${input.regulationId}
        and course_id = ${input.courseId} and not (code = any(${`{${codes.join(',')}}`}::text[]))`);
    for (const [i, c] of input.cos.entries()) {
      const [co] = await tx.execute<{ id: string }>(sql`
        insert into obe_course_outcome (org_id, regulation_id, course_id, code, statement, position)
        values (app_current_org(), ${input.regulationId}, ${input.courseId}, ${c.code}, ${c.statement.trim()}, ${i + 1})
        on conflict (org_id, regulation_id, course_id, code) do update set statement = excluded.statement,
          position = excluded.position
        returning id::text`);
      if (!co) throw new Error('saveCourseOutcomes: no row');
      await tx.execute(sql`
        delete from obe_co_mapping m using obe_outcome o
        where m.org_id = app_current_org() and m.course_outcome_id = ${co.id}
          and o.org_id = m.org_id and o.id = m.outcome_id and o.set_id = ${set.id}`);
      for (const [code, level] of Object.entries(c.mappings))
        await tx.execute(sql`
          insert into obe_co_mapping (org_id, course_outcome_id, outcome_id, level)
          values (app_current_org(), ${co.id}, ${byCode.get(code) ?? null}::uuid, ${level})`);
      await tx.execute(
        sql`delete from obe_item_tag where org_id = app_current_org() and course_outcome_id = ${co.id}`,
      );
      for (const item of new Set(c.items))
        await tx.execute(sql`
          insert into obe_item_tag (org_id, course_outcome_id, item) values (app_current_org(), ${co.id}, ${item})`);
    }
    await audit(tx, actor, {
      action: 'academics.obe.course_save',
      entityType: 'academic_course',
      entityId: input.courseId,
      dataClass: 'operational',
      detail: { regulationId: input.regulationId, cos: input.cos.length },
    });
  });
}

export type AttainmentView = {
  batch: { id: string; name: string; term: number };
  settings: Settings;
  set: { id: string; version: number };
  courses: {
    courseId: string;
    code: string;
    title: string;
    students: number;
    cos: (Pick<CourseOutcome, 'id' | 'code' | 'statement' | 'items'> &
      CoResult & { met: boolean | null })[];
  }[];
  outcomes: (Outcome & { value: number | null; cos: number; met: boolean | null })[];
};

/**
 * Direct attainment for a published term of a batch: every course's CO levels from its tagged
 * items, and each PO and PSO from those CO levels through the matrix. All against one target level.
 */
export async function attainment(
  deps: ObeDeps,
  actor: Actor,
  input: { batchId: string; term: number },
): Promise<AttainmentView> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchFacts(tx, input.batchId);
    if (!b) throw new ObeError('batch_not_found');
    await atProgram(deps, tx, actor, b.programId, OBE_READ);
    const marks = await termMarks(tx, b.batchId, input.term);
    if (!marks.published) throw new ObeError('term_not_published');
    const set = await currentSet(tx, b.programId);
    if (!set) throw new ObeError('no_outcome_set');
    const outcomes = (await outcomesOf(tx, [set.id])).get(set.id) ?? [];
    const courses = (await curriculum(tx, b.regulationId)).filter(
      (c) => c.termNumber === input.term,
    );
    const cos = await cosOf(
      tx,
      b.regulationId,
      courses.map((c) => c.courseId),
      set.id,
    );
    const all: { level: number | null; mappings: { outcomeId: string; level: number }[] }[] = [];
    const view = courses.map((c) => {
      const rows = marks.courses.get(c.courseId) ?? [];
      return {
        courseId: c.courseId,
        code: c.code,
        title: c.title,
        students: rows.length,
        cos: (cos.get(c.courseId) ?? []).map((co) => {
          const r = coAttainment({
            items: co.items,
            plan: c.cieComponents,
            cieMax: marks.cieMax,
            rows,
            settings: set,
          });
          all.push({
            level: r.level,
            mappings: Object.entries(co.mappings).map(([outcomeId, level]) => ({
              outcomeId,
              level,
            })),
          });
          return {
            id: co.id,
            code: co.code,
            statement: co.statement,
            items: co.items,
            ...r,
            met: r.level === null ? null : r.level >= set.targetLevel,
          };
        }),
      };
    });
    const po = outcomeAttainment(all);
    return {
      batch: { id: b.batchId, name: `${b.programCode} ${b.label}`, term: input.term },
      settings: {
        targetPercent: set.targetPercent,
        level1Percent: set.level1Percent,
        level2Percent: set.level2Percent,
        level3Percent: set.level3Percent,
        cieWeight: set.cieWeight,
        targetLevel: set.targetLevel,
      },
      set: { id: set.id, version: set.version },
      courses: view,
      outcomes: outcomes
        .filter((o) => o.kind !== 'peo')
        .map((o) => {
          const v = po.get(o.id);
          return {
            ...o,
            value: v?.value ?? null,
            cos: v?.cos ?? 0,
            met: v ? v.value >= set.targetLevel : null,
          };
        }),
    };
  });
}
