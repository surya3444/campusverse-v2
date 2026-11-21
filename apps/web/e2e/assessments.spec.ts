// Assessments through the real screens (rule book §13.2): the owner adds tagged questions to the
// bank, sets a paper from them, reads its blueprint, finalises it and prints the answer key.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('assessments: bank, paper, blueprint, finalise, print with key', async ({
  page,
  context,
}, info) => {
  test.setTimeout(150_000);
  const s = devSession(`Synthetic Assessment School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/assessments');
  await expect(page.getByText('No questions yet')).toBeVisible();
  await noA11yViolations(page);

  // A multiple-choice question tagged to CO1.
  await page.getByRole('button', { name: 'Add question' }).first().click();
  let add = page.getByRole('dialog', { name: 'Add question' });
  await add.getByLabel('Subject').fill('Physics');
  await add
    .getByLabel('Question', { exact: true })
    .fill('A car goes 30 m in 10 s. What is its speed?');
  await add.getByLabel(/^Options/).fill('3 m/s\n300 m/s\n0.3 m/s');
  await add.getByRole('combobox', { name: 'Correct option' }).selectOption('3 m/s');
  await add.getByRole('combobox', { name: 'Bloom level' }).selectOption('remember');
  await add.getByRole('combobox', { name: 'Difficulty' }).selectOption('easy');
  await add.getByLabel(/^Course outcome/).fill('CO1');
  await noA11yViolations(page);
  await add.getByRole('button', { name: 'Save question' }).click();
  await expect(page.getByText('Question saved.')).toBeAttached();

  // A long answer at Apply level.
  await page.getByRole('button', { name: 'Add question' }).first().click();
  add = page.getByRole('dialog', { name: 'Add question' });
  await add.getByLabel('Subject').fill('Physics');
  await add.getByRole('combobox', { name: 'Type' }).selectOption('long');
  await add
    .getByLabel('Question', { exact: true })
    .fill('Derive v = u + at from first principles.');
  await add.getByLabel('Marks').fill('4');
  await add.getByRole('combobox', { name: 'Bloom level' }).selectOption('apply');
  await add.getByRole('button', { name: 'Save question' }).click();
  await expect(page.getByText('Derive v = u + at from first principles.')).toBeVisible();

  // Set a paper from them.
  await page.getByRole('radio', { name: 'Question papers' }).click();
  await page.getByRole('button', { name: 'New paper' }).first().click();
  const paper = page.getByRole('dialog', { name: 'New paper' });
  await paper.getByLabel('Title').fill('Unit test 1');
  await paper.getByRole('combobox', { name: 'Subject' }).selectOption('Physics');
  await paper.getByLabel('Time in minutes').fill('40');
  await paper.getByRole('button', { name: 'Create paper' }).click();
  await page.getByRole('button', { name: /Unit test 1/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Unit test 1' });
  await drawer.getByRole('button', { name: 'Pick questions' }).click();
  const pick = page.getByRole('dialog', { name: 'Questions for Unit test 1' });
  await pick.getByRole('checkbox', { name: /Derive v = u \+ at/ }).check();
  await pick.getByRole('checkbox', { name: /A car goes 30 m/ }).check();
  await pick.getByRole('button', { name: 'Move question 2 up' }).click();
  await expect(pick.getByText('2 selected · 5 marks')).toBeVisible();
  await noA11yViolations(page);
  await pick.getByRole('button', { name: 'Save questions' }).click();
  await expect(drawer.getByText('80% of marks at Apply or above')).toBeVisible();
  await expect(drawer.getByText('1 question has no course outcome')).toBeVisible();
  await expect(drawer.getByText('1. A car goes 30 m in 10 s. What is its speed?')).toBeVisible();
  await drawer.getByRole('button', { name: 'Finalise paper' }).click();
  await expect(drawer.getByText('Paper finalised.')).toBeAttached();
  await expect(drawer.getByRole('button', { name: 'Pick questions' })).toHaveCount(0);
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/assessments-${info.project.name}.png`,
    fullPage: true,
  });

  // Print with the answer key.
  await drawer.getByRole('link', { name: 'Print with answer key' }).click();
  await expect(page.getByRole('heading', { name: 'Unit test 1 · Answer key' })).toBeVisible();
  await expect(page.getByText('Maximum marks: 5')).toBeVisible();
  await expect(page.getByText('(a) 3 m/s')).toBeVisible();
  await noA11yViolations(page);
});
