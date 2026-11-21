// Each year has its own structure; sections change mid-year without attendance clashes; fees
// belong to a year (owner's brief, 20 Nov 2026). On a real school, all data synthetic.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant, type Tx } from '@campusverse/db';
import { addMembership, createPerson, ensureStudentProfile } from '@campusverse/people-records';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { attendanceTaken, markingSheet, submitAttendance } from '@campusverse/school-attendance';
import { changeSection, enrol, sectionOptions } from '@campusverse/school-enrolment';
import {
  addClassToYear,
  addSection,
  applyStructure,
  classesOverview,
  provisionSchool,
  removeClassFromYear,
  removeSection,
  schoolAudience,
  setSectionClosed,
  setUpNextYear,
  updateSection,
} from '@campusverse/school-setup';
import {
  adjustInvoice,
  billStudent,
  createHead,
  issueInvoices,
  previewIssue,
  publishPlan,
  savePlan,
} from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const finance = { db, permissions, audience: schoolAudience, gateway: null };
afterAll(() => close());

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const phone = () => `9${randomInt(100_000_000, 999_999_999)}`;
const eventId = () => {
  const hex = Date.now().toString(16).padStart(12, '0');
  const r = randomUUID().replaceAll('-', '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${r.slice(13, 16)}-8${r.slice(17, 20)}-${r.slice(20, 32)}`;
};
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string }) => e.code ?? String(e),
  );

let school: Awaited<ReturnType<typeof provisionSchool>>;
let owner: Actor;
let yearId: string;
const T = () => withTenant;

async function overview() {
  return classesOverview(db, permissions, owner, school.institutionId);
}
async function sectionId(year: string, label: string) {
  const y = (await overview()).years.find((x) => x.yearId === year || x.label === year);
  return y?.classes.flatMap((c) => c.sections).find((s) => s.label === label)?.sectionId ?? '';
}
async function student(tx: Tx, name: string, section: string, from: string, until: string) {
  const id = await createPerson(tx, { legalName: name, source: 'admission' });
  await ensureStudentProfile(tx, id);
  await addMembership(tx, {
    personId: id,
    institutionId: school.institutionId,
    kind: 'student',
    from,
    until,
  });
  await enrol(tx, {
    personId: id,
    institutionId: school.institutionId,
    sectionId: section,
    admissionNumber: `YS-${randomInt(1e7)}`,
    rollNumber: null,
    from,
    until,
  });
  return id;
}

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic Year Structure School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner: { name: 'Owner Structure', phone: phone() },
  });
  owner = { accountId: school.ownerAccountId, orgId: school.orgId, personId: school.ownerPersonId };
  yearId = (
    await applyStructure(db, permissions, owner, school.institutionId, {
      board: 'CBSE',
      yearLabel: '2026-27',
      starts: iso(-60),
      ends: iso(300),
      classes: [
        { code: '1', sections: 3, capacity: 30 },
        { code: '2', sections: 2, capacity: 30 },
      ],
    })
  ).yearId;
});

