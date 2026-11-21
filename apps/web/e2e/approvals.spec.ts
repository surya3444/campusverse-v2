// Campus Core › Workflow & Approvals (rule book §12.4 decision 6) through the real screens: the
// owner sets bills to be approved by office staff in the designer; a bill the owner records waits
// in office staff's My Work, opens in Expenses and is approved there.
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

test('approvals: the designer routes a bill to office staff’s My Work', async ({
  page,
  context,
}, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic Approvals School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/settings/approvals');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);

  // The designer: bills go to office staff.
  await page.reload();
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
  const bills = main.getByRole('region', { name: 'Bill' });
  await expect(bills.getByText(/No steps set/)).toBeVisible();
  await noA11yViolations(page);
  await bills.getByRole('button', { name: 'Change steps' }).click();
  const form = page.getByRole('form', { name: 'Change steps: Bill' });
  await form.getByLabel('Approver').selectOption({ label: 'Office staff' });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  await expect(bills.getByText('Office staff')).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/approvals-${info.project.name}.png`,
    fullPage: true,
  });

  // The owner records a bill; it isn't the owner's to approve.
  const categories = (await (
    await page.request.get(`/api/v1/expenses/categories?institutionId=${s.institutionId}`)
  ).json()) as { id: string }[];
  await apiPost(page, '/expenses/bills', {
    institutionId: s.institutionId,
    categoryId: categories[0]!.id,
    payee: 'Synthetic Plumber',
    billNo: 'SP-17',
    billDate: '2026-11-02',
    description: 'Washroom tap repairs',
    amountPaise: 12_000_00,
  });
  await page.goto('/my-work');
  await expect(main.getByText('Nothing is waiting for you')).toBeVisible();

  // Office staff find it in My Work and approve it in Expenses.
  const office = await sessionFor('office', s.orgId);
  await context.clearCookies();
  await signInAs(context, { ...office, institutionId: s.institutionId });
  await page.reload();
  const item = main.getByRole('button', { name: /Synthetic Plumber · SP-17/ });
  await expect(item).toContainText('₹12,000');
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/my-work-${info.project.name}.png`,
    fullPage: true,
  });
  await item.click();
  await expect(page).toHaveURL(/\/expenses\?bill=/);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('Waiting for Office staff')).toBeVisible();
  await drawer.getByRole('button', { name: 'Approve' }).click();
  await expect(drawer).toContainText('Approved');
  await page.goto('/my-work');
  await expect(main.getByText('Nothing is waiting for you')).toBeVisible();

  // Decided by me: the bill, approved, and where it stands now.
  await main.getByRole('radio', { name: /Decided by me/ }).click();
  const done = main.getByRole('button', { name: /Synthetic Plumber · SP-17/ });
  await expect(done).toContainText('Approved');
  await expect(done).toContainText('Done: approved');
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/my-work-decided-${info.project.name}.png`,
    fullPage: true,
  });
});
