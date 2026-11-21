// The public landing page: shown at / to anyone not signed in, with sign-up and sign-in a click
// away. Desktop and phone; nothing wider than the screen; no axe violations.
import { expect, test } from '@playwright/test';
import { noA11yViolations } from './helpers';

test('visitors land on the product page and can start or sign in', async ({ page }, info) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'One Platform. Every Campus. Infinite Possibilities.',
    }),
  ).toBeVisible();
  // The real product, not a drawing of it.
  await expect(page.getByRole('img', { name: /Campusverse’s Today screen/ })).toBeVisible();
  for (const name of [
    /modules that share one brain\./,
    /Everything a campus runs on/,
    'One plan. Full platform. No negotiations.',
    'Student data deserves more than a checkbox.',
  ])
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  // What isn't built yet says so.
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Career Connect' }).first(),
  ).toContainText('Coming next');

  // The role tabs change what's shown.
  await page.getByRole('radio', { name: 'Parent' }).click();
  await expect(page.getByRole('region', { name: 'Parent' })).toContainText('Fees with receipts');

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/landing-${info.project.name}.png`,
    fullPage: true,
  });

  await page.getByRole('main').getByRole('link', { name: 'Create your account' }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
});

test('the design review of the home screen stays reachable', async ({ page }) => {
  await page.goto('/?at=10:05');
  await expect(page.getByRole('heading', { level: 1, name: /One Platform/ })).toHaveCount(0);
});

test('every system and module has its own docs page, linked from the landing page', async ({
  page,
}, info) => {
  const fits = async () =>
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
    ).toBe(false);
  await page.goto('/');
  await page.locator('#modules').getByRole('link', { name: 'Timetable', exact: true }).click();

  // A live module, docs style: facts, capabilities, steps, rules.
  await expect(page).toHaveURL(/\/product\/academics\/timetable$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Timetable' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'What you can do' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Rules it keeps for you' }),
  ).toBeVisible();
  // The sidebar lists every system and marks this page.
  await expect(
    page.locator('nav[aria-label="Platform"] a[aria-current="page"]').first(),
  ).toHaveText('Timetable');
  await fits();
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/module-page-${info.project.name}.png`,
    fullPage: true,
  });

  // Its system, from the breadcrumb.
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Academics' })
    .click();
  await expect(page).toHaveURL(/\/product\/academics$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Modules inside' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Exams & Results/ }).first()).toBeVisible();
  await fits();
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/system-page-${info.project.name}.png`,
    fullPage: true,
  });

  // A module that isn't built yet says so.
  await page.goto('/product/career/placements');
  await expect(page.getByRole('heading', { level: 2, name: 'What it will do' })).toBeVisible();
  await noA11yViolations(page);

  // The docs home.
  await page.goto('/product');
  await expect(page.getByRole('main').getByRole('link', { name: /Health Connect/ })).toBeVisible();
  await fits();
  await noA11yViolations(page);
});
