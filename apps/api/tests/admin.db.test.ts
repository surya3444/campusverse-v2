// Milestone 14 exit check over HTTP: Campusverse staff run a customer without SQL. A customer
// is signed up, put on a plan, given a feature, paused and made read-only, suspended and brought
// back with a second person's approval, and looked into under approved support access. Every
// step is in the admin audit, and what touched the school is in the school's own audit log.
// Passkeys themselves are exercised in the browser test (apps/admin e2e); here sessions are made
// directly so each rule can be checked by itself.
import { loadEnv } from '@campusverse/config';
import { parseFieldKeys } from '@campusverse/crypto';
import { createDb, createRedis, withTenant } from '@campusverse/db';
import { createStaff, flagOn, switchOn } from '@campusverse/platform-control';
import { createOtp } from '@campusverse/platform-identity';
import { createPermissions } from '@campusverse/platform-permissions';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const codes = new Map<string, string>();
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApi({
    db,
    permissions: createPermissions(redis),
    otp: createOtp({
      redis,
      pepper: env.AUTH_PEPPER,
      sender: { send: async (p, c) => void codes.set(p, c) },
    }),
    keys: parseFieldKeys(env.FIELD_KEYS),
  });
});
afterAll(async () => {
  await app.close();
  redis.disconnect();
  await close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- API JSON is checked by the assertions
type Res = { statusCode: number; json: () => any };
const call = (
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  }) as unknown as Promise<Res>;

/** A staff member with a live session (the passkey step is the browser test's job). */
async function staff(role: 'owner' | 'support') {
  const tag = randomBytes(4).toString('hex');
  const { staffId } = await createStaff(db, null, {
    name: `Synthetic ${role} ${tag}`,
    email: `${role}-${tag}@staff.example.com`,
    role,
  });
  const token = randomBytes(32).toString('base64url');
  await db.execute(sql`
    insert into control.session (staff_id, token_hash, expires_at)
    values (${staffId}, ${createHash('sha256').update(token).digest()}, now() + interval '1 hour')`);
  return { staffId, h: { authorization: `Bearer ${token}` } };
}

async function signInOwner(e164: string, orgId: string) {
  await call('POST', '/auth/otp/request', {}, { phone: e164 });
  const res = await call(
    'POST',
    '/auth/otp/verify',
    {},
    { phone: e164, code: codes.get(e164), device: { label: 'Synthetic Pixel' } },
  );
  const { tokens, profiles } = res.json();
  return {
    authorization: `Bearer ${tokens.accessToken}`,
    'x-org-id': orgId,
    'x-person-id': profiles.find((p: { orgId: string }) => p.orgId === orgId).personId,
  };
}

const schoolTrail = (orgId: string) =>
  withTenant(db, orgId, async (tx) =>
    (
      await tx.execute<{ action: string }>(sql`
        select action from audit_event where org_id = app_current_org() and action like 'platform.%'
        order by occurred_at`)
    ).map((r) => r.action),
  );

describe('running a customer without SQL (exit check)', () => {
  it('signs up, plans, flags, pauses, suspends with approval, and supports a school', async () => {
    const a = await staff('owner');
    const b = await staff('owner');
    const s = await staff('support');

    // Only staff sessions open the admin API.
    expect((await call('GET', '/admin/customers')).statusCode).toBe(401);

    // Support signs up a school; it appears with its plan and counts.
    const phone = `9${randomInt(100_000_000, 999_999_999)}`;
    const created = await call('POST', '/admin/customers', s.h, {
      schoolName: 'Synthetic Admin School',
      state: 'KA',
      board: 'CBSE',
      ownerName: 'Owner Synthetic Admin',
      ownerPhone: phone,
      planCode: 'pilot',
    });
    expect(created.statusCode).toBe(201);
    const { orgId, institutionId } = created.json();
    const list = (await call('GET', '/admin/customers', s.h)).json();
    expect(list.find((c: { orgId: string }) => c.orgId === orgId)).toMatchObject({
      status: 'active',
      planCode: 'pilot',
      students: 0,
    });
    const owner = await signInOwner(`+91${phone}`, orgId);
    expect((await call('GET', `/school/setup/${institutionId}`, owner)).statusCode).toBe(200);
    // A school login never opens the admin API.
    expect((await call('GET', '/admin/customers', owner)).statusCode).toBe(401);

    // Plan and flags: Standard includes Verse AI, but its default is off until switched on here.
    expect(
      (await call('POST', `/admin/customers/${orgId}/plan`, s.h, { planCode: 'standard' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `/admin/customers/${orgId}/plan`, a.h, { planCode: 'standard' }))
        .statusCode,
    ).toBe(204);
    // The customer's own setting wins over the default (which an owner may have switched on).
    await call('POST', `/admin/customers/${orgId}/flags`, s.h, { key: 'verse_ai', enabled: false });
    expect(await flagOn(db, 'verse_ai', orgId)).toBe(false);
    await call('POST', `/admin/customers/${orgId}/flags`, s.h, { key: 'verse_ai', enabled: true });
    expect(await flagOn(db, 'verse_ai', orgId)).toBe(true);
    expect(await flagOn(db, 'online_payments', orgId)).toBe(true);

    // Emergency switches: owners only, with a reason; read-only refuses school writes, not reads.
    const writesOff = { key: 'writes_off', orgId, on: true, reason: 'Data repair in progress' };
    expect((await call('POST', '/admin/switches', s.h, writesOff)).statusCode).toBe(403);
    expect((await call('POST', '/admin/switches', a.h, writesOff)).statusCode).toBe(204);
    const structure = {
      board: 'CBSE',
      yearLabel: '2026-27',
      starts: '2026-06-01',
      ends: '2027-03-31',
      classes: [{ code: '3', sections: 1, capacity: 30 }],
    };
    const refused = await call(
      'POST',
      `/school/setup/${institutionId}/structure`,
      owner,
      structure,
    );
    expect([refused.statusCode, refused.json().code]).toEqual([503, 'read_only']);
    expect((await call('GET', `/school/setup/${institutionId}`, owner)).statusCode).toBe(200);
    await call('POST', '/admin/switches', a.h, { ...writesOff, on: false });
    expect(
      (await call('POST', `/school/setup/${institutionId}/structure`, owner, structure)).statusCode,
    ).toBe(201);
    // A global switch reaches every customer.
    const payments = { key: 'payments_off', orgId: null, on: true, reason: 'Gateway incident' };
    await call('POST', '/admin/switches', a.h, payments);
    expect(await switchOn(db, 'payments_off', orgId)).toBe(true);
    await call('POST', '/admin/switches', a.h, { ...payments, on: false });
    expect(await switchOn(db, 'payments_off', orgId)).toBe(false);

    // Suspension needs a second person: support asks, support can't approve, an owner does.
    const asked = await call('POST', `/admin/customers/${orgId}/status`, s.h, {
      status: 'suspended',
      reason: 'Contract ended without renewal',
    });
    const approvalId = asked.json().approvalId;
    expect((await call('GET', `/school/setup/${institutionId}`, owner)).statusCode).toBe(200);
    expect(
      (await call('POST', `/admin/approvals/${approvalId}/decide`, s.h, { approve: true }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `/admin/approvals/${approvalId}/decide`, b.h, { approve: true }))
        .statusCode,
    ).toBe(204);
    const blocked = await call('GET', `/school/setup/${institutionId}`, owner);
    expect([blocked.statusCode, blocked.json().code]).toEqual([403, 'customer_suspended']);
    // Reactivating: the owner who asks can't approve it (also a database CHECK).
    const back = (
      await call('POST', `/admin/customers/${orgId}/status`, a.h, {
        status: 'active',
        reason: 'Renewal signed',
      })
    ).json().approvalId;
    const self = await call('POST', `/admin/approvals/${back}/decide`, a.h, { approve: true });
    expect([self.statusCode, self.json().code]).toEqual([422, 'maker_cannot_approve']);
    await expect(
      db.execute(
        sql`update control.approval set state = 'approved', decided_by = requested_by where id = ${back}`,
      ),
    ).rejects.toThrow();
    await call('POST', `/admin/approvals/${back}/decide`, b.h, { approve: true });
    expect((await call('GET', `/school/setup/${institutionId}`, owner)).statusCode).toBe(200);

    // Support access: asked with a ticket, approved by someone else, read-only, logged at the school.
    const view = `/admin/customers/${orgId}/support-view`;
    expect((await call('GET', view, s.h)).json().code).toBe('no_support_access');
    const grant = (
      await call('POST', `/admin/customers/${orgId}/support`, s.h, {
        reason: 'Owner reports the import page is stuck',
        ticket: 'CV-1042',
        minutes: 60,
      })
    ).json().approvalId;
    await call('POST', `/admin/approvals/${grant}/decide`, a.h, { approve: true });
    const seen = await call('GET', view, s.h);
    expect(seen.statusCode).toBe(200);
    expect(seen.json().institutions[0]).toMatchObject({
      name: 'Synthetic Admin School',
      classes: 1,
    });
    expect(JSON.stringify(seen.json())).not.toContain('Owner Synthetic Admin');
    // Only the person granted sees it; ending the grant closes it.
    expect((await call('GET', view, b.h)).json().code).toBe('no_support_access');
    const grants = (await call('GET', '/admin/support', a.h)).json();
    const g = grants.find((x: { orgId: string; active: boolean }) => x.orgId === orgId && x.active);
    await call('POST', `/admin/support/${g.id}/end`, a.h);
    expect((await call('GET', view, s.h)).json().code).toBe('no_support_access');

    // The school sees what Campusverse did; the admin audit has every step and can't be edited.
    expect(await schoolTrail(orgId)).toEqual(
      expect.arrayContaining([
        'platform.customer.created',
        'platform.customer.plan_changed',
        'platform.flag.changed',
        'platform.switch.on',
        'platform.customer.status_changed',
        'platform.support.access_granted',
        'platform.support.viewed',
        'platform.support.access_ended',
      ]),
    );
    const audit = (await call('GET', `/admin/audit?orgId=${orgId}`, s.h)).json();
    expect(audit.map((r: { action: string }) => r.action)).toEqual(
      expect.arrayContaining(['customer.created', 'approval.requested', 'support.viewed']),
    );
    await expect(
      db.execute(sql`update control.admin_audit set reason = 'x' where org_id = ${orgId}`),
    ).rejects.toThrow();

    // Delivery health is readable by support; disabling staff ends their session at once.
    const health = await call('GET', '/admin/health', s.h);
    expect(health.json().outbox).toHaveProperty('waiting');
    expect((await call('POST', `/admin/staff/${s.staffId}/disable`, a.h)).statusCode).toBe(204);
    expect((await call('GET', '/admin/me', s.h)).statusCode).toBe(401);
  });

  it('records an incident with its clocks, each step once, and tells the affected school', async () => {
    const owner = await staff('owner');
    const phone = `9${randomInt(100_000_000, 999_999_999)}`;
    const { orgId } = (
      await call('POST', '/admin/customers', owner.h, {
        schoolName: 'Synthetic Incident School',
        state: 'KA',
        board: 'CBSE',
        ownerName: 'Owner Synthetic Incident',
        ownerPhone: phone,
        planCode: 'pilot',
      })
    ).json();
    const discovered = new Date(Date.now() - 7 * 3600e3).toISOString();
    const opened = await call('POST', '/admin/incidents', owner.h, {
      title: 'Export link shared outside the school',
      details: 'A fee report link was forwarded to a parent group. Link expired after 5 minutes.',
      discoveredAt: discovered,
      personalData: true,
      orgIds: [orgId],
    });
    expect(opened.statusCode).toBe(201);
    const { incidentId } = opened.json();
    const rows = (await call('GET', '/admin/incidents', owner.h)).json();
    const row = rows.find((r: { id: string }) => r.id === incidentId);
    expect(row.clocks.certin.overdue).toBe(true); // discovered 7 hours ago, 6-hour clock
    expect(row.clocks.board.overdue).toBe(false);
    const step = (body: unknown) =>
      call('POST', `/admin/incidents/${incidentId}/steps`, owner.h, body);
    expect((await step({ step: 'certin_reported' })).statusCode).toBe(204);
    expect((await step({ step: 'certin_reported' })).json().code).toBe('incident_step_done');
    expect((await step({ step: 'closed' })).json().code).toBe('note_required');
    expect(
      (
        await step({
          step: 'closed',
          note: 'Link expired; parent group admin deleted the message.',
        })
      ).statusCode,
    ).toBe(204);
    expect(await schoolTrail(orgId)).toContain('platform.incident.recorded');
  });
});
