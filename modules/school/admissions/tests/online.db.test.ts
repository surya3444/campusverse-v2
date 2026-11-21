// Online application forms (docs/specs/ONLINE_APPLICATIONS.md): the office sets up a form, a
// family proves its mobile first and applies with the session, duplicates and closed forms are
// handled, the family looks up its status, and form codes never work for sign-in.
import { loadEnv } from '@campusverse/config';
import { createDb, createRedis, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createOtp, RateLimited } from '@campusverse/platform-identity';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolAudience } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admissionForms,
  applicationStatus,
  publicForm,
  requestApplicationCode,
  saveAdmissionForm,
  startApplication,
  submitOnlineApplication,
  type AdmissionsDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const deps: AdmissionsDeps = { db, permissions: createPermissions(null), audience: schoolAudience };
const sent = new Map<string, string>();
const sender = { send: async (phone: string, code: string) => void sent.set(phone, code) };
// Each run in its own scope, so earlier runs' limits don't carry over.
const otp = createOtp({
  redis,
  pepper: 'test-pepper',
  sender,
  scope: `apply-test-${randomUUID()}`,
});
const signIn = createOtp({
  redis,
  pepper: 'test-pepper',
  sender,
  scope: `otp-test-${randomUUID()}`,
});

let t: SeededTenant;
let office: Actor;
let classId: string;
let slug: string;
const phone = () => `+919${randomInt(100_000_000, 999_999_999)}`;
const ip = () => `10.0.${randomInt(255)}.${randomInt(255)}`;
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e.name === 'PermissionDenied' ? 'denied' : (e.code ?? String(e)),
  );
async function codeFor(p: string) {
  expect(await requestApplicationCode(db, otp, { slug, phone: p, ip: ip() })).toBe('sent');
  return sent.get(p) ?? '';
}
const SECRET = 'test-secret';
async function sessionFor(p: string) {
  return (await startApplication(db, otp, SECRET, { slug, phone: p, code: await codeFor(p) }))
    .session;
}
const application = (session: string, more: Record<string, unknown> = {}) => ({
  slug,
  session,
  details: {},
  papers: [],
  childName: 'Synthetic Aarav Kumar',
  dateOfBirth: '2021-06-01',
  gender: 'male' as const,
  classId,
  guardianName: 'Synthetic Priya Kumar',
  guardianRelationship: 'mother' as const,
  custom: {},
  consent: true,
  ...more,
});

beforeAll(async () => {
  t = await seedTenant(db, 'Online');
  office = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['school.admission.manage']),
  };
  classId = await withTenant(db, t.orgId, async (tx) => {
    const [c] = await tx.execute<{ id: string }>(sql`
      select id::text from school_class where org_id = app_current_org() and institution_id = ${t.institutionId} limit 1`);
    return c!.id;
  });
});
afterAll(async () => {
  redis.disconnect();
  await close();
});

