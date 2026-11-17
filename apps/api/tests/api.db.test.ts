// The setup wizard over HTTP: OTP sign-in, the profile picker, every setup step, the error
// shape, and who is refused. Real Postgres and Redis; the worker is played by drain().
import { loadEnv } from '@campusverse/config';
import { createDb, createRedis, withTenant } from '@campusverse/db';
import { runConsumer, type Consumer, type OutboxEvent } from '@campusverse/platform-events';
import { createOtp } from '@campusverse/platform-identity';
import { createPermissions } from '@campusverse/platform-permissions';
import { importCommitConsumer, invitesConsumer, provisionSchool } from '@campusverse/school-setup';
import { generateSchool } from '@campusverse/test-data';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFieldKeys } from '@campusverse/crypto';
import { fakeGateway, sign } from '@campusverse/shared-finance';
import { createApi } from '../src/app.js';

const gateway = fakeGateway('api-test-webhook-secret');

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
    gateway,
  });
});
afterAll(async () => {
  await app.close();
  redis.disconnect();
  await close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- API JSON is checked by the assertions
type Res = { statusCode: number; json: () => any; rawPayload: Buffer };
const call = (
  method: 'GET' | 'POST',
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown; payload?: Buffer } = {},
) => {
  const payload = opts.payload ?? (opts.body !== undefined ? JSON.stringify(opts.body) : null);
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    ...(payload !== null ? { payload } : {}),
  }) as unknown as Promise<Res>;
};

function upload(bytes: Buffer) {
  const boundary = `----cv${randomUUID()}`;
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="school.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function drain(orgId: string, consumer: Consumer) {
  const events = await db.execute<OutboxEvent>(sql`
    select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt" from ops.outbox
    where org_id = ${orgId} and published_at is null and type in (${sql.join(
      consumer.events.map((t) => sql`${t}`),
      sql`, `,
    )})
    order by id`);
  for (const e of events) {
    await runConsumer(db, consumer, e);
    await db.execute(sql`update ops.outbox set published_at = now() where id = ${e.id}`);
  }
}

/** OTP sign-in as the API client does it. Returns headers for one chosen profile. */
async function signIn(e164: string, orgId: string) {
  expect((await call('POST', '/auth/otp/request', { body: { phone: e164 } })).statusCode).toBe(202);
  const res = await call('POST', '/auth/otp/verify', {
    body: { phone: e164, code: codes.get(e164), device: { label: 'Synthetic Pixel' } },
  });
  expect(res.statusCode).toBe(200);
  const { tokens, profiles } = res.json();
  const profile = profiles.find((p: { orgId: string }) => p.orgId === orgId);
  return {
    authorization: `Bearer ${tokens.accessToken}`,
    'x-org-id': orgId,
    'x-person-id': profile.personId,
  };
}

