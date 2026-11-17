// Expenses through the real screens (docs/specs/EXPENSES.md): a bill the office records is
// approved and paid by the owner with a voucher; the owner's own bill (with its photo) waits for
// someone else; a budget is set; a vendor is added.
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

// The smallest valid PNG: one transparent pixel.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('expenses: record, approve, pay with a voucher, budgets and vendors', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic Expenses School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/expenses');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);

  // The class teacher also works in the office: they record bills.
  const clerk = await sessionFor('teacher', s.orgId);
  const { roles } = (await (await page.request.get('/api/v1/access/roles')).json()) as {
    roles: { id: string; key: string }[];
  };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await apiPost(page, '/access/assignments', {
    personId: clerk.personId,
    roleId: roles.find((r) => r.key === 'office')?.id,
    scope: { type: 'institution', id: s.institutionId },
    from: today,
    until: null,
  });
  const asClerk = {
    authorization: `Bearer ${clerk.accessToken}`,
    'x-org-id': clerk.orgId,
    'x-person-id': clerk.personId,
  };
  const cats = (await (
    await page.request.get(
      `http://localhost:4000/api/v1/expenses/categories?institutionId=${s.institutionId}`,
      { headers: asClerk },
    )
  ).json()) as { id: string; name: string }[];
  const repairs = cats.find((c) => c.name === 'Repairs and maintenance')!;
  const recorded = await page.request.post('http://localhost:4000/api/v1/expenses/bills', {
    headers: asClerk,
    data: {
      institutionId: s.institutionId,
      categoryId: repairs.id,
      payee: 'Synthetic Plumber',
      billDate: today,
      description: 'Leaking tank fixed',
      amountPaise: 185_000,
    },
  });
  expect(recorded.ok(), await recorded.text()).toBe(true);

  // The owner approves it, seeing the budget position, then pays it.
  await page.reload();
  await expect(page.getByRole('button', { name: /Synthetic Plumber/ })).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole('button', { name: /Synthetic Plumber/ }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('No budget set for this category this year.')).toBeVisible();
  await noA11yViolations(page);
  await drawer.getByRole('button', { name: 'Approve' }).click();
  await expect(drawer.getByRole('button', { name: 'Pay' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Pay' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Paid by').selectOption('bank_transfer');
  await expect(modal.getByRole('button', { name: 'Pay' })).toBeDisabled();
  await modal.getByLabel(/Reference/).fill('UTR000123');
  await noA11yViolations(page);
  await modal.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByRole('dialog')).toContainText(/PV\/\d{4}-\d{2}\/000001/);
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'Paid' }).click();
  await expect(page.getByText(/PV\/\d{4}-\d{2}\/000001/)).toBeVisible();

  // The owner's own bill, with its photo, waits for someone else.
  await page.getByRole('button', { name: 'Record bill' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Category').selectOption({ label: 'Stationery and printing' });
  await form.getByLabel('Paid to').fill('Synthetic Stationers');
  await form.getByLabel('What it was for').fill('Exam answer sheets');
  await form.getByLabel(/Amount/).fill('4,250.50');
  await form.locator('input[type=file]').setInputFiles({
    name: 'bill.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(form.getByText('Attached: bill.png')).toBeVisible();
  await noA11yViolations(page);
  await form.getByRole('button', { name: 'Record bill' }).click();
  await expect(form).toBeHidden();
  await page.getByRole('button', { name: /Synthetic Stationers.*₹4,250\.50/ }).click();
  await expect(page.getByRole('dialog').getByText(/someone else approves it/)).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Open the bill' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A budget for repairs; what's committed shows against it.
  await page.getByRole('radio', { name: 'Budgets' }).click();
  await page.getByRole('button', { name: 'Set budget Repairs and maintenance' }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/Amount/)
    .fill('10000');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  const row = page.getByRole('row', { name: /Repairs and maintenance/ });
  await expect(row).toContainText('₹10,000.00');
  await expect(row).toContainText('₹1,850.00');
  await expect(row).toContainText('₹8,150.00');
  await noA11yViolations(page);

  // A vendor.
  await page.getByRole('radio', { name: 'Vendors' }).click();
  await page.getByRole('button', { name: 'Add vendor' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Synthetic Hardware Stores');
  await page.getByRole('dialog').getByLabel(/GSTIN/).fill('29abcde1234f1z5');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('29ABCDE1234F1Z5')).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/expenses-${info.project.name}.png`,
    fullPage: true,
  });
});
