// Inviting an organisation admin: a login by phone (no organisation yet) and an invite holding
// the plan. The admin signs in and builds their organisation in onboarding, which saves drafts
// here and finally marks the invite active with the new organisation.
import type { Db, Tx } from '@campusverse/db';
import { ensureLogin, normaliseIndianMobile } from '@campusverse/platform-identity';
import { sql } from 'drizzle-orm';
import { adminAudit, assertStaffCan, ControlError, type Staff } from './common.js';

export type InviteRow = {
  inviteId: string;
  name: string;
  phone: string;
  email: string | null;
  planCode: string;
  status: 'invited' | 'active' | 'cancelled';
  orgId: string | null;
  invitedBy: string;
  createdAt: string;
  completedAt: string | null;
};

export async function inviteAdmin(
  db: Db,
  staff: Staff,
  input: { name: string; phone: string; email?: string | null | undefined; planCode: string },
): Promise<{ inviteId: string; phone: string }> {
  assertStaffCan(staff, 'customers.create');
  const phone = normaliseIndianMobile(input.phone);
  if (!phone) throw new ControlError('phone_invalid');
  return db.transaction(async (tx) => {
    const [plan] = await tx.execute(sql`select 1 from control.plan where code = ${input.planCode}`);
    if (!plan) throw new ControlError('plan_not_found');
    const [open] = await tx.execute(sql`
      select 1 from control.account_invite where phone = ${phone} and status = 'invited'`);
    if (open) throw new ControlError('already_invited');
    const login = await ensureLogin(tx, { phone, email: input.email ?? null });
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into control.account_invite (name, phone, email, plan_code, account_id, invited_by)
      values (${input.name.trim()}, ${phone}, ${input.email?.trim().toLowerCase() || null},
        ${input.planCode}, ${login.accountId}, ${staff.staffId})
      returning id::text`);
    if (!row) throw new ControlError('invite_not_saved');
    await adminAudit(tx, staff, {
      action: 'customer.invited',
      detail: { inviteId: row.id, planCode: input.planCode },
    });
    return { inviteId: row.id, phone };
  });
}

/** The plan a self-serve sign-up starts on (free, with a student limit; staff can change it later). */
export const SELF_SIGNUP_PLAN = 'pilot';

export type SelfSignupInput = {
  name: string;
  phone: string;
  email?: string | null | undefined;
  organisation: string;
  kind: 'school' | 'college' | 'university';
  stateCode: string;
};

/**
 * Self-serve sign-up (rule book §11 "Self-serve onboarding"): opens an invite on the Pilot plan
 * for this mobile, with onboarding already started (their name, the organisation, one campus and
 * one institution of the kind they chose). Someone already invited keeps their invite; someone
 * already working somewhere just signs in. Nothing happens until they confirm the mobile with a code.
 */
export async function selfSignup(db: Db, input: SelfSignupInput): Promise<void> {
  const phone = normaliseIndianMobile(input.phone);
  if (!phone) throw new ControlError('phone_invalid');
  await db.transaction(async (tx) => {
    const [open] = await tx.execute(sql`
      select 1 from control.account_invite where phone = ${phone} and status = 'invited'`);
    if (open) return;
    const login = await ensureLogin(tx, { phone, email: input.email ?? null });
    const [member] = await tx.execute(sql`
      select 1 from identity.account_person_link where account_id = ${login.accountId} limit 1`);
    if (member) return;
    const email = input.email?.trim().toLowerCase() || null;
    const school = input.kind === 'school';
    const draft = {
      step: 'profile',
      admin: { name: input.name.trim(), designation: '', email: email ?? '' },
      organisation: { name: input.organisation.trim(), legalEntityName: '', gstin: '' },
      campuses: [
        {
          name: 'Main campus',
          addressLine: '',
          city: '',
          district: '',
          stateCode: input.stateCode,
          pincode: '',
          schools: [
            {
              kind: input.kind,
              ...(input.kind === 'college' ? { collegeProfile: 'affiliated_college' } : {}),
              authority: input.kind === 'university' ? 'UGC' : '',
              name: input.organisation.trim(),
              udiseCode: '',
              affiliationNumber: '',
              establishedYear: '',
              medium: school ? 'English' : '',
              lowestClass: 'LKG',
              highestClass: '10',
              phone: '',
              email: '',
              website: '',
            },
          ],
        },
      ],
    };
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into control.account_invite (name, phone, email, plan_code, account_id, invited_by, source, draft)
      values (${input.name.trim()}, ${phone}, ${email}, ${SELF_SIGNUP_PLAN}, ${login.accountId}, null, 'self',
        ${JSON.stringify(draft)}::jsonb)
      returning id::text`);
    if (!row) throw new ControlError('invite_not_saved');
    await adminAudit(tx, null, {
      action: 'customer.self_signup',
      detail: { inviteId: row.id, kind: input.kind, stateCode: input.stateCode },
    });
  });
}

