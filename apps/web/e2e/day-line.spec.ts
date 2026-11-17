import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const STATES = ['ready', 'loading', 'empty', 'error', 'offline', 'denied'] as const;

async function noA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`),
  ).toEqual([]);
}

test.describe('principal Day Line', () => {
  for (const state of STATES) {
    test(`${state} state passes WCAG 2.1 AA checks`, async ({ page }) => {
      await page.goto(`/?state=${state}&at=10:05`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await noA11yViolations(page);
    });
  }

  test('shows the day, the now line and what needs attention', async ({ page }) => {
    await page.goto('/?at=10:05');
    await expect(page.getByText('Now 10:05')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
    await expect(page.getByText("4 sections haven't marked attendance")).toBeVisible();
    // Screen readers get the day as an ordered list.
    await expect(
      page.getByRole('list', { name: 'Today, in order' }).getByRole('listitem'),
    ).toHaveCount(14);
  });

  test('the remind action opens the Preview Canvas with the same words, and confirms', async ({
    page,
  }) => {
    await page.goto('/?at=10:05');
    await page.getByRole('button', { name: 'Remind 4 teachers' }).click();
    const canvas = page.getByRole('dialog', { name: 'Remind class teachers to mark attendance' });
    await expect(canvas.getByRole('heading', { name: 'What could go wrong' })).toBeVisible();
    await noA11yViolations(page);
    await canvas.getByRole('button', { name: 'Remind 4 teachers' }).click();
    await expect(page.getByText('Reminders queued for 4 teachers')).toBeVisible();
  });

  test('error state retries', async ({ page }) => {
    await page.goto('/?state=error&at=10:05');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  });

  test('no sideways page scroll; only the Day Line band scrolls', async ({ page }) => {
    // Compare with the configured viewport: mobile emulation widens innerWidth to fit overflow.
    const width = page.viewportSize()!.width;
    for (const path of ['/?at=10:05', '/design']) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
  });

  test('screenshot for review', async ({ page }, info) => {
    await page.goto('/?at=10:05');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `e2e/screenshots/day-line-${info.project.name}.png`,
      fullPage: true,
    });
  });
});

test.describe('keyboard', () => {
  test('Ctrl K opens the Verse Bar, finds a student and opens the record', async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'phone', 'keyboard shortcut is a desktop feature');
    await page.goto('/?at=10:05');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.keyboard.type('Dev');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Dev Synthetic' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Ask goes to Verse AI and is labelled AI', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'keyboard shortcut is a desktop feature');
    await page.goto('/?at=10:05');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('which classes are unmarked');
    await page.getByRole('option', { name: /Ask Verse AI/ }).click();
    await expect(page.getByText('AI', { exact: true })).toBeVisible();
    await expect(page.getByText('Sign in to ask Verse AI about your school.')).toBeVisible();
  });

  test('a keyboard user reaches the main action without a mouse', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'desktop keyboard pass');
    await page.goto('/?at=10:05');
    // Past the skip link, the systems and their modules in the sidebar, and the header.
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const name = await page.evaluate(() => document.activeElement?.textContent ?? '');
      if (name.includes('Remind 4 teachers')) return;
    }
    throw new Error('Remind 4 teachers was not reachable by Tab');
  });
});

test.describe('design system page', () => {
  test('passes WCAG 2.1 AA checks', async ({ page }) => {
    await page.goto('/design');
    await noA11yViolations(page);
  });

  test('marks grid: type, move, flag errors, keep blanks blank', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'desktop grid entry');
    await page.goto('/design');
    const grid = page.getByRole('grid', { name: 'Unit test 1 marks, Class 5-A' });
    await grid.getByRole('gridcell', { name: '34' }).click();
    await page.keyboard.type('45'); // over the maximum of 40
    await page.keyboard.press('Enter');
    await expect(grid.locator('[aria-invalid="true"]')).toHaveCount(3); // 41, "ten", and 45
    await expect(page.getByText('3 to fix')).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Delete');
    await expect(page.getByText('2 to fix')).toBeVisible();
    await expect(page.getByText(/Saved \d\d:\d\d/)).toBeVisible();
  });

  test('screenshot for review', async ({ page }, info) => {
    await page.goto('/design');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `e2e/screenshots/design-${info.project.name}.png`,
      fullPage: true,
    });
  });
});
