// Milestone 22: the date sheet (time, room, invigilator; clashes refused) and the analysis.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);

test('an exam gets a date sheet, and its analysis shows how it went', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === 'phone', 'one full run; screens are checked on phone below');
  test.setTimeout(240_000);
  const owner = devSession('Synthetic Date Sheet School');
  await signInAs(context, owner);
  await page.goto('/exams');
  await schoolWithStudents(page, owner.institutionId);
  await page.reload();
  await page.getByRole('button', { name: 'New exam' }).click();
  const form = page.getByRole('form', { name: 'New exam' });
  await form.getByLabel('Year').selectOption({ label: '2026-27' });
  await form.getByLabel('Exam name').fill('Term 1');
  await form.getByLabel('Class 3').check();
  await form.getByRole('button', { name: 'Create exam' }).click();
  await expect(page.getByRole('heading', { name: 'Term 1' })).toBeVisible();

  // The date sheet: two papers on one day; the second can't overlap the first.
  await page.getByRole('radio', { name: 'Date sheet' }).click();
  const rows = page.getByRole('row');
  const first = rows.nth(1);
  const second = rows.nth(2);
  const fill = async (row: typeof first, time: string) => {
    await row.getByRole('textbox').first().fill(iso(10)); // the date field
    await row.locator('input[type="time"]').fill(time);
    await row.locator('input[type="number"]').fill('90');
    await row.getByRole('textbox', { name: /^Room/ }).fill('Hall A');
  };
  await fill(first, '09:30');
  await first.getByRole('combobox', { name: /^Invigilator/ }).selectOption({ index: 1 });
  await first.getByRole('button', { name: /^Save/ }).click();
  await expect(first.getByRole('button', { name: /^Save/ })).toHaveCount(0);
  await fill(second, '10:00');
  await second.getByRole('button', { name: /^Save/ }).click();
  await expect(second.getByRole('alert')).toHaveText(
    'This class already has a paper at that time.',
  );
  await second.locator('input[type="time"]').fill('11:30');
  await second.getByRole('button', { name: /^Save/ }).click();
  await expect(second.getByRole('button', { name: /^Save/ })).toHaveCount(0);
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/exam-date-sheet.png', fullPage: true });

  // Marks for the first paper, then the analysis shows it.
  await page.getByRole('radio', { name: 'Papers' }).click();
  await page
    .getByRole('link', { name: /^Enter marks: / })
    .first()
    .click();
  const grid = page.getByRole('grid');
  await expect(grid).toBeVisible();
  for (let r = 0; r < 6; r++) {
    const cell = grid
      .getByRole('row')
      .nth(r + 1)
      .getByRole('gridcell')
      .nth(1);
    await cell.click();
    await page.keyboard.type(String(40 + r * 10));
    await page.keyboard.press('Enter');
  }
  await expect(page.getByText(/Saved/).first()).toBeVisible({ timeout: 15_000 });
  await page.goBack();
  await page.getByRole('radio', { name: 'Analysis' }).click();
  await expect(page.getByText('Pass mark 33.00%')).toBeVisible();
  await expect(page.getByText('Top of the class')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/exam-analysis.png', fullPage: true });
});
