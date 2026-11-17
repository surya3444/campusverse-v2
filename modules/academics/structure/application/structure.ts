// Academics › Academic Structure (rule book §13.2, §12.4 decisions 2–3): programs, regulations
// with versions, the curriculum of each, batches that keep their regulation, terms, sections and
// enrolments. Students are created through people/records; places through platform/organisation.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import {
  addMembership,
  createPerson,
  displayNames,
  ensureStudentProfile,
} from '@campusverse/people-records';
import { writeAudit, type AuditEntry } from '@campusverse/platform-audit';
import { emit, type EventInput } from '@campusverse/platform-events';
import { institutionProfile, placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { creditFrameworkAt } from '@campusverse/platform-rulepacks';
import { creditFramework } from '@campusverse/rules';
import { sql } from 'drizzle-orm';
import {
  batchYears,
  checkRegulation,
  nextStep,
  parity,
  validCiePlan,
  type CieComponent,
  type CourseKind,
  type ProgramLevel,
  type RegulationCheck,
  type TermKind,
} from '../domain/structure.js';
import { parseEnrolCsv, type EnrolProblem } from '../domain/enrolments.js';

type Permissions = ReturnType<typeof createPermissions>;
export type StructureDeps = { db: Db; permissions: Permissions };

export const READ = 'academics.structure.read';
export const MANAGE = 'academics.structure.manage';
export const ENROL = 'academics.enrolment.manage';

export const REGULATION_PUBLISHED = 'academics.regulation.published.v1';
export const BATCH_CREATED = 'academics.batch.created.v1';
/** A batch moved on a term, or completed. Fees, timetable and registration listen. */
export const TERM_ADVANCED = 'academics.term.advanced.v1';
export const STUDENT_ENROLLED = 'academics.student.enrolled.v1';

export type AcademicsErrorCode =
  | 'institution_not_found'
  | 'program_not_found'
  | 'regulation_not_found'
  | 'batch_not_found'
  | 'section_not_found'
  | 'school_uses_classes'
  | 'code_taken'
  | 'draft_exists'
  | 'regulation_published'
  | 'regulation_not_published'
  | 'regulation_incomplete'
  | 'term_out_of_range'
  | 'batch_completed'
  | 'term_changed'
  | 'term_dates'
  | 'section_full'
  | 'cie_plan_invalid'
  | 'file_columns'
  | 'file_too_long';

export class AcademicsError extends Error {
  constructor(readonly code: AcademicsErrorCode) {
    super(`academics: ${code}`);
    this.name = 'AcademicsError';
  }
}

const isUnique = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.cause?.code ?? e.code) === '23505';
};

type Outcome<T> = { result: T; audit: AuditEntry; events?: EventInput[] };

/**
 * One write: tenant, the institution's place, can(), the work, the audit row and events, in one
 * transaction. `find` names the institution the work belongs to (from a program, batch…).
 */
async function write<T>(
  deps: StructureDeps,
  actor: Actor,
  permission: string,
  find: (tx: Tx) => Promise<string | null>,
  missing: AcademicsErrorCode,
  work: (tx: Tx, institutionId: string) => Promise<Outcome<T>>,
): Promise<T> {
  try {
    return await withTenant(deps.db, actor.orgId, async (tx) => {
      const institutionId = await find(tx);
      const place = institutionId ? await placeOf(tx, institutionId) : null;
      if (!institutionId || !place) throw new AcademicsError(missing);
      await deps.permissions.assertCan(tx, actor, permission, { orgId: actor.orgId, place });
      const outcome = await work(tx, institutionId);
      await writeAudit(tx, actor, outcome.audit);
      for (const e of outcome.events ?? []) await emit(tx, e);
      return outcome.result;
    });
  } catch (err) {
    if (isUnique(err)) throw new AcademicsError('code_taken');
    throw err;
  }
}

async function read<T>(
  deps: StructureDeps,
  actor: Actor,
  find: (tx: Tx) => Promise<string | null>,
  missing: AcademicsErrorCode,
  work: (tx: Tx, institutionId: string) => Promise<T>,
): Promise<T> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const institutionId = await find(tx);
    const place = institutionId ? await placeOf(tx, institutionId) : null;
    if (!institutionId || !place) throw new AcademicsError(missing);
    await deps.permissions.assertCan(tx, actor, READ, { orgId: actor.orgId, place });
    return work(tx, institutionId);
  });
}

const one = async <T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T | null> =>
  ((await tx.execute(q)) as T[])[0] ?? null;

const institutionOfProgram = async (tx: Tx, programId: string) =>
  (
    await one<{ i: string }>(
      tx,
      sql`select institution_id::text as i from academic_program where org_id = app_current_org() and id = ${programId}`,
    )
  )?.i ?? null;
const institutionOfRegulation = async (tx: Tx, regulationId: string) =>
  (
    await one<{ i: string }>(
      tx,
      sql`select p.institution_id::text as i from academic_regulation r
        join academic_program p on p.org_id = r.org_id and p.id = r.program_id
        where r.org_id = app_current_org() and r.id = ${regulationId}`,
    )
  )?.i ?? null;
