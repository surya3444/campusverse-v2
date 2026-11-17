// Payroll (rule book §13.7 Assignments & Arrears, Statutory Payroll) through the real screens:
// October is approved; a raise is back-dated to 1 October; November's payslip carries October's
// difference as arrears, and the statutory panel offers the ESI file (and names who lacks an IP).
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

test('payroll: arrears from a back-dated raise, and the ESI file', async ({
  page,
  context,
}, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic Arrears School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/payroll');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const office = await sessionFor('office', s.orgId);
  const name = `Synthetic Arrears Teacher ${info.project.name}`;
  const { personId } = (await apiPost(page, '/people/staff', {
    institutionId: s.institutionId,
    name,
    phone: `+9190001${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`,
    joinedOn: '2026-09-01',
  })) as { personId: string };
  const salary = (basic: number, effectiveFrom: string) =>
    apiPost(page, '/payroll/salaries', {
      institutionId: s.institutionId,
      personId,
      effectiveFrom,
      basic: basic * 100,
      da: 0,
      hra: 400_000,
      conveyance: 0,
      special: 0,
      other: 0,
      pf: true,
      esi: true,
      pt: false,
      tdsPaise: 0,
      otherDeductionPaise: 0,
    });
  await salary(15_000, '2026-09-01');

  // Office staff prepare a month; the owner approves it.
  const month = async (m: string) => {
    await context.clearCookies();
    await signInAs(context, { ...office, institutionId: s.institutionId });
    const { runId } = (await apiPost(page, '/payroll/runs', {
      institutionId: s.institutionId,
      month: m,
    })) as { runId: string };
    await context.clearCookies();
    await signInAs(context, s);
    await apiPost(page, `/payroll/runs/${runId}/approve`);
  };
  await month('2026-10');
  await salary(17_000, '2026-10-01');
  await month('2026-11');

  await page.goto('/payroll');
  await page.getByRole('button', { name: /November 2026/ }).click();
  const drawer = page.getByRole('dialog');
  // Nobody has an IP number yet: no ESI file, and the panel says who to fix.
  await expect(drawer.getByRole('button', { name: 'Download ESI file' })).toBeDisabled();
  await expect(drawer.getByText(new RegExp(`no IP number on record for .*${name}`))).toBeVisible();
  await noA11yViolations(page);
  await drawer.getByRole('button', { name: new RegExp(name) }).click();
  const slip = page.getByRole('dialog').last();
  await expect(slip.getByText('Arrears for October 2026')).toBeVisible();
  await expect(slip.getByText('₹2,000.00')).toBeVisible();
});
