// Staff leave through the real screens (docs/specs/STAFF_LEAVE.md): the office asks for leave
// for a teacher, the owner approves it, balances adjust, a new leave type, and the month's
// payroll inputs download.
import { expect, test } from '@playwright/test';
import {
  apiPost,
  devSession,
  noA11yViolations,
  openApp,
  schoolWithStudents,
  sessionFor,
  signInAs,
} from './helpers';

const iso = (d: Date) => d.toISOString().slice(0, 10);

test('staff leave: ask, approve, adjust, types, payroll inputs', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  const s = devSession(`Synthetic Leave School ${info.project.name}`);
  await signInAs(context, s);
  await apiPost(page, '/people/staff', {
    institutionId: s.institutionId,
    name: 'Synthetic Leave Teacher',
    phone: `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
    joinedOn: iso(new Date(Date.now() - 86_400_000)),
  });
  // Next week's Monday and Tuesday.
  const mon = new Date(Date.now() + 330 * 60_000);
  mon.setUTCDate(mon.getUTCDate() + ((8 - mon.getUTCDay()) % 7 || 7));
  const tue = new Date(mon.getTime() + 86_400_000);

  await page.goto('/staff-leave');
  await expect(page.getByRole('heading', { name: 'Staff leave', level: 1 })).toBeVisible();
  await expect(page.getByText('No leave asked for this year.')).toBeVisible();
  await noA11yViolations(page);

  // The office asks on the teacher's behalf: two working days of casual leave.
  await page.getByRole('button', { name: 'Ask for leave' }).click();
  const dialog = page.getByRole('dialog');
  const who = dialog.getByLabel('Ask for leave for');
  await who.selectOption(
    (await who.locator('option', { hasText: 'Synthetic Leave Teacher' }).getAttribute('value')) ??
      '',
  );
  await dialog.getByLabel('Leave type').selectOption({ label: 'Casual leave (CL)' });
  await dialog.getByLabel('From').fill(iso(mon));
  await dialog.getByLabel('To').fill(iso(tue));
  await dialog.getByLabel('Reason').fill('Family function');
  await expect(dialog.getByText('Counts 2 days · 10 left after this')).toBeVisible();
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Ask for leave' }).click();
  await expect(dialog).toBeHidden();

  // The owner approves it.
  await page.getByRole('radio', { name: 'Requests' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Synthetic Leave Teacher' });
  await expect(row.getByText('Waiting', { exact: true })).toBeVisible();
  await noA11yViolations(page);
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Synthetic Leave Teacher' }).getByText('Approved'),
  ).toBeVisible();

  // Balances: 12 − 2 = 10, then one day added with a reason.
  await page.getByRole('radio', { name: 'Balances' }).click();
  const bal = page.getByRole('row').filter({ hasText: 'Synthetic Leave Teacher' });
  await expect(bal.getByRole('cell').first()).toHaveText('10');
  await noA11yViolations(page);
  await bal.getByRole('button', { name: /Adjust/ }).click();
  await dialog.getByLabel('Days to add').fill('1');
  await dialog.getByLabel('Reason').fill('Opening balance');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(bal.getByRole('cell').first()).toHaveText('11');

  // A new leave type.
  await page.getByRole('radio', { name: 'Leave types' }).click();
  await page.getByRole('button', { name: 'New leave type' }).click();
  await dialog.getByLabel('Code').fill('STL');
  await dialog.getByLabel('Name').fill('Study leave');
  await dialog.getByLabel('Days a year').fill('5');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Study leave (STL)')).toBeVisible();
  await noA11yViolations(page);

  // Payroll inputs for this month, downloaded as CSV.
  await page.getByRole('radio', { name: 'Payroll inputs' }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Synthetic Leave Teacher' })).toBeVisible();
  await noA11yViolations(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^payroll-inputs-\d{4}-\d{2}\.csv$/);
});

test('a teacher asks for leave in the app and sees it approved', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(info.project.name === 'phone', 'the app side already runs at phone width');
  test.setTimeout(240_000);
  const owner = devSession('Synthetic App Leave School');
  await signInAs(context, owner);
  await page.goto('/staff-leave');
  await schoolWithStudents(page, owner.institutionId);
  await apiPost(page, `/school/setup/${owner.institutionId}/invites`);
  const teacher = await sessionFor('teacher', owner.orgId);
  const mon = new Date(Date.now() + 330 * 60_000);
  mon.setUTCDate(mon.getUTCDate() + ((8 - mon.getUTCDay()) % 7 || 7));

  const app = await openApp(browser, teacher);
  const v = { visible: true };
  await expect(app.getByText(/CL: 12 left/).filter(v)).toBeVisible({ timeout: 30_000 });
  await app.getByRole('button', { name: 'Ask for leave' }).filter(v).click();
  await app.getByRole('radio', { name: 'Sick leave (SL)' }).filter(v).click();
  await app.getByLabel('From').filter(v).fill(iso(mon));
  await app.getByLabel('Reason').filter(v).fill('Fever');
  await expect(app.getByText('Counts 1 day · 11 left after this').filter(v)).toBeVisible();
  await app.getByRole('button', { name: 'Ask for leave' }).filter(v).click();
  await expect(app.getByText('Sent for approval.').filter(v)).toBeVisible();
  await expect(app.getByText('Waiting for approval').filter(v)).toBeVisible();
  await noA11yViolations(app);

  // The owner approves it on the web; the app shows it approved.
  await page.reload();
  await page.getByRole('radio', { name: 'Requests' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved')).toBeVisible();
  // Still on the leave screen.
  await app.reload();
  await expect(app.getByText('Approved').filter(v)).toBeVisible({ timeout: 30_000 });
  await app.screenshot({ path: 'e2e/screenshots/teacher-app-leave.png', fullPage: true });
});
