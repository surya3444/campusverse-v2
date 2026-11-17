import { withTenant, type Db, type Tx } from '@campusverse/db';
import {
  continueMembership,
  studentFacts,
  studentLeaves,
  studentReturns,
} from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf as institutionPlace } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { boardRulesAt } from '@campusverse/platform-rulepacks';
import { promotionFor } from '@campusverse/rules';
import { anyAttendanceFrom } from '@campusverse/school-attendance';
import {
  enrolForRollover,
  enrolmentFacts,
  sectionRoster,
  setOutcome,
  undoRolloverEnrolments,
} from '@campusverse/school-enrolment';
import { latestResult } from '@campusverse/school-exams';
import { classesOf, sectionsOn, yearsOf, type YearInfo } from '@campusverse/school-setup';
import { anyInvoicesFrom } from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import {
  balance,
  generate,
  problems,
  type Balance,
  type Plan,
  type Problem,
  type Pupil,
} from '../domain/planner.js';

type Permissions = ReturnType<typeof createPermissions>;
export type RolloverDeps = { db: Db; permissions: Permissions };

export const ROLLOVER_COMMITTED = 'school.rollover.committed.v1';
export const ROLLOVER_UNDONE = 'school.rollover.undone.v1';

export class RolloverError extends Error {
  constructor(
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`Rollover: ${code}`);
    this.name = 'RolloverError';
  }
}

export type Outcome = 'promoted' | 'detained' | 'passed_out' | 'review';

export type Row = {
  studentId: string;
  name: string;
  classId: string;
  className: string;
  sectionLabel: string;
  outcome: Outcome;
  /** Why the rule pack chose this, for the reviewer. */
  basis: string;
  lastPercentBp: number | null;
  belowPass: string[];
  nextClassId: string | null;
  nextSectionId: string | null;
};

export type Preview = {
  from: YearInfo;
  to: YearInfo;
  checklist: { code: 'exams_unpublished'; count: number }[];
  rows: Row[];
  nextSections: { sectionId: string; classId: string; label: string }[];
};

async function years(tx: Tx, institutionId: string, fromYearId: string, toYearId: string) {
  const all = await yearsOf(tx, institutionId);
  const from = all.find((y) => y.yearId === fromYearId);
  const to = all.find((y) => y.yearId === toYearId);
  if (!from || !to || to.starts < from.ends) throw new RolloverError('years_not_in_order');
  return { from, to };
}

