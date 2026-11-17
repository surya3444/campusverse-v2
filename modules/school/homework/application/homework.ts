// Homework and class diary (docs/specs/HOMEWORK.md). A teacher sets homework where they teach
// (subject teacher, or class teacher for any subject); principal and school admin anywhere.
// Guardians are told through communications (app only), see it in the app and tick it done.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { filesInfo, fileState } from '@campusverse/platform-documents';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import {
  PermissionDenied,
  type Actor,
  type createPermissions,
  type Resource,
} from '@campusverse/platform-permissions';
import { holidayOn } from '@campusverse/school-attendance';
import { sectionOf, sectionRoster } from '@campusverse/school-enrolment';
import {
  classTeacherSections,
  sectionInfo,
  teachingPlan,
  teaches,
  type SectionInfo,
} from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { addDays, dueProblem, isSunday, nextSchoolDay } from '../domain/homework.js';

type Permissions = ReturnType<typeof createPermissions>;
export type HomeworkDeps = { db: Db; permissions: Permissions };

export const HOMEWORK_SET = 'school.homework.set.v1';
export const HOMEWORK_DUE_CHANGED = 'school.homework.due_changed.v1';
export const DIARY_WRITTEN = 'school.diary.written.v1';

export class HomeworkError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'section_not_found'
      | 'homework_not_found'
      | 'entry_not_found'
      | 'wrong_school'
      | 'subject_not_offered'
      | 'due_in_past'
      | 'due_too_far'
      | 'withdrawn'
      | 'file_not_found'
      | 'too_many_files'
      | 'not_in_section'
      | 'diary_date'
      | 'not_editable',
  ) {
    super(`homework: ${code}`);
    this.name = 'HomeworkError';
  }
}

export type HomeworkFile = {
  fileId: string;
  fileName: string;
  contentType: string;
  ready: boolean;
};
export type Homework = {
  id: string;
  institutionId: string;
  subjectId: string;
  subject: string;
  title: string;
  details: string;
  setOn: string;
  dueOn: string;
  setBy: string;
  setByName: string;
  state: 'open' | 'withdrawn';
  editedAt: string | null;
  files: HomeworkFile[];
  /** Per section: label, done ticks and children on the roll today. */
  sections: { sectionId: string; label: string; done: number; of: number }[];
  /** Whether the asking person may edit or withdraw it. */
  mine: boolean;
};
export type DiaryEntry = {
  id: string;
  sectionId: string;
  onDate: string;
  subjectId: string | null;
  subject: string | null;
  body: string;
  writtenBy: string;
  writtenByName: string;
  editedAt: string | null;
  mine: boolean;
};
/** A homework's due-date warning: a Sunday or a school holiday (by name). */
export type DueWarning = { kind: 'sunday' } | { kind: 'holiday'; name: string } | null;

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new HomeworkError('institution_not_found');
  return p;
}
async function section(tx: Tx, sectionId: string, onDate: string): Promise<SectionInfo> {
  const s = await sectionInfo(tx, sectionId, onDate);
  if (!s) throw new HomeworkError('section_not_found');
  return s;
}
const at = (s: SectionInfo) => ({ campusId: s.campusId, institutionId: s.institutionId });
const resource = (actor: Actor, s: SectionInfo): Resource => ({ orgId: actor.orgId, place: at(s) });

/** Principal or school admin here: any section, anyone's homework. */
const manages = async (tx: Tx, p: Permissions, actor: Actor, where: Resource['place']) =>
  (
    await p.can(tx, actor, 'school.homework.manage', {
      orgId: actor.orgId,
      ...(where ? { place: where } : {}),
    })
  ).allowed;

/** May set homework or write the diary for this section and subject today. */
async function maySet(
  tx: Tx,
  p: Permissions,
  actor: Actor,
  s: SectionInfo,
  subjectId: string | null,
  on: string,
) {
  if (await manages(tx, p, actor, at(s))) return true;
  if (subjectId === null)
    return (await classTeacherSections(tx, actor.personId, on)).includes(s.sectionId);
  return teaches(tx, { personId: actor.personId, sectionId: s.sectionId, subjectId, onDate: on });
}

