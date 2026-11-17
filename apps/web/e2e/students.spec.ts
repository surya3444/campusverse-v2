// Student records through the real screens: list, search, record tabs, an audited reveal,
// restricting a guardian, the real signed-in sidebar, and signing out.
import { expect, test } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test('students: list, record, reveal, restrict, sign out', async ({ page, context }, info) => {
  test.skip(
    info.project.name === 'phone',
    'one full run; phone layout is covered by the axe and overflow checks',
  );
  test.setTimeout(120_000);
  const s = devSession('Synthetic Students School');
  await signInAs(context, s);
  await page.goto('/students'); // a page on this origin, so page.request carries the cookies
  await schoolWithStudents(page, s.institutionId);
  await page.reload();

  // The sidebar shows the real school and person.
  await expect(page.getByText('Meera Owner Synthetic')).toBeVisible();
  await expect(page.getByText('Administrator', { exact: true })).toBeVisible();

  // List and search.
  const rows = page.getByRole('table', { name: 'Students' }).locator('tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(rows.first().getByText('Class 3-A')).toBeVisible();
  await noA11yViolations(page);
  const first = /[A-Z][a-z]+ Synthetic \d+/.exec((await rows.first().textContent()) ?? '')![0];
  // The full name: a lone digit like "0" would also match every admission number (ADM-1000…).
  await page.getByLabel('Search by name').fill(first);
  await expect(rows).toHaveCount(1);

  // The record.
  await page.getByRole('link', { name: first }).click();
  await expect(page.getByRole('heading', { name: first })).toBeVisible();
  for (const tab of ['Overview', 'Personal info', 'Guardians', 'Documents', 'History'])
    await expect(page.getByRole('tab', { name: tab, exact: tab === 'History' })).toBeVisible();
  await noA11yViolations(page);

  // Aadhaar: recorded masked; shown in full only with a reason.
  const personId = page.url().split('/').pop()!;
  await apiPost(page, `/people/students/${personId}/aadhaar`, { aadhaar: '234123412346' });
  await page.reload();
  // Identifiers live on the Personal info tab of the 360 record.
  await page.getByRole('tab', { name: 'Personal info' }).click();
  await expect(page.getByText('XXXX XXXX 2346')).toBeVisible();
  await page.getByRole('button', { name: 'Show in full' }).click();
  const dialog = page.getByRole('dialog', { name: 'Show Aadhaar in full' });
  await expect(dialog.getByRole('button', { name: 'Show' })).toBeDisabled();
  await dialog.getByLabel('Why do you need it?').fill('Board registration form');
  await dialog.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByText('234123412346')).toBeVisible();

  // Restrict a guardian, then lift it.
  await page.getByRole('tab', { name: 'Guardians' }).click();
  await page.getByRole('button', { name: 'Restrict' }).first().click();
  const restrict = page.getByRole('dialog', { name: 'Restrict this guardian' });
  await restrict.getByLabel('Reason (court order, safeguarding…)').fill('Court order on file');
  await restrict.getByRole('button', { name: 'Restrict guardian' }).click();
  await expect(page.getByText('Restricted: Court order on file')).toBeVisible();
  await page.getByRole('button', { name: 'Lift restriction' }).click();
  await expect(page.getByText('Restricted: Court order on file')).toHaveCount(0);

  // The reveal and the restriction are in the history, with their reasons.
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(page.getByText(/Board registration form/)).toBeVisible();
  await expect(page.getByText(/Court order on file/)).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/student-record.png', fullPage: true });

  // Sign out ends the session.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/students');
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)students/);
});
