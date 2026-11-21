// Organisation admins through the real screens (owner's brief, 20 Nov 2026): an admin invited by
// email signs up through the link (no approval needed), runs a campus with a school and a college
// and a second campus with a university, narrows the view to one campus (overview, students and
// the institution switcher follow it), then starts a second organisation and switches between
// them. All data synthetic.
import { expect, test, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiPost, emailInviteToken, noA11yViolations } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

/** The sidebar: on a phone it opens as a dialog behind Menu. */
async function sidebar(page: Page, phone: boolean) {
  if (phone) {
    await page.getByRole('button', { name: 'Menu' }).click();
    return page.getByRole('dialog');
  }
  return page.locator('aside').filter({ visible: true }).first();
}

test('an invited admin runs campuses, views and a second organisation', async ({ page }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'phone';
  const email = `admin-${randomInt(1e9)}@example.test`;
  const org = `Synthetic Invited Group ${randomInt(1e6)}`;
  const token = emailInviteToken('Synthetic Group Admin', email);

  // The link opens sign-up with the address fixed.
  await page.goto(`/signup?invite=${token}`);
  await expect(page.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible();
  await expect(page.getByLabel('Email (optional)')).toHaveValue(email);
  await page.getByLabel(/name$/i).first().fill(org);
  await page.getByLabel('Your full name').fill('Synthetic Group Admin');
  await page.getByLabel('Mobile number').fill(`9${String(randomInt(1e8, 1e9))}`);
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  const sms = page.getByRole('status').filter({ hasText: 'Simulated SMS' });
  const code = /(\d{6}) is your/.exec((await sms.textContent()) ?? '')?.[1] ?? '';
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Confirm and continue' }).click();

  // No approval step: onboarding opens straight away.
  await expect(page.getByRole('heading', { name: 'Welcome, Synthetic Group Admin' })).toBeVisible();
  await page.getByLabel('Designation').fill('Chairperson');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const campus = page.getByRole('region', { name: 'Campus 1' });
  await campus.getByLabel('Address').fill('1 Synthetic Road');
  await campus.getByLabel('City or town').fill('Bengaluru');
  await campus.getByLabel('PIN code').fill('560001');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page).toHaveURL(/\/setup/);

  // A college beside the school on the main campus; a second campus with a university.
  const view = (await (await page.request.get('/api/v1/organisation/view')).json()) as {
    campuses: { campusId: string; name: string }[];
  };
  const main = view.campuses[0]?.campusId ?? '';
  await apiPost(page, `/organisation/campuses/${main}/institutions`, {
    profile: 'affiliated_college',
    name: 'Synthetic Degree College',
    authorityCode: 'BU',
  });
  const { campusId: south } = (await apiPost(page, '/organisation/campuses', {
    name: 'South Campus',
    stateCode: 'KA',
  })) as { campusId: string };
  await apiPost(page, `/organisation/campuses/${south}/institutions`, {
    profile: 'university',
    name: 'Synthetic South University',
    authorityCode: 'UGC',
  });

  // The whole organisation, then a view of the main campus only.
  await page.goto('/organisation');
  await expect(
    page.getByText('Synthetic South University').filter({ visible: true }).first(),
  ).toBeVisible();
  let nav = await sidebar(page, phone);
  await nav.getByRole('button', { name: /^Working in:/ }).click();
  await page.getByRole('menuitem', { name: /Change view/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Change view' });
  await dialog.getByRole('radio', { name: 'Campuses' }).click();
  await dialog.getByRole('checkbox', { name: /Main campus/ }).check();
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await expect(dialog).toBeHidden();
  if (phone) await page.keyboard.press('Escape');
  await expect(
    page.getByText('Synthetic Degree College').filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('Synthetic South University')).toHaveCount(0);
  await noA11yViolations(page);

  // Students list everyone in the view; the switcher offers only its institutions.
  await page.goto('/students');
  await expect(page.getByRole('radio', { name: 'Whole view · 2 institutions' })).toBeChecked();
  nav = await sidebar(page, phone);
  await nav.getByRole('button', { name: /^Working in:/ }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Synthetic Degree College' })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Synthetic South University' })).toHaveCount(
    0,
  );
  await page.screenshot({ path: `e2e/screenshots/admin-view-${info.project.name}.png` });

  // A second organisation of their own, built in the same onboarding.
  await page.getByRole('menuitem', { name: 'New organisation' }).click();
  await expect(page).toHaveURL(/\/onboarding\?another=1/);
  await page.getByLabel('Organisation name').fill(`${org} Two`);
  await page.getByRole('button', { name: 'Continue' }).click();
  const c2 = page.getByRole('region', { name: 'Campus 1' });
  await c2.getByLabel('Address').fill('2 Synthetic Road');
  await c2.getByLabel('City or town').fill('Mysuru');
  await c2.getByLabel('PIN code').fill('570001');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByRole('region', { name: /^Institutions at/ })
    .getByLabel(/^School name/)
    .fill('Synthetic Second School');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page).toHaveURL(/\/setup/);

  // Both organisations in the switcher; switching goes back to the first.
  nav = await sidebar(page, phone);
  await nav.getByRole('button', { name: /^Working in:/ }).click();
  await expect(page.getByRole('menuitemradio', { name: `${org} Two` })).toBeChecked();
  await page.getByRole('menuitemradio', { name: org, exact: true }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await page.goto('/organisation');
  await expect(page.getByRole('heading', { name: org, exact: true })).toBeVisible();
});
