// Privacy & Consent through the real screens (rule book §13.12): the owner publishes a notice,
// records a data-rights request and closes it with an outcome, and records a breach with the
// CERT-In clock. A teacher, without the privacy permission, is refused.
import { expect, test } from '@playwright/test';
import {
  apiPost,
  devSession,
  noA11yViolations,
  schoolWithStudents,
  sessionFor,
  signInAs,
} from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('privacy: notices, a data-rights request and a breach', async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const s = devSession(`Synthetic Privacy School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/privacy');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Privacy & Consent', level: 1 })).toBeVisible();
  await expect(page.getByRole('row', { name: /Health record/ })).toContainText('No notice yet');
  await noA11yViolations(page);

  // A notice for the health record, in English.
  await page
    .getByRole('row', { name: /Health record/ })
    .getByRole('button', { name: 'Publish notice' })
    .click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Purpose')).toHaveValue('health_records');
  await dialog
    .getByLabel('Notice text guardians will read')
    .fill('Synthetic notice: the school nurse keeps allergies, conditions and blood group.');
  await dialog.getByRole('button', { name: 'Publish notice' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: /Health record/ })).toContainText('Version 1 · EN');

  // A data-rights request, closed with an outcome.
  await page.getByRole('radio', { name: 'Data-rights requests' }).click();
  await expect(page.getByText(/No open requests/)).toBeVisible();
  await page.getByRole('button', { name: 'Record a request' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('What they ask for').selectOption('correction');
  await dialog.getByLabel('Who asked').fill('Synthetic Guardian');
  await dialog.getByLabel('What they asked, in their words').fill('The date of birth is wrong.');
  await dialog.getByRole('button', { name: 'Record request' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: /Correction · Synthetic Guardian/ }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('button', { name: 'Mark done' })).toBeDisabled();
  await drawer.getByLabel('Outcome').fill('Corrected from the birth certificate.');
  await drawer.getByRole('button', { name: 'Mark done' }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('radio', { name: 'Closed', exact: true }).click();
  await expect(page.getByRole('button', { name: /Correction · Synthetic Guardian/ })).toContainText(
    'Done',
  );

  // A breach noticed now: the CERT-In report is due.
  await page.getByRole('radio', { name: 'Breach register' }).click();
  await page.getByRole('button', { name: 'Record a breach' }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('What happened, in a line')
    .fill('Synthetic: a fee list was emailed to the wrong parent');
  await dialog.getByLabel('Details: what data, how, what has been done').fill('Synthetic details.');
  await dialog.getByLabel('People affected (if known)').fill('12');
  await dialog.getByRole('button', { name: 'Record breach' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('CERT-In report due')).toBeVisible();
  await page.getByRole('button', { name: 'Mark: reported to cert-in' }).click();
  await expect(page.getByText('CERT-In reported in time')).toBeVisible();
  await noA11yViolations(page);

  // A teacher doesn't run the privacy console.
  const teacher = await sessionFor('teacher', s.orgId);
  await context.clearCookies();
  await signInAs(context, { ...teacher, institutionId: s.institutionId });
  await page.goto('/privacy');
  await expect(page.getByText('You don’t have access to the privacy console.')).toBeVisible();
});
