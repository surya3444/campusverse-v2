// Milestone 15 in the browser: a signed-in owner asks Verse AI from Ctrl K (the offline development
// model); the question opens the Verse AI panel (decision 0021) with an answer labelled AI and
// dated sources, and a drafted notice opens pre-filled for review. Nothing is sent.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test('the Verse Bar answers with sources and drafts a notice for review', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  const owner = devSession('Synthetic Verse Bar School');
  await signInAs(context, owner);
  await page.goto('/attendance');
  await schoolWithStudents(page, owner.institutionId);
  await page.reload();
  await expect(page.getByText('Class 3-A').first()).toBeVisible();

  const open = async () => {
    if (info.project.name === 'phone')
      await page.getByRole('button', { name: /Search students, actions or ask Verse AI/ }).click();
    else await page.keyboard.press('Control+k');
  };
  await open();
  await page.getByRole('combobox').fill('Which classes have not marked attendance today?');
  await page.getByRole('option', { name: /Ask Verse AI/ }).click();
  const panel = page.getByRole('dialog', { name: 'Verse AI' });
  await expect(panel.getByText('Verse AI', { exact: true }).first()).toBeVisible();
  // The offline model or a real one: either way the answer cites the attendance screen.
  await expect(panel.getByRole('link', { name: /^Attendance, / })).toBeVisible({ timeout: 30_000 });
  await noA11yViolations(page);
  await page.screenshot({ path: `e2e/screenshots/verse-answer-${info.project.name}.png` });

  // A follow-up in the same panel.
  await panel
    .getByRole('textbox', { name: /follow-up/ })
    .fill('Draft a notice that school is closed on Friday');
  await panel.getByRole('button', { name: 'Ask' }).click();
  await panel.getByRole('link', { name: /Review draft: .*clos/i }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/notices\/new\?title=/);
  await expect(page.getByRole('textbox', { name: /Title/ }).first()).toHaveValue(/clos/i);
});
