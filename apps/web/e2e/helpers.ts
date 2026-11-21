// Shared browser-test helpers: a signed-in synthetic school, and accessibility checks.
import AxeBuilder from '@axe-core/playwright';
import { generateSchool } from '@campusverse/test-data';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export type DevSession = {
  orgId: string;
  personId: string;
  institutionId: string;
  accessToken: string;
  refreshToken: string;
};

/** Approves the sign-up request from this mobile, as the super admin would (dev-only script). */
export function approveSignup(phone: string) {
  execSync(`pnpm --filter @campusverse/api -s dev-session --approve ${phone}`, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

/** An email invite's one-time sign-up link token, as the super admin's "Invite by email" makes. */
export function emailInviteToken(name: string, email: string): string {
  const out = execSync(
    `pnpm --filter @campusverse/api -s dev-session --email-invite "${name}" ${email}`,
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return (JSON.parse(out.trim().split('\n').pop() ?? '{}') as { token: string }).token;
}

/** A freshly signed-up synthetic school, with its owner signed in (dev-only script). */
export function devSession(name = 'Synthetic Test School'): DevSession {
  const out = execSync(`pnpm --filter @campusverse/api -s dev-session "${name}"`, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as DevSession;
}

/** Puts the session into the browser's httpOnly cookies, as /session/verify would. */
export async function signInAs(context: BrowserContext, s: DevSession) {
  await context.addCookies(
    (
      [
        ['cv_at', s.accessToken],
        ['cv_rt', s.refreshToken],
        ['cv_org', s.orgId],
        ['cv_person', s.personId],
      ] as const
    ).map(([name, value]) => ({
      name,
      value,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict' as const,
    })),
  );
}

export async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual(
    [],
  );
}

export const xlsx = (name: string, buffer: Buffer) => ({
  name,
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer,
});

/** Calls the app's /api/v1 pass-through as the signed-in browser does. */
export async function apiPost(page: Page, path: string, body?: unknown) {
  const res = await page.request.post(`/api/v1${path}`, {
    headers: { 'x-requested-with': 'campusverse' },
    ...(body === undefined ? {} : { data: body }),
  });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

/** A school with one class of six generated students, set up through the API the screens use. */
export async function schoolWithStudents(page: Page, institutionId: string) {
  const iso = (d: number) =>
    new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
  await apiPost(page, `/school/setup/${institutionId}/structure`, {
    board: 'CBSE',
    yearLabel: '2026-27',
    starts: iso(-10),
    ends: iso(300),
    classes: [{ code: '3', sections: 1, capacity: 30 }],
  });
  const files = await generateSchool({
    classes: [{ code: '3', sections: ['A'], studentsPerSection: 6 }],
    seed: randomInt(1e6),
  });
  for (const [kind, buffer] of [
    ['staff', files.staff],
    ['students', files.students],
  ] as const) {
    const res = await page.request.post(`/api/v1/school/setup/${institutionId}/imports/${kind}`, {
      headers: { 'x-requested-with': 'campusverse' },
      multipart: {
        file: {
          name: `${kind}.xlsx`,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer,
        },
      },
    });
    const { batchId } = (await res.json()) as { batchId: string };
    await apiPost(page, `/school/setup/imports/${batchId}/commit`);
    await expect
      .poll(
        async () =>
          (
            (await (await page.request.get(`/api/v1/school/setup/imports/${batchId}`)).json()) as {
              status: string;
            }
          ).status,
        {
          timeout: 30_000,
        },
      )
      .toBe('committed');
  }
}

// The Expo app's web build at phone size, signed in as a guardian or teacher of a school.
export const APP = 'http://localhost:8081';

export type AppSession = {
  orgId: string;
  personId: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
};

/** A guardian or class teacher of the school, signed in (dev-only script); waits for the invite worker. */
export async function sessionFor(
  kind: 'guardian' | 'teacher' | 'nurse' | 'office',
  orgId: string,
): Promise<AppSession> {
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      const out = execSync(`pnpm --filter @campusverse/api -s dev-session --${kind} ${orgId}`, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return JSON.parse(out.trim().split('\n').pop() ?? '{}') as AppSession;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw last;
}

/** The app on a 360 px phone, already signed in as this person (the app keeps it in sessionStorage on web). */
export async function openApp(browser: Browser, s: AppSession): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    isMobile: true,
    hasTouch: true,
  });
  const session = {
    tokens: { accessToken: s.accessToken, refreshToken: s.refreshToken, deviceId: s.deviceId },
    profile: {
      orgId: s.orgId,
      personId: s.personId,
      orgName: 'Synthetic',
      personName: 'Synthetic',
    },
  };
  await context.addInitScript(
    (value) => sessionStorage.setItem('cv_session', value),
    JSON.stringify(session),
  );
  const page = await context.newPage();
  await page.goto(APP);
  return page;
}
