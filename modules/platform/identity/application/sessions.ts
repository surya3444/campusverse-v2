import { schema, type Db, type Tx } from '@campusverse/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { hashToken, newToken } from '../domain/secrets.js';

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const { account, session, trustedDevice } = schema;

export type Tokens = {
  sessionId: string;
  accountId: string;
  deviceId: string;
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
};

export type Authenticated = { sessionId: string; accountId: string; deviceId: string };

/** Reuses the caller's device if it is theirs and not revoked; otherwise registers a new one. */
export async function trustDevice(
  db: Db,
  accountId: string,
  device: { id?: string; label: string },
): Promise<string> {
  if (device.id) {
    const [known] = await db
      .update(trustedDevice)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(trustedDevice.id, device.id),
          eq(trustedDevice.accountId, accountId),
          isNull(trustedDevice.revokedAt),
        ),
      )
      .returning({ id: trustedDevice.id });
    if (known) return known.id;
  }
  const [created] = await db
    .insert(trustedDevice)
    .values({ accountId, label: device.label })
    .returning({ id: trustedDevice.id });
  if (!created) throw new Error('trustDevice: insert returned no row');
  return created.id;
}

export async function startSession(
  db: Db | Tx,
  accountId: string,
  deviceId: string,
  familyId?: string,
): Promise<Tokens> {
  const accessToken = newToken();
  const refreshToken = newToken();
  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(now + REFRESH_TTL_MS);
  const [row] = await db
    .insert(session)
    .values({
      // A new family starts with its own id; rotations keep the first session's family.
      familyId: familyId ?? sql`uuidv7()`,
      accountId,
      deviceId,
      accessHash: hashToken(accessToken),
      accessExpiresAt,
      refreshHash: hashToken(refreshToken),
      refreshExpiresAt,
    })
    .returning({ id: session.id });
  return {
    sessionId: required(row).id,
    accountId,
    deviceId,
    accessToken,
    accessExpiresAt,
    refreshToken,
    refreshExpiresAt,
  };
}

/** Resolves a live access token. Rotated, revoked, expired, device-revoked or locked: null. */
export async function authenticate(db: Db, accessToken: string): Promise<Authenticated | null> {
  const [row] = await db
    .select({ sessionId: session.id, accountId: session.accountId, deviceId: session.deviceId })
    .from(session)
    .innerJoin(trustedDevice, eq(trustedDevice.id, session.deviceId))
    .innerJoin(account, eq(account.id, session.accountId))
    .where(
      and(
        eq(session.accessHash, hashToken(accessToken)),
        isNull(session.revokedAt),
        isNull(session.replacedBy),
        gt(session.accessExpiresAt, new Date()),
        isNull(trustedDevice.revokedAt),
        eq(account.status, 'active'),
      ),
    );
  return row ?? null;
}

/**
 * Rotates a refresh token: the old session is replaced and a new pair issued.
 * Presenting an already-rotated token means it was copied, so the whole family is revoked.
 */
export async function refresh(db: Db, refreshToken: string): Promise<Tokens | null> {
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select({
        id: session.id,
        familyId: session.familyId,
        accountId: session.accountId,
        deviceId: session.deviceId,
        replacedBy: session.replacedBy,
        revokedAt: session.revokedAt,
        refreshExpiresAt: session.refreshExpiresAt,
        deviceRevokedAt: trustedDevice.revokedAt,
        accountStatus: account.status,
      })
      .from(session)
      .innerJoin(trustedDevice, eq(trustedDevice.id, session.deviceId))
      .innerJoin(account, eq(account.id, session.accountId))
      .where(eq(session.refreshHash, hashToken(refreshToken)))
      // Locks the joined device and account rows too; Postgres rejects schema-qualified OF.
      .for('update');
    if (!old || old.revokedAt) return null;

    if (old.replacedBy) {
      await tx
        .update(session)
        .set({ revokedAt: new Date(), revokeReason: 'refresh_token_reuse' })
        .where(and(eq(session.familyId, old.familyId), isNull(session.revokedAt)));
      return null;
    }
    if (
      old.refreshExpiresAt <= new Date() ||
      old.deviceRevokedAt ||
      old.accountStatus !== 'active'
    ) {
      return null;
    }

    const next = await startSession(tx, old.accountId, old.deviceId, old.familyId);
    await tx.update(session).set({ replacedBy: next.sessionId }).where(eq(session.id, old.id));
    return next;
  });
}

export async function revokeSession(db: Db, sessionId: string, reason: string): Promise<void> {
  await db
    .update(session)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(session.id, sessionId), isNull(session.revokedAt)));
}

/** Signs a device out everywhere: the device and every session on it. */
export async function revokeDevice(db: Db, deviceId: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(trustedDevice)
      .set({ revokedAt: new Date() })
      .where(and(eq(trustedDevice.id, deviceId), isNull(trustedDevice.revokedAt)));
    await tx
      .update(session)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(and(eq(session.deviceId, deviceId), isNull(session.revokedAt)));
  });
}

function required<T>(row: T | undefined): T {
  if (!row) throw new Error('session insert returned no row');
  return row;
}

/**
 * Development tooling and tests only: opens a session for an account without OTP or Google.
 * Real sign-in never calls this; the dev-session script refuses to run outside development.
 */
export async function devSignIn(db: Db, accountId: string, deviceLabel: string): Promise<Tokens> {
  const deviceId = await trustDevice(db, accountId, { label: deviceLabel });
  return startSession(db, accountId, deviceId);
}