async function dueWarning(tx: Tx, institutionId: string, dueOn: string): Promise<DueWarning> {
  if (isSunday(dueOn)) return { kind: 'sunday' };
  const name = await holidayOn(tx, institutionId, dueOn);
  return name ? { kind: 'holiday', name } : null;
}

async function offered(tx: Tx, s: SectionInfo, subjectId: string, on: string) {
  const plan = await teachingPlan(tx, s.institutionId, on);
  return plan.offerings.some((o) => o.classId === s.classId && o.subjectId === subjectId);
}

/** Checks files for a homework: up to three, each stored and not refused by the scan. */
async function checkFiles(tx: Tx, fileIds: string[]) {
  if (fileIds.length > 3) throw new HomeworkError('too_many_files');
  for (const id of fileIds) {
    const st = await fileState(tx, id);
    if (!st || st === 'infected' || st === 'rejected') throw new HomeworkError('file_not_found');
  }
}
async function writeFiles(tx: Tx, homeworkId: string, fileIds: string[]) {
  await tx.execute(sql`
    delete from school_homework_file where org_id = app_current_org() and homework_id = ${homeworkId}`);
  for (const [i, id] of fileIds.entries())
    await tx.execute(sql`
      insert into school_homework_file (org_id, homework_id, file_id, position)
      values (app_current_org(), ${homeworkId}, ${id}, ${i + 1})`);
}

/** What storeFile needs before a homework attachment is uploaded: setting homework at the school. */
export async function homeworkUploadCheck(
  deps: HomeworkDeps,
  actor: Actor,
  institutionId: string,
): Promise<{ permission: string; resource: Resource }> {
  return withTenant(deps.db, actor.orgId, async (tx) => ({
    permission: 'school.homework.set',
    resource: { orgId: actor.orgId, place: await place(tx, institutionId) },
  }));
}

export type HomeworkInput = {
  institutionId: string;
  sectionIds: string[];
  subjectId: string;
  title: string;
  details: string;
  dueOn: string;
  fileIds: string[];
};

/** Sets homework for one or more sections of the school. Guardians are told (HOMEWORK_SET). */
export async function setHomework(
  deps: HomeworkDeps,
  actor: Actor,
  input: HomeworkInput,
): Promise<{ id: string; warning: DueWarning }> {
  const where = await withTenant(deps.db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.homework.set', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const on = await today(tx);
      const problem = dueProblem(on, input.dueOn);
      if (problem) throw new HomeworkError(problem);
      const sectionIds = [...new Set(input.sectionIds)];
      for (const id of sectionIds) {
        const s = await section(tx, id, on);
        if (s.institutionId !== input.institutionId) throw new HomeworkError('wrong_school');
        if (!(await offered(tx, s, input.subjectId, on)))
          throw new HomeworkError('subject_not_offered');
        if (!(await maySet(tx, deps.permissions, actor, s, input.subjectId, on)))
          throw new PermissionDenied('school.homework.set', 'no_relationship');
      }
      await checkFiles(tx, input.fileIds);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_homework (org_id, institution_id, subject_id, title, details, set_on, due_on,
          set_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.subjectId}, ${input.title.trim()},
          ${input.details.trim()}, ${on}::date, ${input.dueOn}::date, ${actor.personId})
        returning id::text`);
      const id = row?.id ?? '';
      for (const sid of sectionIds)
        await tx.execute(sql`
          insert into school_homework_section (org_id, homework_id, section_id)
          values (app_current_org(), ${id}, ${sid})`);
      await writeFiles(tx, id, input.fileIds);
      return {
        result: { id, warning: await dueWarning(tx, input.institutionId, input.dueOn) },
        audit: {
          action: 'school.homework.set',
          entityType: 'school_homework',
          entityId: id,
          dataClass: 'operational',
          detail: {
            title: input.title.trim(),
            dueOn: input.dueOn,
            sections: sectionIds.length,
            files: input.fileIds.length,
          },
        },
        events: [{ type: HOMEWORK_SET, payload: { homeworkId: id } }],
      };
    },
  );
}

async function loadHomework(tx: Tx, id: string) {
  const [h] = await tx.execute<{
    id: string;
    institutionId: string;
    subjectId: string;
    title: string;
    details: string;
    dueOn: string;
    setBy: string;
    state: 'open' | 'withdrawn';
  }>(sql`
    select id::text, institution_id::text as "institutionId", subject_id::text as "subjectId", title, details,
      due_on::text as "dueOn", set_by_person_id::text as "setBy", state
    from school_homework where org_id = app_current_org() and id = ${id} for update`);
  if (!h) throw new HomeworkError('homework_not_found');
  return h;
}
const homeworkPlace = (deps: HomeworkDeps, actor: Actor, id: string) =>
  withTenant(deps.db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from school_homework
      where org_id = app_current_org() and id = ${id}`);
    if (!r) throw new HomeworkError('homework_not_found');
    return place(tx, r.institutionId);
  });

