// Exam patterns, the full report card and the year's final result (owner's brief, 21 Nov 2026):
// an exam split Theory 80 + Internal 20, one subject changed back to one paper, co-scholastic
// grades and suggested remarks, publish; then a second exam and a 40/60 final result published.
import type { ExamDetail, MarksSheet } from '@campusverse/school-exams';
import { expect, test, type Page } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

const fitsScreen = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

/** Every paper's marks typed and submitted, as teachers' autosave would send them. */
async function markAll(page: Page, examId: string, base: number) {
  const detail = (await (
    await page.request.get(`/api/v1/school/exams/${examId}`)
  ).json()) as ExamDetail;
  for (const c of detail.classes)
    for (const p of c.papers) {
      for (const s of c.sections) {
        const sheet = (await (
          await page.request.get(
            `/api/v1/school/exams/papers/${p.paperId}?sectionId=${s.sectionId}`,
          )
        ).json()) as MarksSheet;
        const max = Number(p.maxMarks);
        await apiPost(page, `/school/exams/papers/${p.paperId}/marks`, {
          sectionId: s.sectionId,
          entries: sheet.students.map((x, i) => ({
            studentId: x.personId,
            mark: String(Math.min(max, Math.round((max * (base + i * 5)) / 100))),
          })),
        });
      }
      await apiPost(page, `/school/exams/papers/${p.paperId}/submit`);
    }
}

test('split marks, report card entries and a weighted final result', async ({
  page,
  context,
}, info) => {
  test.setTimeout(300_000);
  const shot = (name: string) =>
    page.screenshot({ path: `e2e/screenshots/${name}-${info.project.name}.png`, fullPage: true });
  const s = devSession(`Synthetic Patterns School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/exams');
  await schoolWithStudents(page, s.institutionId);
  await page.reload();

  // 1 · A half-yearly exam split Theory 80 + Internal 20 for every subject.
  await page.getByRole('button', { name: 'New exam' }).click();
  const form = page.getByRole('form', { name: 'New exam' });
  await form.getByLabel('Year').selectOption({ label: '2026-27' });
  await form.getByLabel('Exam name').fill('Half-yearly');
  await form.getByLabel('Class 3').check();
  await form.getByRole('radio', { name: 'Split into parts' }).click();
  await expect(form.getByLabel('Name of part 1')).toHaveValue('Theory');
  await expect(form.getByLabel('Marks for part 2')).toHaveValue('20');
  await expect(form.getByText('Each subject out of 100')).toBeVisible();
  await noA11yViolations(page);
  await shot('exam-split-form');
  await form.getByRole('button', { name: 'Create exam' }).click();
  await expect(page.getByRole('heading', { name: 'Half-yearly', level: 1 })).toBeVisible();
  const examId = page.url().split('/').pop()?.split('?')[0] ?? '';
  await expect(page.getByRole('cell', { name: 'Internal' }).first()).toBeVisible();

  // 2 · English goes back to one paper of 100 while no marks are in it.
  await page.getByRole('button', { name: /^Change split: English/ }).click();
  const split = page.getByRole('form', { name: /^Marks split: English/ });
  await split.getByRole('radio', { name: 'One paper' }).click();
  await expect(split.getByLabel('Maximum marks per subject')).toHaveValue('100');
  await split.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Marks split saved.')).toBeVisible();
  await fitsScreen(page);
  await noA11yViolations(page);
  await shot('exam-split-papers');

  // 3 · Report card: a co-scholastic grade, suggested remarks from the marks, saved.
  await markAll(page, examId, 55);
  await page.getByRole('radio', { name: 'Report card' }).click();
  const first = page.getByRole('combobox', { name: /^Work Education for / }).first();
  await first.selectOption('A');
  await page.getByRole('button', { name: 'Fill empty remarks with suggestions' }).click();
  await expect(page.getByText(/^\d+ unsaved changes?$/)).toBeVisible();
  await page.getByRole('button', { name: 'Save report-card entries' }).click();
  await expect(page.getByText(/^\d+ students? saved\.$/)).toBeVisible();
  await expect(first).toHaveValue('A');
  await fitsScreen(page);
  await noA11yViolations(page);
  await shot('exam-report-card');

  // 4 · Lock and publish: the report card adds Theory and Internal up.
  await page.reload();
  await page.getByRole('button', { name: 'Lock marks' }).click();
  await expect(page.getByText('Locked', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish results' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish results' }).click();
  await expect(page.getByText(/^\d+ report cards issued\.$/)).toBeVisible();

  // 5 · The annual exam, one paper a subject, marked and published through the API.
  const years = (await (
    await page.request.get(`/api/v1/school/exams/institution/${s.institutionId}/years`)
  ).json()) as {
    years: { yearId: string; label: string }[];
    classes: { classId: string; name: string }[];
  };
  const yearId = years.years.find((y) => y.label === '2026-27')?.yearId ?? '';
  const classId = years.classes.find((c) => c.name === 'Class 3')?.classId ?? '';
  const annual = (await apiPost(page, `/school/exams/institution/${s.institutionId}`, {
    yearId,
    name: 'Annual',
    classIds: [classId],
    maxMarks: '100',
  })) as { id: string };
  await markAll(page, annual.id, 70);
  await apiPost(page, `/school/exams/${annual.id}/lock`);
  await apiPost(page, `/school/exams/${annual.id}/publish`);

  // 6 · Final result: Half-yearly 40% + Annual 60%, previewed, then published.
  await page.goto('/exams');
  await page.getByRole('button', { name: 'New final result' }).click();
  const fin = page.getByRole('form', { name: 'New final result' });
  await fin.getByLabel(/^Name/).fill('Final result 2026-27');
  await fin.getByLabel('Class 3').check();
  await fin.getByLabel('Weight of Half-yearly (%)').fill('40');
  await fin.getByLabel('Weight of Annual (%)').fill('60');
  await expect(fin.getByText('Weights add up to 100%', { exact: true })).toBeVisible();
  await noA11yViolations(page);
  await fin.getByRole('button', { name: 'New final result' }).click();
  await expect(page.getByRole('heading', { name: 'Final result 2026-27', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Each student’s year result' })).toBeVisible();
  await fitsScreen(page);
  await noA11yViolations(page);
  await shot('exam-final-preview');
  await page.getByRole('button', { name: 'Publish final result' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish final result' }).click();
  await expect(page.getByText(/^\d+ final report cards issued\.$/)).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await noA11yViolations(page);
});
