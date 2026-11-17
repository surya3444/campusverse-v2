// Identity & Access (rule book §10.3) through the real screens: Check access explains why the
// owner can't open named health records (sensitive data is opt-in per role); the Data Protection
// Officer grants a teacher case access to one student's record, logged, then ends it.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('access: check access, then case access for one student', async ({ page, context }, info) => {
  test.setTimeout(150_000);
  const s = devSession(`Synthetic Access School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/settings/access');
  await schoolWithStudents(page, s.institutionId);
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { name: string }[];
  const child = students[0]!.name;

  // Check access: the owner holds health totals, not named records.
  await page.reload();
  await page.getByRole('button', { name: 'Check access' }).click();
  const check = page.getByRole('form', { name: 'Check access' });
  await check.getByLabel('Person').selectOption({ label: 'Meera Owner Synthetic' });
  await check
    .getByLabel('Permission')
    .selectOption({ label: 'Open students’ health records (the medical role)' });
  await check.getByRole('button', { name: 'Check' }).click();
  const answer = check.getByRole('region', { name: 'Not allowed' });
  await expect(answer).toContainText('Data class: Sensitive data');
  await expect(answer).toContainText('None of their roles carries this permission.');
  await noA11yViolations(page);
  await page.keyboard.press('Escape');

  // Case access: one teacher, one student, a reason, a day.
  await page.goto('/privacy');
  await page.getByRole('radio', { name: 'Case access' }).click();
  await expect(page.getByText('No case access granted in the last 30 days.')).toBeVisible();
  await page.getByRole('button', { name: 'Grant case access' }).click();
  const grant = page.getByRole('form', { name: 'Grant case access' });
  const who = grant.getByLabel('Who needs it');
  const teacher =
    (await who
      .locator('option')
      .filter({ hasText: /Teacher/ })
      .first()
      .textContent()) ?? '';
  await who.selectOption({ label: teacher });
  await grant.getByLabel('About whom').fill(child.split(' ')[0]!);
  await grant.getByRole('button', { name: child }).click();
  await grant
    .getByLabel(/The case/)
    .fill('Parent asked the class teacher to check the asthma plan');
  await grant.getByRole('button', { name: 'Grant case access' }).click();
  await expect(grant).toBeHidden();
  const row = page.getByRole('listitem').filter({ hasText: `${teacher} → ${child}` });
  await expect(row).toContainText('Running');
  await expect(row).toContainText('Parent asked the class teacher to check the asthma plan');
  await noA11yViolations(page);
  await row.getByRole('button', { name: `End now: case access for ${teacher}` }).click();
  await expect(row).toContainText('Ended');
});