describe('setup over HTTP', () => {
  it('an owner signs in and takes a generated school to ready-for-attendance', async () => {
    const ownerPhone = `9${randomInt(100_000_000, 999_999_999)}`;
    const school = await provisionSchool(db, {
      schoolName: 'Synthetic HTTP School',
      group: null,
      board: 'CBSE',
      state: 'TS',
      owner: { name: 'Owner Synthetic HTTP', phone: ownerPhone },
    });
    const owner = await signIn(`+91${ownerPhone}`, school.orgId);
    const base = `/school/setup/${school.institutionId}`;
    const iso = (d: number) =>
      new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
    const structure = {
      board: 'CBSE',
      yearLabel: '2026-27',
      starts: iso(-10),
      ends: iso(320),
      classes: [{ code: '3', sections: 2, capacity: 35 }],
    };

    const preview = await call('POST', `${base}/structure/preview`, {
      headers: owner,
      body: structure,
    });
    expect(preview.json().plan.totals).toEqual({ classes: 1, sections: 2, seats: 70 });
    const applied = await call('POST', `${base}/structure`, { headers: owner, body: structure });
    expect(applied.statusCode).toBe(201);

    const template = await call('GET', '/school/setup/templates/students', { headers: owner });
    expect(template.rawPayload.subarray(0, 2).toString()).toBe('PK');

    const files = await generateSchool({
      classes: [{ code: '3', sections: ['A', 'B'], studentsPerSection: 5 }],
      seed: randomInt(1e6),
    });
    for (const [kind, bytes] of [
      ['staff', files.staff],
      ['students', files.students],
    ] as const) {
      const u = upload(bytes);
      const p = await call('POST', `${base}/imports/${kind}`, {
        headers: { ...owner, ...u.headers },
        payload: u.payload,
      });
      expect(p.statusCode).toBe(201);
      expect(p.json().counts.invalid).toBe(0);
      const commit = await call('POST', `/school/setup/imports/${p.json().batchId}/commit`, {
        headers: owner,
      });
      expect(commit.statusCode).toBe(202);
      await drain(school.orgId, importCommitConsumer);
      expect(
        (await call('GET', `/school/setup/imports/${p.json().batchId}`, { headers: owner })).json()
          .status,
      ).toBe('committed');
    }

    expect((await call('GET', `${base}/invites`, { headers: owner })).json()).toMatchObject({
      staff: 2,
    });
    expect((await call('POST', `${base}/invites`, { headers: owner })).statusCode).toBe(202);
    await drain(school.orgId, invitesConsumer);

    const ready = await call('GET', `${base}/readiness`, { headers: owner });
    expect(ready.json().ready).toBe(true);

    // A class teacher can now sign in, but setup is not theirs to see.
    const teacher = await signIn(files.classTeacherPhones['3-A']!, school.orgId);
    const refused = await call('GET', `${base}/readiness`, { headers: teacher });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'forbidden', retryable: false });
    expect(refused.json().requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('refusals and the error shape', () => {
  it('no token, a bad token, or a profile that is not yours: 401', async () => {
    const someone = { 'x-org-id': randomUUID(), 'x-person-id': randomUUID() };
    for (const headers of [someone, { ...someone, authorization: 'Bearer nope' }]) {
      const res = await call('GET', `/school/setup/${randomUUID()}/readiness`, { headers });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthenticated');
    }

    const phone = `9${randomInt(100_000_000, 999_999_999)}`;
    const mine = await provisionSchool(db, {
      schoolName: 'Mine',
      group: null,
      board: 'CBSE',
      state: 'KA',
      owner: { name: 'Me', phone },
    });
    const other = await provisionSchool(db, {
      schoolName: 'Theirs',
      group: null,
      board: 'CBSE',
      state: 'KA',
      owner: { name: 'Them', phone: `9${randomInt(100_000_000, 999_999_999)}` },
    });
    const me = await signIn(`+91${phone}`, mine.orgId);
    // My token, their organisation and owner: not linked to me.
    const res = await call('GET', `/school/setup/${other.institutionId}/readiness`, {
      headers: { ...me, 'x-org-id': other.orgId, 'x-person-id': other.ownerPersonId },
    });
    expect(res.statusCode).toBe(401);
  });

  it('bad input names the field; a wrong code is 401; an unknown import is 404', async () => {
    const phone = `9${randomInt(100_000_000, 999_999_999)}`;
    const s = await provisionSchool(db, {
      schoolName: 'Errors',
      group: null,
      board: 'CBSE',
      state: 'TN',
      owner: { name: 'E', phone },
    });
    const h = await signIn(`+91${phone}`, s.orgId);
    const bad = await call('POST', `/school/setup/${s.institutionId}/structure`, {
      headers: h,
      body: {
        board: 'ICSE',
        yearLabel: '2026-27',
        starts: '2026-04-01',
        ends: '2027-03-31',
        classes: [],
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 'invalid_input', field: 'board' });

    const wrong = await call('POST', '/auth/otp/verify', {
      body: { phone, code: '000000', device: { label: 'x' } },
    });
    expect(wrong.statusCode).toBe(401);

    const missing = await call('POST', `/school/setup/imports/${randomUUID()}/undo`, {
      headers: h,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('import_not_found');
  });
});

describe('people over HTTP', () => {
  it('a downloaded list is logged in that school (ids and counts only); bad input 400, no session 401', async () => {
    const phone = `9${randomInt(100_000_000, 999_999_999)}`;
    const s = await provisionSchool(db, {
      schoolName: 'Export HTTP',
      group: null,
      board: 'CBSE',
      state: 'KA',
      owner: { name: 'E Owner', phone },
    });
    const owner = await signIn(`+91${phone}`, s.orgId);
    const body = { list: 'students', scopeId: s.institutionId, rows: 42 };
    expect((await call('POST', '/activity/exports', { headers: owner, body })).statusCode).toBe(
      204,
    );
    expect(
      (
        await call('POST', '/activity/exports', {
          headers: owner,
          body: { ...body, list: 'everything' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await call('POST', '/activity/exports', { body })).statusCode).toBe(401);
    const rows = await withTenant(db, s.orgId, (tx) =>
      tx.execute<{ actor: string; detail: Record<string, unknown> }>(sql`
        select actor_person_id::text as actor, detail from audit_event
        where org_id = app_current_org() and action = 'platform.data.exported' and entity_id = ${s.institutionId}`),
    );
    expect(rows).toEqual([{ actor: owner['x-person-id'], detail: { list: 'students', rows: 42 } }]);
  });

  it('lists and opens student records; identifiers stay masked until an audited reveal', async () => {
    const phone = `9${randomInt(100_000_000, 999_999_999)}`;
    const s = await provisionSchool(db, {
      schoolName: 'People HTTP',
      group: null,
      board: 'CBSE',
      state: 'KA',
      owner: { name: 'P Owner', phone },
    });
    const owner = await signIn(`+91${phone}`, s.orgId);
    const iso = (d: number) =>
      new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
    await call('POST', `/school/setup/${s.institutionId}/structure`, {
      headers: owner,
      body: {
        board: 'CBSE',
        yearLabel: '2026-27',
        starts: iso(-10),
        ends: iso(300),
        classes: [{ code: '4', sections: 1, capacity: 30 }],
      },
    });
    const files = await generateSchool({
      classes: [{ code: '4', sections: ['A'], studentsPerSection: 3 }],
      seed: randomInt(1e6),
    });
    for (const [kind, bytes] of [
      ['staff', files.staff],
      ['students', files.students],
    ] as const) {
      const u = upload(bytes);
      const p = await call('POST', `/school/setup/${s.institutionId}/imports/${kind}`, {
        headers: { ...owner, ...u.headers },
        payload: u.payload,
      });
      await call('POST', `/school/setup/imports/${p.json().batchId}/commit`, { headers: owner });
      await drain(s.orgId, importCommitConsumer);
    }

    const me = await call('GET', '/people/me', { headers: owner });
    expect(me.json()).toMatchObject({
      name: 'P Owner',
      orgName: 'People HTTP',
      // Provisioning makes the first person both school administrator and owner (decision 0020).
      roles: ['Administrator', 'Owner'],
    });

    const list = await call('GET', `/people/students?institutionId=${s.institutionId}`, {
      headers: owner,
    });
    expect(list.json()).toHaveLength(3);
    expect(list.json()[0].placement).toBe('Class 4-A');
    const id = list.json()[0].personId;

    const record = await call('GET', `/people/students/${id}`, { headers: owner });
    expect(record.json().guardians).toHaveLength(1);

    const bad = await call('POST', `/people/students/${id}/aadhaar`, {
      headers: owner,
      body: { aadhaar: '123412341234' },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('bad_aadhaar');
    expect(
      (
        await call('POST', `/people/students/${id}/aadhaar`, {
          headers: owner,
          body: { aadhaar: '234123412346' },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await call('GET', `/people/students/${id}`, { headers: owner })).json().identifiers.aadhaar
        .masked,
    ).toBe('XXXX XXXX 2346');

    const noReason = await call('POST', `/people/students/${id}/reveal`, {
      headers: owner,
      body: { kind: 'aadhaar', reason: 'x' },
    });
    expect(noReason.statusCode).toBe(400);
    const revealed = await call('POST', `/people/students/${id}/reveal`, {
      headers: owner,
      body: { kind: 'aadhaar', reason: 'Board registration' },
    });
    expect(revealed.json()).toEqual({ value: '234123412346' });

    // A class teacher sees the overview only.
    await sendInvitesAndDrain(s.institutionId, s.orgId, owner);
    const teacher = await signIn(files.classTeacherPhones['4-A']!, s.orgId);
    const asTeacher = (await call('GET', `/people/students/${id}`, { headers: teacher })).json();
    expect(asTeacher.guardians).toBeNull();
    expect(asTeacher.can).toEqual({ update: false, reveal: false, readFull: false });
    expect(
      (
        await call('POST', `/people/students/${id}/reveal`, {
          headers: teacher,
          body: { kind: 'aadhaar', reason: 'Curious about it' },
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (await call('GET', `/people/students/${randomUUID()}`, { headers: owner })).statusCode,
    ).toBe(404);
  });
});

async function sendInvitesAndDrain(
  institutionId: string,
  orgId: string,
  headers: Record<string, string>,
) {
  await call('POST', `/school/setup/${institutionId}/invites`, { headers });
  await drain(orgId, invitesConsumer);
}

describe('attendance over HTTP', () => {
  it('a class teacher syncs an offline submission; the resend is a duplicate', async () => {
    const phone = `9${randomInt(100_000_000, 999_999_999)}`;
    const s = await provisionSchool(db, {
      schoolName: 'Attendance HTTP',
      group: null,
      board: 'CBSE',
      state: 'KA',
      owner: { name: 'A Owner', phone },
    });
    const owner = await signIn(`+91${phone}`, s.orgId);
    const iso = (d: number) =>
      new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
    await call('POST', `/school/setup/${s.institutionId}/structure`, {
      headers: owner,
      body: {
        board: 'CBSE',
        yearLabel: '2026-27',
        starts: iso(-10),
        ends: iso(300),
        classes: [{ code: '2', sections: 1, capacity: 30 }],
      },
    });
    const files = await generateSchool({
      classes: [{ code: '2', sections: ['A'], studentsPerSection: 3 }],
      seed: randomInt(1e6),
    });
    for (const [kind, bytes] of [
      ['staff', files.staff],
      ['students', files.students],
    ] as const) {
      const u = upload(bytes);
      const p = await call('POST', `/school/setup/${s.institutionId}/imports/${kind}`, {
        headers: { ...owner, ...u.headers },
        payload: u.payload,
      });
      await call('POST', `/school/setup/imports/${p.json().batchId}/commit`, { headers: owner });
      await drain(s.orgId, importCommitConsumer);
    }
    await sendInvitesAndDrain(s.institutionId, s.orgId, owner);
    const teacher = await signIn(files.classTeacherPhones['2-A']!, s.orgId);

    const day = (
      await call('GET', `/school/attendance/${s.institutionId}/day`, { headers: teacher })
    ).json();
    expect(day.sections).toHaveLength(1);
    expect(day.sections[0]).toMatchObject({ state: 'not_taken', students: 3, mine: true });
    const sectionId = day.sections[0].sectionId;
    const sheet = (
      await call('GET', `/school/attendance/sections/${sectionId}`, { headers: teacher })
    ).json();

    const event = {
      eventId: randomUUID(),
      deviceId: 'synthetic-browser',
      actorId: teacher['x-person-id'],
      occurredAt: new Date().toISOString(),
      type: 'attendance.mark',
      payload: {
        sectionId,
        onDate: sheet.today,
        marks: [{ personId: sheet.students[0].personId, status: 'absent' }],
      },
    };
    const first = await call('POST', '/sync/events', {
      headers: teacher,
      body: { events: [event] },
    });
    expect(first.json()).toEqual({ results: [{ eventId: event.eventId, outcome: 'accepted' }] });
    const again = await call('POST', '/sync/events', {
      headers: teacher,
      body: { events: [event] },
    });
    expect(again.json().results[0].outcome).toBe('duplicate');

    const bad = await call('POST', '/sync/events', {
      headers: teacher,
      body: { events: [{ ...event, payload: { ...event.payload, onDate: 'today' } }] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().field).toBe('events.0.payload.onDate');

    const after = (
      await call('GET', `/school/attendance/${s.institutionId}/day`, { headers: owner })
    ).json();
    expect(after.sections[0]).toMatchObject({ state: 'submitted', absent: 1 });
    const refused = await call('POST', `/school/attendance/${s.institutionId}/holidays/preview`, {
      headers: teacher,
      body: { onDate: iso(3), name: 'Rain' },
    });
    expect(refused.statusCode).toBe(403);
  });
});

describe('payment webhooks over HTTP', () => {
  it('checks the signature over the exact bytes received', async () => {
    const body = JSON.stringify({
      event: 'payment_link.paid',
      payload: { payment_link: { entity: { id: `plink_${randomUUID()}`, amount_paid: 100 } } },
    });
    const send = (signature: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/finance/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': `evt_${randomUUID()}`,
        },
        payload: body,
      }) as unknown as Promise<Res>;
    expect((await send(sign(body, 'wrong-secret'))).statusCode).toBe(400);
    const ok = await send(sign(body, gateway.webhookSecret));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ outcome: 'unmatched' });
    // Re-serialised JSON (same data, different bytes) no longer matches the signature.
    const reformatted = await app.inject({
      method: 'POST',
      url: '/api/v1/finance/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': sign(body, gateway.webhookSecret),
      },
      payload: JSON.stringify(JSON.parse(body), null, 2),
    });
    expect(reformatted.statusCode).toBe(400);
  });
});
