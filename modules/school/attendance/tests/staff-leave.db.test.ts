// Staff leave across modules (docs/specs/STAFF_LEAVE.md): asking with the school's holidays,
// balances, approval into the register (which the cover screen reads), cancel, adjustments and
// the month's payroll inputs. Holidays come from school attendance, as the API wires them.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { myWork } from '@campusverse/platform-workflow';
import { holidaysBetween } from '../contract.js';
import {
  adjustLeave,
  askLeave,
  awayOn,
  cancelLeave,
  decideLeave,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  leaveYear,
  myLeave,
  payrollInputs,
  saveLeaveType,
  staffAttendanceTools,
} from '@campusverse/shared-staff-attendance';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);

let t: SeededTenant;
let office: Actor;
let approver: Actor;
let teacher: Actor;
let today: string;
let cl: string;
let lop: string;
// A Monday at least two weeks out whose week stays in one leave year.
let mon: string;
const plus = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const ask = (actor: Actor, i: Partial<Parameters<typeof askLeave>[4]> = {}) =>
  askLeave(db, permissions, holidaysBetween, actor, {
    institutionId: t.institutionId,
    typeId: cl,
    from: mon,
    to: mon,
    halfDay: false,
    reason: 'Family function',
    ...i,
  });
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string }) => e.code ?? String(e),
  );
const left = async (typeId: string) =>
  (await myLeave(db, permissions, teacher, t.institutionId)).balances.find(
    (b) => b.typeId === typeId,
  )?.left;