/** Whoever set it, or a manager. */
async function assertMayChange(
  tx: Tx,
  p: Permissions,
  actor: Actor,
  setBy: string,
  where: Resource['place'],
) {
  if (setBy !== actor.personId && !(await manages(tx, p, actor, where)))
    throw new PermissionDenied('school.homework.manage', 'no_relationship');
}

/**
 * Edits title, details, due date and attachments (sections stay). A new due date tells guardians
 * again; other edits show as edited.
 */
export async function editHomework(
  deps: HomeworkDeps,
  actor: Actor,
  input: { homeworkId: string; title: string; details: string; dueOn: string; fileIds: string[] },
): Promise<{ warning: DueWarning }> {
  const where = await homeworkPlace(deps, actor, input.homeworkId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.homework.set', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const h = await loadHomework(tx, input.homeworkId);
      await assertMayChange(tx, deps.permissions, actor, h.setBy, where);
      if (h.state === 'withdrawn') throw new HomeworkError('withdrawn');
      const [set] = await tx.execute<{ setOn: string }>(sql`
        select set_on::text as "setOn" from school_homework where org_id = app_current_org() and id = ${h.id}`);
      const on = await today(tx);
      if (input.dueOn !== h.dueOn) {
        const problem = dueProblem(on, input.dueOn);
        if (problem) throw new HomeworkError(problem);
        if (input.dueOn > addDays(set?.setOn ?? on, 60)) throw new HomeworkError('due_too_far');
      }
      await checkFiles(tx, input.fileIds);
      await tx.execute(sql`
        update school_homework set title = ${input.title.trim()}, details = ${input.details.trim()},
          due_on = ${input.dueOn}::date, edited_at = now()
        where org_id = app_current_org() and id = ${h.id}`);
      await writeFiles(tx, h.id, input.fileIds);
      const moved = input.dueOn !== h.dueOn;
      return {
        result: { warning: await dueWarning(tx, h.institutionId, input.dueOn) },
        audit: {
          action: 'school.homework.edit',
          entityType: 'school_homework',
          entityId: h.id,
          dataClass: 'operational',
          detail: { title: input.title.trim(), was: h.title, dueOn: input.dueOn, wasDue: h.dueOn },
        },
        events: moved ? [{ type: HOMEWORK_DUE_CHANGED, payload: { homeworkId: h.id } }] : [],
      };
    },
  );
}

/** Withdraws homework: gone from the parent app, kept for the record. */
export async function withdrawHomework(
  deps: HomeworkDeps,
  actor: Actor,
  homeworkId: string,
): Promise<void> {
  const where = await homeworkPlace(deps, actor, homeworkId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.homework.set', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const h = await loadHomework(tx, homeworkId);
      await assertMayChange(tx, deps.permissions, actor, h.setBy, where);
      if (h.state === 'withdrawn') throw new HomeworkError('withdrawn');
      await tx.execute(sql`
        update school_homework set state = 'withdrawn', edited_at = now()
        where org_id = app_current_org() and id = ${h.id}`);
      return {
        result: undefined,
        audit: {
          action: 'school.homework.withdraw',
          entityType: 'school_homework',
          entityId: h.id,
          dataClass: 'operational',
          detail: { title: h.title, dueOn: h.dueOn },
        },
      };
    },
  );
}

const homeworkSelect = sql`
  select h.id::text, h.institution_id::text as "institutionId", h.subject_id::text as "subjectId",
    sub.name as subject, h.title, h.details, h.set_on::text as "setOn", h.due_on::text as "dueOn",
    h.set_by_person_id::text as "setBy", h.state, h.edited_at::text as "editedAt",
    coalesce((select array_agg(f.file_id::text order by f.position) from school_homework_file f
      where f.org_id = h.org_id and f.homework_id = h.id), '{}') as "fileIds"
  from school_homework h join school_subject sub on sub.org_id = h.org_id and sub.id = h.subject_id`;
