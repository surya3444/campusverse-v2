// Onboarding in the browser: an invited organisation admin signs in with the simulated SMS code
// shown on screen, builds an organisation with two campuses and a school in each, lands in
// setup, switches between the schools, and sees
// today's real overview asking them to finish setting up.
import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noA11yViolations } from './helpers';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function invite(name: string): string {
  const out = execSync(`pnpm --filter @campusverse/api -s dev-session --invite "${name}"`, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return (JSON.parse(out.trim().split('\n').pop() ?? '{}') as { phone: string }).phone;
}

const fitsScreen = async (page: import('@playwright/test').Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

test('an invited admin signs in with a simulated code and onboards two campuses', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const phone = invite('Kavya Synthetic');
  const org = `Synthetic Onboarding Group ${randomInt(1e6)}`;

  // Sign in: the code arrives as a simulated SMS on screen.
  await page.goto('/login');
  await expect(page.getByText(/Simulation mode/)).toBeVisible();
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  const sms = page.getByRole('status').filter({ hasText: 'Simulated SMS' });
  await expect(sms).toBeVisible();
  const code = /(\d{6}) is your/.exec((await sms.textContent()) ?? '')?.[1] ?? '';
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: 'Welcome, Kavya Synthetic' })).toBeVisible();
  await noA11yViolations(page);
  await fitsScreen(page);
  await page.screenshot({ path: `e2e/screenshots/onboarding-profile-${info.project.name}.png` });

  // Your profile.
  await page.getByLabel('Designation').fill('Director');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Organisation.
  await page.getByLabel('Organisation name').fill(org);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Two campuses.
  const first = page.getByRole('region', { name: 'Campus 1' });
  await first.getByLabel('Address').fill('12 Synthetic Road');
  await first.getByLabel('City or town').fill('Bengaluru');
  await first.getByLabel('PIN code').fill('560001');
  await page.getByRole('button', { name: 'Add another campus' }).click();
  const second = page.getByRole('region', { name: 'Campus 2' });
  await second.getByLabel('Campus name').fill('South campus');
  await second.getByLabel('Address').fill('4 Synthetic Lane');
  await second.getByLabel('City or town').fill('Mysuru');
  await second.getByLabel('PIN code').fill('570001');
  await page.getByRole('button', { name: 'Continue' }).click();

  // A school in each.
  const main = page.getByRole('region', { name: 'Institutions at Main campus' });
  await main.getByLabel('School name').fill('Synthetic North School');
  await main.getByLabel('UDISE+ code').fill('29200100101');
  await page
    .getByRole('region', { name: 'Institutions at South campus' })
    .getByLabel('School name')
    .fill('Synthetic South School');
  await page.screenshot({
    path: `e2e/screenshots/onboarding-institutions-${info.project.name}.png`,
    fullPage: true,
  });
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Review, then create.
  await expect(page.getByText('Synthetic North School · CBSE · LKG–10')).toBeVisible();
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page).toHaveURL(/\/setup/);

  // Both schools are in the switcher; choosing one moves every screen to it. (On a phone the
  // switcher is in the menu.)
  await expect(page.getByRole('heading', { name: 'School setup' })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('button', { name: /Working in:/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole('menuitemradio', { name: /Synthetic South School/ })).toBeVisible();
  await page.getByRole('menuitemradio', { name: /Synthetic South School/ }).click();

  // Today's real overview: setup isn't finished yet.
  await page.goto('/');
  await expect(
    page
      .getByRole('main')
      .getByText(/Synthetic South School/)
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Finish setting up' })).toBeVisible();
  await noA11yViolations(page);
  await fitsScreen(page);
});