describe('the online form', () => {
  it('is set up by the office, with a public link that shows only its own text', async () => {
    const input = {
      institutionId: t.institutionId,
      yearLabel: '2026-27',
      title: 'Synthetic Online School admissions',
      intro: 'Visit us on Saturdays.',
      classIds: [classId],
      open: true,
      closesOn: null,
    };
    const teacher: Actor = { accountId: randomUUID(), orgId: t.orgId, personId: t.teacherId };
    expect(await code(saveAdmissionForm(deps, teacher, input))).toBe('denied');
    const r = await saveAdmissionForm(deps, office, input);
    slug = r.slug;
    expect(slug).toMatch(/^synthetic-online-school-admissions-[a-z2-9]{4}$/);
    expect(await code(saveAdmissionForm(deps, office, input))).toBe('form_exists');
    const f = await publicForm(db, slug);
    expect(f).toMatchObject({ title: input.title, accepting: true, yearLabel: '2026-27' });
    expect(f?.classes).toEqual([expect.objectContaining({ classId, name: 'Class 5' })]);
    expect(await publicForm(db, 'no-such-school-x1y2')).toBeNull();
  });

  it('takes an application after the mobile check; a wrong code gives no session', async () => {
    const p = phone();
    const c = await codeFor(p);
    expect(await code(startApplication(db, otp, SECRET, { slug, phone: p, code: '000000' }))).toBe(
      'invalid_code',
    );
    const { session } = await startApplication(db, otp, SECRET, { slug, phone: p, code: c });
    expect(await code(submitOnlineApplication(db, SECRET, application(`${session}x`)))).toBe(
      'session_invalid',
    );
    expect(
      await code(submitOnlineApplication(db, SECRET, application(session, { consent: false }))),
    ).toBe('consent_required');
    const r = await submitOnlineApplication(
      db,
      SECRET,
      application(session, { details: { addressLine: '1 Synthetic Road', pincode: '560001' } }),
    );
    expect(r).toMatchObject({
      status: 'received',
      reference: expect.stringMatching(/^[A-Z2-9]{6}$/),
    });
    const rows = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{
        state: string;
        source: string;
        creator: string | null;
        n: number;
        pin: string;
      }>(sql`
        select state, source, created_by_person_id::text as creator, pincode as pin,
          (select count(*)::int from audit_event e where e.org_id = a.org_id and e.entity_id = a.id
            and e.action = 'school.admission.apply_online' and e.actor_person_id is null) as n
        from school_application a where a.org_id = app_current_org() and guardian_phone = ${p}`),
    );
    // No papers came with it, so it waits for them.
    expect(rows).toEqual([
      { state: 'documents_pending', source: 'website', creator: null, n: 1, pin: '560001' },
    ]);

    // The same child again: the existing reference, no second application.
    const again = await submitOnlineApplication(db, SECRET, application(session));
    expect(again).toEqual({
      status: 'duplicate',
      reference: r.status === 'received' ? r.reference : null,
    });

    // Where it stands, after a fresh code: first name, class, status and the papers still needed.
    const status = await applicationStatus(db, otp, SECRET, {
      slug,
      phone: p,
      code: await codeFor(p),
    });
    expect(status).toEqual([
      {
        reference: again.reference,
        firstName: 'Synthetic',
        className: 'Class 5',
        status: 'papers_needed',
        offerUntil: null,
        papersNeeded: expect.arrayContaining([
          { kind: 'birth_certificate', title: 'Birth certificate', note: null },
        ]),
        session: expect.any(String),
      },
    ]);
    // The office sees it among the form's applications.
    expect(
      (await admissionForms(deps, office, t.institutionId)).find((f) => f.yearLabel === '2026-27')
        ?.applications,
    ).toBe(1);
  });

  it('refuses a closed form and a class it doesn’t take', async () => {
    const p = phone();
    const other = await withTenant(db, t.orgId, async (tx) => {
      const [c] = await tx.execute<{ id: string }>(sql`
        insert into school_class (org_id, institution_id, code, name, sequence)
        values (app_current_org(), ${t.institutionId}, '9', 'Class 9', 10) returning id::text`);
      return c!.id;
    });
    const session = await sessionFor(p);
    expect(
      await code(submitOnlineApplication(db, SECRET, application(session, { classId: other }))),
    ).toBe('class_not_found');
    const form = (await admissionForms(deps, office, t.institutionId)).find(
      (f) => f.yearLabel === '2026-27',
    );
    const base = {
      institutionId: t.institutionId,
      formId: form!.id,
      yearLabel: '2026-27',
      title: form!.title,
      intro: form!.intro,
      classIds: form!.classIds,
      closesOn: null,
    };
    await saveAdmissionForm(deps, office, { ...base, open: false });
    expect((await publicForm(db, slug))?.accepting).toBe(false);
    expect(await code(submitOnlineApplication(db, SECRET, application(session)))).toBe(
      'form_closed',
    );
    await saveAdmissionForm(deps, office, { ...base, open: true });
  });

  it('keeps form codes away from sign-in, and limits how many are sent', async () => {
    const p = phone();
    const c = await codeFor(p);
    expect(await signIn.verify(p, c)).toBe(false);
    await codeFor(p);
    await codeFor(p);
    await expect(
      requestApplicationCode(db, otp, { slug, phone: p, ip: ip() }),
    ).rejects.toBeInstanceOf(RateLimited);
    await expect(
      admissionForms(deps, { ...office, personId: t.teacherId }, t.institutionId),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
