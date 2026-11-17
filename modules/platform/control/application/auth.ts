// Staff sign-in with passkeys (WebAuthn, user verification required), one-time enrolment links,
// and short sessions: 30 minutes idle, 8 hours at most. Only hashes of tokens are stored.
import type { Db, Tx } from '@campusverse/db';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { adminAudit, controlStep, ControlError, type Staff } from './common.js';
import type { StaffRole } from '../domain/roles.js';

const IDLE_MS = 30 * 60 * 1000;
const MAX_MS = 8 * 60 * 60 * 1000;
const ENROL_MS = 15 * 60 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;

const newToken = () => randomBytes(32).toString('base64url');
const hash = (t: string) => createHash('sha256').update(t).digest();

/** Where the admin app runs: WebAuthn binds passkeys to this origin and its host name. */
export type RelyingParty = { origin: string; name: string };
const rpId = (rp: RelyingParty) => new URL(rp.origin).hostname;

export type StaffSession = { token: string; expiresAt: string; staff: Staff };

async function startSession(tx: Tx, staff: Staff): Promise<StaffSession> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + MAX_MS).toISOString();
  await tx.execute(sql`
    insert into control.session (staff_id, token_hash, expires_at)
    values (${staff.staffId}, ${hash(token)}, ${expiresAt})`);
  return { token, expiresAt, staff };
}

const staffColumns = sql`s.id::text as "staffId", s.name, s.email, s.role`;

/** The staff member behind a session token, or null. Touches the idle clock. */
export async function authenticateStaff(db: Db, token: string): Promise<Staff | null> {
  const [row] = await db.execute<Staff>(sql`
    update control.session x set last_seen_at = now()
    from control.staff s
    where x.token_hash = ${hash(token)} and s.id = x.staff_id and s.disabled_at is null
      and x.ended_at is null and x.expires_at > now()
      and x.last_seen_at > now() - ${`${IDLE_MS / 1000} seconds`}::interval
    returning ${staffColumns}`);
  return row ?? null;
}

export async function signOutStaff(db: Db, token: string): Promise<void> {
  await db.execute(sql`
    update control.session set ended_at = now() where token_hash = ${hash(token)} and ended_at is null`);
}

async function enrolmentLink(tx: Tx, staffId: string): Promise<string> {
  const token = newToken();
  await tx.execute(sql`
    insert into control.enrolment (token_hash, staff_id, expires_at)
    values (${hash(token)}, ${staffId}, ${new Date(Date.now() + ENROL_MS).toISOString()})`);
  return token;
}

/**
 * Adds a staff member and returns their one-time enrolment token (shown once). With a null
 * caller it is the development bootstrap for the first owner.
 */
export async function createStaff(
  db: Db,
  by: Staff | null,
  input: { name: string; email: string; role: StaffRole },
): Promise<{ staffId: string; enrolToken: string }> {
  const work = async (tx: Tx) => {
    const [s] = await tx.execute<{ id: string }>(sql`
      insert into control.staff (name, email, role)
      values (${input.name.trim()}, ${input.email.trim().toLowerCase()}, ${input.role})
      on conflict (email) do nothing returning id::text`);
    if (!s) throw new ControlError('staff_exists');
    return { staffId: s.id, enrolToken: await enrolmentLink(tx, s.id) };
  };
  const entry = { action: 'staff.created', detail: { role: input.role } };
  if (!by)
    return db.transaction(async (tx) => {
      const r = await work(tx);
      await adminAudit(tx, null, { ...entry, detail: { ...entry.detail, staffId: r.staffId } });
      return r;
    });
  return controlStep(db, by, 'staff.manage', entry, work);
}

/** A fresh enrolment link for an existing staff member (lost or new device). */
export async function reissueEnrolment(db: Db, by: Staff, staffId: string): Promise<string> {
  return controlStep(
    db,
    by,
    'staff.manage',
    { action: 'staff.enrolment_issued', detail: { staffId } },
    (tx) => enrolmentLink(tx, staffId),
  );
}

/** Disabling ends every session at once. */
export async function disableStaff(db: Db, by: Staff, staffId: string): Promise<void> {
  if (staffId === by.staffId) throw new ControlError('cannot_disable_self');
  await controlStep(
    db,
    by,
    'staff.manage',
    { action: 'staff.disabled', detail: { staffId } },
    async (tx) => {
      await tx.execute(sql`update control.staff set disabled_at = now() where id = ${staffId}`);
      await tx.execute(sql`
        update control.session set ended_at = now() where staff_id = ${staffId} and ended_at is null`);
    },
  );
}

export type StaffRow = Staff & { enrolled: boolean; disabled: boolean };

export async function listStaff(db: Db, by: Staff): Promise<StaffRow[]> {
  if (by.role !== 'owner') throw new ControlError('forbidden');
  return [
    ...(await db.execute<StaffRow>(sql`
      select ${staffColumns}, exists (select 1 from control.passkey p where p.staff_id = s.id) as enrolled,
        s.disabled_at is not null as disabled
      from control.staff s order by s.name`)),
  ];
}

async function newChallenge(tx: Db | Tx, staffId: string, purpose: string, challenge: string) {
  const [c] = await tx.execute<{ id: string }>(sql`
    insert into control.challenge (staff_id, purpose, challenge, expires_at)
    values (${staffId}, ${purpose}, ${challenge}, ${new Date(Date.now() + CHALLENGE_MS).toISOString()})
    returning id::text`);
  return c?.id ?? '';
}

