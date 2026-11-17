// Milestone 21: the owner's admission question, an applicant's photo and papers that move to the
// student on enrolment, and subjects with periods and teachers.
import { expect, test } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);

test('an applicant’s papers follow them into the student record; subjects are set up', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === 'phone', 'one full run; screens are checked on phone below');
  test.setTimeout(300_000);
  const owner = devSession('Synthetic Depth School');
  await signInAs(context, owner);
  await page.goto('/setup');
  await schoolWithStudents(page, owner.institutionId);
  // A published fee plan for Class 3 (offers disclose fees) and the owner's admission question.
  const head = (await apiPost(page, `/finance/${owner.institutionId}/heads`, {
    code: 'TUITION',
    name: 'Tuition',
    taxClass: 'education_exempt',
    rteExempt: true,
    refundable: false,
  })) as { id: string };
  const groups = (await (
    await page.request.get(`/api/v1/communications/${owner.institutionId}/audience-groups`)
  ).json()) as { id: string; label: string }[];
  const plan = (await apiPost(page, `/finance/${owner.institutionId}/plans`, {
    name: 'Class 3 fees',
    groupIds: [groups.find((g) => g.label === 'Class 3')!.id],
    lines: [{ headId: head.id, amountPaise: 1_800_000 }],
    instalments: [{ label: 'Annual', dueOn: iso(30), shareBp: 10_000 }],
    lateFeePaise: 0,
    graceDays: 0,
  })) as { id: string };
  await apiPost(page, `/finance/plans/${plan.id}/publish`);
  await apiPost(page, '/fields/admission', {
    label: 'Previous board',
    type: 'choice',
    options: ['CBSE', 'ICSE', 'State board'],
    required: true,
  });

  // The enquiry asks the owner's question.
  await page.goto('/admissions');
  await page.getByRole('button', { name: 'New enquiry' }).first().click();
  await page.getByLabel("Child's name").fill('Ira Synthetic Depth');
  await page.getByLabel('Date of birth').fill('2018-06-15');
  await page.getByLabel("Parent or guardian's name").fill('Asha Synthetic Depth');
  await page
    .getByLabel('Mobile number')
    .fill(`9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`);
  await page.getByLabel('Previous board').selectOption('ICSE');
  await page.getByRole('button', { name: 'Save enquiry' }).click();
  await page.getByRole('link', { name: /Ira Synthetic Depth/ }).click();

  // Photo and a paper on the application, checked by the office.
  await page
    .getByLabel('Photo: Upload')
    .setInputFiles({ name: 'ira.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Add a document' }).click();
  const doc = page.getByRole('form', { name: 'Add a document' });
  await doc.getByLabel('Document').fill('Birth certificate');
  await doc
    .getByLabel('File')
    .setInputFiles({ name: 'birth.pdf', mimeType: 'application/pdf', buffer: PDF });
  await doc.getByRole('button', { name: 'Upload' }).click();
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText(/Checked by Meera Owner Synthetic/)).toBeVisible();
  await expect(page.getByLabel('Previous board')).toHaveValue('ICSE');
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/admissions-application.png', fullPage: true });

  // Applied → offered → accepted → enrolled.
  await page.getByLabel('Move to').selectOption('applied');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByRole('button', { name: 'Make offer' }).click();
  await page.getByRole('button', { name: 'Family accepted' }).click();
  await page.getByLabel('Section').selectOption({ label: 'Class 3-A' });
  await page.getByRole('button', { name: 'Enrol', exact: true }).click();
  await expect(page.getByText(/Enrolled\. Admission number/).first()).toBeVisible();
  await expect(page.getByText('These papers are now in the student’s record.')).toBeVisible();

  // The student's record has the verified paper in Identity.
  await page.getByRole('link', { name: 'Open student record' }).click();
  await page.getByRole('tab', { name: 'Documents' }).click();
  const carried = page
    .getByRole('listitem')
    .filter({ has: page.getByText('Birth certificate', { exact: true }) });
  await expect(carried.getByText('Verified', { exact: true })).toBeVisible();
  await noA11yViolations(page);

  // Subjects: a new language for Class 3 with periods and a teacher for 3-A.
  await page.goto('/subjects');
  await page.getByRole('button', { name: 'Add a subject' }).click();
  const add = page.getByRole('form', { name: 'Add a subject' });
  await add.getByLabel('Code').fill('SKT');
  await add.getByLabel('Name').fill('Sanskrit');
  await add.getByLabel('Type').selectOption('language');
  await add.getByRole('button', { name: 'Add subject' }).click();
  await page.getByLabel('Taught: Sanskrit, Class 3').click();
  await expect(page.getByLabel('Taught: Sanskrit, Class 3')).toBeChecked();
  const periods = page.getByLabel('Periods a week: Sanskrit, Class 3');
  await periods.fill('4');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/offerings') && r.ok()),
    periods.blur(),
  ]);
  const teacher = page.getByLabel('Teacher, Class 3-A: Sanskrit');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/teachers') && r.ok()),
    teacher.selectOption({ index: 1 }),
  ]);
  await page.reload();
  await expect(page.getByLabel('Periods a week: Sanskrit, Class 3')).toHaveValue('4');
  await expect(page.getByLabel('Teacher, Class 3-A: Sanskrit')).not.toHaveValue('');
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/subjects.png', fullPage: true });
});

test('subjects fit a phone and pass axe', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  test.setTimeout(120_000);
  const owner = devSession('Synthetic Depth Phone');
  await signInAs(context, owner);
  await page.goto('/subjects');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await noA11yViolations(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
});