const institutionOfBatch = async (tx: Tx, batchId: string) =>
  (
    await one<{ i: string }>(
      tx,
      sql`select p.institution_id::text as i from academic_batch b
        join academic_program p on p.org_id = b.org_id and p.id = b.program_id
        where b.org_id = app_current_org() and b.id = ${batchId}`,
    )
  )?.i ?? null;

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export type ProgramRow = {
  id: string;
  code: string;
  name: string;
  level: ProgramLevel;
  termKind: TermKind;
  terms: number;
  framework: string | null;
  regulations: {
    id: string;
    code: string;
    version: number;
    status: 'draft' | 'published';
    effectiveFrom: string;
    courses: number;
    credits: number;
    batches: number;
  }[];
};

export type BatchRow = {
  id: string;
  label: string;
  startYear: number;
  programId: string;
  programCode: string;
  programName: string;
  regulation: string;
  termKind: TermKind;
  terms: number;
  currentTerm: number;
  parity: 'odd' | 'even';
  status: 'running' | 'completed';
  startsOn: string | null;
  endsOn: string | null;
  sections: number;
  students: number;
  intake: number | null;
};

export type StructureOverview = {
  profile: string;
  programs: ProgramRow[];
  batches: BatchRow[];
};

/** Everything on the Academic Structure screen for one institution. */
export async function structureOverview(
  deps: StructureDeps,
  actor: Actor,
  institutionId: string,
): Promise<StructureOverview> {
  return read(
    deps,
    actor,
    async () => institutionId,
    'institution_not_found',
    async (tx) => {
      const profile = (await institutionProfile(tx, institutionId)) ?? 'school';
      const programs = await tx.execute<Omit<ProgramRow, 'regulations'>>(sql`
        select id::text, code, name, level, term_kind as "termKind", terms, framework
        from academic_program where org_id = app_current_org() and institution_id = ${institutionId}
        order by code`);
      const regulations = await tx.execute<
        ProgramRow['regulations'][number] & { programId: string }
      >(sql`
        select r.id::text, r.program_id::text as "programId", r.code, r.version, r.status,
          r.effective_from::text as "effectiveFrom",
          (select count(*)::int from academic_curriculum c where c.org_id = r.org_id and c.regulation_id = r.id) as courses,
          (select coalesce(sum(credits), 0)::float from academic_curriculum c where c.org_id = r.org_id and c.regulation_id = r.id) as credits,
          (select count(*)::int from academic_batch b where b.org_id = r.org_id and b.regulation_id = r.id) as batches
        from academic_regulation r join academic_program p on p.org_id = r.org_id and p.id = r.program_id
        where r.org_id = app_current_org() and p.institution_id = ${institutionId}
        order by r.code desc, r.version desc`);
      const batches = await batchRows(tx, institutionId);
      return {
        profile,
        programs: programs.map((p) => ({
          ...p,
          regulations: regulations
            .filter((r) => r.programId === p.id)
            .map(({ programId, ...r }) => (void programId, r)),
        })),
        batches,
      };
    },
  );
}

export type CurriculumCourse = {
  courseId: string;
  code: string;
  title: string;
  termNumber: number;
  kind: CourseKind;
  lecture: number;
  tutorial: number;
  practical: number;
  credits: number;
  /** Internal assessment components (weights add up to 100); null: one internal mark. */
  cieComponents: CieComponent[] | null;
};

export type RegulationView = {
  id: string;
  programId: string;
  programCode: string;
  programName: string;
  terms: number;
  termKind: TermKind;
  code: string;
  version: number;
  status: 'draft' | 'published';
  effectiveFrom: string;
  minCredits: number | null;
  publishedAt: string | null;
  framework: { code: string; title: string; totalCredits: number } | null;
  courses: CurriculumCourse[];
  check: RegulationCheck;
  batches: number;
};

/** A regulation's courses (every term), for other Academics modules. Call inside the tenant. */
export async function curriculum(tx: Tx, regulationId: string): Promise<CurriculumCourse[]> {
  return tx.execute<CurriculumCourse>(sql`
    select c.course_id::text as "courseId", k.code, k.title, c.term_number as "termNumber", c.kind,
      c.lecture, c.tutorial, c.practical, c.credits::float as credits, c.cie_components as "cieComponents"
    from academic_curriculum c join academic_course k on k.org_id = c.org_id and k.id = c.course_id
    where c.org_id = app_current_org() and c.regulation_id = ${regulationId}
    order by c.term_number, c.kind, k.code`);
}

