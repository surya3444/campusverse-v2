// Milestone 7 exit check through the real screens: a fresh school is set up in the wizard and
// reaches "ready for first attendance". Real API, worker, Postgres and Redis.
import { generateSchool } from '@campusverse/test-data';
import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { devSession, noA11yViolations, signInAs, xlsx } from './helpers';

test('setup wizard: a new school reaches first attendance', async ({ page, context }, info) => {
  test.skip(
    info.project.name === 'phone',
    'one full run is enough; the phone layout is covered by axe and overflow checks',
  );
  test.setTimeout(120_000);
  await signInAs(context, devSession('Synthetic Wizard School'));

  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'School setup' })).toBeVisible();

  // Step 1: two classes, one section each.
  for (let c = 3; c <= 10; c++)
    await page.getByLabel(`Runs: Class ${c}`, { exact: true }).uncheck();
  for (const c of [1, 2]) await page.getByLabel(`Sections: Class ${c}`, { exact: true }).fill('1');
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'Review structure' }).click();
  const structure = page.getByRole('dialog', { name: 'Set up the year and classes' });
  await expect(structure.getByText('Class 1: sections A')).toBeVisible();
  await structure.getByRole('button', { name: 'Create 2 sections' }).click();
  // Done: the wizard marks the step and moves on to the next one.
  await expect(page.getByRole('button', { name: /Year and classes\s*Done/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Invitations\s*To do/ })).toBeVisible();

  // Step 2: staff, then students, from generated files.
  await page.getByRole('button', { name: /Students and staff/ }).click();
  const files = await generateSchool({
    classes: [
      { code: '1', sections: ['A'], studentsPerSection: 6 },
      { code: '2', sections: ['A'], studentsPerSection: 6 },
    ],
    seed: randomInt(1e6),
  });
  for (const [label, file, n] of [
    ['Staff', files.staff, 2],
    ['Students and guardians', files.students, 12],
  ] as const) {
    await page.getByLabel(`Upload .xlsx file: ${label}`).setInputFiles(xlsx(`${label}.xlsx`, file));
    const panel = page.getByRole('region', { name: label });
    await expect(panel.getByText(`${n} ready`)).toBeVisible();
    await panel.getByRole('button', { name: `Import ${n} rows` }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: `Import ${n} rows` })
      .click();
    await expect(panel.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible({
      timeout: 30_000,
    });
  }

  // Step 3: invitations.
  await page.getByRole('button', { name: /Invitations/ }).click();
  const invite = page.getByRole('button', { name: /^Invite \d+ people$/ });
  await invite.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Invite \d+ people$/ })
    .click();
  await expect(page.getByText('Everyone with a phone number has been invited.')).toBeVisible({
    timeout: 30_000,
  });

  // Step 4: ready.
  await page.getByRole('button', { name: /Ready for attendance/ }).click();
  await expect(page.getByRole('heading', { name: 'Ready for first attendance' })).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/setup-ready.png', fullPage: true });
});

test('without a session, setup sends you to sign in; sign-in asks for the code', async ({
  page,
}) => {
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)setup/);
  await noA11yViolations(page);
  await page.getByLabel('Mobile number').fill(`9${randomInt(100_000_000, 999_999_999)}`);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('6-digit code')).toBeVisible();
  await page.screenshot({ path: `e2e/screenshots/login-${test.info().project.name}.png` });
});

test('the API pass-through refuses requests without the CSRF header or a session', async ({
  request,
}) => {
  const noHeader = await request.post('/api/v1/school/setup/x/invites');
  expect(noHeader.status()).toBe(403);
  const noSession = await request.get('/api/v1/school/setup/institutions');
  expect(noSession.status()).toBe(401);
  const auth = await request.post('/api/v1/auth/refresh', {
    headers: { 'x-requested-with': 'campusverse' },
  });
  expect(auth.status()).toBe(404); // sign-in endpoints are never reachable through the pass-through
});