type HomeworkRow = Omit<Homework, 'files' | 'sections' | 'setByName' | 'mine'> & {
  fileIds: string[];
};

/** Fills in files, sections with done counts, and names. */
async function complete(
  tx: Tx,
  p: Permissions,
  actor: Actor,
  rows: HomeworkRow[],
  on: string,
): Promise<Homework[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const files = new Map(
    (
      await filesInfo(
        tx,
        rows.flatMap((r) => r.fileIds),
      )
    ).map((f) => [f.fileId, f]),
  );
  const links = await tx.execute<{ homeworkId: string; sectionId: string }>(sql`
    select homework_id::text as "homeworkId", section_id::text as "sectionId" from school_homework_section
    where org_id = app_current_org() and homework_id = any(${`{${ids.join(',')}}`}::uuid[])`);
  const done = await tx.execute<{ homeworkId: string; studentId: string }>(sql`
    select homework_id::text as "homeworkId", student_person_id::text as "studentId" from school_homework_done
    where org_id = app_current_org() and homework_id = any(${`{${ids.join(',')}}`}::uuid[])`);
  const rosters = new Map<string, Set<string>>();
  const labels = new Map<string, string>();
  for (const sid of new Set(links.map((l) => l.sectionId))) {
    rosters.set(sid, new Set((await sectionRoster(tx, sid, on)).map((r) => r.personId)));
    labels.set(sid, (await sectionInfo(tx, sid, on))?.label ?? '');
  }
  const names = await displayNames(
    tx,
    rows.map((r) => r.setBy),
  );
  const managerAt = new Map<string, boolean>();
  for (const inst of new Set(rows.map((r) => r.institutionId)))
    managerAt.set(inst, await manages(tx, p, actor, (await placeOf(tx, inst)) ?? undefined));
  return rows.map(({ fileIds, ...r }) => ({
    ...r,
    setByName: names[r.setBy] ?? '',
    mine: r.setBy === actor.personId || !!managerAt.get(r.institutionId),
    files: fileIds.flatMap((id) => {
      const f = files.get(id);
      return f
        ? [
            {
              fileId: id,
              fileName: f.fileName,
              contentType: f.contentType,
              ready: f.state === 'clean',
            },
          ]
        : [];
    }),
    sections: links
      .filter((l) => l.homeworkId === r.id)
      .map((l) => {
        const roll = rosters.get(l.sectionId) ?? new Set<string>();
        return {
          sectionId: l.sectionId,
          label: labels.get(l.sectionId) ?? '',
          of: roll.size,
          done: done.filter((d) => d.homeworkId === r.id && roll.has(d.studentId)).length,
        };
      }),
  }));
}

const diarySelect = sql`
  select d.id::text, d.section_id::text as "sectionId", d.on_date::text as "onDate",
    d.subject_id::text as "subjectId", sub.name as subject, d.body,
    d.written_by_person_id::text as "writtenBy", d.edited_at::text as "editedAt"
  from school_diary_entry d left join school_subject sub on sub.org_id = d.org_id and sub.id = d.subject_id`;
type DiaryRow = Omit<DiaryEntry, 'writtenByName' | 'mine'>;
async function namedDiary(tx: Tx, actor: Actor, rows: DiaryRow[], manager: boolean, on: string) {
  const names = await displayNames(
    tx,
    rows.map((r) => r.writtenBy),
  );
  return rows.map((r) => ({
    ...r,
    writtenByName: names[r.writtenBy] ?? '',
    mine: manager || (r.writtenBy === actor.personId && r.onDate === on),
  }));
}

export type MyClass = {
  sectionId: string;
  label: string;
  /** Subjects the person may set homework in for this section. */
  subjects: { subjectId: string; name: string }[];
  classTeacher: boolean;
  homework: number;
  diaryToday: number;
};

/**
 * The sections a person teaches today (all sections for principal and school admin), with the
 * subjects they can set, open homework and today's diary entries.
 */
