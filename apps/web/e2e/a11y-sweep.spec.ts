// Milestone 17: every top-level school screen, signed in with real data, passes axe (WCAG 2.1 AA)
// and fits a 360 px phone. Detail screens are covered by their own journey specs.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

// Empty states fade in; axe would otherwise judge their colours halfway through the fade.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const SCREENS = [
  '/',
  '/apps',
  '/organisation',
  '/attendance',
  '/attendance/shortage',
  '/students',
  '/staff',
  '/staff-attendance',
  '/staff-leave',
  '/appraisals',
  '/payroll',
  '/homework',
  '/syllabus',
  '/library',
  '/gate',
  '/expenses',
  '/hostel',
  '/helpdesk',
  '/assets',
  '/ask',
  '/subjects',
  '/transport',
  '/timetable',
  '/admissions',
  '/certificates',
  '/exams',
  '/year-end',
  '/fees',
  '/fees/plans',
  '/notices',
  '/notices/new',
  '/setup',
  '/settings',
  '/verify/NOTACODE',
  '/design',
];

test('every school screen passes axe and fits the screen', async ({ page, context }) => {
  test.setTimeout(240_000);
  const owner = devSession('Synthetic Accessibility School');
  await signInAs(context, owner);
  await page.goto('/setup');
  await schoolWithStudents(page, owner.institutionId);
  for (const path of SCREENS) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(page.locator('main, [role="main"]').first()).toBeVisible();
      // The design system page shows a loading state on purpose.
      if (path !== '/design') await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await noA11yViolations(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        `${path} is wider than the screen`,
      ).toBe(true);
    });
  }
});
