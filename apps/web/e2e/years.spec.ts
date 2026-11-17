// Academic years over their life: the running year and an ended one; the ended year is closed
// (read-only) and reopened with a reason.
import { expect, test, type Page } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const fitsScreen = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

test('an ended year is closed and reopened with a reason', async ({ page, context }) => {
  test.setTimeout(120_000);
  const owner = devSession('Synthetic Years School');
  await signInAs(context, owner);
  await page.goto('/years');
  await schoolWithStudents(page, owner.institutionId);
  await apiPost(page, `/school/setup/${owner.institutionId}/structure`, {
    board: 'CBSE',
    yearLabel: '2025-26',
    starts: iso(-400),
    ends: iso(-31),
    classes: [{ code: '3', sections: 1, capacity: 30 }],
  });
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Academic years', level: 1 })).toBeVisible();
  const list = page.getByRole('list', { name: 'Years' });
  const running = list.getByRole('listitem').filter({ hasText: '2026-27' });
  const past = list.getByRole('listitem').filter({ hasText: '2025-26' });
  await expect(running).toContainText('This year');
  await expect(running).toContainText('6 students');
  await expect(running.getByRole('button', { name: 'Close year' })).toHaveCount(0);
  await expect(past).toContainText('Ended');
  await fitsScreen(page);
  await noA11yViolations(page);

  await past.getByRole('button', { name: 'Close year' }).click();
  const close = page.getByRole('form', { name: 'Close 2025-26?' });
  await expect(close.getByText('Attendance can’t be marked or corrected.')).toBeVisible();
  await close.getByRole('button', { name: 'Close year' }).click();
  await expect(past).toContainText('Closed');

  await past.getByRole('button', { name: 'Reopen' }).click();
  const reopen = page.getByRole('form', { name: 'Reopen 2025-26?' });
  await reopen.getByLabel('Reason').fill('Correct a Class 3 attendance entry');
  await reopen.getByRole('button', { name: 'Reopen' }).click();
  await expect(past).toContainText('Ended');
  await noA11yViolations(page);

  // The student list by year: this year's six, and nobody on the rolls in the earlier year.
  await page.goto('/students');
  await expect(page.getByLabel('Class', { exact: true }).locator('option')).toHaveCount(2);
  await page.getByLabel('Year', { exact: true }).selectOption({ label: '2025-26' });
  await expect(
    page.getByText(/On the rolls on .*, in the classes they were in then\./),
  ).toBeVisible();
  await expect(page.getByLabel('Class', { exact: true }).locator('option')).toHaveCount(1);
});
