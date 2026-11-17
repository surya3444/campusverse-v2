import type { Db, Tx } from '@campusverse/db';
import { sql } from 'drizzle-orm';

export type InviteResult = { accountId: string; created: boolean; emailConflict: boolean };

/**
 * Gives a person a login: finds the account that owns this phone, or creates one, then links it
 * to the person. A shared family phone links one account to several people. An email is added
 * for Google sign-in unless another account already owns it. Safe to repeat.
 */
/**
 * A login by phone (and email if free), created if new, not yet linked to anyone. The super admin
 * invites an organisation admin this way; onboarding links it to the admin's person later.
 */
export async function ensureLogin(
  db: Db | Tx,
  input: { phone: string; email?: string | null },
): Promise<InviteResult> {
  if (!/^\+91[6-9]\d{9}$/.test(input.phone))
    throw new Error('ensureLogin: phone must be E.164 Indian mobile');

  const [existing] = await db.execute<{ accountId: string }>(sql`
    select account_id::text as "accountId" from identity.login_identifier
    where kind = 'phone' and value = ${input.phone}`);
  let accountId = existing?.accountId;
  const created = !accountId;
  if (!accountId) {
    const [acc] = await db.execute<{ id: string }>(
      sql`insert into identity.account default values returning id::text`,
    );
    if (!acc) throw new Error('ensureLogin: account insert returned no row');
    accountId = acc.id;
    await db.execute(sql`
      insert into identity.login_identifier (account_id, kind, value)
      values (${accountId}, 'phone', ${input.phone})`);
  }

  let emailConflict = false;
  if (input.email) {
    const email = input.email.toLowerCase();
    const [owner] = await db.execute<{ accountId: string }>(sql`
      select account_id::text as "accountId" from identity.login_identifier
      where kind = 'email' and value = ${email}`);
    if (!owner) {
      await db.execute(sql`
        insert into identity.login_identifier (account_id, kind, value) values (${accountId}, 'email', ${email})`);
    } else emailConflict = owner.accountId !== accountId;
  }
  return { accountId, created, emailConflict };
}

export async function inviteAccount(
  db: Db | Tx,
  input: { orgId: string; personId: string; phone: string; email?: string | null },
): Promise<InviteResult> {
  const login = await ensureLogin(db, input);
  const accountId = login.accountId;
  await db.execute(sql`
    insert into identity.account_person_link (account_id, org_id, person_id)
    values (${accountId}, ${input.orgId}, ${input.personId})
    on conflict do nothing`);
  return login;
}