/** The last day of a year (ends is exclusive). */
const lastDay = (y: YearInfo) =>
  new Date(Date.parse(`${y.ends}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

/**
 * One row per student enrolled on the old year's last day: the outcome the rule pack gives, and
 * the next class and section (from the section plan, else the same section letter).
 */
async function draft(
  tx: Tx,
  institutionId: string,
  fromYearId: string,
  toYearId: string,
): Promise<Preview> {
  const { from, to } = await years(tx, institutionId, fromYearId, toYearId);
  const end = lastDay(from);
  const classes = await classesOf(tx, institutionId);
  const oldSections = await sectionsOn(tx, institutionId, end);
  const nextSections = await sectionsOn(tx, institutionId, to.starts);
  const plans = new Map(
    (
      await tx.execute<{ classId: string; assignments: Plan }>(sql`
        select class_id::text as "classId", assignments from school_section_plan
        where org_id = app_current_org() and to_year_id = ${toYearId}`)
    ).map((p) => [p.classId, p.assignments]),
  );
  const [unpublished] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from school_exam where org_id = app_current_org() and year_id = ${fromYearId}
      and state not in ('published', 'cancelled')`);
  const rows: Row[] = [];
  for (const s of oldSections) {
    const cls = classes.find((c) => c.classId === s.classId);
    if (!cls) continue;
    const next = classes.find((c) => c.sequence > cls.sequence) ?? null;
    const board = await boardRulesAt(tx, s.institutionId, s.board, end);
    const rule = board ? promotionFor(board.rules, cls.code) : 'promote';
    const pass = board?.rules.grades?.passBasisPoints ?? 3300;
    for (const st of await sectionRoster(tx, s.sectionId, end)) {
      const res = await latestResult(tx, st.personId);
      const below = (res?.subjects ?? [])
        .filter((x) => x.percentBp !== null && x.percentBp < pass)
        .map((x) => x.subject);
      const outcome: Outcome =
        rule === 'board' || !next
          ? 'passed_out'
          : rule === 'pass_marks' && (below.length > 0 || !res)
            ? 'review'
            : 'promoted';
      const basis =
        rule === 'board'
          ? 'board_year'
          : !next
            ? 'last_class'
            : rule === 'pass_marks'
              ? res
                ? below.length
                  ? 'below_pass'
                  : 'passed'
                : 'no_result'
              : 'no_detention';
      const targetClass =
        outcome === 'promoted'
          ? (next?.classId ?? null)
          : outcome === 'review'
            ? (next?.classId ?? null)
            : null;
      const letter = s.label.split('-').pop();
      const planned = targetClass ? plans.get(targetClass)?.[st.personId] : undefined;
      const sameLetter = nextSections.find(
        (n) => n.classId === targetClass && n.label.split('-').pop() === letter,
      );
      const fallback = nextSections.find((n) => n.classId === targetClass);
      rows.push({
        studentId: st.personId,
        name: st.name,
        classId: cls.classId,
        className: cls.name,
        sectionLabel: s.label,
        outcome,
        basis,
        lastPercentBp: res?.percentBp ?? null,
        belowPass: below,
        nextClassId: targetClass,
        nextSectionId: planned ?? sameLetter?.sectionId ?? fallback?.sectionId ?? null,
      });
    }
  }
  return {
    from,
    to,
    checklist:
      (unpublished?.n ?? 0) > 0 ? [{ code: 'exams_unpublished', count: unpublished?.n ?? 0 }] : [],
    rows,
    nextSections: nextSections.map((n) => ({
      sectionId: n.sectionId,
      classId: n.classId,
      label: n.label,
    })),
  };
}

async function place(tx: Tx, institutionId: string) {
  const p = await institutionPlace(tx, institutionId);
  if (!p) throw new RolloverError('institution_not_found');
  return p;
}

export async function previewRollover(
  deps: RolloverDeps,
  actor: Actor,
  input: { institutionId: string; fromYearId: string; toYearId: string },
): Promise<Preview> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'school.rollover.manage', {
      orgId: actor.orgId,
      place: await place(tx, input.institutionId),
    });
    return draft(tx, input.institutionId, input.fromYearId, input.toYearId);
  });
}

export type Override = {
  studentId: string;
  outcome: Exclude<Outcome, 'review'>;
  reason: string;
  nextSectionId?: string | null | undefined;
};

/**
 * Commits the year end for one institution: old enrolments get their outcome, promoted and
 * detained students get a new enrolment on the next year's first day (roll numbers by name),
 * leavers' memberships end. Every review row needs a decision; every override needs a reason.
 */
