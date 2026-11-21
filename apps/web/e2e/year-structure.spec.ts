// Each year's classes and sections can change (owner's brief, 20 Nov 2026), and a student can
// move to another section of their class without attendance clashing.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);

test('a year’s structure is edited in Classes, and a student changes section', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const owner = devSession('Synthetic Structure School');
  await signInAs(context, owner);
  await page.goto('/classes');
  await schoolWithStudents(page, owner.institutionId);
  await page.reload();

  // Add a section B to Class 3 in the running year.
  await page.getByRole('button', { name: 'Edit structure' }).click();
  await expect(page.getByRole('region', { name: 'What can change' })).toContainText(
    'changes stay in 2026-27 only',
  );
  await page.getByRole('button', { name: 'Add a section to Class 3' }).click();
  const add = page.getByRole('dialog', { name: 'Add a section to Class 3' });
  await expect(add.getByLabel('Section name')).toHaveValue('B');
  await add.getByLabel('Seats').fill('25');
  await noA11yViolations(page);
  await add.getByRole('button', { name: 'Add section' }).click();
  const class3 = page.getByRole('region', { name: 'Class 3' });
  await expect(class3.getByRole('row', { name: /^B / })).toContainText('0 of 25');
  await page.screenshot({
    path: `e2e/screenshots/classes-structure-${test.info().project.name}.png`,
    fullPage: true,
  });

  // A has students: it can close but not be removed. B is unused: it can be removed.
  await expect(page.getByRole('button', { name: 'Remove Class 3-A' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close Class 3-A to new students' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Class 3-B' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // A student of 3-A moves to 3-B from tomorrow, with B's next roll number.
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${owner.institutionId}`)
  ).json()) as { personId?: string; id?: string; name: string }[];
  const student = students[0];
  const studentId = student?.personId ?? student?.id ?? '';
  await page.goto(`/students/${studentId}`);
  await page.getByRole('button', { name: 'Change section' }).click();
  const move = page.getByRole('dialog', { name: 'Change section' });
  await expect(move).toContainText('is in Class 3-A for 2026-27');
  await move.getByRole('radio', { name: /Class 3-B/ }).check();
  await expect(move).toContainText('25 seats left');
  await expect(move.getByLabel('From')).toHaveValue(iso(1));
  // Neither register is taken today, so today is allowed too.
  await expect(move.getByLabel('From')).toHaveAttribute('min', iso(0));
  await move.getByLabel('Reason').fill('Balancing section sizes');
  await page.screenshot({ path: `e2e/screenshots/change-section-${test.info().project.name}.png` });
  await noA11yViolations(page);
  await move.getByRole('button', { name: 'Change section' }).click();
  await expect(move).toBeHidden();
  await expect(page.getByText(/moves to Class 3-B from .*, roll number 1\./)).toBeVisible();

  // Once today's 3-A register is taken, a move can only start tomorrow: the mark stays put.
  const sectionA = (
    (await (
      await page.request.get(`/api/v1/school/enrolment/${studentId}/section-options`)
    ).json()) as { current: { sectionId: string } }
  ).current.sectionId;
  await page.goto(`/attendance/${sectionA}`);
  await page.getByRole('button', { name: /^Submit/ }).click();
  await expect(page.getByRole('region', { name: 'Submitted' })).toBeVisible();
  const other = students[1];
  await page.goto(`/students/${other?.personId ?? other?.id ?? ''}`);
  await page.getByRole('button', { name: 'Change section' }).click();
  const next = page.getByRole('dialog', { name: 'Change section' });
  await next.getByRole('radio', { name: /Class 3-B/ }).check();
  await expect(next.getByLabel('From')).toHaveAttribute('min', iso(1));
  await expect(next).toContainText('1 of 25 students');
});
