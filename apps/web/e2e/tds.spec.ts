// Payroll › TDS (rule book §13.7 "TDS (24Q), Form 16") through the real screens: the owner opens
// the quarter, sees what stops the 24Q statement (no TAN), records a challan from its counterfoil,
// removes it, and sees the Form 16 figures section. All data synthetic.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('TDS: quarter, challan recorded and removed, Form 16 figures', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  const s = devSession(`Synthetic TDS School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/payroll');
  await page.getByRole('radio', { name: 'TDS' }).click();
  await expect(page.getByRole('heading', { name: 'TDS on salaries' })).toBeVisible();
  await expect(page.getByText('Not ready for 24Q')).toBeVisible();
  await expect(
    page.getByText('No TAN on record for this institution’s legal entity.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Form 16 figures/ })).toBeVisible();
  await noA11yViolations(page);

  // Record a challan for the quarter's first month, deposited on its first day.
  await page.getByRole('button', { name: 'Record challan' }).click();
  const dialog = page.getByRole('dialog');
  const month = await dialog.getByLabel('Salary month').inputValue();
  await dialog.getByLabel('Deposited on').fill(`${month}-01`);
  await dialog.getByLabel('BSR code').fill('0510001');
  await dialog.getByLabel('Challan serial number').fill('00042');
  await dialog.getByLabel('Amount (₹)').fill('1,250');
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Record challan' }).click();
  await expect(dialog).toBeHidden();
  const challan = page.getByText(/BSR 0510001 · No\. 00042/);
  await expect(challan).toBeVisible();
  await expect(page.getByText('₹1,250.00').first()).toBeVisible();

  await page.getByRole('button', { name: 'Remove challan 00042' }).click();
  await expect(challan).toBeHidden();
});
