// Milestone 13 through the real screens: an exam is created, marks are typed into the grid and
// submitted, the exam is locked and published with report cards, and the year is rolled over and
// undone. Runs on desktop and phone; nothing may be wider than the screen.
import type { ExamDetail, MarksSheet } from '@campusverse/school-exams';
import { expect, test, type Page } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);

const fitsScreen = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

test('an exam is marked, locked and published, then the year rolls over and back', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const owner = devSession('Synthetic Exams School');
  await signInAs(context, owner);
  await page.goto('/exams');
  await schoolWithStudents(page, owner.institutionId);
  // Next year, ready for the rollover.
  await apiPost(page, `/school/setup/${owner.institutionId}/structure`, {
    board: 'CBSE',
    yearLabel: '2027-28',
    starts: iso(301),
    ends: iso(660),
    classes: [
      { code: '3', sections: 1, capacity: 30 },
      { code: '4', sections: 1, capacity: 30 },
    ],
  });

  await page.reload();
  await expect(page.getByText('No exams yet.')).toBeVisible();
  await page.getByRole('button', { name: 'New exam' }).click();
  const form = page.getByRole('form', { name: 'New exam' });
  await form.getByLabel('Year').selectOption({ label: '2026-27' });
  await form.getByLabel('Exam name').fill('Term 1');
  await form.getByLabel('Class 3').check();
  await form.getByRole('button', { name: 'Create exam' }).click();
  await expect(page.getByRole('heading', { name: 'Term 1' })).toBeVisible();
  await fitsScreen(page);
  await noA11yViolations(page);
  const examId = page.url().split('/').pop() ?? '';

  // The first subject is typed into the grid: marks, a code, and a mark over the maximum.
  await page
    .getByRole('link', { name: /^Enter marks: / })
    .first()
    .click();
  const grid = page.getByRole('grid');
  await expect(grid).toBeVisible();
  // Row 0 is the header; each row's first cell is the name.
  const markCell = (row: number) =>
    grid
      .getByRole('row')
      .nth(row + 1)
      .getByRole('gridcell')
      .nth(1);
  await markCell(0).click();
  for (const m of ['72', 'AB', '88.5', '140', '64', '91']) {
    await page.keyboard.type(m);
    await page.keyboard.press('Enter');
  }
  await expect(page.getByText('1 to fix')).toBeVisible();
  await markCell(3).click();
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Saved /)).toBeVisible();
  await page.getByRole('button', { name: /^Submit / }).click();
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
  await fitsScreen(page);
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/exam-marks-${info.project.name}.png`,
    fullPage: true,
  });

  // The other subjects are entered as a teacher's autosave would send them.
  const detail = (await (
    await page.request.get(`/api/v1/school/exams/${examId}`)
  ).json()) as ExamDetail;
  const cls = detail.classes[0]!;
  for (const p of cls.papers.filter((x) => !x.submitted)) {
    for (const s of cls.sections) {
      const sheet = (await (
        await page.request.get(`/api/v1/school/exams/papers/${p.paperId}?sectionId=${s.sectionId}`)
      ).json()) as MarksSheet;
      await apiPost(page, `/school/exams/papers/${p.paperId}/marks`, {
        sectionId: s.sectionId,
        entries: sheet.students.map((x, i) => ({ studentId: x.personId, mark: String(50 + i) })),
      });
    }
    await apiPost(page, `/school/exams/papers/${p.paperId}/submit`);
  }

  await page.goto(`/exams/${examId}`);
  await page.getByRole('button', { name: 'Lock marks' }).click();
  await expect(page.getByText('Locked', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish results' }).click();
  const canvas = page.getByRole('dialog');
  await expect(canvas.getByText(/Grading scheme: cbse-8pt/)).toBeVisible();
  await canvas.getByRole('button', { name: 'Publish results' }).click();
  await expect(page.getByText('6 report cards issued.')).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await noA11yViolations(page);

  // Year end: everyone in Class 3 is promoted to Class 4, then the rollover is undone.
  await page.goto('/year-end');
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByText('No detention up to Class 8').first()).toBeVisible();
  await fitsScreen(page);
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/year-end-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Roll over' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText('Promoted', { exact: true })).toBeVisible();
  await confirm.getByRole('button', { name: 'Roll over' }).click();
  await expect(page.getByText('Rolled over.')).toBeVisible();
  const run = page.getByRole('listitem').filter({ hasText: '2026-27 → 2027-28' });
  await expect(run).toContainText('Done');
  await run.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Rollover undone.')).toBeVisible();
  await expect(run).toContainText('Undone');
});
