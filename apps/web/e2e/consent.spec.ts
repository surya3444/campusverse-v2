// Consent at Entry through the real screens (rule book §13.4, §16.5): the school publishes a
// notice; a guardian allows it in the parent app; it counts once the office has verified the
// guardian as an identifiable adult (DPDP Rule 10); coverage moves on the privacy console.
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

test('consent: a guardian decides in the app; the school sees it', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(info.project.name === 'phone', 'the app side already runs at phone width');
  test.setTimeout(240_000);
  const owner = devSession('Synthetic Consent School');
  await signInAs(context, owner);
  await page.goto('/privacy');
  await schoolWithStudents(page, owner.institutionId);
  await apiPost(page, `/school/setup/${owner.institutionId}/invites`);
  await apiPost(page, '/privacy/notices', {
    purpose: 'photos_publication',
    language: 'en',
    body: 'Synthetic notice: we may print photos of your child in the school magazine and website.',
  });
  const parent = await sessionFor('guardian', owner.orgId);

  const app = await openApp(browser, parent);
  const v = { visible: true };
  await app
    .getByRole('button', { name: 'Privacy and consent' })
    .filter(v)
    .first()
    .click({ timeout: 30_000 });
  await expect(app.getByText('Photos in school publications').filter(v)).toBeVisible();
  await expect(app.getByText("You haven't decided yet").filter(v)).toBeVisible();
  await noA11yViolations(app);
  await app.getByRole('button', { name: 'Allow' }).filter(v).click();
  await expect(app.getByText('You allowed this').filter(v)).toBeVisible();
  await expect(app.getByText(/The school will confirm who you are/).filter(v)).toBeVisible();
  await app.close();

  // The office sees it on the child's record (the child whose guardian decided).
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${owner.institutionId}`)
  ).json()) as { personId: string }[];
  let childId = '';
  for (const st of students) {
    const c = (await (
      await page.request.get(`/api/v1/consent/students/${st.personId}`)
    ).json()) as {
      purposes: { decisions: unknown[] }[];
    };
    if (c.purposes.some((x) => x.decisions.length > 0)) childId = st.personId;
  }
  expect(childId).not.toBe('');
  await page.goto(`/students/${childId}`);
  await page.getByRole('tab', { name: 'Guardians' }).click();
  const consent = page.getByRole('region', { name: 'Consent' });
  await expect(consent).toContainText('Photos in school publications');
  await expect(consent).toContainText('Allowed, awaiting verification');
  await expect(consent).toContainText('in the app');

  // The office checks the guardian's voter ID at the counter.
  await page.goto('/privacy');
  await expect(page.getByRole('row', { name: /Photos in school publications/ })).toContainText(
    'Version 1',
  );
  await page.goto(`/students/${childId}`);
  await page.getByRole('tab', { name: 'Guardians' }).click();
  await consent
    .getByRole('button', { name: /^Verify / })
    .first()
    .click();
  const check = page.getByRole('form', { name: 'Verify a guardian' });
  await check.getByRole('combobox', { name: /^Document seen/ }).selectOption('voter_id');
  await noA11yViolations(page);
  await check.getByRole('button', { name: 'Mark as verified' }).click();
  await expect(check).toBeHidden();
  await expect(consent.getByText(/Voter ID ·/)).toBeVisible();
  await expect(consent.getByText('Allowed', { exact: true })).toBeVisible();
  await noA11yViolations(page);
  await consent.screenshot({ path: 'e2e/screenshots/consent-verified.png' });

  await page.goto('/privacy');
  await expect(
    page.getByRole('row', { name: /Photos in school publications/ }).getByRole('meter'),
  ).not.toHaveAttribute('aria-valuenow', '0');
});
