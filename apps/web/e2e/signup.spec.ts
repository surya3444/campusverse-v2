// Self-serve sign-up (rule book §11 "Self-serve onboarding") through the real screens: someone
// running a college signs up, confirms the simulated code, waits for Campusverse to approve the
// request (done here as the super admin would), finds onboarding already started with
// their answers, adds the affiliating university and creates the organisation, landing in
// Academic Structure with the sidebar for colleges. All data synthetic.
import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiPost, approveSignup, noA11yViolations } from './helpers';

test('a college signs up by itself and onboards', async ({ page, context }, info) => {
  test.setTimeout(150_000);
  const phone = `9${String(randomInt(1e8, 1e9))}`;
  const org = `Synthetic Signup College ${randomInt(1e6)}`;

  // Someone else signed in on this browser before: their chosen profile must not carry over.
  await context.addCookies(
    (['cv_org', 'cv_person'] as const).map((name) => ({
      name,
      value: '00000000-0000-7000-8000-000000000001',
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict' as const,
    })),
  );
  await page.goto('/login');
  await page.getByRole('link', { name: 'Create your institution’s account' }).click();
  await expect(page).toHaveURL(/\/signup/);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page
    .locator('label')
    .filter({ hasText: /^College$/ })
    .click();
  await expect(page.getByRole('radio', { name: 'College' })).toBeChecked();
  await page.getByLabel('College or group name').fill(org);
  await page.getByLabel('State').selectOption('TS');
  await page.getByLabel('Your full name').fill('Synthetic Principal');
  await page.getByLabel('Mobile number').fill(phone);
  await noA11yViolations(page);
  await page.screenshot({ path: `e2e/screenshots/signup-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Create account' }).click();

  const sms = page.getByRole('status').filter({ hasText: 'Simulated SMS' });
  await expect(sms).toBeVisible();
  const code = /(\d{6}) is your/.exec((await sms.textContent()) ?? '')?.[1] ?? '';
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Confirm and continue' }).click();

  // Campusverse checks each new organisation first: setup waits for approval.
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByText('Your request is with Campusverse')).toBeVisible();
  await noA11yViolations(page);
  approveSignup(phone);
  await page.getByRole('button', { name: 'Check again' }).click();

  // Onboarding, started with their answers.
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: 'Welcome, Synthetic Principal' })).toBeVisible();
  await page.getByLabel('Designation').fill('Principal');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Organisation name')).toHaveValue(org);
  await page.getByRole('button', { name: 'Continue' }).click();
  const campus = page.getByRole('region', { name: 'Campus 1' });
  await expect(campus.getByLabel('State')).toHaveValue('TS');
  await campus.getByLabel('Address').fill('1 Synthetic Road');
  await campus.getByLabel('City or town').fill('Hyderabad');
  await campus.getByLabel('PIN code').fill('500001');
  await page.getByRole('button', { name: 'Continue' }).click();
  const inst = page.getByRole('region', { name: 'Institutions at Main campus' });
  await expect(inst.getByRole('radio', { name: 'College' })).toBeChecked();
  await expect(inst.getByLabel('Name', { exact: true })).toHaveValue(org);
  await inst.getByLabel('College type').selectOption('autonomous_college');
  await inst.getByLabel('Affiliating university').fill('ou');
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(`${org} · College · OU`)).toBeVisible();
  await page.getByRole('button', { name: 'Create organisation' }).click();

  // A college starts with programmes and batches; its sidebar shows the college modules.
  await expect(page).toHaveURL(/\/academic-structure/);
  await expect(page.getByRole('heading', { name: 'Academic structure', level: 1 })).toBeVisible();
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Menu' }).click();
  // On a phone the sidebar opens as a dialog; wait for it rather than any visible navigation.
  const nav =
    info.project.name === 'phone'
      ? page.getByRole('dialog')
      : page.getByRole('navigation').filter({ visible: true }).first();
  await expect(nav.getByRole('link', { name: 'Course registration' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'OBE' })).toBeVisible();

  // Today for a college: getting started, from the first programme to the programme outcomes.
  await page.goto('/');
  const setup = page.getByRole('region', { name: 'Finish setting up' });
  await expect(setup).toContainText('Add your first programme');
  await expect(page.getByRole('region', { name: 'Quick actions' })).toContainText(
    'Course registration',
  );
  await noA11yViolations(page);

  // A member of staff added: the home offers to invite them to sign in.
  const institutionId = await page.evaluate(async () => {
    const r = await fetch('/api/v1/school/setup/institutions', {
      headers: { 'x-requested-with': 'campusverse' },
    });
    return ((await r.json()) as { id: string }[])[0]?.id ?? '';
  });
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const { personId } = (await apiPost(page, '/people/staff', {
    institutionId,
    name: 'Synthetic College Teacher',
    phone: `+919${String(randomInt(1e8, 1e9))}`,
    joinedOn: new Date(Date.now() - 864e5).toISOString().slice(0, 10),
  })) as { personId: string };
  // Invitations go to staff with a role here (a role is given in Settings › Roles).
  const roles = (await (await page.request.get('/api/v1/access/roles')).json()) as {
    roles: { id: string; key: string }[];
  };
  await apiPost(page, '/access/assignments', {
    personId,
    roleId: roles.roles.find((r) => r.key === 'teacher')!.id,
    scope: { type: 'institution', id: institutionId },
    from: today,
    until: null,
  });
  await page.reload();
  const invite = page.getByRole('region', { name: 'Invite staff and parents' });
  await expect(invite).toContainText('Staff to invite');
  await expect(invite.getByRole('button', { name: 'Invite 1 person' })).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/college-home-${info.project.name}.png`,
    fullPage: true,
  });
});
