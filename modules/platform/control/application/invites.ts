// Inviting an organisation admin: a login by phone (no organisation yet) and an invite holding
// the plan. The admin signs in and builds their organisation in onboarding, which saves drafts
// here and finally marks the invite active with the new organisation.
import type { Db, Tx } from '@campusverse/db';
import { ensureLogin, normaliseIndianMobile } from '@campusverse/platform-identity';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { adminAudit, assertStaffCan, ControlError, type Staff } from './common.js';

export type InviteStatus = 'requested' | 'invited' | 'active' | 'declined' | 'cancelled';
export type InviteSource = 'staff' | 'self' | 'email' | 'additional';

export type InviteRow = {
  inviteId: string;
  name: string;
  /** Null for an email invite nobody has taken up yet. */
  phone: string | null;
  email: string | null;
  planCode: string;
  status: InviteStatus;
  source: InviteSource;
  declineReason: string | null;
  decidedBy: string | null;
  /** From a sign-up's answers: the organisation and the kind of institution. */
  organisation: string | null;
  kind: string | null;
  expiresAt: string | null;
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
  invite?: string | null | undefined;
};

/** Onboarding answers to start from: the person, the organisation, one campus and one institution. */
function startingDraft(input: SelfSignupInput, email: string | null) {
  return {
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
            medium: input.kind === 'school' ? 'English' : '',
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
}

const hashToken = (token: string) => createHash('sha256').update(token).digest();

/**
 * Self-serve sign-up (rule book §11 "Self-serve onboarding"). Without a link it is a request on
 * the Pilot plan that Campusverse staff approve before onboarding opens; with an email invite's
 * link it takes up that invite, already approved. Either way onboarding starts with their name,
 * the organisation, one campus and one institution of the kind they chose. Someone with an open
 * request or invite keeps it; someone already working somewhere just signs in. Nothing is usable
 * until they confirm the mobile with a code.
 */
export async function selfSignup(db: Db, input: SelfSignupInput): Promise<void> {
  const phone = normaliseIndianMobile(input.phone);
  if (!phone) throw new ControlError('phone_invalid');
  await db.transaction(async (tx) => {
    const link = input.invite
      ? (
          await tx.execute<{ id: string; email: string }>(sql`
            select id::text, email from control.account_invite
            where token_hash = ${hashToken(input.invite)} and status = 'invited' and account_id is null
              and expires_at > now()
            for update`)
        )[0]
      : undefined;
    if (input.invite && !link) throw new ControlError('invite_link_invalid');
    const [open] = await tx.execute<{ id: string; status: InviteStatus }>(sql`
      select id::text, status from control.account_invite
      where phone = ${phone} and status in ('requested', 'invited')`);
    if (open && !(link && open.status === 'requested')) return;
    const email = link?.email ?? (input.email?.trim().toLowerCase() || null);
    const login = await ensureLogin(tx, { phone, email });
    const [member] = await tx.execute(sql`
      select 1 from identity.account_person_link where account_id = ${login.accountId} limit 1`);
    if (member) return;
    const draft = JSON.stringify(startingDraft(input, email));
    if (link) {
      // The link proves the address: a waiting request from this mobile gives way to it.
      if (open)
        await tx.execute(sql`
        update control.account_invite set status = 'cancelled' where id = ${open.id}`);
      await tx.execute(sql`
        update control.account_invite
        set account_id = ${login.accountId}, phone = ${phone}, name = ${input.name.trim()}, draft = ${draft}::jsonb
        where id = ${link.id}`);
      await adminAudit(tx, null, {
        action: 'customer.invite_taken',
        detail: { inviteId: link.id, kind: input.kind, stateCode: input.stateCode },
      });
      return;
    }
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into control.account_invite (name, phone, email, plan_code, account_id, invited_by, source, status, draft)
      values (${input.name.trim()}, ${phone}, ${email}, ${SELF_SIGNUP_PLAN}, ${login.accountId}, null, 'self',
        'requested', ${draft}::jsonb)
      returning id::text`);
    if (!row) throw new ControlError('invite_not_saved');
    await adminAudit(tx, null, {
      action: 'customer.self_signup',
      detail: { inviteId: row.id, kind: input.kind, stateCode: input.stateCode },
    });
  });
}

/** How long an email invite's link works. */
export const INVITE_LINK_DAYS = 14;

/**
 * Invites an email address: a one-time link (only its hash is kept) that opens sign-up with the
 * address filled in and no approval needed. Staff send it themselves; it is shown once.
 */
export async function inviteByEmail(
  db: Db,
  staff: Staff,
  input: { name: string; email: string; planCode: string },
): Promise<{ inviteId: string; token: string }> {
  assertStaffCan(staff, 'customers.create');
  const email = input.email.trim().toLowerCase();
  const token = randomBytes(24).toString('base64url');
  return db.transaction(async (tx) => {
    const [plan] = await tx.execute(sql`select 1 from control.plan where code = ${input.planCode}`);
    if (!plan) throw new ControlError('plan_not_found');
    const [taken] = await tx.execute(sql`
      select 1 from identity.login_identifier l
      join identity.account_person_link p on p.account_id = l.account_id
      where l.kind = 'email' and l.value = ${email} limit 1`);
    if (taken) throw new ControlError('already_member');
    // A fresh link replaces an untaken one for the same address.
    await tx.execute(sql`
      update control.account_invite set status = 'cancelled'
      where email = ${email} and source = 'email' and status = 'invited' and account_id is null`);
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into control.account_invite (name, email, plan_code, invited_by, source, token_hash, expires_at)
      values (${input.name.trim()}, ${email}, ${input.planCode}, ${staff.staffId}, 'email',
        ${hashToken(token)}, now() + make_interval(days => ${INVITE_LINK_DAYS}))
      returning id::text`);
    if (!row) throw new ControlError('invite_not_saved');
    await adminAudit(tx, staff, {
      action: 'customer.email_invited',
      detail: { inviteId: row.id, planCode: input.planCode },
    });
    return { inviteId: row.id, token };
  });
}