export async function myClasses(
  deps: HomeworkDeps,
  actor: Actor,
  institutionId: string,
): Promise<{ today: string; nextSchoolDay: string; manager: boolean; classes: MyClass[] }> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const where = await place(tx, institutionId);
    await deps.permissions.assertCan(tx, actor, 'school.homework.read', {
      orgId: actor.orgId,
      place: where,
    });
    const on = await today(tx);
    const manager = await manages(tx, deps.permissions, actor, where);
    const plan = await teachingPlan(tx, institutionId, on);
    const ct = new Set(await classTeacherSections(tx, actor.personId, on));
    const counts = await tx.execute<{ sectionId: string; homework: number; diary: number }>(sql`
      select s.id::text as "sectionId",
        (select count(*)::int from school_homework_section hs join school_homework h
          on h.org_id = hs.org_id and h.id = hs.homework_id
          where hs.org_id = s.org_id and hs.section_id = s.id and h.state = 'open' and h.due_on >= ${on}::date) as homework,
        (select count(*)::int from school_diary_entry d
          where d.org_id = s.org_id and d.section_id = s.id and d.on_date = ${on}::date) as diary
      from school_section s where s.org_id = app_current_org()
        and s.id = any(${`{${plan.sections.map((x) => x.sectionId).join(',')}}`}::uuid[])`);
    const n = new Map(counts.map((c) => [c.sectionId, c]));
    const classes = plan.sections
      .map((sec) => ({
        sectionId: sec.sectionId,
        label: sec.label,
        classTeacher: ct.has(sec.sectionId),
        subjects: plan.offerings
          .filter(
            (o) =>
              o.classId === sec.classId &&
              (manager ||
                ct.has(sec.sectionId) ||
                plan.teachers.some(
                  (t) =>
                    t.sectionId === sec.sectionId &&
                    t.subjectId === o.subjectId &&
                    t.personId === actor.personId,
                )),
          )
          .map((o) => ({ subjectId: o.subjectId, name: o.name })),
        homework: n.get(sec.sectionId)?.homework ?? 0,
        diaryToday: n.get(sec.sectionId)?.diary ?? 0,
      }))
      .filter((c) => c.subjects.length > 0);
    const holidays = new Set<string>();
    for (let i = 1; i <= 14; i++) {
      const d = addDays(on, i);
      if (await holidayOn(tx, institutionId, d)) holidays.add(d);
    }
    return {
      today: on,
      nextSchoolDay: nextSchoolDay(on, (d) => holidays.has(d)),
      manager,
      classes,
    };
  });
}

/** One section: homework still open or due in the last week, and the diary for the last 7 days. */
export async function sectionHomework(
  deps: HomeworkDeps,
  actor: Actor,
  sectionId: string,
): Promise<{ section: string; homework: Homework[]; diary: DiaryEntry[] }> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const on = await today(tx);
    const s = await section(tx, sectionId, on);
    await deps.permissions.assertCan(tx, actor, 'school.homework.read', resource(actor, s));
    const rows = await tx.execute<HomeworkRow>(sql`${homeworkSelect}
      where h.org_id = app_current_org() and h.due_on >= ${addDays(on, -7)}::date
        and exists (select 1 from school_homework_section hs where hs.org_id = h.org_id and hs.homework_id = h.id
          and hs.section_id = ${sectionId})
      order by h.state, h.due_on, h.created_at`);
    const diary = await tx.execute<DiaryRow>(sql`${diarySelect}
      where d.org_id = app_current_org() and d.section_id = ${sectionId} and d.on_date > ${addDays(on, -7)}::date
      order by d.on_date desc, d.created_at`);
    return {
      section: s.label,
      homework: await complete(tx, deps.permissions, actor, [...rows], on),
      diary: await namedDiary(
        tx,
        actor,
        [...diary],
        await manages(tx, deps.permissions, actor, at(s)),
        on,
      ),
    };
  });
}

export type ChildHomework = {
  section: string | null;
  homework: (Omit<Homework, 'sections' | 'mine' | 'setBy'> & { done: boolean })[];
  diary: Omit<DiaryEntry, 'mine' | 'writtenBy'>[];
};

