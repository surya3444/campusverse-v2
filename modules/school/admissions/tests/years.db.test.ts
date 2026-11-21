// Admissions work in the school's own years (owner's brief, 20 Nov 2026): only years set up in
// Academic years, only the classes that year runs, and enrolment into that year's open sections.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import {
  addClassToYear,
  applyStructure,
  provisionSchool,
  schoolAudience,
  setSectionClosed,
  setUpNextYear,
} from '@campusverse/school-setup';
import { createHead, publishPlan, savePlan } from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addEnquiry,
  admissionInProgress,
  admissionYears,
  applicationRecord,
  confirm,
  enrolApplicant,
  moveApplication,
  offer,
  pipeline,
  type AdmissionsDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const deps: AdmissionsDeps = { db, permissions, audience: schoolAudience };
const finance = { db, permissions, audience: schoolAudience, gateway: null };
afterAll(() => close());

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const phone = () => `+919${randomInt(100_000_000, 999_999_999)}`;
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string }) => e.code ?? String(e),
  );

let school: Awaited<ReturnType<typeof provisionSchool>>;
let owner: Actor;
let next: { yearId: string; label: string; starts: string };

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic Years School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner: { name: 'Owner Years', phone: phone().slice(3) },
  });
  owner = { accountId: school.ownerAccountId, orgId: school.orgId, personId: school.ownerPersonId };
  await applyStructure(db, permissions, owner, school.institutionId, {
    board: 'CBSE',
    yearLabel: '2026-27',
    starts: iso(-60),
    ends: iso(300),
    classes: [{ code: '1', sections: 1, capacity: 30 }],
  });
  // Next year runs Class 2 only.
  next = await setUpNextYear(db, permissions, owner, school.institutionId, {
    classes: [
      {
        code: '2',
        sections: [
          { name: 'A', capacity: 30 },
          { name: 'B', capacity: 30 },
        ],
      },
    ],
  });
});

const ids = () =>
  withTenant(db, school.orgId, async (tx) => {
    const rows = await tx.execute<{ code: string; id: string }>(sql`
      select code, id::text from school_class where org_id = app_current_org()`);
    return Object.fromEntries(rows.map((r) => [r.code, r.id]));
  });

describe('admissions in the school’s years', () => {
  it('offers only set-up years and the classes each runs; enrols into that year’s open sections', async () => {
    const classes = await ids();
    expect((await admissionYears(deps, owner, school.institutionId)).map((y) => y.label)).toEqual([
      '2026-27',
      next.label,
    ]);
    const lead = (yearLabel: string, classId: string) =>
      addEnquiry(deps, owner, {
        institutionId: school.institutionId,
        yearLabel,
        classId,
        category: 'general',
        source: 'walk_in',
        childName: `Synthetic Year Child ${randomInt(1e6)}`,
        dateOfBirth: '2019-06-01',
        guardianName: 'Synthetic Year Parent',
        guardianPhone: phone(),
      });
    expect(await code(lead('2031-32', classes['1'] ?? ''))).toBe('year_not_set_up');
    expect(
      await code(
        pipeline(deps, owner, { institutionId: school.institutionId, yearLabel: '2031-32' }),
      ),
    ).toBe('year_not_set_up');
    // Class 1 doesn't run next year; Class 2 does.
    expect(await code(lead(next.label, classes['1'] ?? ''))).toBe('class_not_in_year');
    const { id } = await lead(next.label, classes['2'] ?? '');
    const p = await pipeline(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: next.label,
    });
    expect(p.classes.map((c) => [c.name, c.capacity, c.running])).toEqual([['Class 2', 60, true]]);

    // Next year's fees for Class 2, offered and enrolled into a next-year section from its first day.
    const head = await createHead(finance, owner, {
      institutionId: school.institutionId,
      code: 'TUITION',
      name: 'Tuition',
      taxClass: 'education_exempt',
      rteExempt: false,
      refundable: false,
    });
    const plan = await savePlan(finance, owner, {
      institutionId: school.institutionId,
      name: 'Class 2 next year',
      groupIds: [classes['2'] ?? ''],
      lines: [{ headId: head.id, amountPaise: 900_000 }],
      instalments: [{ label: 'Year', dueOn: next.starts, shareBp: 10_000 }],
      lateFeePaise: 0,
      graceDays: 0,
      periodId: next.yearId,
    });
    await publishPlan(finance, owner, plan.id);
    await moveApplication(deps, owner, { applicationId: id, to: 'applied' });
    await offer(deps, owner, id);
    await confirm(deps, owner, id);
    const rec = await applicationRecord(deps, owner, id);
    expect(rec.fees.map((f) => f.name)).toEqual(['Class 2 next year']);
    expect(rec.sections.map((s) => s.label)).toEqual(['Class 2-A', 'Class 2-B']);
    expect(rec.yearStarts).toBe(next.starts);

    // A closed section takes nobody; a day outside the year is refused.
    await setSectionClosed(db, permissions, owner, {
      sectionId: rec.sections[0]?.sectionId ?? '',
      closed: true,
    });
    expect(
      await code(
        enrolApplicant(deps, owner, {
          applicationId: id,
          sectionId: rec.sections[0]?.sectionId ?? '',
          from: next.starts,
        }),
      ),
    ).toBe('section_closed');
    expect(
      await code(
        enrolApplicant(deps, owner, {
          applicationId: id,
          sectionId: rec.sections[1]?.sectionId ?? '',
          from: iso(0),
        }),
      ),
    ).toBe('from_outside_year');
    const enrolled = await enrolApplicant(deps, owner, {
      applicationId: id,
      sectionId: rec.sections[1]?.sectionId ?? '',
      from: next.starts,
    });
    expect(enrolled).toMatchObject({ sectionLabel: 'Class 2-B', invoices: 1 });
    // Seats count the students already in the class, not only families from admissions.
    const filled = await pipeline(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: next.label,
    });
    expect(filled.classes.map((c) => [c.name, c.students, c.promised, c.capacity])).toEqual([
      ['Class 2', 1, 0, 30],
    ]);
    const now = await pipeline(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: '2026-27',
    });
    expect(now.classes.find((c) => c.name === 'Class 1')?.students).toBe(0);

    // A class added to next year shows up for admissions at once.
    await addClassToYear(db, permissions, owner, {
      yearId: next.yearId,
      code: '4',
      sections: 1,
      capacity: 40,
    });
    expect(
      (
        await pipeline(deps, owner, { institutionId: school.institutionId, yearLabel: next.label })
      ).classes.map((c) => c.name),
    ).toEqual(['Class 2', 'Class 4']);
  });

  it('knows a family with an admission in progress (finance refuses their donations)', async () => {
    const classes = await ids();
    const guardianPhone = phone();
    await addEnquiry(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: next.label,
      classId: classes['2'] ?? '',
      category: 'general',
      source: 'walk_in',
      childName: 'Synthetic Donor Child',
      dateOfBirth: '2019-06-01',
      guardianName: 'Synthetic Donor Parent',
      guardianPhone,
    });
    const check = (p: string | null) =>
      withTenant(db, school.orgId, (tx) =>
        admissionInProgress(tx, { institutionId: school.institutionId, phone: p, email: null }),
      );
    expect(await check(guardianPhone)).toBe(true);
    expect(await check(phone())).toBe(false);
    expect(await check(null)).toBe(false);
  });
});
