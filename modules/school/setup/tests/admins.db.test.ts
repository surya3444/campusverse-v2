// Organisation admins end to end on a real database (owner's brief, 20 Nov 2026; rule book §11,
// §12.4, §10.3): a sign-up waits for Campusverse to approve it; an email invite's link needs no
// approval; an admin runs several organisations, each its own tenant; and a saved view never
// reaches past the person's roles. All data synthetic.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import {
  decideSignup,
  emailInvite,
  inviteByEmail,
  listAdmins,
  pendingInvite,
  selfSignup,
  signupState,
  startAnotherOrganisation,
  createStaff,
  type Staff,
} from '@campusverse/platform-control';
import { listProfiles } from '@campusverse/platform-identity';
import { myView, saveView } from '@campusverse/platform-organisation';
import { addPhone, createPerson, ensureStaffProfile } from '@campusverse/people-records';
import { assignRole } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeOnboarding, type OnboardingInput } from '../contract.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);
afterAll(() => close());

const mobile = () => `9${randomInt(100_000_000, 999_999_999)}`;
const accountOf = async (phone: string) => {
  const [r] = await db.execute<{ id: string }>(sql`
    select account_id::text as id from identity.login_identifier where kind = 'phone' and value = ${`+91${phone}`}`);
  return r?.id ?? '';
};
const tree = (name: string, campuses: [string, ('school' | 'college' | 'university')[]][]) =>
  ({
    admin: { name: 'Synthetic Admin', designation: 'Chair' },
    organisation: { name, legalEntityName: `${name} Trust` },
    campuses: campuses.map(([campus, kinds]) => ({
      name: campus,
      stateCode: 'KA',
      institutions: kinds.map((type, n) => ({
        name: `${campus} ${type} ${n + 1}`,
        type,
        authorityCode: type === 'school' ? 'CBSE' : 'UGC',
        stateCode: 'KA',
      })),
    })),
  }) satisfies OnboardingInput;

let staff: Staff;
beforeAll(async () => {
  const email = `admins-test-${randomInt(1e9)}@staff.campusverse.local`;
  const { staffId } = await createStaff(db, null, {
    name: 'Synthetic Staff',
    email,
    role: 'owner',
  });
  staff = { staffId, name: 'Synthetic Staff', email, role: 'owner' };
});

const signup = (phone: string, extra: Record<string, unknown> = {}) =>
  selfSignup(db, {
    name: 'Synthetic Admin',
    phone,
    organisation: 'Synthetic Admin Trust',
    kind: 'school',
    stateCode: 'KA',
    ...extra,
  });