/** Who an email invite's link is for, while it works (sign-up fills these in). */
export async function emailInvite(
  db: Db,
  token: string,
): Promise<{ name: string; email: string } | null> {
  const [row] = await db.execute<{ name: string; email: string }>(sql`
    select name, email from control.account_invite
    where token_hash = ${hashToken(token)} and status = 'invited' and account_id is null and expires_at > now()`);
  return row ?? null;
}

/** Staff approve a sign-up request (onboarding opens) or decline it with a reason. */
export async function decideSignup(
  db: Db,
  staff: Staff,
  inviteId: string,
  decision: { decision: 'approve' } | { decision: 'decline'; reason: string },
): Promise<void> {
  assertStaffCan(staff, 'customers.create');
  await db.transaction(async (tx) => {
    const approve = decision.decision === 'approve';
    const [done] = await tx.execute(sql`
      update control.account_invite
      set status = ${approve ? 'invited' : 'declined'},
        decline_reason = ${approve ? null : decision.reason.trim()},
        decided_by = ${staff.staffId}, decided_at = now()
      where id = ${inviteId} and status = 'requested' returning id`);
    if (!done) throw new ControlError('request_not_found');
    await adminAudit(tx, staff, {
      action: approve ? 'customer.signup_approved' : 'customer.signup_declined',
      detail: { inviteId },
    });
  });
}

/** Where a signed-in login without an organisation stands: waiting, or declined with the reason. */
export async function signupState(
  db: Db | Tx,
  accountId: string,
): Promise<{ status: 'requested' } | { status: 'declined'; reason: string } | null> {
  const [row] = await db.execute<{ status: InviteStatus; reason: string | null }>(sql`
    select status, decline_reason as reason from control.account_invite
    where account_id = ${accountId} order by created_at desc limit 1`);
  if (row?.status === 'requested') return { status: 'requested' };
  if (row?.status === 'declined') return { status: 'declined', reason: row.reason ?? '' };
  return null;
}

/**
 * An admin who has set up an organisation starts another of their own (its own tenant, on the
 * same plan): an open invite that onboarding completes, beginning at the organisation step.
 */
