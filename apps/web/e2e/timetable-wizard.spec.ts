// The timetable from nothing, without leaving the timetable screen (owner's brief, 21 Nov 2026):
// the school day, each class's subjects and periods a week, who teaches them to each section,
// rules, a check that it fits, then generate, place and publish.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test('generate a timetable end to end from the timetable screen', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const shot = (name: string) =>
    page.screenshot({ path: `e2e/screenshots/${name}-${info.project.name}.png` });
  const s = devSession(`Synthetic Wizard School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/timetable');
  await schoolWithStudents(page, s.institutionId);
  await page.reload();

  // 1 · The school day: the usual Indian day is filled in; name it and go on.
  await page.getByRole('button', { name: 'Generate a timetable' }).first().click();
  const day = page.getByRole('form', { name: /The school day/ });
  await day.getByLabel('Name').fill('Term 1');
  await noA11yViolations(page);
  await day.getByRole('button', { name: 'Save' }).click();

  // 2 · Subjects and periods a week, saved for the school.
  const wizard = page.getByRole('dialog', { name: 'Timetable generator' });
  await expect(wizard.getByRole('button', { name: /Subjects & periods/ })).toHaveAttribute(
    'aria-current',
    'step',
  );
  const periods = async (subject: string, n: number) => {
    const row = wizard.getByRole('listitem').filter({ hasText: subject }).first();
    const box = row.getByRole('checkbox');
    if (!(await box.isChecked())) await box.check();
    for (let i = 0; i < 20; i++) {
      const now = Number(((await row.getByText(/ a week$/).textContent()) ?? '0').split(' ')[0]);
      if (now === n) break;
      await row
        .getByRole('button', { name: now < n ? /One more period/ : /One period fewer/ })
        .click();
      await expect(
        row.getByText(new RegExp(`^${now < n ? now + 1 : now - 1} a week$`)),
      ).toBeVisible();
    }
  };
  await periods('Mathematics', 3);
  await periods('English', 2);
  await expect(wizard.getByText(/^\d+ of 48$/)).toBeVisible();
  await noA11yViolations(page);
  await shot('wizard-subjects');
  await wizard.getByRole('button', { name: 'Next' }).click();

  // 3 · Teachers: who teaches each subject to each section.
  for (const subject of ['Mathematics', 'English'])
    await wizard
      .getByRole('combobox', { name: `Teacher for ${subject} in Class 3-A` })
      .selectOption({ index: 1 });
  await expect(wizard.getByRole('complementary').getByText(/^5 of 48$/)).toBeVisible();
  await noA11yViolations(page);
  await shot('wizard-teachers');
  await wizard.getByRole('button', { name: 'Next' }).click();

  // 4 · Rules: optional; go on to the check.
  await expect(wizard.getByText('Rules that are never broken')).toBeVisible();
  await wizard.getByRole('button', { name: 'Next' }).click();

  // 5 · Check and generate.
  await expect(wizard.getByText(/^It fits\./)).toBeVisible();
  await noA11yViolations(page);
  await shot('wizard-check');
  await wizard.getByRole('button', { name: 'Generate timetable' }).click();
  await expect(wizard.getByRole('button', { name: 'Place 5 lessons' })).toBeVisible({
    timeout: 60_000,
  });
  await wizard.getByRole('button', { name: 'Place 5 lessons' }).click();
  await expect(wizard.getByText('5 lessons placed.')).toBeVisible();

  // Publish from today, from the same screen; the week shows the lessons.
  await wizard.getByRole('button', { name: 'Publish' }).click();
  await expect(wizard).toBeHidden();
  await expect(page.getByText(/^Timetable published from/).first()).toBeVisible();
  await expect(page.getByText('In use', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Mathematics( \(MAT\))? 3 of 3$/)).toBeVisible();
  await expect(page.getByText(/^English( \(ENG\))? 2 of 2$/)).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/wizard-week-${info.project.name}.png`,
    fullPage: true,
  });
});
