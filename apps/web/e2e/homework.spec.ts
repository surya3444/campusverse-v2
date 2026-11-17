// Homework and the class diary through the real screens (docs/specs/HOMEWORK.md): homework with a
// PDF set for a class, a diary entry, the parent ticking it done in the app, and the teacher's
// done count.
import { expect, test } from '@playwright/test';
import {
  apiPost,
  devSession,
  noA11yViolations,
  openApp,
  schoolWithStudents,
  sessionFor,
  signInAs,
} from './helpers';

// Scans run on settled screens: empty states fade in, which axe can catch half-drawn.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('homework: set with a PDF, diary, parent ticks done', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic Homework School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/homework');
  await expect(page.getByText('You don’t teach any class here yet.')).toBeVisible();
  await schoolWithStudents(page, s.institutionId);
  const id = s.institutionId;
  // The generated school's classes already take Mathematics.
  await page.reload();
  await expect(page.getByRole('button', { name: /Class 3-A/ })).toBeVisible();
  await noA11yViolations(page);

  // Set homework with a worksheet PDF.
  await page.getByRole('button', { name: 'Set homework' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await dialog.getByRole('textbox', { name: /^Homework/ }).fill('Exercise 4.2, questions 1 to 10');
  await dialog.getByRole('textbox', { name: /^Details/ }).fill('Show your working.');
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'worksheet.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n'),
  });
  await expect(dialog.getByText('worksheet.pdf')).toBeVisible();
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: 'Exercise 4.2' });
  await expect(item.getByText('Class 3-A: 0 of 6 done')).toBeVisible();
  await expect(item.getByRole('link', { name: 'worksheet.pdf' })).toBeVisible();

  // A general note in the diary.
  await page.getByRole('button', { name: 'Write in the diary' }).click();
  await dialog
    .getByRole('textbox', { name: /^What was covered/ })
    .fill('Fractions: adding unlike denominators.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Fractions: adding unlike denominators.')).toBeVisible();
  await noA11yViolations(page);

  // The parent sees it in the app and ticks it done (the app side runs once, at phone width).
  if (info.project.name === 'phone') return;
  await apiPost(page, `/school/setup/${id}/invites`);
  const parent = await sessionFor('guardian', s.orgId);
  const app = await openApp(browser, parent);
  const v = { visible: true };
  await app.getByRole('button', { name: 'Homework' }).filter(v).first().click({ timeout: 30_000 });
  await expect(app.getByText(/Mathematics · Exercise 4.2/).filter(v)).toBeVisible();
  await expect(app.getByText(/Fractions: adding unlike denominators/).filter(v)).toBeVisible();
  await noA11yViolations(app);
  await app.getByRole('button', { name: 'Mark done' }).filter(v).click();
  await expect(app.getByRole('button', { name: 'Not done yet' }).filter(v)).toBeVisible();
  await app.screenshot({ path: 'e2e/screenshots/parent-app-homework.png', fullPage: true });

  await page.reload();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Exercise 4.2' })
      .getByText('Class 3-A: 1 of 6 done'),
  ).toBeVisible();
});

test('a teacher sets homework with a photo and writes the diary in the app', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(info.project.name === 'phone', 'the app side already runs at phone width');
  test.setTimeout(240_000);
  const s = devSession('Synthetic App Homework School');
  await signInAs(context, s);
  await page.goto('/homework');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const teacher = await sessionFor('teacher', s.orgId);

  const app = await openApp(browser, teacher);
  const v = { visible: true };
  await app.getByRole('button', { name: 'Set homework' }).filter(v).click({ timeout: 30_000 });
  await app.getByRole('radio', { name: 'Mathematics' }).filter(v).first().click();
  await app.getByLabel('Homework').filter(v).fill('Learn the 7 times table');
  // A photo from the phone's gallery (a file chooser on the web build).
  const chooser = app.waitForEvent('filechooser');
  await app.getByRole('button', { name: 'Choose a photo' }).filter(v).click();
  await (
    await chooser
  ).setFiles({
    name: 'board.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(app.getByText('board.png', { exact: true }).filter(v)).toBeVisible({
    timeout: 15_000,
  });
  await noA11yViolations(app);
  await app.getByRole('button', { name: 'Set homework' }).filter(v).last().click();
  await expect(app.getByText('Saved. Parents will see it in the app.').filter(v)).toBeVisible();
  await expect(app.getByText(/Mathematics · Learn the 7 times table/).filter(v)).toBeVisible();

  await app.getByLabel('What was covered today').filter(v).fill('Multiplication tables 6 and 7.');
  await app.getByRole('button', { name: 'Write in the diary' }).filter(v).last().click();
  await expect(app.getByText('Added to the class diary.').filter(v)).toBeVisible();
  await app.screenshot({ path: 'e2e/screenshots/teacher-app-homework.png', fullPage: true });

  // The office sees both on the web, with the photo.
  await page.reload();
  const item = page.getByRole('listitem').filter({ hasText: 'Learn the 7 times table' });
  await expect(item.getByRole('link', { name: 'board.png' })).toBeVisible();
  await expect(page.getByText('Multiplication tables 6 and 7.')).toBeVisible();
});
