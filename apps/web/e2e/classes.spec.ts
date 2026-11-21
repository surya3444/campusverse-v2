// Where classes, sections and students live, and how next year is set up from Year end.
import { expect, test, type Page } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

const fitsScreen = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

test('classes show their sections and students, and Year end sets up next year', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const owner = devSession('Synthetic Classes School');
  await signInAs(context, owner);
  await page.goto('/classes');
  await schoolWithStudents(page, owner.institutionId);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Classes and sections' })).toBeVisible();
  const class3 = page.getByRole('region', { name: 'Class 3' });
  await expect(class3.getByRole('row', { name: /^A / })).toContainText('6 of 30');
  await fitsScreen(page);
  await noA11yViolations(page);

  // ID cards for the section print as one PDF.
  const cards = await page.request.get(
    (await class3.getByRole('link', { name: 'ID cards for Class 3-A' }).getAttribute('href')) ?? '',
  );
  expect(cards.headers()['content-type']).toBe('application/pdf');
  expect((await cards.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // The section's link opens the student list filtered to it.
  await class3.getByRole('link', { name: 'Students in Class 3-A' }).click();
  await expect(page).toHaveURL(/\/students\?class=Class(\+|%20)3-A/);
  await expect(page.getByLabel('Class', { exact: true })).toHaveValue('Class 3-A');

  // No next year yet: Year end proposes it from this year, to change before it's created:
  // Class 3 gets a second section and Class 4 starts.
  await page.goto('/year-end');
  await page.getByRole('button', { name: 'Set up next year' }).click();
  const proposal = page.getByRole('dialog', { name: 'Set up 2027-28' });
  await expect(proposal.getByRole('row', { name: /Class 3/ })).toContainText('Same');
  await proposal.getByRole('button', { name: 'One more section in Class 3' }).click();
  await proposal.getByLabel('Add a class').selectOption({ label: 'Class 4' });
  await proposal.getByRole('button', { name: 'Add', exact: true }).click();
  await proposal.getByLabel('Seats in each section of Class 4').fill('35');
  await expect(proposal.getByRole('row', { name: /Class 3/ })).toContainText('1 → 2 sections');
  await expect(proposal.getByRole('row', { name: /Class 4/ })).toContainText('New');
  await expect(proposal).toContainText('2027-28: 2 classes, 3 sections, 95 seats.');
  await page.screenshot({
    path: `e2e/screenshots/next-year-proposal-${test.info().project.name}.png`,
  });
  await noA11yViolations(page);
  await proposal.getByRole('button', { name: 'Create the year' }).click();
  await expect(proposal).toBeHidden();
  await expect(page.getByLabel('Next year').locator('option')).toHaveText(['2027-28']);
  await expect(page.getByRole('button', { name: 'Set up next year' })).toBeHidden();

  // Classes shows the new year as proposed, with nobody in it yet; this year is unchanged.
  await page.goto('/classes');
  await expect(class3.getByRole('row', { name: /^B / })).toHaveCount(0);
  await page.getByLabel('Year').selectOption({ label: '2027-28 · Next' });
  await expect(class3.getByRole('row', { name: /^A / })).toContainText('0 of 30');
  await expect(class3.getByRole('row', { name: /^B / })).toContainText('0 of 30');
  await expect(
    page.getByRole('region', { name: 'Class 4' }).getByRole('row', { name: /^A / }),
  ).toContainText('0 of 35');
  await expect(class3.getByRole('link')).toHaveCount(0);
});
