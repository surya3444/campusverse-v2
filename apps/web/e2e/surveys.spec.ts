// Feedback & Surveys through the real screens (rule book §13.4): the owner builds a staff
// facility survey from the template and opens it; a teacher answers it anonymously; the owner
// reads the weighted results and records an action taken.
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

test('surveys: template, open, anonymous answer, results, action taken', async ({
  page,
  context,
}, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic Survey School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/surveys');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const teacher = await sessionFor('teacher', s.orgId);

  // Build from the template and open it.
  await page.goto('/surveys?tab=manage');
  await expect(page.getByText('No surveys yet')).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'New survey' }).first().click();
  const create = page.getByRole('dialog', { name: 'New survey' });
  await create.getByRole('combobox', { name: /^Template/ }).selectOption('facility');
  await create.getByRole('combobox', { name: 'Who answers', exact: true }).selectOption('staff');
  await create.getByLabel('Title').fill('Staff facilities 2026');
  await noA11yViolations(page);
  await create.getByRole('button', { name: 'Create survey' }).click();
  await expect(page.getByText('Survey created as a draft.')).toBeAttached();
  await page.getByRole('button', { name: /Staff facilities 2026/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Staff facilities 2026' });
  await drawer.getByRole('button', { name: 'Edit questions' }).click();
  const qs = page.getByRole('dialog', { name: 'Edit questions' });
  await qs.getByRole('button', { name: 'Add question' }).click();
  await qs.getByRole('combobox', { name: 'Question 5 type' }).selectOption('choice');
  await qs.getByLabel('Question 5', { exact: true }).fill('Which block needs work first?');
  await qs.getByLabel(/Question 5 choices/).fill('Main block\nScience block');
  await qs.getByRole('button', { name: 'Save questions' }).click();
  await expect(drawer.getByText('5. Which block needs work first?')).toBeVisible();
  await drawer.getByRole('button', { name: 'Open for answers' }).click();
  await expect(drawer.getByText('Survey opened.')).toBeAttached();

  // A teacher answers.
  await context.clearCookies();
  await signInAs(context, { ...teacher, institutionId: s.institutionId });
  await page.goto('/surveys');
  await page.getByRole('button', { name: 'Answer Staff facilities 2026' }).click();
  const answer = page.getByRole('dialog', { name: 'Answer: Staff facilities 2026' });
  await expect(answer.getByRole('button', { name: 'Send answers' })).toBeDisabled();
  for (const [i, n] of [
    [1, 4],
    [2, 3],
    [3, 2],
  ] as const)
    await answer
      .getByRole('group', { name: new RegExp(`^${i}\\.`) })
      .getByText(String(n), { exact: true })
      .click();
  await answer.getByLabel(/What facility needs attention first/).fill('Water cooler, floor 2');
  await answer
    .getByRole('combobox', { name: /Which block needs work first/ })
    .selectOption('Science block');
  await noA11yViolations(page);
  await answer.getByRole('button', { name: 'Send answers' }).click();
  await expect(page.getByText('Thank you. Your answers were recorded.')).toBeAttached();
  await expect(page.getByText('Nothing to answer right now')).toBeVisible();

  // The owner reads the results and records an action.
  await context.clearCookies();
  await signInAs(context, s);
  await page.goto('/surveys?tab=manage');
  await page.getByRole('button', { name: /Staff facilities 2026/ }).click();
  const results = page.getByRole('dialog', { name: 'Staff facilities 2026' });
  // (4×1 + 3×1 + 2×2) / 4 = 2.75
  await expect(results.getByText('2.75 of 5')).toBeVisible();
  await expect(results.getByText('Water cooler, floor 2')).toBeVisible();
  await results.getByRole('button', { name: 'Add action' }).click();
  const action = page.getByRole('dialog', { name: 'Add action' });
  await action.getByLabel('Action', { exact: true }).fill('Replace the floor 2 water cooler');
  await action.getByRole('combobox', { name: 'Owner', exact: true }).selectOption({ index: 1 });
  await action.getByRole('button', { name: 'Add action' }).click();
  await results.getByRole('button', { name: 'Mark done Replace the floor 2 water cooler' }).click();
  const done = page.getByRole('dialog', { name: 'Mark done' });
  await done.getByLabel('What was done').fill('Replaced on 20 Nov.');
  await done.getByRole('button', { name: 'Mark done' }).click();
  await expect(results.getByText(/Replaced on 20 Nov\./)).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/surveys-${info.project.name}.png`,
    fullPage: true,
  });
});
