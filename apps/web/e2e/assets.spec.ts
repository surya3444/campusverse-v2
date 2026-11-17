// Assets and inventory through the real screens (docs/specs/ASSETS.md): a place, an asset with the
// suggested tag, a condition change in its history, writing it off; stock received and issued
// down to low.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('assets: register, history, write off, and stock', async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const s = devSession(`Synthetic Assets School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/assets');
  await expect(page.getByText('No assets here yet.')).toBeVisible();
  await noA11yViolations(page);
  const dialog = page.getByRole('dialog');

  // A place first.
  await page.getByRole('radio', { name: 'Places and categories' }).click();
  await page.getByRole('button', { name: 'Add place' }).click();
  await dialog.getByLabel('Name').fill('Synthetic Science Lab');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Synthetic Science Lab', { exact: true }).first()).toBeVisible();

  // An asset with the suggested tag.
  await page.getByRole('radio', { name: 'Register' }).click();
  await page.getByRole('button', { name: 'Add asset' }).click();
  await expect(dialog.getByLabel(/^Tag/)).toHaveValue('AST-0001');
  await dialog.getByLabel('Name', { exact: true }).fill('Synthetic microscope');
  await dialog.getByLabel('Category').selectOption({ label: 'Lab equipment' });
  await dialog.getByLabel(/^Place/).selectOption({ label: 'Synthetic Science Lab' });
  await dialog.getByLabel(/^Cost/).fill('12,500');
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Add asset' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: /Synthetic microscope/ }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Condition').selectOption('needs_repair');
  await drawer.getByLabel('Note').fill('Focus knob loose');
  await drawer.getByRole('button', { name: 'Save changes' }).click();
  await expect(drawer.getByText(/Condition Good → Needs repair/)).toBeVisible();
  await noA11yViolations(page);
  await drawer.getByRole('button', { name: 'Write off' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Lens cracked');
  await page.getByRole('dialog').getByRole('button', { name: 'Write off' }).click();
  await expect(page.getByText('No assets here yet.')).toBeVisible();
  await page.getByRole('radio', { name: 'Written off' }).click();
  await expect(page.getByText('Synthetic microscope', { exact: true }).first()).toBeVisible();

  // Stock: receive 10, issue 8 with a reorder level of 3, and it's low.
  await page.getByRole('radio', { name: 'Stock' }).click();
  await page.getByRole('button', { name: 'Add item' }).click();
  await dialog.getByLabel('Name').fill('Synthetic chalk');
  await dialog.getByLabel(/^Unit/).fill('boxes');
  await dialog.getByLabel(/^Reorder at/).fill('3');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Receive Synthetic chalk' }).click();
  await dialog.getByLabel(/^Quantity/).fill('10');
  await dialog.getByRole('button', { name: 'Receive' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Issue Synthetic chalk' }).click();
  await dialog.getByLabel(/^Quantity/).fill('8');
  await dialog.getByRole('button', { name: 'Issue' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('2 boxes · Reorder at 3')).toBeVisible();
  await expect(page.getByText('Low', { exact: true })).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/assets-${info.project.name}.png`,
    fullPage: true,
  });
});
