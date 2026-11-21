// Seat draws on a real school (rule book §13.1, §16.2): an RTE lottery with a recorded seed,
// published by a second person into offers and an ordered waitlist; draws that can't hide.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { addPhone, createPerson, ensureStaffProfile } from '@campusverse/people-records';
import { assignRole, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { applyStructure, provisionSchool, schoolAudience } from '@campusverse/school-setup';
import { createHead, publishPlan, savePlan } from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addEnquiry,
  discardDraw,
  drawDetail,
  draws,
  moveApplication,
  pipeline,
  publishDraw,
  setSeats,
  startDraw,
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
const YEAR = '2026-27';

let school: Awaited<ReturnType<typeof provisionSchool>>;
let owner: Actor;
let principal: Actor;
let classId: string;

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic Draw School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner: { name: 'Owner Draws', phone: phone().slice(3) },
  });
  owner = { accountId: school.ownerAccountId, orgId: school.orgId, personId: school.ownerPersonId };
  await applyStructure(db, permissions, owner, school.institutionId, {
    board: 'CBSE',
    yearLabel: YEAR,
    starts: iso(-60),
    ends: iso(300),
    classes: [{ code: '1', sections: 1, capacity: 30 }],
  });
  principal = await withTenant(db, school.orgId, async (tx) => {
    const id = await createPerson(tx, { legalName: 'Principal Draws', source: 'signup' });
    await addPhone(tx, id, phone());
    await ensureStaffProfile(tx, id, { employeeCode: `E-${randomInt(1e6)}`, workEmail: null });
    await assignRole(tx, {
      personId: id,
      roleKey: 'principal',
      scope: { type: 'institution', id: school.institutionId },
    });
    const [c] = await tx.execute<{ id: string }>(
      sql`select id::text from school_class where org_id = app_current_org()`,
    );
    classId = c!.id;
    return { accountId: randomUUID(), orgId: school.orgId, personId: id };
  });
  const head = await createHead(finance, owner, {
    institutionId: school.institutionId,
    code: 'TUITION',
    name: 'Tuition',
    taxClass: 'education_exempt',
    rteExempt: true,
    refundable: false,
  });
  const plan = await savePlan(finance, owner, {
    institutionId: school.institutionId,
    name: 'Class 1',
    groupIds: [classId],
    lines: [{ headId: head.id, amountPaise: 1_000_000 }],
    instalments: [{ label: 'Year', dueOn: iso(30), shareBp: 10000 }],
    lateFeePaise: 0,
    graceDays: 0,
  });
  await publishPlan(finance, owner, plan.id);
});

async function applicant(over: Record<string, unknown>) {
  const { id } = await addEnquiry(deps, owner, {
    institutionId: school.institutionId,
    yearLabel: YEAR,
    classId,
    category: 'rte',
    source: 'rte_portal',
    childName: `Synthetic Draw Child ${randomInt(1e6)}`,
    dateOfBirth: '2019-08-01',
    guardianName: 'Synthetic Parent Draws',
    guardianPhone: phone(),
    ...over,
  });
  await moveApplication(deps, owner, { applicationId: id, to: 'applied' });
  return id;
}

describe('seat draws', () => {
  it('draws an RTE lottery, two people publish it into offers and an ordered waitlist', async () => {
    const base = { institutionId: school.institutionId, yearLabel: YEAR, classId };
    const lottery = { ...base, category: 'rte' as const, method: 'lottery' as const };
    const pool = await Promise.all([1, 2, 3, 4, 5].map(() => applicant({})));
    // Too young for Class 1 on the cut-off date: left out with the reason.
    const tooYoung = await applicant({ dateOfBirth: '2021-06-01' });

    await expect(
      startDraw(deps, owner, { ...lottery, siblingFirst: false, seed: 'x' }),
    ).rejects.toMatchObject({ code: 'no_seats_set' });
    await setSeats(deps, owner, { ...base, category: 'rte', seats: 2 });

    const { id } = await startDraw(deps, owner, {
      ...lottery,
      siblingFirst: false,
      seed: 'chits 4-17-29',
    });
    // One open draw at a time per class and category.
    await expect(
      startDraw(deps, owner, { ...lottery, siblingFirst: false, seed: null }),
    ).rejects.toMatchObject({ code: 'draw_pending' });
    const d = await drawDetail(deps, owner, id);
    expect(d).toMatchObject({ seed: 'chits 4-17-29', seatsFree: 2, entered: 5, reproduces: true });
    expect(new Set(d.ranked.map((r) => r.id))).toEqual(new Set(pool));
    expect(d.leftOut.map((l) => [l.id, l.reason])).toEqual([[tooYoung, 'age']]);

    // The person who drew it can't publish it; nothing can rewrite the seed.
    await expect(publishDraw(deps, owner, id)).rejects.toMatchObject({ code: 'same_person' });
    await expect(
      withTenant(db, school.orgId, (tx) =>
        tx.execute(sql`update school_admission_draw set seed = 'other' where id = ${id}`),
      ),
    ).rejects.toThrow();

    expect(await publishDraw(deps, principal, id)).toEqual({ offered: 2, waitlisted: 3 });
    const p = await pipeline(deps, owner, { institutionId: school.institutionId, yearLabel: YEAR });
    const state = new Map(p.applications.map((a) => [a.id, a.state]));
    expect(d.ranked.map((r) => state.get(r.id))).toEqual([
      'offered',
      'offered',
      'waitlisted',
      'waitlisted',
      'waitlisted',
    ]);
    const positions = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{ id: string; pos: number }>(sql`
        select id::text, waitlist_position as pos from school_application
        where id = any(${`{${d.ranked
          .slice(2)
          .map((r) => r.id)
          .join(',')}}`}::uuid[])`),
    );
    const pos = new Map(positions.map((r) => [r.id, r.pos]));
    expect(d.ranked.slice(2).map((r) => pos.get(r.id))).toEqual([1, 2, 3]);
    await expect(publishDraw(deps, principal, id)).rejects.toMatchObject({ code: 'draw_decided' });
  });

  it('keeps a discarded draw on record with its reason', async () => {
    await setSeats(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: YEAR,
      classId,
      category: 'general',
      seats: 1,
    });
    await applicant({ category: 'general', source: 'walk_in' });
    const { id } = await startDraw(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: YEAR,
      classId,
      category: 'general',
      method: 'first_come',
      siblingFirst: true,
      seed: null,
    });
    await discardDraw(deps, principal, { drawId: id, reason: 'Seats were changed after the draw' });
    const all = await draws(deps, owner, { institutionId: school.institutionId, yearLabel: YEAR });
    expect(all.find((x) => x.id === id)).toMatchObject({
      state: 'discarded',
      discardReason: 'Seats were changed after the draw',
      drawnBy: 'Owner Draws',
      decidedBy: 'Principal Draws',
    });
    expect(all.find((x) => x.id === id)?.seed).toMatch(/^[0-9a-f]{32}$/);
  });
});