async function takeChallenge(tx: Tx, id: string, purpose: string) {
  const [c] = await tx.execute<{ staffId: string; challenge: string }>(sql`
    update control.challenge set used_at = now()
    where id = ${id} and purpose = ${purpose} and used_at is null and expires_at > now()
    returning staff_id::text as "staffId", challenge`);
  if (!c) throw new ControlError('challenge_expired');
  return c;
}

/** Step 1 of enrolment: the link's token becomes passkey creation options. */
export async function registrationOptions(db: Db, rp: RelyingParty, enrolToken: string) {
  const [s] = await db.execute<Staff>(sql`
    select ${staffColumns} from control.enrolment e join control.staff s on s.id = e.staff_id
    where e.token_hash = ${hash(enrolToken)} and e.used_at is null and e.expires_at > now()
      and s.disabled_at is null`);
  if (!s) throw new ControlError('enrolment_expired');
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rpId(rp),
    userName: s.email,
    userDisplayName: s.name,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  return { challengeId: await newChallenge(db, s.staffId, 'register', options.challenge), options };
}

/** Step 2 of enrolment: the passkey is stored, the link is spent, and a session starts. */
export async function completeRegistration(
  db: Db,
  rp: RelyingParty,
  input: { enrolToken: string; challengeId: string; response: RegistrationResponseJSON },
): Promise<StaffSession> {
  return db.transaction(async (tx) => {
    const c = await takeChallenge(tx, input.challengeId, 'register');
    const [s] = await tx.execute<Staff>(sql`
      update control.enrolment e set used_at = now() from control.staff s
      where e.token_hash = ${hash(input.enrolToken)} and e.used_at is null and e.expires_at > now()
        and s.id = e.staff_id and s.id = ${c.staffId} and s.disabled_at is null
      returning ${staffColumns}`);
    if (!s) throw new ControlError('enrolment_expired');
    const v = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: c.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rpId(rp),
      requireUserVerification: true,
    }).catch(() => null);
    if (!v?.verified) throw new ControlError('passkey_not_verified');
    const cred = v.registrationInfo.credential;
    await tx.execute(sql`
      insert into control.passkey (credential_id, staff_id, public_key, counter, transports)
      values (${cred.id}, ${s.staffId}, ${Buffer.from(cred.publicKey)}, ${cred.counter},
        ${`{${(cred.transports ?? []).join(',')}}`}::text[])`);
    await adminAudit(tx, s, { action: 'staff.passkey_added' });
    return startSession(tx, s);
  });
}

/** Sign-in step 1: options for this staff member's passkeys. Unknown emails get the same shape. */
export async function signInOptions(db: Db, rp: RelyingParty, email: string) {
  const [s] = await db.execute<{ staffId: string }>(sql`
    select id::text as "staffId" from control.staff
    where email = ${email.trim().toLowerCase()} and disabled_at is null`);
  const keys = s
    ? await db.execute<{ id: string; transports: string[] }>(sql`
        select credential_id as id, transports from control.passkey where staff_id = ${s.staffId}`)
    : [];
  const options = await generateAuthenticationOptions({
    rpID: rpId(rp),
    userVerification: 'required',
    allowCredentials: keys.map((k) => ({
      id: k.id,
      transports: k.transports as AuthenticatorTransportFuture[],
    })),
  });
  // No staff: a challenge nobody can answer, so the response doesn't reveal who exists.
  const challengeId = s ? await newChallenge(db, s.staffId, 'sign_in', options.challenge) : '';
  return { challengeId, options };
}

/** Sign-in step 2: the passkey's signature is checked, its counter moves, a session starts. */
export async function completeSignIn(
  db: Db,
  rp: RelyingParty,
  input: { challengeId: string; response: AuthenticationResponseJSON },
): Promise<StaffSession> {
  if (!input.challengeId) throw new ControlError('passkey_not_verified');
  return db.transaction(async (tx) => {
    const c = await takeChallenge(tx, input.challengeId, 'sign_in');
    const [k] = await tx.execute<{
      staffId: string;
      publicKey: Buffer;
      counter: string;
      transports: string[];
    }>(sql`
      select p.staff_id::text as "staffId", p.public_key as "publicKey", p.counter::text, p.transports
      from control.passkey p join control.staff s on s.id = p.staff_id
      where p.credential_id = ${input.response.id} and p.staff_id = ${c.staffId} and s.disabled_at is null`);
    if (!k) throw new ControlError('passkey_not_verified');
    const v = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: c.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rpId(rp),
      requireUserVerification: true,
      credential: {
        id: input.response.id,
        publicKey: new Uint8Array(k.publicKey),
        counter: Number(k.counter),
        transports: k.transports as AuthenticatorTransportFuture[],
      },
    }).catch(() => null);
    if (!v?.verified) throw new ControlError('passkey_not_verified');
    await tx.execute(sql`
      update control.passkey set counter = ${v.authenticationInfo.newCounter}, last_used_at = now()
      where credential_id = ${input.response.id}`);
    const [s] = await tx.execute<Staff>(
      sql`select ${staffColumns} from control.staff s where s.id = ${c.staffId}`,
    );
    if (!s) throw new ControlError('passkey_not_verified');
    await adminAudit(tx, s, { action: 'staff.signed_in' });
    return startSession(tx, s);
  });
}
