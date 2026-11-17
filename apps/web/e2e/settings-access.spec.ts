// Milestone 18: owner-defined fields, roles with a second owner, access by scope, and the name
// of whoever changed a record shown on the record itself.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test('an owner adds a field, builds a role, and gives a teacher access', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === 'phone', 'one full run; screens are checked on phone below');
  test.setTimeout(240_000);
  const owner = devSession('Synthetic Access School');
  await signInAs(context, owner);
  await page.goto('/setup');
  await schoolWithStudents(page, owner.institutionId);

  // A field of the owner's own on the institution.
  await page.goto('/settings/fields');
  await page.getByRole('button', { name: 'Institution' }).click();
  await page.getByRole('button', { name: 'Add a field' }).click();
  await page.getByLabel('Label').fill('Trust registration number');
  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByText('Key: trust_registration_number')).toBeVisible();
  await expect(page.getByText(/Created by Meera Owner Synthetic/).first()).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/settings-fields.png', fullPage: true });

  // It appears on the school profile; saving shows who changed it, and History lists it.
  await page.goto('/settings');
  await page.getByLabel('Trust registration number').fill('TRUST/KA/2001/42');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/Last changed by Meera Owner Synthetic/)).toBeVisible();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('dialog').getByText('updated the profile').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByLabel('Trust registration number')).toHaveValue('TRUST/KA/2001/42');

  // A role with an ordinary and a sensitive permission: the sensitive one waits.
  await page.goto('/settings/roles');
  await page.getByRole('button', { name: 'New role' }).click();
  await page.getByRole('form', { name: 'New role' }).getByLabel('Role name').fill('Accounts clerk');
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts clerk', level: 2 })).toBeVisible();
  await page.getByLabel('See fees and dues').check();
  await page.getByLabel('Approve refunds').check();
  await page.getByRole('button', { name: 'Save permissions' }).click();
  await expect(page.getByText('1 added · 1 sent for approval')).toBeVisible();
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/settings-roles.png', fullPage: true });

  // A new school has one owner, who may confirm alone, typing CONFIRM.
  await page.getByRole('button', { name: 'Confirm alone' }).click();
  const confirm = page.getByRole('button', { name: 'Confirm alone' }).last();
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type CONFIRM to continue').fill('CONFIRM');
  await confirm.click();
  await expect(page.getByText('Waiting for approval')).toHaveCount(0);
  await expect(page.getByLabel('Approve refunds')).toBeChecked();

  // Access for one teacher, at this school only.
  await page.goto('/settings/access');
  await page.getByRole('button', { name: 'Give access' }).click();
  const person = page.getByLabel('Person');
  const teacher = (await person.locator('option').nth(1).textContent())!.split(' · ')[0]!;
  await person.selectOption({ index: 1 });
  await page.getByLabel('Role').selectOption({ label: 'Accounts clerk' });
  await page
    .getByRole('form', { name: 'Give access' })
    .getByRole('button', { name: 'Give access' })
    .click();
  const row = page.getByRole('listitem').filter({ hasText: teacher }).first();
  await expect(row.getByText('Accounts clerk')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/settings-access.png', fullPage: true });

  // The last owner can't be removed.
  const me = page
    .getByRole('listitem')
    .filter({ has: page.getByText('Meera Owner Synthetic', { exact: true }) });
  await me
    .getByRole('listitem')
    .filter({ has: page.getByText('Owner', { exact: true }) })
    .getByRole('button', { name: 'End access' })
    .click();
  await page
    .getByRole('form', { name: 'End access: Owner' })
    .getByRole('button', { name: 'End access' })
    .click();
  await expect(page.getByText('The organisation must keep at least one owner.')).toBeVisible();
});

test('settings screens fit a phone and pass axe', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  test.setTimeout(120_000);
  const owner = devSession('Synthetic Access Phone');
  await signInAs(context, owner);
  for (const path of ['/settings', '/settings/fields', '/settings/roles', '/settings/access']) {
    await page.goto(path);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await noA11yViolations(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, path).toBe(false);
  }
});
