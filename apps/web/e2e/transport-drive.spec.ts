// The driver's screen with a simulated phone location: choose the bus, start the trip, share
// the position, raise an SOS; the in-charge sees where the bus is and the SOS on Today.
import { expect, test } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test('drive: start, share location, SOS', async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const s = devSession(`Synthetic Drive School ${info.project.name}`);
  await signInAs(context, s);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 17.385, longitude: 78.4867, accuracy: 10 });
  await page.goto('/transport');
  await schoolWithStudents(page, s.institutionId);

  // A bus with its papers, one stop, a route, one rider: through the API the screens use.
  const institutionId = s.institutionId;
  const { id: vehicleId } = await apiPost(page, '/transport/vehicles', {
    institutionId,
    registration: 'TS10GH9012',
    kind: 'bus',
    seats: 40,
    ownedBy: 'school',
    active: true,
  });
  for (const kind of ['fitness', 'insurance', 'permit'])
    await apiPost(page, `/transport/vehicles/${vehicleId}/documents`, {
      institutionId,
      kind,
      validUntil: '2099-03-31',
    });
  const { id: stopId } = await apiPost(page, '/transport/stops', {
    institutionId,
    name: 'Clock Tower',
    active: true,
  });
  const { id: routeId } = await apiPost(page, '/transport/routes', {
    institutionId,
    name: 'Route 5',
    direction: 'pickup',
    vehicleId,
    active: true,
    stops: [{ stopId, plannedAt: '07:20' }],
  });
  const [student] = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${institutionId}`)
  ).json()) as { personId: string }[];
  await apiPost(page, '/transport/riders', {
    institutionId,
    personId: student!.personId,
    routeId,
    stopId,
    from: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()),
  });

  await page.goto('/transport/drive');
  await expect(page.getByRole('heading', { name: 'Drive' })).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole('button', { name: /Route 5/ }).click();
  await page.getByRole('button', { name: 'Start trip' }).click();
  await expect(page.getByText('Sharing the bus’s location')).toBeVisible();
  await noA11yViolations(page);

  await page.getByRole('button', { name: 'SOS' }).click();
  const sos = page.getByRole('form', { name: 'Send an SOS' });
  await sos.getByLabel('What happened (optional)').fill('Tyre burst near the flyover');
  await sos.getByRole('button', { name: 'Send SOS' }).click();
  await expect(sos).toBeHidden();
  await expect(page.getByText(/SOS at/)).toBeVisible();

  // The first batch goes after 30 seconds; then the in-charge sees the bus on Today.
  await expect(page.getByText(/Last sent/)).toBeVisible({ timeout: 45_000 });
  await page.goto('/transport');
  await expect(page.getByText(/SOS at/)).toBeVisible();
  await expect(page.getByText(/Bus seen/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Where is Route 5? Opens OpenStreetMap' }),
  ).toHaveAttribute('href', /mlat=17\.385&mlon=78\.4867/);
});
