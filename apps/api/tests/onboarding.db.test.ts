// Invitation and onboarding over HTTP: the super admin invites an organisation admin, who signs
// in with a simulated SMS code, saves a draft, and creates their organisation with two campuses
// and three schools. Colleges and universities are refused for now; so is a second completion.
import { loadEnv } from '@campusverse/config';
import { parseFieldKeys } from '@campusverse/crypto';
import { createDb, createRedis, withTenant } from '@campusverse/db';
import { createStaff } from '@campusverse/platform-control';
import { createOtp } from '@campusverse/platform-identity';
import { createPermissions } from '@campusverse/platform-permissions';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { createSmsSimulator } from '../src/simulation.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const sms = createSmsSimulator(() => {});
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApi({
    db,
    permissions: createPermissions(redis),
    otp: createOtp({ redis, pepper: env.AUTH_PEPPER, sender: sms.sender }),
    keys: parseFieldKeys(env.FIELD_KEYS),
    smsSimulator: sms,
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

async function ownerStaff() {
  const tag = randomBytes(4).toString('hex');
  const { staffId } = await createStaff(db, null, {
    name: `Synthetic owner ${tag}`,
    email: `owner-${tag}@staff.example.com`,
    role: 'owner',
  });
  const token = randomBytes(32).toString('base64url');
  await db.execute(sql`
    insert into control.session (staff_id, token_hash, expires_at)
    values (${staffId}, ${createHash('sha256').update(token).digest()}, now() + interval '1 hour')`);
  return { authorization: `Bearer ${token}` };
}

/** Sign in with the simulated code shown on screen. */
async function signIn(phone: string) {
  const asked = await call('POST', '/auth/otp/request', {}, { phone });
  expect(asked.statusCode).toBe(202);
  const code = /(\d{6})/.exec(asked.json().simulated?.text ?? '')?.[1];
  expect(code).toBeDefined();
  const res = await call(
    'POST',
    '/auth/otp/verify',
    {},
    {
      phone,
      code,
      device: { label: 'Synthetic browser' },
    },
  );
  expect(res.statusCode).toBe(200);
  return res.json() as {
    tokens: { accessToken: string };
    profiles: { orgId: string; personId: string }[];
  };
}

const school = (name: string) => ({
  type: 'school',
  name,
  authorityCode: 'CBSE',
  stateCode: 'KA',
  udiseCode: '29200100101',
  affiliationNumber: '830001',
  establishedYear: 1998,
  medium: 'English',
  lowestClass: 'LKG',
  highestClass: '10',
  phone: '8012345678',
  email: 'office@school.example.com',
  website: '',
});

describe('invitation and onboarding', () => {
  it('invites, signs in with a simulated code, onboards two campuses, then works as the admin', async () => {
    const staff = await ownerStaff();
    const phone = `9${randomInt(100_000_000, 999_999_999)}`;
    const invited = await call('POST', '/admin/invites', staff, {
      name: 'Kavya Synthetic',
      phone,
      email: 'kavya@group.example.com',
      planCode: 'pilot',
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json().simulated.text).toContain('/login');
    expect(
      (
        await call('POST', '/admin/invites', staff, { name: 'Again', phone, planCode: 'pilot' })
      ).json().code,
    ).toBe('already_invited');

    const first = await signIn(phone);
    expect(first.profiles).toEqual([]);
    const bearer = { authorization: `Bearer ${first.tokens.accessToken}` };
    const state = await call('GET', '/onboarding', bearer);
    expect(state.json()).toMatchObject({ name: 'Kavya Synthetic', planName: 'Pilot', draft: {} });
    expect(
      (await call('POST', '/onboarding/draft', bearer, { draft: { step: 'campuses' } })).statusCode,
    ).toBe(204);
    expect((await call('GET', '/onboarding', bearer)).json().draft).toEqual({ step: 'campuses' });

    const body = {
      admin: { name: 'Kavya Synthetic', designation: 'Director', email: 'kavya@group.example.com' },
      organisation: {
        name: 'Synthetic Learning Group',
        legalEntityName: 'Synthetic Learning Trust',
        gstin: '',
      },
      campuses: [
        {
          name: 'North campus',
          stateCode: 'KA',
          addressLine: '12 Synthetic Road',
          city: 'Bengaluru',
          district: 'Bengaluru Urban',
          pincode: '560001',
          institutions: [school('Synthetic Primary School'), school('Synthetic High School')],
        },
        {
          name: 'South campus',
          stateCode: 'KA',
          city: 'Mysuru',
          institutions: [school('Synthetic Public School')],
        },
      ],
    };
    // A profile must fit its type: a college can't be set up as a school.
    const college = structuredClone(body);
    Object.assign(college.campuses[0]?.institutions[0] as object, {
      type: 'college',
      profile: 'school',
      authorityCode: 'VTU',
    });
    expect((await call('POST', '/onboarding/complete', bearer, college)).json().code).toBe(
      'invalid_input',
    );

    const done = await call('POST', '/onboarding/complete', bearer, body);
    expect(done.statusCode).toBe(201);
    const { orgId, personId, institutions } = done.json();
    expect(institutions).toHaveLength(3);
    expect((await call('POST', '/onboarding/complete', bearer, body)).json().code).toBe(
      'not_invited',
    );

    // Now a profile exists, and the admin works through the school API.
    const profiles = (await call('GET', '/auth/profiles', bearer)).json();
    expect(profiles).toEqual([
      expect.objectContaining({ orgId, personId, orgName: 'Synthetic Learning Group' }),
    ]);
    const actor = { ...bearer, 'x-org-id': orgId, 'x-person-id': personId };
    const tree = (await call('GET', '/school/setup/tree', actor)).json();
    expect(
      tree.campuses.map((c: { name: string; institutions: unknown[] }) => [
        c.name,
        c.institutions.length,
      ]),
    ).toEqual([
      ['North campus', 2],
      ['South campus', 1],
    ]);
    const overview = await call('GET', `/school/setup/${institutions[0].institutionId}`, actor);
    expect(overview.statusCode).toBe(200);

    // The super admin sees the customer on the invited plan; the school's profile was stored.
    const invites = (await call('GET', '/admin/invites', staff)).json();
    expect(invites.find((i: { orgId: string }) => i.orgId === orgId)).toMatchObject({
      status: 'active',
    });
    const [row] = await withTenant(db, orgId, (tx) =>
      tx.execute<{ udise: string; city: string; designation: string }>(sql`
        select i.udise_code as udise, i.city, s.designation from institution i, staff_profile s
        where i.org_id = app_current_org() and i.name = 'Synthetic Primary School' and s.person_id = ${personId}`),
    );
    expect(row).toEqual({ udise: '29200100101', city: 'Bengaluru', designation: 'Director' });
  });

  it('refuses onboarding to a login nobody invited', async () => {
    const stranger = await call('GET', '/onboarding', { authorization: 'Bearer nobody' });
    expect(stranger.statusCode).toBe(401);
  });
});