export async function commitRollover(
  deps: RolloverDeps,
  actor: Actor,
  input: { institutionId: string; fromYearId: string; toYearId: string; overrides: Override[] },
): Promise<{ rolloverId: string; promoted: number; detained: number; passedOut: number }> {
  if (input.overrides.some((o) => o.reason.trim().length < 3))
    throw new RolloverError('reason_required');
  const p = await withTenant(deps.db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.rollover.manage', resource: { orgId: actor.orgId, place: p } },
    async (tx) => {
      const d = await draft(tx, input.institutionId, input.fromYearId, input.toYearId);
      const byStudent = new Map(input.overrides.map((o) => [o.studentId, o]));
      const final = d.rows.map((r) => {
        const o = byStudent.get(r.studentId);
        if (!o) return { ...r, reason: null as string | null };
        // Detained repeats the same class next year.
        const nextClassId =
          o.outcome === 'promoted' ? r.nextClassId : o.outcome === 'detained' ? r.classId : null;
        const nextSectionId =
          o.nextSectionId ??
          (nextClassId === r.nextClassId
            ? r.nextSectionId
            : (d.nextSections.find((n) => n.classId === nextClassId)?.sectionId ?? null));
        return {
          ...r,
          outcome: o.outcome as Outcome,
          nextClassId,
          nextSectionId,
          reason: o.reason.trim(),
        };
      });
      const undecided = final.filter((r) => r.outcome === 'review');
      if (undecided.length > 0)
        throw new RolloverError('review_pending', { students: undecided.map((r) => r.name) });
      const homeless = final.filter(
        (r) => (r.outcome === 'promoted' || r.outcome === 'detained') && !r.nextSectionId,
      );
      if (homeless.length > 0)
        throw new RolloverError('next_year_not_ready', { students: homeless.length });

      const [ro] = await tx.execute<{ id: string }>(sql`
      insert into school_rollover (org_id, institution_id, from_year_id, to_year_id, rows, committed_by_person_id)
      values (app_current_org(), ${input.institutionId}, ${input.fromYearId}, ${input.toYearId},
        ${JSON.stringify(final.map((r) => ({ studentId: r.studentId, outcome: r.outcome, nextSectionId: r.nextSectionId, reason: r.reason })))}::jsonb,
        ${actor.personId})
      on conflict do nothing returning id::text`);
      if (!ro) throw new RolloverError('already_rolled_over');
      const end = lastDay(d.from);
      // Roll numbers by name within each new section.
      const bySection = new Map<string, typeof final>();
      for (const r of final)
        if (r.nextSectionId)
          bySection.set(r.nextSectionId, [...(bySection.get(r.nextSectionId) ?? []), r]);
      const roll = new Map<string, number>();
      for (const list of bySection.values()) {
        [...list]
          .sort((a, b) => a.name.localeCompare(b.name))
          .forEach((r, i) => roll.set(r.studentId, i + 1));
      }
      let promoted = 0;
      let detained = 0;
      let passedOut = 0;
      for (const r of final) {
        const facts = await enrolmentFacts(tx, r.studentId, end);
        if (!facts) continue;
        if (r.outcome === 'passed_out') {
          await setOutcome(tx, { personId: r.studentId, onDate: end, status: 'promoted' });
          await studentLeaves(tx, {
            personId: r.studentId,
            institutionId: input.institutionId,
            lastDay: end,
            status: 'passed_out',
          });
          passedOut++;
          continue;
        }
        await setOutcome(tx, {
          personId: r.studentId,
          onDate: end,
          status: r.outcome === 'detained' ? 'detained' : 'promoted',
        });
        await enrolForRollover(tx, {
          rolloverId: ro.id,
          personId: r.studentId,
          institutionId: input.institutionId,
          sectionId: r.nextSectionId as string,
          admissionNumber: facts.admissionNumber,
          rollNumber: roll.get(r.studentId) ?? null,
          from: d.to.starts,
          until: d.to.ends,
        });
        await continueMembership(tx, {
          personId: r.studentId,
          institutionId: input.institutionId,
          onDate: end,
          until: d.to.ends,
        });
        if (r.outcome === 'detained') detained++;
        else promoted++;
      }
      return {
        result: { rolloverId: ro.id, promoted, detained, passedOut },
        audit: {
          action: 'school.rollover.manage',
          entityType: 'school_rollover',
          entityId: ro.id,
          dataClass: 'personal',
          detail: { promoted, detained, passedOut, overrides: input.overrides.length },
        },
        events: [
          {
            type: ROLLOVER_COMMITTED,
            payload: {
              rolloverId: ro.id,
              institutionId: input.institutionId,
              toYearId: input.toYearId,
            },
          },
        ],
      };
    },
  );
}