/** A regulation with its curriculum, term by term, and what it adds up to. */
export async function regulationView(
  deps: StructureDeps,
  actor: Actor,
  regulationId: string,
): Promise<RegulationView> {
  return read(
    deps,
    actor,
    (tx) => institutionOfRegulation(tx, regulationId),
    'regulation_not_found',
    async (tx, institutionId) => {
      const r = await one<
        Omit<RegulationView, 'framework' | 'courses' | 'check'> & {
          framework: string | null;
        }
      >(
        tx,
        sql`
        select r.id::text, p.id::text as "programId", p.code as "programCode", p.name as "programName",
          p.terms, p.term_kind as "termKind", p.framework, r.code, r.version, r.status,
          r.effective_from::text as "effectiveFrom", r.min_credits::float as "minCredits",
          r.published_at::text as "publishedAt",
          (select count(*)::int from academic_batch b where b.org_id = r.org_id and b.regulation_id = r.id) as batches
        from academic_regulation r join academic_program p on p.org_id = r.org_id and p.id = r.program_id
        where r.org_id = app_current_org() and r.id = ${regulationId}`,
      );
      if (!r) throw new AcademicsError('regulation_not_found');
      const courses = await curriculum(tx, regulationId);
      // The credit rules in force when the regulation takes effect (rule packs, §15.1).
      const fw = await creditFrameworkAt(tx, institutionId, r.framework, r.effectiveFrom);
      return {
        ...r,
        framework:
          fw && r.framework
            ? { code: r.framework, title: fw.title, totalCredits: fw.totalCredits }
            : null,
        courses,
        check: checkRegulation(courses, r.terms, r.minCredits, fw),
      };
    },
  );
}

export type BatchView = BatchRow & {
  regulationId: string;
  termHistory: { number: number; startsOn: string; endsOn: string; status: 'open' | 'closed' }[];
  sectionList: { id: string; name: string; capacity: number; students: number }[];
  roster: { personId: string; name: string; registerNumber: string | null; section: string }[];
  /** The regulation's courses for the current term: what registration and the timetable offer. */
  thisTerm: CurriculumCourse[];
};

/** A batch: its terms so far, sections, students, and this term's courses. */
export async function batchView(
  deps: StructureDeps,
  actor: Actor,
  batchId: string,
): Promise<BatchView> {
  return read(
    deps,
    actor,
    (tx) => institutionOfBatch(tx, batchId),
    'batch_not_found',
    async (tx, institutionId) => {
      const b = (await batchRows(tx, institutionId)).find((x) => x.id === batchId);
      const reg = await one<{ id: string }>(
        tx,
        sql`select regulation_id::text as id from academic_batch where org_id = app_current_org() and id = ${batchId}`,
      );
      if (!b || !reg) throw new AcademicsError('batch_not_found');
      const termHistory = await tx.execute<BatchView['termHistory'][number]>(sql`
        select number, starts_on::text as "startsOn", ends_on::text as "endsOn", status
        from academic_term where org_id = app_current_org() and batch_id = ${batchId} order by number`);
      const sectionList = await tx.execute<BatchView['sectionList'][number]>(sql`
        select s.id::text, s.name, s.capacity,
          (select count(*)::int from academic_enrolment e where e.org_id = s.org_id and e.section_id = s.id
            and e.until_term is null) as students
        from academic_section s where s.org_id = app_current_org() and s.batch_id = ${batchId} order by s.name`);
      const enrolled = await tx.execute<{
        personId: string;
        registerNumber: string | null;
        section: string;
      }>(sql`
        select e.student_person_id::text as "personId", e.register_number as "registerNumber", s.name as section
        from academic_enrolment e join academic_section s on s.org_id = e.org_id and s.id = e.section_id
        where e.org_id = app_current_org() and e.batch_id = ${batchId} and e.until_term is null`);
      const names = await displayNames(
        tx,
        enrolled.map((e) => e.personId),
      );
      const roster = enrolled
        .map((e) => ({ ...e, name: names[e.personId] ?? '' }))
        .sort(
          (a, c) =>
            a.section.localeCompare(c.section) ||
            (a.registerNumber ?? '').localeCompare(c.registerNumber ?? '') ||
            a.name.localeCompare(c.name),
        );
      const thisTerm = (await curriculum(tx, reg.id)).filter((c) => c.termNumber === b.currentTerm);
      return { ...b, regulationId: reg.id, termHistory, sectionList, roster, thisTerm };
    },
  );
}

async function batchRows(tx: Tx, institutionId: string): Promise<BatchRow[]> {
  const rows = await tx.execute<Omit<BatchRow, 'parity'>>(sql`
    select b.id::text, b.label, b.start_year as "startYear", p.id::text as "programId",
      p.code as "programCode", p.name as "programName", r.code || ' v' || r.version as regulation,
      p.term_kind as "termKind", p.terms, b.current_term as "currentTerm", b.status, b.intake,
      t.starts_on::text as "startsOn", t.ends_on::text as "endsOn",
      (select count(*)::int from academic_section s where s.org_id = b.org_id and s.batch_id = b.id) as sections,
      (select count(*)::int from academic_enrolment e where e.org_id = b.org_id and e.batch_id = b.id
        and e.until_term is null) as students
    from academic_batch b
    join academic_program p on p.org_id = b.org_id and p.id = b.program_id
    join academic_regulation r on r.org_id = b.org_id and r.id = b.regulation_id
    left join academic_term t on t.org_id = b.org_id and t.batch_id = b.id and t.number = b.current_term
    where b.org_id = app_current_org() and p.institution_id = ${institutionId}
    order by b.status, b.start_year desc, p.code, b.label`);
  return rows.map((b) => ({ ...b, parity: parity(b.currentTerm) }));
}

/**
 * The courses a student's batch studies in its current term, for course registration and the
 * timetable. Call inside the tenant, after the caller's own permission check.
 */