beforeAll(async () => {
  t = await seedTenant(db, 'Leave');
  office = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['staff.leave.manage']),
  };
  approver = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['staff.leave.approve', 'staff.leave.apply']),
  };
  teacher = { accountId: randomUUID(), orgId: t.orgId, personId: t.teacherId };
  await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into role (org_id, key, name) values (app_current_org(), 'teacher', 'Teacher') returning id::text`);
    await tx.execute(sql`
      insert into role_grant (org_id, role_id, permission, relation)
      values (app_current_org(), ${r!.id}, 'staff.leave.apply', 'self')`);
    await tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      values (app_current_org(), ${t.teacherId}, ${r!.id}, 'institution', ${t.institutionId})`);
    // On staff since January, so last month's payroll has them; the approver is on staff too.
    await tx.execute(sql`
      update institution_membership set valid_during = daterange('2026-01-01', null)
      where org_id = app_current_org() and person_id = ${t.teacherId} and kind = 'staff'`);
    await tx.execute(sql`
      insert into institution_membership (org_id, person_id, institution_id, kind, valid_during)
      values (app_current_org(), ${approver.personId}, ${t.institutionId}, 'staff', daterange('2026-01-01', null))`);
    await tx.execute(sql`
      insert into staff_profile (org_id, person_id, employee_code)
      values (app_current_org(), ${approver.personId}, 'APPROVER-1')`);
    const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    today = d!.d;
    const [c] = await tx.execute<{ id: string }>(sql`
      select id::text from staff_leave_type where org_id = app_current_org() and code = 'CL'`);
    cl = c!.id;
  });
  mon = plus(today, 14);
  // A Monday whose fortnight stays in one leave year and misses the seed's pending day (1 December).
  while (
    new Date(`${mon}T00:00:00Z`).getUTCDay() !== 1 ||
    leaveYear(mon) !== leaveYear(plus(mon, 7)) ||
    (mon <= '2026-12-01' && '2026-12-01' <= plus(mon, 7))
  )
    mon = plus(mon, 1);
  // Saturday of that week is a school holiday.
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      insert into school_holiday (org_id, institution_id, on_date, name, declared_by_person_id)
      values (app_current_org(), ${t.institutionId}, ${plus(mon, 5)}::date, 'Founders day', ${t.principalId})`),
  );
  lop = (
    await saveLeaveType(db, permissions, office, {
      code: 'LOP',
      name: 'Loss of pay',
      paid: false,
      daysPerYear: null,
      carryForwardMax: 0,
      halfDay: true,
      active: true,
    })
  ).id;
});
afterAll(() => close());

describe('staff leave', () => {
  it('counts working days only, and holds them against the balance while pending', async () => {
    // The seed: CL 12 a year, +2 opening balance, 1 day pending on 1 December.
    const before = await left(cl);
    // Monday to the next Monday: Sunday and the Saturday holiday don't count.
    const r = await ask(teacher, { to: plus(mon, 7) });
    expect(r.days).toBe(6);
    expect(await left(cl)).toBe((before ?? 0) - 6);
    await cancelLeave(db, permissions, teacher, r.id);
    expect(await left(cl)).toBe(before);
  });

  it('refuses what the rules forbid', async () => {
    expect(await code(ask(teacher, { from: plus(mon, 6), to: plus(mon, 6) }))).toBe(
      'no_working_days',
    );
    expect(await code(ask(teacher, { to: plus(mon, 1), halfDay: true }))).toBe(
      'half_day_not_allowed',
    );
    expect(await code(ask(teacher, { from: '2027-03-31', to: '2027-04-01' }))).toBe(
      'crosses_leave_year',
    );
    // Balance used up (an adjustment takes it all for a moment): refused, saying what's left.
    const year = leaveYear(mon);
    const all = (await left(cl)) ?? 0;
    const adj = (days: number) =>
      adjustLeave(db, permissions, office, {
        institutionId: t.institutionId,
        personId: t.teacherId,
        typeId: cl,
        year,
        days,
        reason: 'Test',
      });
    await adj(-(all - 0.5));
    const over = await ask(teacher).catch((e: { code: string; detail: unknown }) => e);
    expect(over).toMatchObject({ code: 'over_balance', detail: { left: 0.5 } });
    await adj(all - 0.5);
    const r = await ask(teacher, { from: plus(mon, 1), to: plus(mon, 2) });
    expect(await code(ask(teacher, { from: plus(mon, 2), to: plus(mon, 3) }))).toBe(
      'leave_overlaps',
    );
    // Unlimited loss of pay instead, when the balance is gone.
    const unpaid = await ask(teacher, { typeId: lop, from: plus(mon, 3), to: plus(mon, 4) });
    expect(unpaid.days).toBe(2);
    await cancelLeave(db, permissions, teacher, r.id);
    await cancelLeave(db, permissions, teacher, unpaid.id);
  });

  it('keeps people to their own leave unless they manage it', async () => {
    // A teacher whose role is for this school only still sees the organisation's leave types.
    expect(
      (await leaveTypes(db, permissions, teacher, t.institutionId)).map((x) => x.code),
    ).toContain('LOP');
    await expect(ask(teacher, { personId: approver.personId })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(leaveRequests(db, permissions, teacher, t.institutionId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    // The office asks on the teacher's behalf.
    const r = await ask(office, { personId: t.teacherId, halfDay: true });
    expect(r.days).toBe(0.5);
    // Decided through the approval engine: not by the teacher, not by the office that entered it.
    expect(
      await code(
        decideLeave(db, permissions, holidaysBetween, teacher, { requestId: r.id, approve: true }),
      ),
    ).toBe('own_leave');
    expect(
      await code(
        decideLeave(db, permissions, holidaysBetween, office, { requestId: r.id, approve: true }),
      ),
    ).toBe('not_your_step');
    const waiting = await leaveRequests(db, permissions, approver, t.institutionId);
    expect(waiting.approvals[r.id]).toMatchObject({ status: 'pending', steps: 1, mine: true });
    expect((await myWork({ db, permissions }, approver)).map((w) => w.subjectId)).toContain(r.id);
    await cancelLeave(db, permissions, office, r.id);
    expect((await myWork({ db, permissions }, approver)).map((w) => w.subjectId)).not.toContain(
      r.id,
    );
  });

  it('approves into the register, so cover sees the teacher away; never one’s own', async () => {
    const r = await ask(teacher, { from: mon, to: plus(mon, 1) });
    await decideLeave(db, permissions, holidaysBetween, approver, {
      requestId: r.id,
      approve: true,
    });
    const away = await withTenant(db, t.orgId, (tx) => awayOn(tx, t.institutionId, mon));
    expect(away).toContainEqual({ personId: t.teacherId, status: 'on_leave', reason: 'Leave: CL' });
    expect(
      await code(
        decideLeave(db, permissions, holidaysBetween, approver, { requestId: r.id, approve: true }),
      ),
    ).toBe('not_pending');
    const list = await leaveRequests(db, permissions, approver, t.institutionId);
    expect(list.requests.find((x) => x.id === r.id)).toMatchObject({ state: 'approved', days: 2 });

    // The approver's own leave: someone else decides it.
    const own = await ask(approver, { from: plus(mon, 3), to: plus(mon, 3) });
    expect(
      await code(
        decideLeave(db, permissions, holidaysBetween, approver, {
          requestId: own.id,
          approve: true,
        }),
      ),
    ).toBe('own_leave');
    // Rejecting needs a reason.
    const other = await ask(teacher, { from: plus(mon, 4), to: plus(mon, 4) });
    expect(
      await code(
        decideLeave(db, permissions, holidaysBetween, approver, {
          requestId: other.id,
          approve: false,
        }),
      ),
    ).toBe('note_required');
    await decideLeave(db, permissions, holidaysBetween, approver, {
      requestId: other.id,
      approve: false,
      note: 'Exams that week',
    });

    // Verse AI counts it, without names.
    const tool = staffAttendanceTools({ db, permissions }).find(
      (x) => x.name === 'staff.leave.today',
    )!;
    const counts = await tool.handler(
      { actor: approver, institutionId: t.institutionId, today },
      { date: mon },
    );
    expect(counts.data).toEqual({
      date: mon,
      onLeave: 1,
      onLeaveNext7Days: 1,
      // The approver's own, and the seed's on 1 December.
      waitingForDecision: 2,
    });
    expect(JSON.stringify(counts.data)).not.toContain('Synthetic');

    // Cancelled before it starts: the register days go.
    await cancelLeave(db, permissions, teacher, r.id);
    const after = await withTenant(db, t.orgId, (tx) => awayOn(tx, t.institutionId, mon));
    expect(after.some((a) => a.personId === t.teacherId)).toBe(false);
  });

  it('lets the office adjust balances with a reason, and lists everyone’s', async () => {
    const before = await left(cl);
    await adjustLeave(db, permissions, office, {
      institutionId: t.institutionId,
      personId: t.teacherId,
      typeId: cl,
      year: leaveYear(today),
      days: -1.5,
      reason: 'Joined in June',
    });
    expect(await left(cl)).toBe((before ?? 0) - 1.5);
    const b = await leaveBalances(db, permissions, office, t.institutionId);
    expect(
      b.staff.find((s) => s.personId === t.teacherId)?.balances.find((x) => x.typeId === cl)?.left,
    ).toBe((before ?? 0) - 1.5);
    await expect(
      adjustLeave(db, permissions, teacher, {
        institutionId: t.institutionId,
        personId: t.teacherId,
        typeId: cl,
        year: leaveYear(today),
        days: 5,
        reason: 'More please',
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('works out last month’s payroll inputs', async () => {
    const first = `${plus(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
    const month = first.slice(0, 7);
    // The first three working days: present, absent, a day of loss-of-pay leave.
    const working: string[] = [];
    for (let d = first; working.length < 3; d = plus(d, 1))
      if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) working.push(d);
    const [w0, w1, w2] = working as [string, string, string];
    await withTenant(db, t.orgId, async (tx) => {
      for (const [d, status] of [
        [w0, 'present'],
        [w1, 'absent'],
      ] as const)
        await tx.execute(sql`
          insert into staff_attendance_day (org_id, person_id, institution_id, on_date, status, source, marked_by_person_id)
          values (app_current_org(), ${t.teacherId}, ${t.institutionId}, ${d}::date, ${status}, 'register', ${office.personId})
          on conflict (org_id, institution_id, on_date, person_id) do update set status = excluded.status`);
    });
    const r = await ask(office, {
      personId: t.teacherId,
      typeId: lop,
      from: w2,
      to: w2,
      reason: 'Unpaid day',
    });
    await decideLeave(db, permissions, holidaysBetween, approver, {
      requestId: r.id,
      approve: true,
    });

    const p = await payrollInputs(db, permissions, holidaysBetween, office, t.institutionId, month);
    const row = p.staff.find((s) => s.personId === t.teacherId)?.row;
    expect(row).toMatchObject({ present: 1, absent: 1, unpaidLeave: 1, lossOfPay: 2 });
    expect(row?.paidDays).toBe(p.calendarDays - 2);
    expect(row?.notMarked).toBe((row?.workingDays ?? 0) - 3);
    await expect(
      payrollInputs(db, permissions, holidaysBetween, teacher, t.institutionId, month),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
