// Academics › Academic Structure (rule book §13.2, §12.4 decisions 2–3) through the real screens:
// a school is pointed to Setup; a college gets programs, a regulation drafted course by course and
// published, a batch on it, a student enrolled, and the batch moved on a term, never copied.
import { expect, test } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('academic structure: program, regulation, batch, enrolment, next term', async ({
  page,
  context,
}, info) => {
  test.setTimeout(150_000);
  const s = devSession(`Synthetic Engine Trust ${info.project.name}`);
  await signInAs(context, s);

  // A school keeps its classes in Setup.
  await page.goto('/academic-structure');
  await expect(page.getByRole('heading', { name: 'Academic Structure', level: 1 })).toBeVisible();
  await expect(page.getByText('Schools set classes and sections in Setup')).toBeVisible();

  // An autonomous college on the same campus.
  const tree = (await (await page.request.get('/api/v1/school/setup/tree')).json()) as {
    campuses: { campusId: string }[];
  };
  const { institutionId } = (await apiPost(
    page,
    `/organisation/campuses/${tree.campuses[0]!.campusId}/institutions`,
    {
      profile: 'autonomous_college',
      name: 'Synthetic Engineering College',
      authorityCode: 'JNTUH',
    },
  )) as { institutionId: string };
  await page.evaluate((id) => window.localStorage.setItem('cv.institution', id), institutionId);
  await page.reload();
  const main = page.getByRole('main');
  await expect(main.getByText('Start with a program')).toBeVisible();
  if (info.project.name === 'desktop') {
    const nav = page.getByRole('navigation', { name: /./ }).first();
    await expect(nav.getByRole('link', { name: 'Academic structure' })).toBeVisible();
    // A college's attendance is period-wise (course attendance), not the school register.
    await expect(nav.getByRole('link', { name: 'Attendance', exact: true })).toHaveAttribute(
      'href',
      '/course-attendance',
    );
  }
  await noA11yViolations(page);

  // The program.
  await main.getByRole('button', { name: 'Add a program' }).first().click();
  const program = page.getByRole('form', { name: 'Add a program' });
  await program.getByLabel('Name').fill('Diploma in Data Science');
  await program.getByLabel('Code').fill('dds');
  await program.getByLabel('Level').selectOption('diploma');
  await program.getByLabel('Number of terms').fill('2');
  await program.getByLabel('Credit framework').selectOption('');
  await program.getByRole('button', { name: 'Add a program' }).click();
  await expect(program).toBeHidden();
  const item = main.getByRole('listitem', { name: 'DDS Diploma in Data Science' });
  await expect(item).toBeVisible();

  // A regulation, drafted course by course.
  await item.getByRole('button', { name: 'Draft a regulation' }).click();
  const reg = page.getByRole('form', { name: 'Draft a regulation' });
  await reg.getByLabel('Regulation code').fill('r26');
  await reg.getByLabel('In force from').fill('2026-06-01');
  await reg.getByRole('button', { name: 'Draft a regulation' }).click();
  const drawer = page.getByRole('dialog', { name: 'DDS R26 v1' });
  await expect(drawer.getByText('Semester 1 has no courses.')).toBeVisible();
  for (const [code, title, term] of [
    ['DS101', 'Statistics', 'Semester 1'],
    ['DS201', 'Machine Learning', 'Semester 2'],
  ] as const) {
    await drawer.getByRole('button', { name: 'Add a course' }).click();
    const course = page.getByRole('form', { name: 'Add a course' });
    await course.getByLabel('Course code').fill(code);
    await course.getByLabel('Course title').fill(title);
    await course.getByLabel('Term').selectOption({ label: term });
    await course.getByLabel('Lecture hours a week (L)').fill('3');
    await course.getByLabel('Practical hours a week (P)').fill('2');
    await course.getByLabel('Credits').fill('4');
    if (code === 'DS101') {
      // Two internal assessment components: weights must add up to 100 before saving.
      await course.getByRole('button', { name: 'Add component' }).click();
      await course.getByLabel('Component 1', { exact: true }).fill('Test');
      await course.getByLabel('Out of (1)').fill('50');
      await course.getByLabel('Weight % (1)').fill('70');
      await course.getByRole('button', { name: 'Add component' }).click();
      await course.getByLabel('Component 2', { exact: true }).fill('Assignment');
      await course.getByLabel('Weight % (2)').fill('20');
      await expect(course.getByText('Weights add up to 90%')).toBeVisible();
      await expect(course.getByRole('button', { name: 'Add a course' })).toBeDisabled();
      await course.getByLabel('Weight % (2)').fill('30');
      await noA11yViolations(page);
    }
    await course.getByRole('button', { name: 'Add a course' }).click();
    await expect(course).toBeHidden();
    await expect(drawer.getByText(`${code} · ${title}`)).toBeVisible();
  }
  await expect(drawer.getByText(/^Every term has courses\./)).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: `e2e/screenshots/regulation-${info.project.name}.png` });
  await drawer.getByRole('button', { name: 'Publish regulation' }).click();
  const publish = page.getByRole('form', { name: 'Publish regulation' });
  await publish.getByRole('button', { name: 'Publish regulation' }).click();
  await expect(publish).toBeHidden();
  await expect(drawer.getByRole('button', { name: 'Add a course' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // A batch on it, a student, then the next term.
  await page.getByRole('button', { name: 'Add a batch' }).click();
  const batch = page.getByRole('form', { name: 'Add a batch' });
  await batch.getByLabel('Starting year').fill('2026');
  await batch.getByLabel('Number of sections').fill('1');
  await batch.getByLabel('First term starts').fill('2026-07-01');
  await batch.getByLabel('First term ends').fill('2026-11-30');
  await batch.getByRole('button', { name: 'Add a batch' }).click();
  const b = page.getByRole('dialog', { name: 'DDS 2026–27' });
  await expect(b.getByText('Semester 1 of 2')).toBeVisible();
  await expect(b.getByText('DS101 · Statistics')).toBeVisible();

  await b.getByRole('button', { name: 'Enrol a student' }).click();
  const enrol = page.getByRole('form', { name: 'Enrol a student' });
  await enrol.getByLabel('Full name').fill('Synthetic Meera Nair');
  await enrol.getByLabel('Register number').fill('26DS001');
  await enrol.getByRole('button', { name: 'Enrol a student' }).click();
  await expect(enrol).toBeHidden();
  await expect(b.getByRole('link', { name: 'Synthetic Meera Nair' })).toBeVisible();

  // The rest of the batch from a file: every row checked, the ready ones enrolled.
  await b.getByRole('button', { name: 'Enrol from a file' }).click();
  const file = page.getByRole('dialog', { name: 'Enrol students from a file' });
  await file.locator('input[type="file"]').setInputFiles({
    name: 'students.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'Name,Register number,Section,Date of birth',
        'Synthetic Arjun Das,26DS002,A,14/02/2008',
        'Synthetic Lata Rao,26DS003,A,',
        'Synthetic Repeat,26DS001,A,',
      ].join('\n'),
    ),
  });
  await expect(file.getByRole('status')).toHaveText('2 of 3 rows are ready to enrol.');
  await expect(file.getByRole('row', { name: /Synthetic Repeat/ })).toContainText(
    'Already in this batch',
  );
  await noA11yViolations(page);
  await file.getByRole('button', { name: 'Enrol 2 students' }).click();
  await expect(file).toBeHidden();
  await expect(b.getByRole('link', { name: 'Synthetic Lata Rao' })).toBeVisible();

  await b.getByRole('button', { name: 'Move to semester 2' }).click();
  const next = page.getByRole('form', { name: 'Move to semester 2' });
  await next.getByLabel('Next term starts').fill('2027-01-04');
  await next.getByLabel('Next term ends').fill('2027-05-29');
  await next.getByRole('button', { name: 'Move to semester 2' }).click();
  await expect(next).toBeHidden();
  await expect(b.getByText('Semester 2 of 2')).toBeVisible();
  await expect(b.getByText('DS201 · Machine Learning')).toBeVisible();
  await expect(b.getByText('DS101 · Statistics')).toHaveCount(0);
  await expect(b.getByRole('button', { name: 'Complete the batch' })).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: `e2e/screenshots/batch-${info.project.name}.png` });
  await page.keyboard.press('Escape');

  const row = main
    .getByRole('table', { name: 'Batches' })
    .getByRole('row', { name: /DDS 2026–27/ });
  await expect(row).toContainText('R26 v1');
  await expect(row).toContainText('Even term');
  await page.screenshot({
    path: `e2e/screenshots/academic-structure-${info.project.name}.png`,
    fullPage: true,
  });
});
