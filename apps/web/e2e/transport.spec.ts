// Transport through the real screens: a vehicle and its papers, two stops, a route, then riders
// added one by one and imported from a sheet (preview, then commit), then today's trip run by
// the attendant: marks, the empty-bus check, end.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test('transport: vehicle, papers, stops, route, riders, a trip', async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  const s = devSession(`Synthetic Transport School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/transport');
  await schoolWithStudents(page, s.institutionId);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Transport' })).toBeVisible();
  await expect(page.getByText('No buses run today')).toBeVisible();
  await page.getByRole('radio', { name: /Students/ }).click();
  await expect(page.getByText('No students use the bus yet')).toBeVisible();
  await page.getByRole('radio', { name: /Vehicles/ }).click();
  await expect(page.getByText('No vehicles yet')).toBeVisible();
  await noA11yViolations(page);

  // A van: it can't run until fitness, insurance and permit are recorded.
  await page.getByRole('button', { name: 'Add a vehicle' }).click();
  const form = page.getByRole('form', { name: 'Add a vehicle' });
  await form.getByLabel('Registration number').fill('ts 08 ef 5678');
  await form.getByLabel('Type').selectOption('van');
  await form.getByLabel('Seats').fill('14');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('TS08EF5678')).toBeVisible();
  await expect(page.getByText(/Can’t run: fitness, insurance, permit/)).toBeVisible();
  for (const kind of ['Fitness', 'Insurance', 'Permit']) {
    await page.getByRole('button', { name: 'Record a document' }).click();
    const doc = page.getByRole('form', { name: 'Record a document: TS08EF5678' });
    await doc.getByLabel('Document').selectOption({ label: kind });
    await doc.getByLabel('Valid until').fill('2099-03-31');
    await doc.getByRole('button', { name: 'Save' }).click();
    await expect(doc).toBeHidden();
  }
  await expect(page.getByText('Papers in order')).toBeVisible();

  // Two stops.
  await page.getByRole('radio', { name: /Stops/ }).click();
  for (const name of ['Gandhi Nagar', 'Bus Stand']) {
    await page.getByRole('button', { name: 'Add a stop' }).click();
    const stop = page.getByRole('form', { name: 'Add a stop' });
    await stop.getByLabel('Stop name').fill(name);
    await stop.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(name)).toBeVisible();
  }

  // A morning route through them, in time order; its afternoon drop is made with it.
  await page.getByRole('radio', { name: /Routes/ }).click();
  await page.getByRole('button', { name: 'Add a route' }).click();
  const route = page.getByRole('form', { name: 'Add a route' });
  await route.getByLabel('Route name').fill('Route 3');
  await route
    .getByRole('combobox', { name: 'Bus', exact: true })
    .selectOption({ label: 'TS08EF5678 · 14 seats' });
  await route.getByLabel('Add a stop to the route').selectOption({ label: 'Gandhi Nagar' });
  await route.getByLabel('Time: Gandhi Nagar').fill('07:10');
  await route.getByLabel('Add a stop to the route').selectOption({ label: 'Bus Stand' });
  await route.getByLabel('Time: Bus Stand').fill('07:25');
  await route.getByLabel('Bus leaves school at').fill('15:30');
  await route.getByRole('button', { name: 'Save' }).click();
  await expect(route).toBeHidden();
  // Two routes now: the morning pickup, and the afternoon drop the other way round.
  await expect(page.getByText('Route 3', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Afternoon drop', { exact: true })).toHaveCount(1);
  await expect(page.getByText(/15:30\s*Bus Stand/)).toBeVisible();
  await expect(page.getByText(/15:45\s*Gandhi Nagar/)).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/transport-routes-${info.project.name}.png`,
    fullPage: true,
  });
  await noA11yViolations(page);

  // Riders: one added by hand, one imported by admission number.
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { name: string; reference: string }[];
  const [first, second] = students;
  await page.getByRole('radio', { name: /Students/ }).click();
  await page.getByRole('button', { name: 'Add a student to the bus' }).click();
  const add = page.getByRole('form', { name: 'Add a student to the bus' });
  await add.getByLabel('Find a student by name or admission no.').fill(first!.reference);
  await add.getByRole('button', { name: new RegExp(first!.name) }).click();
  // Both ways by default: choosing the morning bus fills in the afternoon one at the same stop.
  const morning = add.getByRole('group', { name: /Morning pickup/ });
  const afternoon = add.getByRole('group', { name: /Afternoon drop/ });
  await morning.getByLabel('Route').selectOption({ label: 'Route 3' });
  await morning.getByLabel('Stop').selectOption({ label: '07:10 · Gandhi Nagar' });
  await expect(afternoon.getByLabel('Route')).toHaveValue(/.+/);
  await expect(afternoon.getByLabel('Stop')).toHaveValue(/.+/);
  await noA11yViolations(page);
  await page.screenshot({ path: `e2e/screenshots/transport-add-student-${info.project.name}.png` });
  await add.getByRole('button', { name: 'Add a student to the bus' }).click();
  await expect(add).toBeHidden();
  const row = page.getByRole('listitem').filter({ hasText: first!.name });
  await expect(row).toContainText('Gandhi Nagar');
  await expect(row.getByRole('button', { name: /Take off this trip/ })).toHaveCount(2);

  await page.getByRole('button', { name: 'Import from a sheet' }).click();
  const sheet = page.getByRole('form', { name: 'Import from a sheet' });
  await sheet
    .getByLabel('Rows')
    .fill(
      `Admission no.,Route,Direction,Stop\n${second!.reference},Route 3,pickup,Bus Stand\nNOPE-1,Route 3,pickup,Bus Stand`,
    );
  await sheet.getByRole('button', { name: 'Preview' }).click();
  const canvas = page.getByRole('dialog', { name: 'Import from a sheet' });
  await expect(canvas.getByText(/Row 2 \(NOPE-1\): no student/)).toBeVisible();
  await noA11yViolations(page);
  await canvas.getByRole('button', { name: 'Add 1 trip' }).click();
  await expect(canvas).toBeHidden();
  await expect(page.getByText(second!.name)).toBeVisible();
  await expect(page.getByText('2 students').first()).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/transport-students-${info.project.name}.png`,
    fullPage: true,
  });
  await noA11yViolations(page);

  // Today's trip: the attendant starts it, marks each child, and ends it with the empty-bus check.
  await page.getByRole('radio', { name: /Today/ }).click();
  await expect(page.getByText('2 students')).toBeVisible();
  await expect(page.getByText('1 student', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start trip: Route 3 · Morning pickup' }).click();
  await expect(page.getByRole('heading', { name: 'Route 3' })).toBeVisible();
  await expect(page.getByText(/Running since/)).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole('button', { name: `Boarded: ${first!.name}` }).click();
  await page.getByRole('button', { name: `Didn’t come: ${second!.name}` }).click();
  await expect(page.getByRole('button', { name: 'Hand 1 on board to school' })).toBeVisible();

  // "Empty" is refused while a child is still marked on board.
  await page.getByRole('button', { name: 'End trip' }).click();
  let check = page.getByRole('form', { name: 'End trip: empty-bus check' });
  await check.getByLabel('I walked the bus. It is empty.').check();
  await noA11yViolations(page);
  await check.getByRole('button', { name: 'End trip' }).click();
  await expect(check.getByText(/still marked on board/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(check).toBeHidden();

  await page.getByRole('button', { name: 'Hand 1 on board to school' }).click();
  await expect(page.getByRole('button', { name: /Hand \d on board/ })).toBeHidden();
  await page.getByRole('button', { name: 'End trip' }).click();
  check = page.getByRole('form', { name: 'End trip: empty-bus check' });
  await check.getByLabel('I walked the bus. It is empty.').check();
  await check.getByRole('button', { name: 'End trip' }).click();
  await expect(check).toBeHidden();
  await expect(page.getByText(/Ended .* · bus empty/)).toBeVisible();
  await noA11yViolations(page);

  // Reports: the day's boarding log, downloadable (and logged); papers are in order.
  await page.goto('/transport');
  await page.getByRole('radio', { name: /Reports/ }).click();
  const log = page.getByRole('region', { name: 'Boarding log' });
  await expect(log.getByText(first!.name)).toHaveCount(2); // boarded, then handed to school
  await expect(page.getByText(/Route 3 · Morning pickup · \d\d:\d\d to \d\d:\d\d/)).toBeVisible();
  await expect(
    page.getByText('Every vehicle’s papers are in order for the next 30 days.'),
  ).toBeVisible();
  await noA11yViolations(page);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download' }).first().click(),
  ]);
  expect(file.suggestedFilename()).toMatch(/^boarding-log-\d{4}-\d{2}-\d{2}\.csv$/);

  // Today: the bus on the Transport lane of the Day Line.
  await page.goto('/');
  await expect(
    page.getByText('Transport', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('Route 3').filter({ visible: true }).first()).toBeVisible();
  await noA11yViolations(page);
});
