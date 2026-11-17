// Campus Core › Activity Log (rule book §13.12): the owner sees the organisation's log, checks
// the seal, and filters by kind of data. A teacher can't open it.
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

test('activity log: entries, the integrity check, filters, and who may open it', async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  const s = devSession(`Synthetic Activity School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/activity-log');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Activity Log', level: 1 })).toBeVisible();
  await expect(page.getByRole('listitem').first()).toBeVisible();
  await noA11yViolations(page);

  await page.getByRole('button', { name: 'Check the log' }).click();
  await expect(page.getByText(/^Intact:/)).toBeVisible();

  await page.getByLabel('Kind of data').selectOption('restricted');
  await expect(page.getByText('Nothing recorded for these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('listitem').first()).toBeVisible();

  const teacher = await sessionFor('teacher', s.orgId);
  await context.clearCookies();
  await signInAs(context, { ...teacher, institutionId: s.institutionId });
  await page.goto('/activity-log');
  await expect(page.getByText("You don't have access to this")).toBeVisible();
});
