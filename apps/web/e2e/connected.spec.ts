// A connected school (docs/specs/CONNECTED_SCHOOL.md, PAYROLL.md) through the real screens:
// transport set up on its own page (guide, zone fee, crew), the rider's bus on their student
// record, a staff member's salary and the month's payroll prepared with a preview.
import { expect, test } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('transport in one place: guide, zone fee, rider on the student record', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic Connected Transport ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/transport');
  await schoolWithStudents(page, s.institutionId);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Set up transport' })).toBeVisible();
  await expect(page.getByText('0 of 5 done')).toBeVisible();
  await noA11yViolations(page);

  // A stop in zone 2 and a route through it, as the Stops and Routes tabs save them.
  const stop = (await apiPost(page, '/transport/stops', {
    institutionId: s.institutionId,
    name: 'Synthetic Circle',
    fareZone: 2,
    active: true,
  })) as { id: string };
  const route = (await apiPost(page, '/transport/routes', {
    institutionId: s.institutionId,
    name: 'Synthetic Route A',
    direction: 'pickup',
    active: true,
    stops: [{ stopId: stop.id, plannedAt: '07:15' }],
  })) as { id: string };

  // The zone's fee, set on the Transport page's Fees tab.
  await page.reload();
  await page.getByRole('radio', { name: 'Fees' }).click();
  await expect(page.getByText('Zone 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set fee', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Yearly amount (₹)').fill('12000');
  await dialog.getByLabel('Paid in').selectOption('monthly');
  await expect(dialog.getByText('Mar', { exact: true })).toBeVisible();
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Publish fee' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('₹12,000.00 a year')).toBeVisible();

  // A student put on the bus; their record shows it.
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { personId: string }[];
  const student = students[0]!.personId;
  await apiPost(page, '/transport/riders', {
    institutionId: s.institutionId,
    personId: student,
    routeId: route.id,
    stopId: stop.id,
    from: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
  });
  await page.goto(`/students/${student}`);
  // The 360 record's Transport card shows the route and the stop.
  await expect(page.getByText('Synthetic Route A', { exact: true })).toBeVisible();
  await expect(page.getByText(/Synthetic Circle · 07:15/)).toBeVisible();
  await noA11yViolations(page);

  // Register details, edited in a modal on the Personal info tab.
  await page.getByRole('tab', { name: 'Personal info' }).click();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByRole('dialog').getByLabel('Blood group').selectOption('B+');
  await page.getByRole('dialog').getByLabel('Mother tongue').fill('Telugu');
  await page.getByRole('dialog').getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(
    page.getByRole('region', { name: 'Register details' }).getByText('Telugu'),
  ).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/student-connected-${info.project.name}.png`,
    fullPage: true,
  });
});

test('payroll: set a salary, prepare the month with a preview', async ({ page, context }, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic Payroll School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/payroll');
  await schoolWithStudents(page, s.institutionId);
  await page.reload();
  await expect(page.getByText('No payroll yet')).toBeVisible();
  await noA11yViolations(page);

  await page.getByRole('radio', { name: 'Salaries' }).click();
  await page.getByRole('button', { name: 'Set salary' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('From')
    .fill(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 8) + '01');
  await dialog.getByLabel('Basic').fill('20000');
  await dialog.getByLabel('House rent allowance').fill('8000');
  await expect(dialog.getByText('Gross: ₹28,000.00')).toBeVisible();
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Set salary' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/₹28,000.00 gross/)).toBeVisible();

  await page.getByRole('radio', { name: 'Months' }).click();
  await page.getByRole('button', { name: 'Prepare month' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Prepare month' }).click();
  // The preview canvas: who is paid, who has no salary, before anything is saved.
  await expect(page.getByText(/1 payslip, /)).toBeVisible();
  await page.getByRole('button', { name: 'Prepare month' }).last().click();
  await expect(
    page.getByText('You prepared this month, so someone else approves it.'),
  ).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/payroll-${info.project.name}.png`,
    fullPage: true,
  });
});
