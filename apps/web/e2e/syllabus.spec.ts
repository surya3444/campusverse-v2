// The syllabus through the real screens (docs/specs/SYLLABUS.md): two units planned by month,
// one ticked done for the section, a lesson plan for today, and coverage across the school.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('syllabus: plan units, tick one done, a lesson plan, coverage', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic Syllabus School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/syllabus');
  await schoolWithStudents(page, s.institutionId);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Class 3 · / })).toBeVisible();
  await noA11yViolations(page);

  const units = page.getByRole('region', { name: /Class 3 · / });
  await expect(units.getByText('No units for this subject yet.')).toBeVisible();
  const dialog = page.getByRole('dialog');
  for (const [title, month] of [
    ['Synthetic Unit One', '2026-06'],
    ['Synthetic Unit Two', '2027-01'],
  ] as const) {
    await units.getByRole('button', { name: 'Add unit' }).click();
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel(/Planned for/).fill(month);
    await dialog.getByLabel(/Periods/).fill('4');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(units.getByText('Synthetic Unit Two', { exact: true }).first()).toBeVisible();
  // June is due by now and nothing is ticked: the section is behind.
  await expect(page.getByText('Behind').first()).toBeVisible();
  await units.getByRole('checkbox').first().click();
  await expect(units.getByText(/Class 3-A done/)).toBeVisible();
  await expect(page.getByText('On track').first()).toBeVisible();
  await noA11yViolations(page);

  // Today's lesson plan.
  await page.getByRole('radio', { name: 'Lesson plans' }).click();
  await page
    .getByRole('button', { name: /Write plan/ })
    .first()
    .click();
  await dialog.getByLabel('Unit').selectOption({ label: '1. Synthetic Unit One' });
  await dialog.getByLabel(/Plan/).fill('Synthetic: read aloud, then pair work on the questions.');
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/read aloud, then pair work/)).toBeVisible();

  // Coverage across the school.
  await page.getByRole('radio', { name: 'Coverage' }).click();
  await expect(page.getByText(/Class 3-A 50%/)).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/syllabus-${info.project.name}.png`,
    fullPage: true,
  });
});