export async function coursesForBatchTerm(
  tx: Tx,
  batchId: string,
): Promise<{ term: number; parity: 'odd' | 'even'; courses: CurriculumCourse[] } | null> {
  const b = await one<{ regulationId: string; term: number }>(
    tx,
    sql`select regulation_id::text as "regulationId", current_term as term
      from academic_batch where org_id = app_current_org() and id = ${batchId} and status = 'running'`,
  );
  if (!b) return null;
  return {
    term: b.term,
    parity: parity(b.term),
    courses: (await curriculum(tx, b.regulationId)).filter((c) => c.termNumber === b.term),
  };
}

// ---------------------------------------------------------------------------------------------
// Curriculum tree
// ---------------------------------------------------------------------------------------------

export async function addProgram(
  deps: StructureDeps,
  actor: Actor,
  input: {
    institutionId: string;
    code: string;
    name: string;
    level: ProgramLevel;
    termKind: TermKind;
    terms: number;
    framework: string | null;
  },
): Promise<string> {
  return write(
    deps,
    actor,
    MANAGE,
    async () => input.institutionId,
    'institution_not_found',
    async (tx, institutionId) => {
      // ponytail: schools keep classes and sections in school/setup until they move onto the engine.
      if ((await institutionProfile(tx, institutionId)) === 'school')
        throw new AcademicsError('school_uses_classes');
      const row = await one<{ id: string }>(
        tx,
        sql`
        insert into academic_program (org_id, institution_id, code, name, level, term_kind, terms, framework)
        values (app_current_org(), ${institutionId}, ${input.code}, ${input.name}, ${input.level},
          ${input.termKind}, ${input.terms}, ${creditFramework(input.framework) ? input.framework : null})
        returning id::text`,
      );
      if (!row) throw new Error('addProgram: no row');
      return {
        result: row.id,
        audit: {
          action: 'academics.program.create',
          entityType: 'academic_program',
          entityId: row.id,
          dataClass: 'operational',
          detail: { code: input.code, level: input.level, terms: input.terms },
        },
      };
    },
  );
}

/**
 * A new draft of a regulation. Version 1 starts empty; a later version starts as a copy of the
 * latest published one, which stays as it is for the batches already on it.
 */
export async function draftRegulation(
  deps: StructureDeps,
  actor: Actor,
  input: { programId: string; code: string; effectiveFrom: string; minCredits: number | null },
): Promise<string> {
  return write(
    deps,
    actor,
    MANAGE,
    (tx) => institutionOfProgram(tx, input.programId),
    'program_not_found',
    async (tx) => {
      const draft = await one<{ id: string }>(
        tx,
        sql`select id::text from academic_regulation where org_id = app_current_org()
          and program_id = ${input.programId} and code = ${input.code} and status = 'draft'`,
      );
      if (draft) throw new AcademicsError('draft_exists');
      const latest = await one<{ id: string; version: number }>(
        tx,
        sql`select id::text, version from academic_regulation where org_id = app_current_org()
          and program_id = ${input.programId} and code = ${input.code} order by version desc limit 1`,
      );
      const version = (latest?.version ?? 0) + 1;
      const row = await one<{ id: string }>(
        tx,
        sql`
        insert into academic_regulation (org_id, program_id, code, version, effective_from, min_credits)
        values (app_current_org(), ${input.programId}, ${input.code}, ${version}, ${input.effectiveFrom}::date,
          ${input.minCredits})
        returning id::text`,
      );
      if (!row) throw new Error('draftRegulation: no row');
      if (latest)
        await tx.execute(sql`
          insert into academic_curriculum (org_id, regulation_id, course_id, term_number, kind, lecture, tutorial, practical, credits)
          select org_id, ${row.id}, course_id, term_number, kind, lecture, tutorial, practical, credits
          from academic_curriculum where org_id = app_current_org() and regulation_id = ${latest.id}`);
      return {
        result: row.id,
        audit: {
          action: 'academics.regulation.draft',
          entityType: 'academic_regulation',
          entityId: row.id,
          dataClass: 'operational',
          detail: { code: input.code, version, from: latest?.id ?? null },
        },
      };
    },
  );
}

async function draftOf(tx: Tx, regulationId: string) {
  const r = await one<{ status: string; terms: number; institutionId: string }>(
    tx,
    sql`select r.status, p.terms, p.institution_id::text as "institutionId" from academic_regulation r
      join academic_program p on p.org_id = r.org_id and p.id = r.program_id
      where r.org_id = app_current_org() and r.id = ${regulationId} for update of r`,
  );
  if (!r) throw new AcademicsError('regulation_not_found');
  if (r.status !== 'draft') throw new AcademicsError('regulation_published');
  return r;
}