/** Undo while the new year is unused: no attendance taken, no invoices issued for it. */
export async function undoRollover(
  deps: RolloverDeps,
  actor: Actor,
  rolloverId: string,
): Promise<void> {
  const p = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from school_rollover where org_id = app_current_org() and id = ${rolloverId}`);
    if (!r) throw new RolloverError('rollover_not_found');
    return place(tx, r.institutionId);
  });
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.rollover.manage', resource: { orgId: actor.orgId, place: p } },
    async (tx) => {
      const [r] = await tx.execute<{
        institutionId: string;
        fromYearId: string;
        toYearId: string;
        rows: { studentId: string; outcome: Outcome }[];
      }>(sql`
      select institution_id::text as "institutionId", from_year_id::text as "fromYearId", to_year_id::text as "toYearId", rows
      from school_rollover where org_id = app_current_org() and id = ${rolloverId} and state = 'committed' for update`);
      if (!r) throw new RolloverError('rollover_not_found');
      const { from, to } = await years(tx, r.institutionId, r.fromYearId, r.toYearId);
      const ids = r.rows.map((x) => x.studentId);
      if (
        (await anyAttendanceFrom(tx, ids, to.starts)) ||
        (await anyInvoicesFrom(tx, ids, to.starts))
      ) {
        throw new RolloverError('new_year_in_use');
      }
      await undoRolloverEnrolments(tx, rolloverId);
      const end = lastDay(from);
      for (const row of r.rows) {
        await setOutcome(tx, { personId: row.studentId, onDate: end, status: 'active' });
        if (row.outcome === 'passed_out')
          await studentReturns(tx, {
            personId: row.studentId,
            institutionId: r.institutionId,
            until: from.ends,
          });
      }
      await tx.execute(sql`
      update school_rollover set state = 'undone', undone_by_person_id = ${actor.personId}, undone_at = now()
      where org_id = app_current_org() and id = ${rolloverId}`);
      return {
        result: undefined,
        audit: {
          action: 'school.rollover.manage',
          entityType: 'school_rollover',
          entityId: rolloverId,
          dataClass: 'personal',
          detail: { undone: true },
        },
        events: [{ type: ROLLOVER_UNDONE, payload: { rolloverId } }],
      };
    },
  );
}

export type SectionPlanView = {
  classId: string;
  sections: { sectionId: string; label: string; capacity: number }[];
  pupils: (Pupil & { name: string; fromSection: string })[];
  plan: Plan;
  keepApart: [string, string][];
  balance: Balance[];
  problems: Problem[];
  saved: boolean;
};

async function planInputs(
  tx: Tx,
  input: { institutionId: string; fromYearId: string; toYearId: string; classId: string },
) {
  const d = await draft(tx, input.institutionId, input.fromYearId, input.toYearId);
  const movers = d.rows.filter(
    (r) => r.nextClassId === input.classId && r.outcome !== 'passed_out',
  );
  const pupils: SectionPlanView['pupils'] = [];
  for (const m of movers) {
    const f = await studentFacts(tx, m.studentId);
    pupils.push({
      id: m.studentId,
      name: m.name,
      gender: f?.gender ?? null,
      scoreBp: m.lastPercentBp,
      fromSection: m.sectionLabel,
    });
  }
  const sections = (await sectionsOn(tx, input.institutionId, d.to.starts))
    .filter((s) => s.classId === input.classId)
    .map((s) => ({ sectionId: s.sectionId, label: s.label, capacity: 40 }));
  const [saved] = await tx.execute<{ assignments: Plan; keepApart: [string, string][] }>(sql`
    select assignments, keep_apart as "keepApart" from school_section_plan
    where org_id = app_current_org() and to_year_id = ${input.toYearId} and class_id = ${input.classId}`);
  return { pupils, sections, saved: saved ?? null };
}

function view(
  classId: string,
  x: Awaited<ReturnType<typeof planInputs>>,
  plan: Plan,
  keepApart: [string, string][],
  saved: boolean,
): SectionPlanView {
  const secs = x.sections.map((s) => ({ id: s.sectionId, capacity: s.capacity }));
  return {
    classId,
    sections: x.sections,
    pupils: x.pupils,
    plan,
    keepApart,
    balance: balance(x.pupils, secs, plan),
    problems: problems(x.pupils, secs, plan, keepApart),
    saved,
  };
}

/** The section plan for a class of the coming year: the saved one, or a fresh balanced one. */
export async function sectionPlan(
  deps: RolloverDeps,
  actor: Actor,
  input: {
    institutionId: string;
    fromYearId: string;
    toYearId: string;
    classId: string;
    regenerate?: boolean | undefined;
    keepApart?: [string, string][] | undefined;
  },
): Promise<SectionPlanView> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'school.rollover.manage', {
      orgId: actor.orgId,
      place: await place(tx, input.institutionId),
    });
    const x = await planInputs(tx, input);
    const keepApart = input.keepApart ?? x.saved?.keepApart ?? [];
    if (x.saved && !input.regenerate)
      return view(input.classId, x, x.saved.assignments, keepApart, true);
    const secs = x.sections.map((s) => ({ id: s.sectionId, capacity: s.capacity }));
    return view(input.classId, x, generate(x.pupils, secs, keepApart), keepApart, false);
  });
}

/** Saves a plan (generated, then adjusted by hand). Problems are shown, not blocked: a person decides. */
export async function saveSectionPlan(
  deps: RolloverDeps,
  actor: Actor,
  input: {
    institutionId: string;
    fromYearId: string;
    toYearId: string;
    classId: string;
    plan: Plan;
    keepApart: [string, string][];
  },
): Promise<SectionPlanView> {
  const p = await withTenant(deps.db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.rollover.manage', resource: { orgId: actor.orgId, place: p } },
    async (tx) => {
      const x = await planInputs(tx, input);
      const valid = new Set(x.sections.map((s) => s.sectionId));
      const plan = Object.fromEntries(
        Object.entries(input.plan).filter(
          ([pupil, s]) => valid.has(s) && x.pupils.some((q) => q.id === pupil),
        ),
      );
      await tx.execute(sql`
      insert into school_section_plan (org_id, to_year_id, class_id, assignments, keep_apart, updated_by_person_id)
      values (app_current_org(), ${input.toYearId}, ${input.classId}, ${JSON.stringify(plan)}::jsonb, ${JSON.stringify(input.keepApart)}::jsonb, ${actor.personId})
      on conflict (org_id, to_year_id, class_id) do update set assignments = excluded.assignments, keep_apart = excluded.keep_apart,
        updated_by_person_id = excluded.updated_by_person_id, updated_at = now()`);
      return {
        result: view(input.classId, x, plan, input.keepApart, true),
        audit: {
          action: 'school.rollover.manage',
          entityType: 'school_class',
          entityId: input.classId,
          dataClass: 'personal',
          detail: { pupils: Object.keys(plan).length },
        },
      };
    },
  );
}

export type RolloverSummary = {
  id: string;
  fromYear: string;
  toYear: string;
  state: string;
  committedAt: string;
  students: number;
};

export async function listRollovers(
  deps: RolloverDeps,
  actor: Actor,
  institutionId: string,
): Promise<RolloverSummary[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'school.rollover.manage', {
      orgId: actor.orgId,
      place: await place(tx, institutionId),
    });
    return [
      ...(await tx.execute<RolloverSummary>(sql`
        select r.id::text, f.label as "fromYear", t.label as "toYear", r.state, r.committed_at::text as "committedAt",
          jsonb_array_length(r.rows) as students
        from school_rollover r
        join school_year f on f.org_id = r.org_id and f.id = r.from_year_id
        join school_year t on t.org_id = r.org_id and t.id = r.to_year_id
        where r.org_id = app_current_org() and r.institution_id = ${institutionId} order by r.committed_at desc`)),
    ];
  });
}
