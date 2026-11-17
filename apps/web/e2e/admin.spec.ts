// Milestone 14 in the browser: two Campusverse owners enrol real passkeys (Chromium's virtual
// authenticator), sign in, invite an organisation admin (simulated SMS), change its plan and features, and suspend it only
// after the second owner approves. Emergency switches, health and audit pages load cleanly.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devSession, noA11yViolations } from './helpers';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADMIN = 'http://localhost:3001';

function newOwner(name: string) {
  const email = `${name.toLowerCase()}-${randomBytes(4).toString('hex')}@staff.example.com`;
  const out = execSync(`pnpm --filter @campusverse/api -s admin-staff "${name}" ${email} owner`, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const { enrolUrl } = JSON.parse(out.trim().split('\n').pop() ?? '{}') as { enrolUrl: string };
  return { email, enrolUrl };
}

/** A device with a platform passkey authenticator that confirms the user automatically. */
async function withPasskeys(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

const fitsScreen = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

async function enrol(context: BrowserContext, page: Page, enrolUrl: string) {
  await withPasskeys(context, page);
  await page.goto(enrolUrl);
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
}

test('owners run a customer from the portal with passkeys and a second approval', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const asha = newOwner('Asha');
  const ravi = newOwner('Ravi');

  // Enrol, sign out, sign back in with the passkey.
  await enrol(context, page, asha.enrolUrl);
  // Two sign-out buttons (phone header, desktop sidebar) post the same form; either will do.
  await page.getByRole('button', { name: 'Sign out' }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Sign in to Campusverse Admin' })).toBeVisible();
  await noA11yViolations(page);
  await page.getByLabel('Work email').fill(asha.email);
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await fitsScreen(page);

  // Inviting an organisation admin: with no SMS service, the invitation shows on screen.
  // The list loads only once the page is interactive (its buttons work from then on).
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite an admin' }).click();
  const form = page.getByRole('form', { name: 'Invite an admin' });
  await form.getByLabel('Admin’s name').fill('Admin Synthetic Portal');
  await form.getByLabel('Admin’s mobile').fill(`9${randomInt(100_000_000, 999_999_999)}`);
  await form.getByRole('button', { name: 'Send invitation' }).click();
  await expect(form.getByText(/Simulated SMS/)).toBeVisible();
  await expect(form.getByText(/Sign in at .*\/login/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Invitations' })).toContainText(
    'Admin Synthetic Portal',
  );

  // An onboarded customer (created the development way) for the plan, feature and status steps.
  const school = `Synthetic Portal School ${randomInt(1e6)}`;
  devSession(school);
  await page.reload();
  await page.getByLabel('Search by name').fill(school);
  await page.getByRole('link', { name: new RegExp(school) }).click();
  await expect(page.getByRole('heading', { name: school })).toBeVisible();
  await noA11yViolations(page);

  // Plan and features.
  await page
    .getByRole('combobox', { name: 'Plan', exact: true })
    .selectOption({ label: 'Standard' });
  await expect(page.getByText('Plan changed.')).toBeVisible();
  // Development schools start with Verse AI on; the owner switches it off for this customer.
  await page
    .getByRole('button', { name: 'Switch off: Verse AI answers in the school app' })
    .click();
  await expect(page.getByText('Off · switched off here')).toBeVisible();

  // Suspension waits for the other owner.
  const status = page.getByRole('form', { name: 'Status' });
  await status.getByLabel('Reason').fill('Contract ended without renewal');
  await status.getByRole('button', { name: 'Ask for approval' }).click();
  await expect(status.getByText(/Waiting for approval/)).toBeVisible();
  const customerUrl = page.url();
  await page.goto(`${ADMIN}/approvals`);
  const mine = page.getByRole('listitem').filter({ hasText: school });
  await expect(mine.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await fitsScreen(page);
  await noA11yViolations(page);

  const other = await browser.newContext({ baseURL: ADMIN });
  const otherPage = await other.newPage();
  await enrol(other, otherPage, ravi.enrolUrl);
  await otherPage.goto(`${ADMIN}/approvals`);
  await otherPage
    .getByRole('listitem')
    .filter({ hasText: school })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(
    otherPage.getByRole('listitem').filter({ hasText: school }).getByText('Approved'),
  ).toBeVisible();
  await other.close();

  await page.goto(customerUrl);
  await expect(page.getByText('Suspended', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/admin-customer-${info.project.name}.png`,
    fullPage: true,
  });

  // An emergency switch for everyone, on and off again.
  await page.goto(`${ADMIN}/switches`);
  const turnOn = page.getByRole('form', { name: 'Turn on' });
  await turnOn.getByLabel('Reason').fill('Provider incident drill');
  await turnOn.getByRole('button', { name: 'Turn on' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Provider incident drill' });
  await expect(row.getByText('Pause messaging')).toBeVisible();
  await fitsScreen(page);
  await noA11yViolations(page);
  await row.getByRole('button', { name: 'Turn off' }).click();
  await expect(row).toHaveCount(0);

  for (const [path, heading] of [
    ['/health', 'Delivery health'],
    ['/audit', 'Audit'],
    ['/incidents', 'Incidents'],
    ['/flags', 'Feature flags'],
    ['/plans', 'Plans'],
    ['/staff', 'Staff'],
  ] as const) {
    await page.goto(`${ADMIN}${path}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await fitsScreen(page);
    await noA11yViolations(page);
  }
  await page.goto(`${ADMIN}/audit`);
  await expect(page.getByText('customer.status_changed').first()).toBeVisible();
});
