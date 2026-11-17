// Payroll › Final settlement (rule book §13.7; Labour Codes) through the real screens: a teacher
// who joined in 2019 leaves; office staff prepare the settlement (salary to the last day and
// gratuity), the owner approves it from My Work and records the payment, which shows as late
// because it is past the two-working-day deadline.
import { expect, test } from '@playwright/test';
import {
  apiPost,
  devSession,
  noA11yViolations,
  schoolWithStudents,
  sessionFor,
  signInAs,
} from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const ist = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);

test('final settlement: prepared, approved from My Work, paid', async ({ page, context }, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic Settlement School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/payroll');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const office = await sessionFor('office', s.orgId);

  // A teacher who joined in 2019 leaves, with a salary on record.
  const leaver = { name: `Synthetic Leaving Teacher ${info.project.name}`, personId: '' };
  leaver.personId = (
    (await apiPost(page, '/people/staff', {
      institutionId: s.institutionId,
      name: leaver.name,
      phone: `+9190000${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`,
      joinedOn: '2019-04-01',
    })) as { personId: string }
  ).personId;
  await apiPost(page, '/payroll/salaries', {
    institutionId: s.institutionId,
    personId: leaver.personId,
    effectiveFrom: ist(-40),
    basic: 1_500_000,
    da: 300_000,
    hra: 600_000,
    conveyance: 0,
    special: 600_000,
    other: 0,
    pf: true,
    esi: false,
    pt: true,
    tdsPaise: 0,
    otherDeductionPaise: 0,
  });
  await apiPost(page, `/people/staff/${leaver.personId}/exit`, {
    lastDay: ist(-5),
    reason: 'Moved to another city',
  });

  // Office staff prepare it.
  await context.clearCookies();
  await signInAs(context, { ...office, institutionId: s.institutionId });
  await page.goto('/payroll?tab=settlements');
  const list = page.getByRole('region', { name: 'Final settlements' });
  const row = list.getByRole('listitem').filter({ hasText: leaver.name });
  await expect(row).toContainText('To prepare');
  await expect(row).toContainText('Overdue');
  await expect(row).toContainText(/Gratuity for [78] years/);
  await expect(row).toContainText('on wages of ₹18,000.00 a month');
  await noA11yViolations(page);
  await row.getByRole('button', { name: `Prepare settlement: ${leaver.name}` }).click();
  await expect(row).toContainText('Waiting for approval');

  // The owner approves it from My Work, then records the payment.
  await context.clearCookies();
  await signInAs(context, s);
  await page.goto('/my-work');
  await page.getByRole('button', { name: new RegExp(`Final settlement: ${leaver.name}`) }).click();
  await expect(page).toHaveURL(/tab=settlements/);
  await row.getByRole('button', { name: `Approve settlement: ${leaver.name}` }).click();
  await expect(row).toContainText('Approved, to pay');
  await row.getByRole('button', { name: `Record payment: ${leaver.name}` }).click();
  const pay = page.getByRole('form', { name: `Record payment: ${leaver.name}` });
  await pay.getByLabel('Bank reference').fill('NEFT/SYN/42');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(pay).toBeHidden();
  await expect(row).toContainText('Paid late');
  await expect(row).toContainText('NEFT/SYN/42');
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/settlement-${info.project.name}.png`,
    fullPage: true,
  });
});