export async function listInvites(db: Db, staff: Staff): Promise<InviteRow[]> {
  assertStaffCan(staff, 'customers.read');
  return [
    ...(await db.execute<InviteRow>(sql`
      select i.id::text as "inviteId", i.name, i.phone, i.email, i.plan_code as "planCode", i.status,
        i.org_id::text as "orgId", coalesce(s.name, 'Self sign-up') as "invitedBy",
        i.created_at::text as "createdAt", i.completed_at::text as "completedAt"
      from control.account_invite i left join control.staff s on s.id = i.invited_by
      order by i.status = 'invited' desc, i.created_at desc limit 200`)),
  ];
}

export async function cancelInvite(db: Db, staff: Staff, inviteId: string): Promise<void> {
  assertStaffCan(staff, 'customers.create');
  await db.transaction(async (tx) => {
    const [done] = await tx.execute(sql`
      update control.account_invite set status = 'cancelled'
      where id = ${inviteId} and status = 'invited' returning id`);
    if (!done) throw new ControlError('invite_not_found');
    await adminAudit(tx, staff, { action: 'customer.invite_cancelled', detail: { inviteId } });
  });
}

export type PendingInvite = {
  inviteId: string;
  name: string;
  phone: string;
  email: string | null;
  planCode: string;
  planName: string;
  draft: Record<string, unknown>;
};

/** The open invite for a signed-in login, if any (onboarding). */
export async function pendingInvite(db: Db | Tx, accountId: string): Promise<PendingInvite | null> {
  const [row] = await db.execute<PendingInvite>(sql`
    select i.id::text as "inviteId", i.name, i.phone, i.email, i.plan_code as "planCode",
      p.name as "planName", i.draft
    from control.account_invite i join control.plan p on p.code = i.plan_code
    where i.account_id = ${accountId} and i.status = 'invited'
    order by i.created_at desc limit 1`);
  return row ?? null;
}

/** Onboarding answers so far. The admin's own profile and institutions only; capped in size. */
export async function saveInviteDraft(
  db: Db,
  accountId: string,
  draft: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(draft);
  if (json.length > 64_000) throw new ControlError('draft_too_large');
  const [done] = await db.execute(sql`
    update control.account_invite set draft = ${json}::jsonb
    where account_id = ${accountId} and status = 'invited' returning id`);
  if (!done) throw new ControlError('not_invited');
}

/** Called in the onboarding transaction once the organisation exists. */
export async function completeInvite(tx: Tx, inviteId: string, orgId: string): Promise<void> {
  const [done] = await tx.execute(sql`
    update control.account_invite set status = 'active', org_id = ${orgId}, completed_at = now()
    where id = ${inviteId} and status = 'invited' returning id`);
  if (!done) throw new ControlError('not_invited');
  await adminAudit(tx, null, { action: 'customer.onboarded', orgId, detail: { inviteId } });
}
