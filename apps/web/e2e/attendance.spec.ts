// Teacher attendance through the real screens, at desktop and phone width: mark offline, see
// the pending count, reconnect, and the submission is accepted once (the milestone exit check).
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test('attendance: marked offline, synced once after reconnecting', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  const s = devSession('Synthetic Attendance School');
  await signInAs(context, s);
  await page.goto('/attendance');
  await schoolWithStudents(page, s.institutionId);
  await page.reload();

  // The day: one section, not yet marked.
  await expect(page.getByRole('heading', { name: 'Attendance', level: 1 })).toBeVisible();
  const row = page.getByRole('row', { name: /Class 3-A/ });
  await expect(row.getByText('Not marked')).toBeVisible();
  // Nothing is wider than the screen: tables scroll inside their panel, not the page.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/attendance-day-${info.project.name}.png`,
    fullPage: true,
  });

  // The roster: everyone starts present; tap one student to mark them absent.
  await row
    .getByRole('link', { name: 'View' })
    .or(row.getByRole('link', { name: 'Mark attendance' }))
    .click();
  const roster = page.getByRole('region', { name: 'Mark attendance' }).getByRole('listitem');
  const tiles = roster.getByRole('button');
  await expect(page.getByText('Everyone starts present.', { exact: false })).toBeVisible();
  await expect(tiles).toHaveCount(6);
  await tiles.first().click();
  await expect(roster.getByRole('button', { pressed: true })).toHaveCount(1);
  await expect(page.getByText('5 present · 1 absent')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/attendance-mark-${info.project.name}.png`,
    fullPage: true,
  });

  // The connection drops; the submission waits on this device with a pending count.
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Submit · 1 absent' }).click();
  await expect(
    page.getByText(/Class 3-A, .* saved on this device\. It will be sent/),
  ).toBeVisible();
  await expect(page.getByText(/You're offline\. 1 submission is saved/)).toBeVisible();

  // Back online: it is sent by itself, and the day shows as submitted.
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/v1/sync/events'));
  await context.setOffline(false);
  const request = await sent;
  await expect(page.getByText(/Class 3-A submitted: 5 present, 1 absent/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/waiting to send|saved on this device/)).toHaveCount(0);

  // The device resends the same event (it never heard the answer): accepted once, not twice.
  const again = await page.request.post('/api/v1/sync/events', {
    headers: { 'x-requested-with': 'campusverse', 'content-type': 'application/json' },
    data: request.postData() ?? '',
  });
  expect(((await again.json()) as { results: { outcome: string }[] }).results[0]?.outcome).toBe(
    'duplicate',
  );
  const day = (await (
    await page.request.get(`/api/v1/school/attendance/${s.institutionId}/day`)
  ).json()) as {
    sections: { state: string; absent: number; students: number }[];
  };
  expect(day.sections[0]).toMatchObject({ state: 'submitted', absent: 1, students: 6 });
  await page.screenshot({
    path: `e2e/screenshots/attendance-done-${info.project.name}.png`,
    fullPage: true,
  });

  // A correction needs a reason; the register shows the month.
  await page
    .getByRole('button', { name: /^Correct: / })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Save correction' })).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Arrived during first period');
  await dialog.getByLabel('New status').selectOption('late');
  await dialog.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText('Late', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Register' }).click();
  await expect(page.getByRole('heading', { name: 'Class 3-A register' })).toBeVisible();
  await noA11yViolations(page);
});
