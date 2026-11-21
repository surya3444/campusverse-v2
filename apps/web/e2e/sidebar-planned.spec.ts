// Every rule-book module has a sidebar row (§13.1); a planned one opens its "not built yet" page.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, signInAs } from './helpers';

test('planned modules show in the sidebar and open their page', async ({ page, context }, info) => {
  await signInAs(context, devSession(`Synthetic Sidebar School ${info.project.name}`));
  await page.goto('/apps');
  if (info.project.name === 'phone')
    await page.getByRole('button', { name: /menu/i }).first().click();
  const nav = page.getByRole('navigation').filter({ hasText: 'Clubs & Events' }).first();
  await nav.getByRole('link', { name: 'Clubs & Events' }).click();
  await expect(page.getByRole('heading', { name: 'Clubs & Events' })).toBeVisible();
  await expect(page.getByText('Not built yet')).toBeVisible();
  await noA11yViolations(page);
});