describe('a year’s structure', () => {
  it('adds, renames, resizes, removes unused sections and closes used ones', async () => {
    const oneA = await sectionId(yearId, 'Class 1-A');
    const oneC = await sectionId(yearId, 'Class 1-C');
    await T()(db, school.orgId, async (tx) => {
      await student(tx, 'Synthetic Asha One', oneA, iso(-60), iso(301));
      await student(tx, 'Synthetic Bilal One', oneA, iso(-60), iso(301));
    });
    let y = (await overview()).years[0];
    expect(y?.classes.find((c) => c.code === '1')?.sections.map((s) => [s.name, s.inUse])).toEqual([
      ['A', true],
      ['B', false],
      ['C', false],
    ]);

    // Capacity can't go below the students in it; a name can't be used twice.
    expect(
      await code(updateSection(db, permissions, owner, { sectionId: oneA, capacity: 1 })),
    ).toBe('below_headcount');
    await updateSection(db, permissions, owner, { sectionId: oneA, capacity: 25, name: 'a1' });
    expect(
      await code(
        addSection(db, permissions, owner, {
          yearId,
          classId: y?.classes[0]?.classId ?? '',
          name: 'B',
          capacity: 30,
        }),
      ),
    ).toBe('section_name_taken');

    // Used sections are closed, not removed; unused ones go.
    expect(await code(removeSection(db, permissions, owner, oneA))).toBe('section_in_use');
    await removeSection(db, permissions, owner, oneC);
    await setSectionClosed(db, permissions, owner, { sectionId: oneA, closed: true });
    await expect(
      T()(db, school.orgId, (tx) => student(tx, 'Synthetic Late Joiner', oneA, iso(0), iso(301))),
    ).rejects.toMatchObject({ code: 'section_closed' });
    y = (await overview()).years[0];
    expect(y?.classes.find((c) => c.code === '1')?.sections.map((s) => [s.name, s.closed])).toEqual(
      [
        ['A1', true],
        ['B', false],
      ],
    );

    // Class 4 starts running this year, with subjects; then stops again.
    const { classId: four } = await addClassToYear(db, permissions, owner, {
      yearId,
      code: '4',
      sections: 2,
      capacity: 35,
    });
    const subjects = () =>
      T()(db, school.orgId, async (tx) => {
        const [r] = await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from school_subject_offering
          where org_id = app_current_org() and year_id = ${yearId} and class_id = ${four}`);
        return r?.n ?? 0;
      });
    expect(await subjects()).toBeGreaterThan(0);
    expect(
      await code(
        addClassToYear(db, permissions, owner, { yearId, code: '4', sections: 1, capacity: 30 }),
      ),
    ).toBe('class_runs');
    await removeClassFromYear(db, permissions, owner, { yearId, classId: four });
    expect(await subjects()).toBe(0);
    expect((await overview()).years[0]?.classes.map((c) => c.code)).toEqual(['1', '2']);
  });

  it('sets up next year from an edited proposal: one class dropped, one widened, one added', async () => {
    await expect(
      setUpNextYear(db, permissions, owner, school.institutionId, {
        classes: [
          { code: '2', sections: [{ name: 'A', capacity: 30 }] },
          { code: '2', sections: [{ name: 'B', capacity: 30 }] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid_structure' });
    const next = await setUpNextYear(db, permissions, owner, school.institutionId, {
      classes: [
        {
          code: '2',
          sections: ['A', 'B', 'C'].map((name) => ({ name, capacity: 35 })),
        },
        { code: '4', sections: ['A', 'B'].map((name) => ({ name, capacity: 30 })) },
      ],
    });
    expect(next.sections).toBe(5);
    const y = (await overview()).years.find((x) => x.label === next.label);
    expect(y?.classes.map((c) => [c.code, c.sections.map((s) => s.name).join('')])).toEqual([
      ['2', 'ABC'],
      ['4', 'AB'],
    ]);
    // This year is untouched.
    expect(
      (await overview()).years.find((x) => x.yearId === yearId)?.classes.map((c) => c.code),
    ).toEqual(['1', '2']);
    await expect(setUpNextYear(db, permissions, owner, school.institutionId)).rejects.toMatchObject(
      {
        code: 'next_year_exists',
      },
    );
  });
});

describe('a section change mid-year', () => {
  it('starts after any day either register was taken; attendance never clashes', async () => {
    const twoA = await sectionId(yearId, 'Class 2-A');
    const twoB = await sectionId(yearId, 'Class 2-B');
    const [ravi, meera] = await T()(db, school.orgId, async (tx) => [
      await student(tx, 'Synthetic Ravi Two', twoA, iso(-60), iso(301)),
      await student(tx, 'Synthetic Meera Two', twoA, iso(-60), iso(301)),
    ]);
    const deps = { db, permissions };
    expect(
      await submitAttendance(deps, owner, {
        eventId: eventId(),
        deviceId: null,
        occurredAt: new Date().toISOString(),
        sectionId: twoA,
        onDate: iso(0),
        marks: [{ personId: ravi ?? '', status: 'absent' }],
      }),
    ).toEqual({ outcome: 'accepted' });

    // 2-A is already taken today: the move starts tomorrow, with the next roll number.
    const ports = { attendanceTaken };
    const options = await sectionOptions(db, permissions, owner, ravi ?? '', ports);
    expect(options.options.map((o) => [o.label, o.earliest, o.nextRoll])).toEqual([
      ['Class 2-B', iso(1), 1],
    ]);
    await expect(
      changeSection(
        db,
        permissions,
        owner,
        { personId: ravi ?? '', sectionId: twoB, from: iso(0), reason: 'Balance' },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'attendance_taken', details: { days: [iso(0)] } });
    expect(
      await changeSection(
        db,
        permissions,
        owner,
        { personId: ravi ?? '', sectionId: twoB, from: iso(1), reason: 'Balance' },
        ports,
      ),
    ).toEqual({ rollNumber: 1 });

    // A move made without the check (as before this release) still never loses 2-B's day:
    // Meera keeps today's mark from 2-A, and 2-B's register goes in for everyone else.
    await changeSection(db, permissions, owner, {
      personId: meera ?? '',
      sectionId: twoB,
      from: iso(0),
      reason: 'Old move',
    });
    const sheet = await markingSheet(deps, owner, { sectionId: twoB, onDate: iso(0) });
    expect(sheet.students.map((s) => [s.name, s.status, s.markedIn])).toEqual([
      ['Synthetic Meera Two', 'present', 'Class 2-A'],
    ]);
    expect(
      await submitAttendance(deps, owner, {
        eventId: eventId(),
        deviceId: null,
        occurredAt: new Date().toISOString(),
        sectionId: twoB,
        onDate: iso(0),
        marks: [],
      }),
    ).toEqual({ outcome: 'accepted' });
    const days = await T()(db, school.orgId, (tx) =>
      tx.execute<{ n: number }>(sql`
        select count(*)::int as n from school_attendance_day
        where org_id = app_current_org() and person_id = ${meera ?? ''} and on_date = ${iso(0)}::date`),
    );
    expect(days[0]?.n).toBe(1);
  });
});

describe('fees belong to a year', () => {
  it('bills the year’s students, refuses dates outside it, and a closed year takes no new charges', async () => {
    const [cur, next] = await T()(db, school.orgId, (tx) =>
      tx.execute<{ id: string; starts: string; ends: string }>(sql`
        select id::text, lower(valid_during)::text as starts, upper(valid_during)::text as ends
        from school_year where org_id = app_current_org() and institution_id = ${school.institutionId}
        order by lower(valid_during)`),
    );
    const classTwo =
      (await overview()).years[0]?.classes.find((c) => c.code === '2')?.classId ?? '';
    const head = await createHead(finance, owner, {
      institutionId: school.institutionId,
      code: 'TUITION',
      name: 'Tuition',
      taxClass: 'education_exempt',
      rteExempt: false,
      refundable: false,
    });
    const plan = (periodId: string | null, dueOn: string) =>
      savePlan(finance, owner, {
        institutionId: school.institutionId,
        name: `Class 2 ${dueOn}`,
        groupIds: [classTwo],
        lines: [{ headId: head.id, amountPaise: 500_000 }],
        instalments: [{ label: 'Year', dueOn, shareBp: 10_000 }],
        lateFeePaise: 0,
        graceDays: 0,
        periodId,
      });
    expect(await code(plan(next?.id ?? '', '2040-01-01'))).toBe('due_outside_year');

    // Next year's plan, issued now, reaches only students placed in next year's Class 2.
    const nextPlan = await plan(next?.id ?? '', next?.starts ?? '');
    await publishPlan(finance, owner, nextPlan.id);
    expect((await previewIssue(finance, owner, nextPlan.id)).students).toBe(0);
    const nextTwoA = await sectionId(next?.id ?? '', 'Class 2-A');
    const joiner = await T()(db, school.orgId, (tx) =>
      student(tx, 'Synthetic Next Year Joiner', nextTwoA, next?.starts ?? '', next?.ends ?? ''),
    );
    expect((await previewIssue(finance, owner, nextPlan.id)).students).toBe(1);

    // This year's plan (year inferred from its due date); enrolling into next year bills next year's only.
    const thisPlan = await plan(null, iso(10));
    await publishPlan(finance, owner, thisPlan.id);
    const billed = await T()(db, school.orgId, (tx) =>
      billStudent(tx, schoolAudience, {
        studentId: joiner,
        institutionId: school.institutionId,
        actorId: owner.personId,
        asOf: next?.starts ?? '',
      }),
    );
    expect(billed.invoices).toBe(1);

    // This year closes: no new bills or charges on it; a reduction still goes through.
    await issueInvoices(finance, owner, thisPlan.id);
    const [inv] = await T()(db, school.orgId, (tx) =>
      tx.execute<{ id: string }>(sql`
        select id::text from fee_invoice where org_id = app_current_org() and plan_id = ${thisPlan.id} limit 1`),
    );
    await T()(db, school.orgId, (tx) =>
      tx.execute(
        sql`update school_year set status = 'closed' where org_id = app_current_org() and id = ${cur?.id ?? ''}`,
      ),
    );
    expect(await code(issueInvoices(finance, owner, thisPlan.id))).toBe('year_closed');
    expect(
      await code(
        adjustInvoice(finance, owner, {
          invoiceId: inv?.id ?? '',
          amountPaise: 10_000,
          reason: 'Late charge',
        }),
      ),
    ).toBe('year_closed');
    expect(
      await code(
        adjustInvoice(finance, owner, {
          invoiceId: inv?.id ?? '',
          amountPaise: -10_000,
          reason: 'Waiver',
        }),
      ),
    ).toBe('ok');
    expect(await code(plan(cur?.id ?? '', iso(10)))).toBe('year_closed');
  });
});