export async function startAnotherOrganisation(db: Db, accountId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [open] = await tx.execute(sql`
      select 1 from control.account_invite where account_id = ${accountId} and status = 'invited'`);
    if (open) return;
    const [prev] = await tx.execute<{
      name: string;
      phone: string;
      email: string | null;
      planCode: string;
      designation: string;
    }>(sql`
      select name, phone, email, plan_code as "planCode",
        coalesce(nullif(draft #>> '{admin,designation}', ''), 'Administrator') as designation
      from control.account_invite
      where account_id = ${accountId} and status = 'active' order by completed_at desc limit 1`);
    if (!prev) throw new ControlError('not_an_admin');
    const draft = {
      step: 'organisation',
      admin: { name: prev.name, designation: prev.designation, email: prev.email ?? '' },
    };
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into control.account_invite (name, phone, email, plan_code, account_id, invited_by, source, draft)
      values (${prev.name}, ${prev.phone}, ${prev.email}, ${prev.planCode}, ${accountId}, null, 'additional',
        ${JSON.stringify(draft)}::jsonb)
      returning id::text`);
    if (!row) throw new ControlError('invite_not_saved');
    await adminAudit(tx, null, {
      action: 'customer.another_started',
      detail: { inviteId: row.id },
    });
  });
}

export type AdminRow = {
  accountId: string;
  name: string;
  phone: string;
  email: string | null;
  since: string;
  organisations: {
    orgId: string;
    name: string;
    status: string;
    planName: string;
    onboardedAt: string;
  }[];
};

/** Every organisation admin with the organisations they set up, newest first. */
export async function listAdmins(db: Db, staff: Staff): Promise<AdminRow[]> {
  assertStaffCan(staff, 'customers.read');
  const rows = await db.execute<{
    accountId: string;
    name: string;
    phone: string;
    email: string | null;
    orgId: string;
    orgName: string;
    status: string;
    planName: string;
    completedAt: string;
  }>(sql`
    select i.account_id::text as "accountId", i.name, i.phone, i.email, c.org_id::text as "orgId",
      c.name as "orgName", c.status, p.name as "planName", i.completed_at::text as "completedAt"
    from control.account_invite i
    join control.customer c on c.org_id = i.org_id
    join control.plan p on p.code = c.plan_code
    where i.status = 'active'
    order by i.completed_at desc limit 500`);
  const out = new Map<string, AdminRow>();
  for (const r of rows) {
    const a = out.get(r.accountId) ?? {
      accountId: r.accountId,
      name: r.name,
      phone: r.phone,
      email: r.email,
      since: r.completedAt,
      organisations: [],
    };
    a.since = r.completedAt < a.since ? r.completedAt : a.since;
    a.organisations.push({
      orgId: r.orgId,
      name: r.orgName,
      status: r.status,
      planName: r.planName,
      onboardedAt: r.completedAt,
    });
    out.set(r.accountId, a);
  }
  return [...out.values()];
}

export async function listInvites(db: Db, staff: Staff): Promise<InviteRow[]> {
  assertStaffCan(staff, 'customers.read');
  return [
    ...(await db.execute<InviteRow>(sql`
      select i.id::text as "inviteId", i.name, i.phone, i.email, i.plan_code as "planCode", i.status,
        i.source, i.decline_reason as "declineReason", d.name as "decidedBy",
        i.draft #>> '{organisation,name}' as organisation, i.draft #>> '{campuses,0,schools,0,kind}' as kind,
        i.expires_at::text as "expiresAt",
        i.org_id::text as "orgId", coalesce(s.name, 'Self sign-up') as "invitedBy",
        i.created_at::text as "createdAt", i.completed_at::text as "completedAt"
      from control.account_invite i
      left join control.staff s on s.id = i.invited_by
      left join control.staff d on d.id = i.decided_by
      where i.source <> 'additional'
      order by i.status = 'requested' desc, i.status = 'invited' desc, i.created_at desc limit 200`)),
  ];
}

export async function cancelInvite(db: Db, staff: Staff, inviteId: string): Promise<void> {
  assertStaffCan(staff, 'customers.create');
  await db.transaction(async (tx) => {
    const [done] = await tx.execute(sql`
      update control.account_invite set status = 'cancelled'
      where id = ${inviteId} and status in ('invited', 'requested') returning id`);
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
