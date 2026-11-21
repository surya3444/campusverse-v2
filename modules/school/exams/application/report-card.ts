// The full report card (owner's brief, 21 Nov 2026; rule book §13 Exams & Results › Report Cards:
// "Board report cards … remarks"): co-scholastic grades (Work Education, Art Education, Health &
// Physical Education, Discipline) and the class teacher's remark, per exam, on screen. A remark
// can start from a suggestion worked out from the student's own marks and attendance (never a
// language model: a child's marks don't leave the system). Printed when the exam is published.
import { withTenant, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import { PermissionDenied, type Actor } from '@campusverse/platform-permissions';
import { attendanceFigures } from '@campusverse/school-attendance';
import { sectionRoster } from '@campusverse/school-enrolment';
import { sectionsOn, yearsOf } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import {
  fromHundredths,
  hundredths,
  result,
  suggestRemark,
  type Code,
  type Mark,
} from '../domain/results.js';
import {
  ExamError,
  loadExam,
  place,
  rosterDay,
  step,
  type ExamDeps,
  type ExamRow,
} from './exams.js';

/** CBSE's co-scholastic areas: what a school starts with, renamed or added to on screen. */
export const DEFAULT_AREAS = [
  'Work Education',
  'Art Education',
  'Health & Physical Education',
  'Discipline',
] as const;
export const AREA_GRADES = ['A', 'B', 'C'] as const;
export type AreaGrade = (typeof AREA_GRADES)[number];

export type Area = { id: string; name: string; retired: boolean };

/** The institution's areas, the CBSE four put in on first use. */
export async function areasIn(tx: Tx, institutionId: string): Promise<Area[]> {
  const read = () =>
    tx.execute<Area>(sql`
      select id::text, name, retired_at is not null as retired from school_coscholastic_area
      where org_id = app_current_org() and institution_id = ${institutionId} order by seq, name`);
  const rows = await read();
  if (rows.length > 0) return [...rows];
  for (const [i, name] of DEFAULT_AREAS.entries())
    await tx.execute(sql`
      insert into school_coscholastic_area (org_id, institution_id, name, seq)
      values (app_current_org(), ${institutionId}, ${name}, ${i}) on conflict do nothing`);
  return [...(await read())];
}

export async function coScholasticAreas(
  deps: ExamDeps,
  actor: Actor,
  institutionId: string,
): Promise<Area[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'school.exam.read', {
      orgId: actor.orgId,
      place: await place(tx, institutionId),
    });
    return areasIn(tx, institutionId);
  });
}