/** A child's homework for their guardians: open, due from three days ago, with their done tick. */
export async function childHomework(
  deps: HomeworkDeps,
  actor: Actor,
  studentId: string,
): Promise<ChildHomework> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const on = await today(tx);
    const sectionId = await sectionOf(tx, studentId, on);
    const s = sectionId ? await sectionInfo(tx, sectionId, on) : null;
    await deps.permissions.assertCan(tx, actor, 'school.homework.read', {
      orgId: actor.orgId,
      ...(s ? { place: at(s) } : {}),
      subjectPersonId: studentId,
    });
    if (!s) return { section: null, homework: [], diary: [] };
    const rows = await tx.execute<HomeworkRow>(sql`${homeworkSelect}
      where h.org_id = app_current_org() and h.state = 'open' and h.due_on >= ${addDays(on, -3)}::date
        and exists (select 1 from school_homework_section hs where hs.org_id = h.org_id and hs.homework_id = h.id
          and hs.section_id = ${s.sectionId})
      order by h.due_on, h.created_at`);
    const done = new Set(
      (
        await tx.execute<{ id: string }>(sql`
          select homework_id::text as id from school_homework_done
          where org_id = app_current_org() and student_person_id = ${studentId}`)
      ).map((r) => r.id),
    );
    const diary = await tx.execute<DiaryRow>(sql`${diarySelect}
      where d.org_id = app_current_org() and d.section_id = ${s.sectionId} and d.on_date > ${addDays(on, -7)}::date
      order by d.on_date desc, d.created_at`);
    const full = await complete(tx, deps.permissions, actor, [...rows], on);
    return {
      section: s.label,
      // Only what a parent needs: no other children's done counts.
      homework: full.map((h) => ({
        id: h.id,
        institutionId: h.institutionId,
        subjectId: h.subjectId,
        subject: h.subject,
        title: h.title,
        details: h.details,
        setOn: h.setOn,
        dueOn: h.dueOn,
        setByName: h.setByName,
        state: h.state,
        editedAt: h.editedAt,
        files: h.files.filter((f) => f.ready),
        done: done.has(h.id),
      })),
      diary: (await namedDiary(tx, actor, [...diary], false, on)).map((d) => ({
        id: d.id,
        sectionId: d.sectionId,
        onDate: d.onDate,
        subjectId: d.subjectId,
        subject: d.subject,
        body: d.body,
        writtenByName: d.writtenByName,
        editedAt: d.editedAt,
      })),
    };
  });
}

/** A guardian's done tick for their child, or taking it back. */
export async function markDone(
  deps: HomeworkDeps,
  actor: Actor,
  input: { homeworkId: string; studentId: string; done: boolean },
): Promise<void> {
  const where = await homeworkPlace(deps, actor, input.homeworkId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.homework.done',
      resource: { orgId: actor.orgId, place: where, subjectPersonId: input.studentId },
    },
    async (tx) => {
      const h = await loadHomework(tx, input.homeworkId);
      if (h.state === 'withdrawn') throw new HomeworkError('withdrawn');
      const sectionId = await sectionOf(tx, input.studentId, await today(tx));
      const [inSection] = await tx.execute(sql`
        select 1 from school_homework_section where org_id = app_current_org() and homework_id = ${h.id}
          and section_id = ${sectionId}`);
      if (!inSection) throw new HomeworkError('not_in_section');
      if (input.done)
        await tx.execute(sql`
          insert into school_homework_done (org_id, homework_id, student_person_id, marked_by_person_id)
          values (app_current_org(), ${h.id}, ${input.studentId}, ${actor.personId})
          on conflict do nothing`);
      else
        await tx.execute(sql`
          delete from school_homework_done where org_id = app_current_org() and homework_id = ${h.id}
            and student_person_id = ${input.studentId}`);
      return {
        result: undefined,
        audit: {
          action: input.done ? 'school.homework.done' : 'school.homework.undone',
          entityType: 'person',
          entityId: input.studentId,
          dataClass: 'personal',
          detail: { homeworkId: h.id },
        },
      };
    },
  );
}

/**
 * A homework attachment the asking person may open: staff of the school, or a guardian of a child
 * in one of its sections (studentId). Returns the file id to serve with cleanFileBytes.
 */
