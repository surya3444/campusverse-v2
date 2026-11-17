// Appraisals through the real screens (docs/specs/APPRAISALS.md), with two people signed in: the
// owner opens a cycle for the staff; the class teacher rates themselves; the owner reviews and the
// weighted score appears; the teacher reads it and acknowledges.
import { expect, test, type Page } from '@playwright/test';
import {
  apiPost,
  devSession,
  noA11yViolations,
  schoolWithStudents,
  sessionFor,
  signInAs,
} from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

async function rateAll(page: Page, scores: number[]) {
  const groups = page.getByRole('dialog').getByRole('radiogroup');
  // The panel loads the criteria first: all six, then rate.
  await expect(groups).toHaveCount(6);
  const n = await groups.count();
  for (let i = 0; i < n; i++) {
    const s = scores[i % scores.length] ?? 3;
    await groups
      .nth(i)
      .locator('label')
      .nth(s - 1)
      .click();
  }
}

test('appraisals: open, self-rate, review with the weighted score, acknowledge', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic Appraisal School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/appraisals');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const teacherSession = await sessionFor('teacher', s.orgId);
  await page.reload();
  await expect(page.getByText('No appraisal for you right now.')).toBeVisible();
  await noA11yViolations(page);

  // A cycle with the default criteria, opened for the staff.
  await page.getByRole('radio', { name: 'Cycles' }).click();
  await page.getByRole('button', { name: 'New cycle' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Synthetic annual review');
  await dialog.getByLabel('Closes').fill('2027-03-31');
  await expect(dialog.getByLabel('Criteria 6')).toHaveValue('Communication with parents');
  await dialog.getByLabel('Weight 1').selectOption('2');
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Open for staff' }).click();
  await expect(dialog.getByText(/staff members? get a review/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Open for staff' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/self · 0 with reviewer/)).toBeVisible();

  // The class teacher, in their own browser, rates themselves.
  const tctx = await browser.newContext({ reducedMotion: 'reduce' });
  await signInAs(tctx, { ...teacherSession, institutionId: s.institutionId });
  const tpage = await tctx.newPage();
  await tpage.goto('/appraisals');
  await tpage.getByRole('button', { name: /Synthetic annual review/ }).click();
  await rateAll(tpage, [4]);
  await tpage
    .getByRole('dialog')
    .getByLabel('Comment')
    .fill('Synthetic: a good year with my class.');
  await noA11yViolations(tpage);
  await tpage.getByRole('button', { name: 'Submit my rating' }).click();
  await expect(tpage.getByRole('dialog').getByText(/With the reviewer/)).toBeVisible();

  // The owner reviews: weight 2 on the first criterion rated 5, the other five rated 3:
  // (5·2 + 3·5) / 7 = 3.57.
  await page.getByRole('radio', { name: 'To review' }).click();
  await page.reload();
  await page.getByRole('radio', { name: 'To review' }).click();
  const teacherRow = page.getByRole('button', { name: /Your turn/ }).first();
  await teacherRow.click();
  const groups = page.getByRole('dialog').getByRole('radiogroup');
  await expect(groups).toHaveCount(6);
  await groups.nth(0).locator('label').nth(4).click();
  for (let i = 1; i < 6; i++) await groups.nth(i).locator('label').nth(2).click();
  await page
    .getByRole('dialog')
    .getByLabel('Comment')
    .fill('Strong teaching; reach parents sooner.');
  await page.getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByRole('dialog').getByText(/Score 3\.57 of 5/)).toBeVisible();
  await noA11yViolations(page);

  // The teacher reads it and acknowledges.
  await tpage.reload();
  await tpage.getByRole('button', { name: /Synthetic annual review/ }).click();
  await expect(tpage.getByRole('dialog').getByText(/Score 3\.57 of 5/)).toBeVisible();
  await expect(tpage.getByRole('dialog').getByText(/reach parents sooner/)).toBeVisible();
  await tpage.getByRole('dialog').getByLabel('Your reply').fill('Thank you, will do.');
  await tpage.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(tpage.getByRole('dialog').getByText(/Acknowledged/)).toBeVisible();
  await tpage.screenshot({
    path: `e2e/screenshots/appraisals-${info.project.name}.png`,
    fullPage: true,
  });
  await tctx.close();
});