/** Puts a course in a draft regulation (adding it to the catalogue if the code is new), or changes it. */
export async function setCurriculumCourse(
  deps: StructureDeps,
  actor: Actor,
  input: {
    regulationId: string;
    code: string;
    title: string;
    termNumber: number;
    kind: CourseKind;
    lecture: number;
    tutorial: number;
    practical: number;
    credits: number;
    cieComponents?: CieComponent[] | null | undefined;
  },
): Promise<string> {
  const plan = input.cieComponents?.map((c) => ({ ...c, name: c.name.trim() })) ?? null;
  if (plan && !validCiePlan(plan)) throw new AcademicsError('cie_plan_invalid');
  return write(
    deps,
    actor,
    MANAGE,
    (tx) => institutionOfRegulation(tx, input.regulationId),
    'regulation_not_found',
    async (tx, institutionId) => {
      const r = await draftOf(tx, input.regulationId);
      if (input.termNumber > r.terms) throw new AcademicsError('term_out_of_range');
      const course = await one<{ id: string }>(
        tx,
        sql`
        insert into academic_course (org_id, institution_id, code, title)
        values (app_current_org(), ${institutionId}, ${input.code}, ${input.title})
        on conflict (org_id, institution_id, code) do update set title = excluded.title
        returning id::text`,
      );
      if (!course) throw new Error('setCurriculumCourse: no course');
      await tx.execute(sql`
        insert into academic_curriculum (org_id, regulation_id, course_id, term_number, kind, lecture, tutorial, practical, credits,
          cie_components)
        values (app_current_org(), ${input.regulationId}, ${course.id}, ${input.termNumber}, ${input.kind},
          ${input.lecture}, ${input.tutorial}, ${input.practical}, ${input.credits},
          ${plan ? JSON.stringify(plan) : null}::jsonb)
        on conflict (org_id, regulation_id, course_id) do update set term_number = excluded.term_number,
          kind = excluded.kind, lecture = excluded.lecture, tutorial = excluded.tutorial,
          practical = excluded.practical, credits = excluded.credits, cie_components = excluded.cie_components`);
      return {
        result: course.id,
        audit: {
          action: 'academics.curriculum.set',
          entityType: 'academic_regulation',
          entityId: input.regulationId,
          dataClass: 'operational',
          detail: {
            course: input.code,
            term: input.termNumber,
            credits: input.credits,
            cie: plan ? plan.map((c) => `${c.name} ${c.maxMarks}/${c.weight}%`).join('; ') : null,
          },
        },
      };
    },
  );
}

export async function removeCurriculumCourse(
  deps: StructureDeps,
  actor: Actor,
  input: { regulationId: string; courseId: string },
): Promise<void> {
  return write(
    deps,
    actor,
    MANAGE,
    (tx) => institutionOfRegulation(tx, input.regulationId),
    'regulation_not_found',
    async (tx) => {
      await draftOf(tx, input.regulationId);
      await tx.execute(sql`
        delete from academic_curriculum where org_id = app_current_org()
          and regulation_id = ${input.regulationId} and course_id = ${input.courseId}`);
      return {
        result: undefined,
        audit: {
          action: 'academics.curriculum.remove',
          entityType: 'academic_regulation',
          entityId: input.regulationId,
          dataClass: 'operational',
          detail: { courseId: input.courseId },
        },
      };
    },
  );
}

