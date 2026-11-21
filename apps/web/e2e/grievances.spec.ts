// Grievances & Committees through the real screens (rule book §13.11, §15): the owner sets up the
// POSH Internal Committee with a teacher as chair and raises a case anonymously; the chair sees
// "Anonymous", records the outcome; the raiser reads it and appeals.
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

test('grievances: committee, anonymous case, outcome, appeal', async ({ page, context }, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic Grievance School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/grievances');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const teacher = await sessionFor('teacher', s.orgId);

  // Set up the committee.
  await page.goto('/grievances?tab=setup');
  await expect(page.getByText('No committees yet')).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'Add committee' }).click();
  const add = page.getByRole('dialog', { name: 'Add committee' });
  await expect(add.getByLabel('Name')).toHaveValue('Internal Committee (POSH)');
  await add.getByRole('button', { name: 'Save committee' }).click();
  await expect(page.getByText('Decides within 90 days')).toBeVisible();
  await page.getByRole('button', { name: 'Members Internal Committee (POSH)' }).click();
  const members = page.getByRole('dialog', { name: /^Members:/ });
  await members.getByRole('button', { name: 'Add staff member' }).click();
  await members
    .getByRole('combobox', { name: 'Choose staff', exact: true })
    .selectOption({ index: 1 });
  await members.getByRole('button', { name: 'Add outside member' }).click();
  await members.getByLabel('Outside member’s name').fill('Synthetic NGO Member');
  await members.getByRole('button', { name: 'Save members' }).click();
  await expect(page.getByText('Synthetic NGO Member', { exact: false })).toBeVisible();

  // Raise a case anonymously.
  await page.getByRole('button', { name: 'Raise a grievance' }).click();
  const raise = page.getByRole('dialog', { name: 'Raise a grievance' });
  await raise.getByLabel('Subject').fill('Remarks in the staff room');
  await raise.getByLabel('What happened').fill('Repeated remarks over two weeks; dates listed.');
  await raise.getByLabel('Don’t show my name to the committee').check();
  await noA11yViolations(page);
  await raise.getByRole('button', { name: 'Raise a grievance' }).click();
  await expect(page.getByText('Case 1 raised. The committee has been told.')).toBeAttached();

  // The chair sees it as anonymous and records the outcome.
  await context.clearCookies();
  await signInAs(context, { ...teacher, institutionId: s.institutionId });
  await page.goto('/grievances?tab=committee');
  await expect(page.getByText(/Raised by Anonymous/)).toBeVisible();
  await page.getByRole('button', { name: /Remarks in the staff room/ }).click();
  const drawer = page.getByRole('dialog', { name: /Remarks in the staff room/ });
  await drawer.getByRole('button', { name: 'Record the outcome' }).click();
  const decide = page.getByRole('dialog', { name: 'Record the outcome' });
  await decide
    .getByLabel('Outcome', { exact: true })
    .fill('Written warning issued; training arranged.');
  await decide.getByRole('button', { name: 'Record the outcome' }).click();
  await expect(drawer.getByText('Written warning issued; training arranged.')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/grievances-${info.project.name}.png`,
    fullPage: true,
  });

  // The raiser reads the outcome and appeals.
  await context.clearCookies();
  await signInAs(context, s);
  await page.goto('/grievances');
  await page.getByRole('button', { name: /Remarks in the staff room/ }).click();
  const mine = page.getByRole('dialog', { name: /Remarks in the staff room/ });
  await expect(mine.getByText('Written warning issued; training arranged.')).toBeVisible();
  await mine.getByRole('button', { name: 'Appeal this decision' }).click();
  const appeal = page.getByRole('dialog', { name: 'Appeal this decision' });
  await appeal
    .getByLabel('Appeal', { exact: true })
    .fill('The remarks continued after the warning was given.');
  await appeal.getByRole('button', { name: 'Appeal this decision' }).click();
  await expect(mine.getByText('The remarks continued after the warning was given.')).toBeVisible();
});
