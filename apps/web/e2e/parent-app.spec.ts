// Milestone 10 through the real screens: the school writes, approves and sends notices on the web;
// a parent reads and acknowledges one in the Expo app (its web build, phone-sized); the school sees
// each guardian's state on every channel. Also: languages, leave, and the teacher's offline queue.
import { expect, test } from '@playwright/test';
import {
  APP,
  apiPost,
  devSession,
  noA11yViolations,
  openApp,
  schoolWithStudents,
  sessionFor,
  signInAs,
} from './helpers';

test('notices reach parents, and the school sees every channel', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(info.project.name === 'phone', 'the app side already runs at phone width');
  test.setTimeout(240_000);
  const owner = devSession('Synthetic Notices School');
  await signInAs(context, owner);
  await page.goto('/notices');
  await schoolWithStudents(page, owner.institutionId);
  await apiPost(page, `/school/setup/${owner.institutionId}/invites`);
  const parent = await sessionFor('guardian', owner.orgId);

  // The parent's phone has the app installed: its push token is registered.
  const app = await openApp(browser, parent);
  await expect(
    app.getByText(/attendance isn't marked yet today/).filter({ visible: true }),
  ).toBeVisible({ timeout: 30_000 });
  await app.evaluate(async (s) => {
    await fetch('/api/v1/parent/push-token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${s.accessToken}`,
        'x-org-id': s.orgId,
        'x-person-id': s.personId,
      },
      body: JSON.stringify({ token: 'ExponentPushToken[synthetic-e2e-token]' }),
    });
  }, parent);

  // A normal notice: approval, then a 2-minute undo window, and cancelling inside it.
  await page.goto('/notices/new');
  await page.getByLabel('Title').fill('Parent-teacher meeting');
  await page.getByLabel('Message').fill('Meeting on Saturday at 10.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('button', { name: 'Preview and send' }).click();
  const canvas = page.getByRole('dialog');
  await expect(canvas.getByText('Guardians reading English')).toBeVisible();
  await canvas.getByRole('button', { name: /^Send to \d+ guardians?$/ }).click();
  await expect(page.getByText(/Sending in 1:5\d\. You can still cancel\./)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel notice' }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();

  // An urgent message that asks for acknowledgement goes at once.
  await page.goto('/notices/new');
  await page.getByRole('radio', { name: /Urgent/ }).check();
  await page.getByLabel('Ask parents to acknowledge').check();
  await page.getByLabel('Title').fill('School closed today');
  await page.getByLabel('Message').fill('Heavy rain: the school is closed today.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: 'Preview and send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const noticeUrl = page.url();

  // On the parent's phone: the message, opened (read on the app channel), then acknowledged.
  await app.reload();
  const message = app.getByRole('link', { name: /School closed today/ });
  await expect(message).toBeVisible({ timeout: 30_000 });
  await noA11yViolations(app);
  await app.screenshot({ path: 'e2e/screenshots/parent-home.png', fullPage: true });
  await message.click();
  await expect(
    app.getByText('Heavy rain: the school is closed today.').filter({ visible: true }),
  ).toBeVisible();
  await app.getByRole('button', { name: 'Acknowledge' }).filter({ visible: true }).click();
  await expect(
    app.getByText('Acknowledged', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await app.screenshot({ path: 'e2e/screenshots/parent-message.png', fullPage: true });

  // The school sees it: acknowledged, and the app channel read.
  await page.goto(noticeUrl);
  const row = page.getByRole('row').filter({ hasText: 'Acknowledged' });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(row.getByText(/App read/)).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/notice-tracking.png', fullPage: true });

  // Languages: Kannada, and Urdu right to left.
  await app.getByRole('button', { name: 'Back' }).filter({ visible: true }).click();
  await app.getByText('Settings', { exact: true }).filter({ visible: true }).click();
  await app.getByRole('radio', { name: 'ಕನ್ನಡ' }).filter({ visible: true }).click();
  await expect(app.getByText('ಭಾಷೆ').filter({ visible: true })).toBeVisible();
  await app.getByRole('radio', { name: 'اردو' }).filter({ visible: true }).click();
  await expect(app.locator('html')).toHaveAttribute('dir', 'rtl');
  await app.screenshot({ path: 'e2e/screenshots/parent-settings-urdu.png', fullPage: true });
  await app.getByRole('radio', { name: 'English' }).filter({ visible: true }).click();

  // Leave from the app reaches the class teacher's list.
  await app.goto(APP);
  await app
    .getByRole('button', { name: 'Apply for leave' })
    .filter({ visible: true })
    .first()
    .click();
  await app.getByLabel('Reason').filter({ visible: true }).fill('Family function');
  await app.getByRole('button', { name: 'Send request' }).filter({ visible: true }).click();
  await expect(
    app.getByText('Your request was sent to the class teacher.').filter({ visible: true }),
  ).toBeVisible();
  await page.goto('/attendance');
  await expect(page.getByText(/Family function/)).toBeVisible();
});

test('a teacher marks attendance in the app offline, and it syncs once back online', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(info.project.name === 'phone', 'the app side already runs at phone width');
  test.setTimeout(240_000);
  const owner = devSession('Synthetic App Attendance School');
  await signInAs(context, owner);
  await page.goto('/attendance');
  await schoolWithStudents(page, owner.institutionId);
  await apiPost(page, `/school/setup/${owner.institutionId}/invites`);
  const teacher = await sessionFor('teacher', owner.orgId);

  const app = await openApp(browser, teacher);
  await app
    .getByRole('button', { name: /Mark attendance: Class 3-A/ })
    .filter({ visible: true })
    .click({ timeout: 30_000 });
  await app.getByRole('checkbox').filter({ visible: true }).first().click();
  await app.context().setOffline(true);
  await app.getByRole('button', { name: 'Submit · 1 absent' }).filter({ visible: true }).click();
  await expect(app.getByText(/Saved on this phone/).filter({ visible: true })).toBeVisible();
  await expect(app.getByText('1 waiting to send').filter({ visible: true })).toBeVisible();
  await app.screenshot({ path: 'e2e/screenshots/teacher-app-offline.png', fullPage: true });

  await app.context().setOffline(false);
  await expect(app.getByText('1 waiting to send').filter({ visible: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  const day = (await (
    await page.request.get(`/api/v1/school/attendance/${owner.institutionId}/day`)
  ).json()) as {
    sections: { state: string; absent: number }[];
  };
  expect(day.sections[0]).toMatchObject({ state: 'submitted', absent: 1 });
});

test("the parent sees their child's bus and can say not today", async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(info.project.name === 'phone', 'the app side already runs at phone width');
  test.setTimeout(240_000);
  const owner = devSession('Synthetic Bus Parents School');
  await signInAs(context, owner);
  await page.goto('/transport');
  await schoolWithStudents(page, owner.institutionId);
  await apiPost(page, `/school/setup/${owner.institutionId}/invites`);
  const parent = await sessionFor('guardian', owner.orgId);

  // Their child, as the API tells the parent; then the school puts the child on a bus.
  const home = (await (
    await page.request.get('http://localhost:4000/api/v1/parent/home', {
      headers: {
        authorization: `Bearer ${parent.accessToken}`,
        'x-org-id': parent.orgId,
        'x-person-id': parent.personId,
      },
    })
  ).json()) as { children: { personId: string; name: string }[] };
  const child = home.children[0]!;
  const institutionId = owner.institutionId;
  const { id: stopId } = await apiPost(page, '/transport/stops', {
    institutionId,
    name: 'Clock Tower',
    active: true,
  });
  const { id: routeId } = await apiPost(page, '/transport/routes', {
    institutionId,
    name: 'Route 7',
    direction: 'pickup',
    active: true,
    stops: [{ stopId, plannedAt: '07:20' }],
  });
  await apiPost(page, '/transport/riders', {
    institutionId,
    personId: child.personId,
    routeId,
    stopId,
    from: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()),
  });

  const app = await openApp(browser, parent);
  const first = child.name.split(' ')[0]!;
  const visible = (text: string | RegExp) => app.getByText(text).filter({ visible: true });
  await expect(visible(`${first}'s bus comes to Clock Tower at about 7:20 am.`)).toBeVisible({
    timeout: 30_000,
  });
  await app
    .getByRole('button', { name: 'Not taking the bus today' })
    .filter({ visible: true })
    .click();
  await expect(visible(`You told the school ${first} isn't taking the bus today.`)).toBeVisible();

  // The attendant sees it on the stop's list.
  const sheet = (await (
    await page.request.get(
      `/api/v1/transport/trips/sheet?institutionId=${institutionId}&routeId=${routeId}`,
    )
  ).json()) as { stops: { riders: { skipping: boolean }[] }[] };
  expect(sheet.stops[0]?.riders[0]?.skipping).toBe(true);

  await app.getByRole('button', { name: 'Undo' }).filter({ visible: true }).click();
  await expect(visible(/bus comes to Clock Tower/)).toBeVisible();
  await noA11yViolations(app);
});