/** Publishes a draft: from now on it never changes. Refused while a course sits outside the terms. */
export async function publishRegulation(
  deps: StructureDeps,
  actor: Actor,
  regulationId: string,
): Promise<void> {
  return write(
    deps,
    actor,
    MANAGE,
    (tx) => institutionOfRegulation(tx, regulationId),
    'regulation_not_found',
    async (tx) => {
      const r = await draftOf(tx, regulationId);
      const courses = await curriculum(tx, regulationId);
      const check = checkRegulation(courses, r.terms, null, null);
      if (check.blocking.length) throw new AcademicsError('regulation_incomplete');
      await tx.execute(sql`
        update academic_regulation set status = 'published', published_at = now()
        where org_id = app_current_org() and id = ${regulationId}`);
      return {
        result: undefined,
        audit: {
          action: 'academics.regulation.publish',
          entityType: 'academic_regulation',
          entityId: regulationId,
          dataClass: 'operational',
          detail: { courses: courses.length, credits: check.totalCredits },
        },
        events: [{ type: REGULATION_PUBLISHED, payload: { regulationId } }],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Cohort tree
// ---------------------------------------------------------------------------------------------

const checkDates = (startsOn: string, endsOn: string) => {
  if (!(endsOn > startsOn)) throw new AcademicsError('term_dates');
};

/** A batch on a published regulation, with its first term and sections. */
export async function addBatch(
  deps: StructureDeps,
  actor: Actor,
  input: {
    programId: string;
    regulationId: string;
    startYear: number;
    label: string | null;
    intake: number | null;
    sections: string[];
    capacity: number;
    startsOn: string;
    endsOn: string;
  },
): Promise<string> {
  checkDates(input.startsOn, input.endsOn);
  return write(
    deps,
    actor,
    MANAGE,
    (tx) => institutionOfProgram(tx, input.programId),
    'program_not_found',
    async (tx) => {
      const r = await one<{ status: string; terms: number; termKind: TermKind }>(
        tx,
        sql`select r.status, p.terms, p.term_kind as "termKind" from academic_regulation r
          join academic_program p on p.org_id = r.org_id and p.id = r.program_id
          where r.org_id = app_current_org() and r.id = ${input.regulationId} and r.program_id = ${input.programId}`,
      );
      if (!r) throw new AcademicsError('regulation_not_found');
      if (r.status !== 'published') throw new AcademicsError('regulation_not_published');
      const label = input.label?.trim() || batchYears(input.startYear, r.terms, r.termKind);
      const row = await one<{ id: string }>(
        tx,
        sql`
        insert into academic_batch (org_id, program_id, regulation_id, label, start_year, intake)
        values (app_current_org(), ${input.programId}, ${input.regulationId}, ${label}, ${input.startYear}, ${input.intake})
        returning id::text`,
      );
      if (!row) throw new Error('addBatch: no row');
      await tx.execute(sql`
        insert into academic_term (org_id, batch_id, number, starts_on, ends_on)
        values (app_current_org(), ${row.id}, 1, ${input.startsOn}::date, ${input.endsOn}::date)`);
      for (const name of [...new Set(input.sections)])
        await tx.execute(sql`
          insert into academic_section (org_id, batch_id, name, capacity)
          values (app_current_org(), ${row.id}, ${name}, ${input.capacity})`);
      return {
        result: row.id,
        audit: {
          action: 'academics.batch.create',
          entityType: 'academic_batch',
          entityId: row.id,
          dataClass: 'operational',
          detail: { label, regulationId: input.regulationId, sections: input.sections.length },
        },
        events: [
          { type: BATCH_CREATED, payload: { batchId: row.id, regulationId: input.regulationId } },
        ],
      };
    },
  );
}

export async function addSection(
  deps: StructureDeps,
  actor: Actor,
  input: { batchId: string; name: string; capacity: number },
): Promise<string> {
  return write(
    deps,
    actor,
    MANAGE,
    (tx) => institutionOfBatch(tx, input.batchId),
    'batch_not_found',
    async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        sql`
        insert into academic_section (org_id, batch_id, name, capacity)
        values (app_current_org(), ${input.batchId}, ${input.name}, ${input.capacity}) returning id::text`,
      );
      if (!row) throw new Error('addSection: no row');
      return {
        result: row.id,
        audit: {
          action: 'academics.section.create',
          entityType: 'academic_batch',
          entityId: input.batchId,
          dataClass: 'operational',
          detail: { section: input.name, capacity: input.capacity },
        },
      };
    },
  );
}

/**
 * Moves a batch on from `fromTerm` (the term the person saw, so a second click does nothing):
 * the term closes and the next opens with its dates. After the last term the batch completes and
 * its students' enrolments end as completed. Nothing is copied: same batch, same regulation.
 */
export async function advanceTerm(
  deps: StructureDeps,
  actor: Actor,
  input: { batchId: string; fromTerm: number; next: { startsOn: string; endsOn: string } | null },
): Promise<{ term: number | null; completed: boolean }> {
  return write(
    deps,
    actor,
    MANAGE,
    (tx) => institutionOfBatch(tx, input.batchId),
    'batch_not_found',
    async (tx) => {
      const b = await one<{ current: number; terms: number; status: string; endsOn: string }>(
        tx,
        sql`select b.current_term as current, p.terms, b.status, t.ends_on::text as "endsOn"
          from academic_batch b join academic_program p on p.org_id = b.org_id and p.id = b.program_id
          join academic_term t on t.org_id = b.org_id and t.batch_id = b.id and t.number = b.current_term
          where b.org_id = app_current_org() and b.id = ${input.batchId} for update of b`,
      );
      if (!b) throw new AcademicsError('batch_not_found');
      if (b.status === 'completed') throw new AcademicsError('batch_completed');
      if (b.current !== input.fromTerm) throw new AcademicsError('term_changed');
      const step = nextStep(b.current, b.terms);
      await tx.execute(sql`
        update academic_term set status = 'closed'
        where org_id = app_current_org() and batch_id = ${input.batchId} and number = ${b.current}`);
      if (step.kind === 'open') {
        if (!input.next) throw new AcademicsError('term_dates');
        checkDates(input.next.startsOn, input.next.endsOn);
        if (input.next.startsOn <= b.endsOn) throw new AcademicsError('term_dates');
        await tx.execute(sql`
          insert into academic_term (org_id, batch_id, number, starts_on, ends_on)
          values (app_current_org(), ${input.batchId}, ${step.term}, ${input.next.startsOn}::date, ${input.next.endsOn}::date)`);
        await tx.execute(sql`
          update academic_batch set current_term = ${step.term}
          where org_id = app_current_org() and id = ${input.batchId}`);
      } else {
        await tx.execute(sql`
          update academic_batch set status = 'completed'
          where org_id = app_current_org() and id = ${input.batchId}`);
        await tx.execute(sql`
          update academic_enrolment set until_term = ${b.current}, ended_reason = 'completed'
          where org_id = app_current_org() and batch_id = ${input.batchId} and until_term is null`);
      }
      const term = step.kind === 'open' ? step.term : null;
      return {
        result: { term, completed: step.kind === 'complete' },
        audit: {
          action: 'academics.term.advance',
          entityType: 'academic_batch',
          entityId: input.batchId,
          dataClass: 'operational',
          detail: { from: b.current, to: term, completed: step.kind === 'complete' },
        },
        events: [
          {
            type: TERM_ADVANCED,
            payload: { batchId: input.batchId, from: b.current, to: term },
          },
        ],
      };
    },
  );
}

/**
 * A new student in a batch section, from the batch's current term: one lifelong learner record in
 * people/records, a membership of the institution from the term's first day, and the enrolment.
 */
/** The batch's current term and its first day, and whether it can take students. Inside the tenant. */
async function enrollable(tx: Tx, batchId: string) {
  const b = await one<{ status: string; term: number; startsOn: string }>(
    tx,
    sql`select b.status, b.current_term as term, t.starts_on::text as "startsOn"
      from academic_batch b join academic_term t on t.org_id = b.org_id and t.batch_id = b.id
        and t.number = b.current_term
      where b.org_id = app_current_org() and b.id = ${batchId}`,
  );
  if (!b) throw new AcademicsError('batch_not_found');
  if (b.status === 'completed') throw new AcademicsError('batch_completed');
  return b;
}

/** One student into a section: the lifelong learner record, the membership and the enrolment. */
async function enrolIn(
  tx: Tx,
  institutionId: string,
  b: { term: number; startsOn: string },
  input: {
    batchId: string;
    sectionId: string;
    name: string;
    dateOfBirth: string | null;
    registerNumber: string | null;
  },
): Promise<string> {
  const s = await one<{ capacity: number; n: number }>(
    tx,
    sql`select s.capacity, (select count(*)::int from academic_enrolment e where e.org_id = s.org_id
        and e.section_id = s.id and e.until_term is null) as n
      from academic_section s where s.org_id = app_current_org() and s.id = ${input.sectionId}
        and s.batch_id = ${input.batchId} for update`,
  );
  if (!s) throw new AcademicsError('section_not_found');
  if (s.n >= s.capacity) throw new AcademicsError('section_full');
  const personId = await createPerson(tx, {
    legalName: input.name,
    dateOfBirth: input.dateOfBirth,
    source: 'admission',
  });
  await ensureStudentProfile(tx, personId);
  await addMembership(tx, {
    personId,
    institutionId,
    kind: 'student',
    from: b.startsOn,
    until: null,
  });
  await tx.execute(sql`
    insert into academic_enrolment (org_id, batch_id, section_id, student_person_id, register_number, from_term)
    values (app_current_org(), ${input.batchId}, ${input.sectionId}, ${personId}, ${input.registerNumber}, ${b.term})`);
  return personId;
}

export async function enrolStudent(
  deps: StructureDeps,
  actor: Actor,
  input: {
    batchId: string;
    sectionId: string;
    name: string;
    dateOfBirth: string | null;
    registerNumber: string | null;
  },
): Promise<string> {
  return write(
    deps,
    actor,
    ENROL,
    (tx) => institutionOfBatch(tx, input.batchId),
    'batch_not_found',
    async (tx, institutionId) => {
      const b = await enrollable(tx, input.batchId);
      const personId = await enrolIn(tx, institutionId, b, input);
      return {
        result: personId,
        audit: {
          action: 'academics.student.enrol',
          entityType: 'person',
          entityId: personId,
          dataClass: 'personal',
          detail: { batchId: input.batchId, sectionId: input.sectionId, term: b.term },
        },
        events: [
          {
            type: STUDENT_ENROLLED,
            payload: { personId, batchId: input.batchId, institutionId, term: b.term },
          },
        ],
      };
    },
  );
}

export type EnrolOutcome =
  EnrolProblem | 'unknown_section' | 'register_taken' | 'section_full' | 'ready';
export type EnrolFromFile = {
  rows: {
    line: number;
    name: string;
    registerNumber: string | null;
    section: string;
    outcome: EnrolOutcome;
  }[];
  ready: number;
  enrolled: number;
};

/**
 * A batch's students from a file (onboarding a college): checks every row (a known section with
 * room, a register number not already in the batch or repeated in the file). With `apply`, enrols
 * the rows that are ready, all in one go; nothing is enrolled from a row with a problem.
 * Without a Section column, a batch with one section takes everyone into it.
 */
export async function enrolFromFile(
  deps: StructureDeps,
  actor: Actor,
  input: { batchId: string; csv: string; apply: boolean },
): Promise<EnrolFromFile> {
  const parsed = parseEnrolCsv(input.csv);
  if (!parsed.ok) throw new AcademicsError('file_columns');
  if (parsed.lines.length > 2000) throw new AcademicsError('file_too_long');
  return write(
    deps,
    actor,
    ENROL,
    (tx) => institutionOfBatch(tx, input.batchId),
    'batch_not_found',
    async (tx, institutionId) => {
      const b = await enrollable(tx, input.batchId);
      const sections = await tx.execute<{
        id: string;
        name: string;
        capacity: number;
        n: number;
      }>(sql`
        select s.id::text, s.name, s.capacity, (select count(*)::int from academic_enrolment e
          where e.org_id = s.org_id and e.section_id = s.id and e.until_term is null) as n
        from academic_section s where s.org_id = app_current_org() and s.batch_id = ${input.batchId}`);
      const taken = new Set(
        (
          await tx.execute<{ reg: string }>(sql`
            select upper(register_number) as reg from academic_enrolment
            where org_id = app_current_org() and batch_id = ${input.batchId} and register_number is not null`)
        ).map((r) => r.reg),
      );
      const room = new Map(sections.map((x) => [x.id, x.capacity - x.n]));
      const only = sections.length === 1 ? sections[0] : undefined;
      const rows = parsed.lines.map((l) => {
        const sec = l.section ? sections.find((x) => x.name === l.section) : only;
        const outcome: EnrolOutcome = l.problem
          ? l.problem
          : !sec
            ? l.section
              ? 'unknown_section'
              : 'section_missing'
            : l.registerNumber && taken.has(l.registerNumber.toUpperCase())
              ? 'register_taken'
              : (room.get(sec.id) ?? 0) <= 0
                ? 'section_full'
                : 'ready';
        if (outcome === 'ready' && sec) room.set(sec.id, (room.get(sec.id) ?? 0) - 1);
        return { ...l, sectionId: sec?.id ?? null, section: sec?.name ?? l.section, outcome };
      });
      const ready = rows.filter((r) => r.outcome === 'ready');
      const events: EventInput[] = [];
      if (input.apply)
        for (const r of ready) {
          const personId = await enrolIn(tx, institutionId, b, {
            batchId: input.batchId,
            sectionId: r.sectionId ?? '',
            name: r.name,
            dateOfBirth: r.dateOfBirth,
            registerNumber: r.registerNumber,
          });
          events.push({
            type: STUDENT_ENROLLED,
            payload: { personId, batchId: input.batchId, institutionId, term: b.term },
          });
        }
      return {
        result: {
          rows: rows.map(({ line, name, registerNumber, section, outcome }) => ({
            line,
            name,
            registerNumber,
            section,
            outcome,
          })),
          ready: ready.length,
          enrolled: input.apply ? ready.length : 0,
        },
        audit: {
          action: input.apply ? 'academics.student.enrol_file' : 'academics.student.enrol_check',
          entityType: 'academic_batch',
          entityId: input.batchId,
          dataClass: 'personal',
          detail: {
            rows: rows.length,
            ready: ready.length,
            enrolled: input.apply ? ready.length : 0,
          },
        },
        events,
      };
    },
  );
}

export type BatchFacts = {
  batchId: string;
  programId: string;
  regulationId: string;
  label: string;
  programCode: string;
  institutionId: string;
  currentTerm: number;
  termKind: TermKind;
  status: 'running' | 'completed';
  framework: string | null;
  termStartsOn: string | null;
  termEndsOn: string | null;
  sections: { id: string; name: string }[];
  students: {
    personId: string;
    registerNumber: string | null;
    section: string;
    sectionId: string;
  }[];
};

/**
 * A batch for other Academics modules (registration, timetable, exams): its institution, current
 * term and current students. Call inside the tenant, after the caller's own permission check.
 */
export async function batchFacts(tx: Tx, batchId: string): Promise<BatchFacts | null> {
  const b = await one<Omit<BatchFacts, 'students' | 'sections'>>(
    tx,
    sql`select b.id::text as "batchId", b.program_id::text as "programId", b.regulation_id::text as "regulationId",
      b.label, p.code as "programCode", p.institution_id::text as "institutionId",
      b.current_term as "currentTerm", p.term_kind as "termKind", b.status, p.framework,
      t.starts_on::text as "termStartsOn", t.ends_on::text as "termEndsOn"
    from academic_batch b join academic_program p on p.org_id = b.org_id and p.id = b.program_id
    left join academic_term t on t.org_id = b.org_id and t.batch_id = b.id and t.number = b.current_term
    where b.org_id = app_current_org() and b.id = ${batchId}`,
  );
  if (!b) return null;
  const students = await tx.execute<BatchFacts['students'][number]>(sql`
    select e.student_person_id::text as "personId", e.register_number as "registerNumber", s.name as section,
      s.id::text as "sectionId"
    from academic_enrolment e join academic_section s on s.org_id = e.org_id and s.id = e.section_id
    where e.org_id = app_current_org() and e.batch_id = ${batchId} and e.until_term is null
    order by s.name, e.register_number nulls last`);
  const sections = await tx.execute<{ id: string; name: string }>(sql`
    select id::text, name from academic_section where org_id = app_current_org() and batch_id = ${batchId}
    order by name`);
  return { ...b, sections: [...sections], students: [...students] };
}

/** Running batches of an institution, for pickers in other Academics modules. Call inside the tenant. */
export async function runningBatches(
  tx: Tx,
  institutionId: string,
): Promise<{ batchId: string; name: string; currentTerm: number; termKind: TermKind }[]> {
  return tx.execute(sql`
    select b.id::text as "batchId", p.code || ' ' || b.label as name, b.current_term as "currentTerm",
      p.term_kind as "termKind"
    from academic_batch b join academic_program p on p.org_id = b.org_id and p.id = b.program_id
    where b.org_id = app_current_org() and p.institution_id = ${institutionId} and b.status = 'running'
    order by p.code, b.start_year desc`);
}