describe('organisation admins', () => {
  it('waits for approval; a declined request says why; an approved one onboards', async () => {
    const phone = mobile();
    await signup(phone);
    const account = await accountOf(phone);
    expect(await pendingInvite(db, account)).toBeNull();
    expect(await signupState(db, account)).toEqual({ status: 'requested' });

    const [req] = await db.execute<{ id: string }>(sql`
      select id::text from control.account_invite where account_id = ${account} and status = 'requested'`);
    await decideSignup(db, staff, req?.id ?? '', { decision: 'decline', reason: 'Not a school' });
    expect(await signupState(db, account)).toEqual({ status: 'declined', reason: 'Not a school' });
    await expect(
      decideSignup(db, staff, req?.id ?? '', { decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'request_not_found' });

    // Asking again opens a new request; approved, onboarding opens with their answers.
    await signup(phone);
    const [again] = await db.execute<{ id: string }>(sql`
      select id::text from control.account_invite where account_id = ${account} and status = 'requested'`);
    await decideSignup(db, staff, again?.id ?? '', { decision: 'approve' });
    expect((await pendingInvite(db, account))?.draft).toMatchObject({
      organisation: { name: 'Synthetic Admin Trust' },
    });
  });

  it('an email invite needs no approval and works once', async () => {
    const email = `admin-${randomInt(1e9)}@example.test`;
    const { token } = await inviteByEmail(db, staff, {
      name: 'Synthetic Invitee',
      email,
      planCode: 'pilot',
    });
    expect(await emailInvite(db, token)).toEqual({ name: 'Synthetic Invitee', email });
    const phone = mobile();
    await signup(phone, { invite: token, email: 'someone-else@example.test' });
    const invite = await pendingInvite(db, await accountOf(phone));
    expect(invite).toMatchObject({ email, planCode: 'pilot' });
    expect(await emailInvite(db, token)).toBeNull();
    await expect(signup(mobile(), { invite: token })).rejects.toMatchObject({
      code: 'invite_link_invalid',
    });
  });

  it('runs several organisations, each with campuses of mixed institutions', async () => {
    const phone = mobile();
    await signup(phone);
    const account = await accountOf(phone);
    const [req] = await db.execute<{ id: string }>(sql`
      select id::text from control.account_invite where account_id = ${account} and status = 'requested'`);
    await decideSignup(db, staff, req?.id ?? '', { decision: 'approve' });
    const first = await completeOnboarding(
      db,
      account,
      tree('Synthetic Group One', [
        ['North', ['school', 'college', 'college']],
        ['South', ['university']],
      ]),
    );
    // Nobody else can start an organisation through this; the admin can.
    await expect(startAnotherOrganisation(db, randomUUID())).rejects.toMatchObject({
      code: 'not_an_admin',
    });
    await startAnotherOrganisation(db, account);
    expect((await pendingInvite(db, account))?.draft).toMatchObject({ step: 'organisation' });
    const second = await completeOnboarding(
      db,
      account,
      tree('Synthetic Group Two', [['East', ['school', 'school']]]),
    );

    expect((await listProfiles(db, account)).map((p) => p.orgName).sort()).toEqual([
      'Synthetic Group One',
      'Synthetic Group Two',
    ]);
    const admin = (await listAdmins(db, staff)).find((a) => a.accountId === account);
    expect(admin?.organisations.map((o) => o.orgId).sort()).toEqual(
      [first.orgId, second.orgId].sort(),
    );
    // Each organisation is its own tenant: the second can't see the first's campuses.
    const seen = await withTenant(db, second.orgId, (tx) =>
      tx.execute(sql`select 1 from campus where org_id = ${first.orgId}`),
    );
    expect(seen).toHaveLength(0);
  });

  it('a view narrows to campuses or institutions and never past the roles', async () => {
    const phone = mobile();
    await signup(phone);
    const account = await accountOf(phone);
    const [req] = await db.execute<{ id: string }>(sql`
      select id::text from control.account_invite where account_id = ${account} and status = 'requested'`);
    await decideSignup(db, staff, req?.id ?? '', { decision: 'approve' });
    const org = await completeOnboarding(
      db,
      account,
      tree('Synthetic View Group', [
        ['North', ['school', 'college']],
        ['South', ['university', 'school']],
      ]),
    );
    const owner = { accountId: account, orgId: org.orgId, personId: org.personId };
    const whole = await myView(db, owner);
    expect(whole).toMatchObject({ reach: 'organisation', level: 'organisation', ids: [] });
    expect(whole.institutionIds).toHaveLength(4);

    const north = whole.campuses.find((c) => c.name === 'North');
    const campusView = await saveView(db, owner, { level: 'campus', ids: [north?.campusId ?? ''] });
    expect(campusView.institutionIds.sort()).toEqual(
      (north?.institutions.map((i) => i.institutionId) ?? []).sort(),
    );
    const one = whole.institutionIds[3] ?? '';
    expect(await saveView(db, owner, { level: 'institution', ids: [one] })).toMatchObject({
      level: 'institution',
      institutionIds: [one],
    });
    await expect(
      saveView(db, owner, { level: 'campus', ids: [randomUUID()] }),
    ).rejects.toMatchObject({ code: 'view_out_of_reach' });

    // A principal of one school sees only that school, and can't widen the view.
    const school = north?.institutions.find((i) => i.type === 'school')?.institutionId ?? '';
    const principal = await withTenant(db, org.orgId, async (tx) => {
      const id = await createPerson(tx, { legalName: 'Synthetic Principal', source: 'signup' });
      await addPhone(tx, id, `+91${mobile()}`);
      await ensureStaffProfile(tx, id, { employeeCode: `P-${randomInt(1e6)}`, workEmail: null });
      await assignRole(tx, {
        personId: id,
        roleKey: 'principal',
        scope: { type: 'institution', id: school },
      });
      return { accountId: randomUUID(), orgId: org.orgId, personId: id };
    });
    const theirs = await myView(db, principal);
    expect(theirs).toMatchObject({ reach: 'institution', institutionIds: [school] });
    expect(theirs.campuses.flatMap((c) => c.institutions)).toHaveLength(1);
    await expect(saveView(db, principal, { level: 'organisation', ids: [] })).rejects.toMatchObject(
      {
        code: 'view_out_of_reach',
      },
    );
    await expect(
      saveView(db, principal, { level: 'campus', ids: [north?.campusId ?? ''] }),
    ).rejects.toMatchObject({ code: 'view_out_of_reach' });
  });
});
