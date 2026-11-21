// Fees through the real screens: heads and a plan, invoices issued through the preview, cash at the
// counter with a printed receipt; then the parent sees the bill in the app, pays online (the
// development gateway stands in for Razorpay), and gets the receipt; the school sees it settled.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const APP = 'http://localhost:8081';
const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);

type AppSession = {
  orgId: string;
  personId: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
};

async function guardian(orgId: string): Promise<AppSession> {
  for (let i = 0; ; i++) {
    try {
      const out = execSync(`pnpm --filter @campusverse/api -s dev-session --guardian ${orgId}`, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return JSON.parse(out.trim().split('\n').pop() ?? '{}') as AppSession;
    } catch (e) {
      if (i > 30) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function openApp(browser: Browser, s: AppSession): Promise<Page> {
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

test('fees: plan, invoices, the counter and a receipt; the parent pays online once', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(
    info.project.name === 'phone',
    'one full run; the app side already runs at phone width',
  );
  test.setTimeout(240_000);
  const owner = devSession('Synthetic Fees School');
  await signInAs(context, owner);
  await page.goto('/fees');
  await schoolWithStudents(page, owner.institutionId);
  await apiPost(page, `/school/setup/${owner.institutionId}/invites`);

  // A fee head and a one-instalment plan for Class 3.
  await page.goto('/fees/plans');
  await page.getByRole('button', { name: 'Add fee type' }).click();
  const head = page.getByRole('form', { name: 'Add fee type' });
  await head.getByLabel('Code').fill('TUITION');
  await head.getByLabel('Name', { exact: true }).fill('Tuition');
  await head.getByRole('button', { name: 'Add fee type' }).click();
  await expect(head).toBeHidden();
  await expect(page.getByText('Tuition', { exact: true })).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/fees-how.png', fullPage: true });
  await page.getByRole('link', { name: 'New fee structure' }).click();
  await page.getByLabel('Fee structure name').fill('Class 3 fees');
  await page.getByText('Class 3', { exact: true }).click();
  await page.getByLabel('Tuition Amount (₹)').fill('12,000');
  await page.getByLabel('Instalment', { exact: true }).fill('Annual');
  await page.getByLabel('Due on').fill(iso(20));
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/fees\/plans\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Finalise' }).click();
  await page.getByRole('button', { name: 'Bill students' }).click();
  const canvas = page.getByRole('dialog');
  await expect(canvas.getByText('Bills', { exact: true })).toBeVisible();
  await canvas.getByRole('button', { name: 'Bill students' }).click();
  await expect(page.getByText('6 bills made.')).toBeVisible();

  // The parent's child pays online below; the counter takes cash from another family.
  const parent = await guardian(owner.orgId);
  const home = (await (
    await page.request.get(`${APP}/api/v1/parent/home`, {
      headers: {
        authorization: `Bearer ${parent.accessToken}`,
        'x-org-id': parent.orgId,
        'x-person-id': parent.personId,
      },
    })
  ).json()) as { children: { personId: string }[] };
  const children = new Set(home.children.map((c) => c.personId));
  const billed = (await (
    await page.request.get(`/api/v1/finance/${owner.institutionId}/students?search=Synthetic`)
  ).json()) as { studentId: string; name: string }[];
  const first = billed.find((b) => !children.has(b.studentId));
  await page.goto('/fees');
  await page
    .getByPlaceholder('Find a student by name or admission no.')
    .fill(first!.name.split(' ')[0]!);
  await page.getByRole('link', { name: new RegExp(first!.name) }).click();
  await expect(page.getByRole('heading', { name: first!.name })).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole('button', { name: /^Collect ₹12,000\.00$/ }).click();
  await expect(page.getByText(/Collected\. Receipt \d{4}-\d{2}\/000001\./).first()).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/fees-account.png', fullPage: true });
  await page.getByRole('link', { name: 'Print receipt' }).click();
  await expect(page.getByText('Fee receipt')).toBeVisible();
  await expect(page.getByText('₹12,000.00').last()).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/fees-receipt.png', fullPage: true });

  // The parent sees the bill before paying, pays online, and gets one receipt.
  const app = await openApp(browser, parent);
  await app
    .getByRole('button', { name: 'Fees' })
    .filter({ visible: true })
    .first()
    .click({ timeout: 30_000 });
  const payButton = app
    .getByRole('button', { name: 'Pay ₹12,000.00 online' })
    .filter({ visible: true });
  await expect(payButton).toBeVisible();
  await expect(app.getByText('₹12,000.00 due').filter({ visible: true })).toBeVisible();
  await noA11yViolations(app);
  await app.screenshot({ path: 'e2e/screenshots/parent-fees.png', fullPage: true });
  const started = app.waitForResponse((r) => /\/finance\/students\/[^/]+\/pay$/.test(r.url()));
  const opened = app.waitForEvent('popup', { timeout: 5_000 }).catch(() => null);
  await payButton.click();
  const { paymentId } = (await (await started).json()) as { paymentId: string };
  await (await opened)?.close();
  // The bank's page "pays"; the gateway's signed webhook arrives, twice.
  for (let i = 0; i < 2; i++) {
    await page.request.post(`/api/v1/finance/webhooks/dev-pay/${paymentId}`, {
      headers: { 'x-requested-with': 'campusverse' },
    });
  }
  await app.reload();
  await expect(app.getByText('All fees paid.').filter({ visible: true })).toBeVisible({
    timeout: 30_000,
  });
  const receipts = app
    .getByRole('link', { name: /^Receipt \d{4}-\d{2}\/\d{6}/ })
    .filter({ visible: true });
  await expect(receipts).toHaveCount(1);
  await receipts.first().click();
  await expect(app.getByText('Total').filter({ visible: true })).toBeVisible();
  await app.screenshot({ path: 'e2e/screenshots/parent-receipt.png', fullPage: true });
});