/** Adds an area, or renames or retires one (a retired area keeps the grades already given). */
export async function saveArea(
  deps: ExamDeps,
  actor: Actor,
  input: { institutionId: string; id?: string | null | undefined; name: string; retired?: boolean },
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new ExamError('bad_area');
  const p = await withTenant(deps.db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.exam.manage', resource: { orgId: actor.orgId, place: p } },
    async (tx) => {
      const areas = await areasIn(tx, input.institutionId);
      if (areas.some((a) => a.id !== input.id && a.name.toLowerCase() === name.toLowerCase()))
        throw new ExamError('area_exists');
      let id = input.id ?? '';
      if (id) {
        if (!areas.some((a) => a.id === id)) throw new ExamError('area_not_found');
        await tx.execute(sql`
          update school_coscholastic_area set name = ${name},
            retired_at = ${input.retired ? sql`coalesce(retired_at, now())` : null}
          where org_id = app_current_org() and id = ${id}`);
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into school_coscholastic_area (org_id, institution_id, name, seq)
          values (app_current_org(), ${input.institutionId}, ${name}, ${areas.length}) returning id::text`);
        id = row?.id ?? '';
      }
      return {
        result: { id },
        audit: {
          action: 'school.exam.manage',
          entityType: 'school_coscholastic_area',
          entityId: id,
          dataClass: 'operational',
          detail: { name, retired: !!input.retired },
        },
      };
    },
  );
}

export type ReportCardSheet = {
  examId: string;
  exam: string;
  examState: string;
  section: string;
  canEdit: boolean;
  areas: Area[];
  students: {
    personId: string;
    name: string;
    rollNumber: number | null;
    grades: Record<string, AreaGrade>;
    remark: string | null;
    /** A remark from the student's marks so far and attendance; null when there are no marks yet. */
    suggestion: string | null;
  }[];
};

/** The class teacher of the section, or someone who manages exams. */
async function mayWrite(
  tx: Tx,
  deps: ExamDeps,
  actor: Actor,
  e: ExamRow,
  sectionId: string,
  d: string,
) {
  const section = (await sectionsOn(tx, e.institutionId, d)).find((s) => s.sectionId === sectionId);
  if (!section || !e.classIds.includes(section.classId)) throw new ExamError('section_not_found');
  if (section.classTeacherPersonId === actor.personId) return section;
  const manage = await deps.permissions.can(tx, actor, 'school.exam.manage', {
    orgId: actor.orgId,
    place: await place(tx, e.institutionId),
  });
  return manage.allowed ? section : null;
}

/** One section's report-card entries for an exam: grades per area, the remark, a suggestion. */
export async function reportCardSheet(
  deps: ExamDeps,
  actor: Actor,
  input: { examId: string; sectionId: string },
): Promise<ReportCardSheet> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const e = await loadExam(tx, input.examId);
    await deps.permissions.assertCan(tx, actor, 'school.exam.read', {
      orgId: actor.orgId,
      place: await place(tx, e.institutionId),
    });
    const d = await rosterDay(tx, e);
    const section = (await sectionsOn(tx, e.institutionId, d)).find(
      (s) => s.sectionId === input.sectionId,
    );
    if (!section || !e.classIds.includes(section.classId)) throw new ExamError('section_not_found');
    const writer = await mayWrite(tx, deps, actor, e, input.sectionId, d);
    const roster = await sectionRoster(tx, input.sectionId, d);
    const areas = (await areasIn(tx, e.institutionId)).filter((a) => !a.retired);
    const grades = await tx.execute<{ studentId: string; areaId: string; grade: AreaGrade }>(sql`
      select student_person_id::text as "studentId", area_id::text as "areaId", grade from school_exam_coscholastic
      where org_id = app_current_org() and exam_id = ${input.examId}`);
    const remarks = new Map(
      (
        await tx.execute<{ studentId: string; remark: string }>(sql`
          select student_person_id::text as "studentId", remark from school_exam_remark
          where org_id = app_current_org() and exam_id = ${input.examId}`)
      ).map((r) => [r.studentId, r.remark]),
    );
    // The suggestion reads the marks entered so far and the year's attendance.
    const papers = await tx.execute<{
      paperId: string;
      subjectId: string;
      subject: string;
      part: string;
      max: string;
    }>(sql`
      select p.id::text as "paperId", p.subject_id::text as "subjectId", s.name as subject, p.part, p.max_marks::text as max
      from school_exam_paper p join school_subject s on s.org_id = p.org_id and s.id = p.subject_id
      where p.org_id = app_current_org() and p.exam_id = ${input.examId} and p.class_id = ${section.classId}
      order by s.code, p.part_seq`);
    const marks = await tx.execute<{
      paperId: string;
      studentId: string;
      value: string | null;
      code: Code | null;
    }>(sql`
      select paper_id::text as "paperId", student_person_id::text as "studentId", value::text, code
      from school_exam_mark where org_id = app_current_org()
        and paper_id = any(${`{${papers.map((p) => p.paperId).join(',')}}`}::uuid[])`);
    const year = (await yearsOf(tx, e.institutionId)).find((y) => y.yearId === e.yearId);
    const until = new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
    const students: ReportCardSheet['students'] = [];
    for (const r of roster) {
      const mine = new Map(
        marks
          .filter((m) => m.studentId === r.personId)
          .map((m): [string, Mark] => [
            m.paperId,
            {
              value: m.value === null ? null : fromHundredths(hundredths(m.value) ?? 0),
              code: m.code,
            },
          ]),
      );
      const res = result([...papers], mine, () => '');
      const att = year
        ? await attendanceFigures(tx, { studentId: r.personId, from: year.starts, until })
        : null;
      students.push({
        personId: r.personId,
        name: r.name,
        rollNumber: r.rollNumber,
        grades: Object.fromEntries(
          grades.filter((g) => g.studentId === r.personId).map((g) => [g.areaId, g.grade]),
        ),
        remark: remarks.get(r.personId) ?? null,
        suggestion: suggestRemark({
          firstName: r.name.split(' ')[0] ?? '',
          subjects: res.subjects.map((s) => ({ subject: s.subject, percentBp: s.percentBp })),
          attendanceBp:
            att && att.workingDays > 0
              ? Math.floor((att.attendedHalfDays * 5_000) / att.workingDays)
              : null,
        }),
      });
    }
    return {
      examId: e.id,
      exam: e.name,
      examState: e.state,
      section: section.label,
      canEdit: !!writer && e.state !== 'published' && e.state !== 'cancelled',
      areas,
      students,
    };
  });
}

/**
 * Saves a section's grades and remarks for an exam, until it is published. A grade left out is
 * cleared; a remark left empty is removed.
 */
export async function saveReportCard(
  deps: ExamDeps,
  actor: Actor,
  input: {
    examId: string;
    sectionId: string;
    entries: {
      studentId: string;
      grades: Record<string, AreaGrade | null>;
      remark: string | null;
    }[];
  },
): Promise<{ saved: number }> {
  return step(deps, actor, input.examId, 'school.exam.enter_marks', async (tx, e) => {
    if (e.state === 'published' || e.state === 'cancelled') throw new ExamError('published');
    const d = await rosterDay(tx, e);
    if (!(await mayWrite(tx, deps, actor, e, input.sectionId, d)))
      throw new PermissionDenied('school.exam.enter_marks', 'no_relationship');
    const roster = new Set((await sectionRoster(tx, input.sectionId, d)).map((r) => r.personId));
    const areas = new Set((await areasIn(tx, e.institutionId)).map((a) => a.id));
    for (const x of input.entries) {
      if (!roster.has(x.studentId))
        throw new ExamError('not_in_section', { studentId: x.studentId });
      const remark = x.remark?.trim() ?? '';
      if (remark.length > 300) throw new ExamError('bad_remark');
      for (const [areaId, grade] of Object.entries(x.grades)) {
        if (!areas.has(areaId)) throw new ExamError('area_not_found');
        if (grade !== null && !AREA_GRADES.includes(grade)) throw new ExamError('bad_grade');
      }
    }
    for (const x of input.entries) {
      for (const [areaId, grade] of Object.entries(x.grades)) {
        if (grade === null)
          await tx.execute(sql`
            delete from school_exam_coscholastic where org_id = app_current_org() and exam_id = ${input.examId}
              and student_person_id = ${x.studentId} and area_id = ${areaId}`);
        else
          await tx.execute(sql`
            insert into school_exam_coscholastic (org_id, exam_id, student_person_id, area_id, grade, entered_by_person_id)
            values (app_current_org(), ${input.examId}, ${x.studentId}, ${areaId}, ${grade}, ${actor.personId})
            on conflict (org_id, exam_id, student_person_id, area_id) do update
              set grade = excluded.grade, entered_by_person_id = excluded.entered_by_person_id, entered_at = now()`);
      }
      const remark = x.remark?.trim() ?? '';
      if (remark)
        await tx.execute(sql`
          insert into school_exam_remark (org_id, exam_id, student_person_id, remark, written_by_person_id)
          values (app_current_org(), ${input.examId}, ${x.studentId}, ${remark}, ${actor.personId})
          on conflict (org_id, exam_id, student_person_id) do update set remark = excluded.remark,
            written_by_person_id = excluded.written_by_person_id, updated_at = now()`);
      else
        await tx.execute(sql`
          delete from school_exam_remark where org_id = app_current_org() and exam_id = ${input.examId}
            and student_person_id = ${x.studentId}`);
    }
    return {
      result: { saved: input.entries.length },
      detail: { sectionId: input.sectionId, saved: input.entries.length },
    };
  });
}
