// Milestone 19: my profile with a photo, the organisation with its logo, campuses with a gate
// location, adding a school after onboarding, and the school's logo. Files are scanned before
// anyone sees them; the screens wait for that.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, signInAs } from './helpers';

// A valid 1×1 PNG (synthetic; no real photo enters tests).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const image = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

test('an owner sets up profiles, the organisation, a new campus and school', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === 'phone', 'one full run; screens are checked on phone below');
  test.setTimeout(180_000);
  const owner = devSession('Synthetic Profiles School');
  await signInAs(context, owner);

  // My profile: a photo (scanned first), email and language.
  await page.goto('/settings/profile');
  await page.getByLabel('Photo: Upload').setInputFiles(image('me.png'));
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel('Email').fill('meera.owner@synthetic.test');
  await page.getByLabel('Language for messages').selectOption('kn');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Last changed by Meera Owner Synthetic/)).toBeVisible();
  await expect(page.locator('aside img').first()).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/settings-profile.png', fullPage: true });

  // The organisation: details and logo.
  await page.goto('/settings/organisation');
  const identity = page.getByRole('form', { name: 'Identity' });
  await identity.getByLabel('Organisation name').fill('Synthetic Learning Trust');
  await identity.getByLabel('Phone').fill('80 4000 0000');
  await identity.getByRole('button', { name: 'Save changes' }).click();
  await expect(identity.getByText(/Last changed by Meera Owner Synthetic/)).toBeVisible();
  await page.getByLabel('Logo: Upload').setInputFiles(image('logo.png'));
  await expect(identity.getByRole('status').filter({ hasText: 'Saved.' }).first()).toBeVisible({
    timeout: 30_000,
  });

  // A new campus with its gate location, then a school on it.
  await page.getByRole('button', { name: 'Add a campus' }).click();
  const fresh = page.getByRole('form', { name: 'Add a campus' });
  await fresh.getByLabel('Campus name').fill('Synthetic North Campus');
  await fresh.getByLabel('City or town').fill('Mysuru');
  await fresh.getByLabel('Latitude').fill('12.295810');
  await fresh.getByLabel('Longitude').fill('76.639381');
  await fresh.getByRole('button', { name: 'Add a campus' }).click();
  await expect(fresh).toBeHidden();
  const north = page.getByRole('region', { name: 'Synthetic North Campus' });
  await expect(north).toBeVisible();
  await expect(north.getByText(/12\.295810, 76\.639381/)).toBeVisible();
  await north.getByRole('button', { name: 'Add an institution: Synthetic North Campus' }).click();
  const school = page.getByRole('form', { name: 'Add an institution' });
  await school.getByLabel('Name', { exact: true }).fill('Synthetic North School');
  await school.getByRole('button', { name: 'Add an institution' }).click();
  await expect(school).toBeHidden();
  await expect(north.getByText('Synthetic North School')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/settings-organisation.png', fullPage: true });

  // The new school appears in the scope switcher.
  await page.getByRole('button', { name: /^Working in/ }).click();
  await expect(page.getByRole('menuitemradio', { name: /Synthetic North School/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // The school's logo, on the School tab.
  await page.goto('/settings');
  await page.getByLabel('School logo: Upload').setInputFiles(image('school.png'));
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' }).first()).toBeVisible({
    timeout: 30_000,
  });
  await noA11yViolations(page);
});

test('profile and organisation fit a phone and pass axe', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  test.setTimeout(120_000);
  const owner = devSession('Synthetic Profiles Phone');
  await signInAs(context, owner);
  for (const path of ['/settings/profile', '/settings/organisation']) {
    await page.goto(path);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await noA11yViolations(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, path).toBe(false);
  }
});