export async function homeworkFile(
  deps: HomeworkDeps,
  actor: Actor,
  input: { homeworkId: string; fileId: string; studentId?: string | undefined },
): Promise<string> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<{ institutionId: string; state: string }>(sql`
      select h.institution_id::text as "institutionId", h.state from school_homework h
      join school_homework_file f on f.org_id = h.org_id and f.homework_id = h.id and f.file_id = ${input.fileId}
      where h.org_id = app_current_org() and h.id = ${input.homeworkId}`);
    if (!r) throw new HomeworkError('file_not_found');
    const where = await place(tx, r.institutionId);
    if (input.studentId) {
      await deps.permissions.assertCan(tx, actor, 'school.homework.read', {
        orgId: actor.orgId,
        place: where,
        subjectPersonId: input.studentId,
      });
      const sectionId = await sectionOf(tx, input.studentId, await today(tx));
      const [inSection] = await tx.execute(sql`
        select 1 from school_homework_section where org_id = app_current_org()
          and homework_id = ${input.homeworkId} and section_id = ${sectionId}`);
      if (!inSection || r.state !== 'open') throw new HomeworkError('file_not_found');
    } else
      await deps.permissions.assertCan(tx, actor, 'school.homework.read', {
        orgId: actor.orgId,
        place: where,
      });
    return input.fileId;
  });
}

/** Writes in a section's class diary: today or a past school day this year. */
export async function writeDiary(
  deps: HomeworkDeps,
  actor: Actor,
  input: { sectionId: string; onDate: string; subjectId: string | null; body: string },
): Promise<{ id: string }> {
  const s0 = await withTenant(deps.db, actor.orgId, async (tx) =>
    section(tx, input.sectionId, await today(tx)),
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.homework.set', resource: resource(actor, s0) },
    async (tx) => {
      const on = await today(tx);
      if (input.onDate > on || input.onDate < s0.yearStarts || isSunday(input.onDate))
        throw new HomeworkError('diary_date');
      if (input.subjectId && !(await offered(tx, s0, input.subjectId, on)))
        throw new HomeworkError('subject_not_offered');
      if (!(await maySet(tx, deps.permissions, actor, s0, input.subjectId, on)))
        throw new PermissionDenied('school.homework.set', 'no_relationship');
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_diary_entry (org_id, section_id, on_date, subject_id, body, written_by_person_id)
        values (app_current_org(), ${input.sectionId}, ${input.onDate}::date, ${input.subjectId}, ${input.body.trim()},
          ${actor.personId})
        returning id::text`);
      const id = row?.id ?? '';
      return {
        result: { id },
        audit: {
          action: 'school.diary.write',
          entityType: 'school_diary_entry',
          entityId: id,
          dataClass: 'operational',
          detail: { sectionId: input.sectionId, onDate: input.onDate },
        },
        events: [{ type: DIARY_WRITTEN, payload: { entryId: id, sectionId: input.sectionId } }],
      };
    },
  );
}

/** Edits a diary entry: its writer on the same day, or a manager any time. */
export async function editDiary(
  deps: HomeworkDeps,
  actor: Actor,
  input: { entryId: string; body: string },
): Promise<void> {
  const s0 = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<{ sectionId: string }>(sql`
      select section_id::text as "sectionId" from school_diary_entry where org_id = app_current_org() and id = ${input.entryId}`);
    if (!r) throw new HomeworkError('entry_not_found');
    return section(tx, r.sectionId, await today(tx));
  });
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.homework.set', resource: resource(actor, s0) },
    async (tx) => {
      const [e] = await tx.execute<{ writtenBy: string; onDate: string; body: string }>(sql`
        select written_by_person_id::text as "writtenBy", on_date::text as "onDate", body
        from school_diary_entry where org_id = app_current_org() and id = ${input.entryId} for update`);
      if (!e) throw new HomeworkError('entry_not_found');
      const own = e.writtenBy === actor.personId && e.onDate === (await today(tx));
      if (!own && !(await manages(tx, deps.permissions, actor, at(s0))))
        throw new HomeworkError('not_editable');
      await tx.execute(sql`
        update school_diary_entry set body = ${input.body.trim()}, edited_at = now()
        where org_id = app_current_org() and id = ${input.entryId}`);
      return {
        result: undefined,
        audit: {
          action: 'school.diary.edit',
          entityType: 'school_diary_entry',
          entityId: input.entryId,
          dataClass: 'operational',
          detail: { was: e.body.slice(0, 200) },
        },
      };
    },
  );
}
