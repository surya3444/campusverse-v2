// The lifelong learner record's identifiers (rule book §13.5, P0 item 4): the office records
// APAAR, PEN and the ABC ID in one form; sealed ones show masked, PEN shows in clear.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('learner identifiers: APAAR, PEN and ABC ID from the record', async ({
  page,
  context,
}, info) => {
  test.setTimeout(150_000);
  const s = devSession(`Synthetic Learner IDs School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/students');
  await schoolWithStudents(page, s.institutionId);
  await page.reload();
  await page.getByRole('table', { name: 'Students' }).locator('tbody tr a').first().click();
  await page.getByRole('tab', { name: 'Personal info' }).click();
  await expect(page.getByText('PEN (UDISE+)')).toBeVisible();

  await page.getByRole('button', { name: 'Edit identifiers' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Save identifiers' })).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'APAAR' }).selectOption('present');
  await dialog.getByLabel('APAAR ID (12 digits)').fill('1234 5678 9012');
  await dialog.getByLabel('PEN (11 digits, from UDISE+)').fill('123');
  await dialog.getByLabel('ABC ID (12 digits)').fill('1111 2222 3333');
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Save identifiers' }).click();
  await expect(dialog.getByText('A PEN has 11 digits.')).toBeVisible();
  await dialog.getByLabel('PEN (11 digits, from UDISE+)').fill('2023 0101 234');
  await dialog.getByRole('button', { name: 'Save identifiers' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText('20230101234')).toBeVisible();
  await expect(page.getByText('XXXX XXXX 9012')).toBeVisible();
  await expect(page.getByText('XXXX XXXX 3333')).toBeVisible();
});
