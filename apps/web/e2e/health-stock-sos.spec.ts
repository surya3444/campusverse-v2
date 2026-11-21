// Health Connect › Medicines & Stock and Emergency through the real screens (rule book §13.9,
// §16.5): the nurse keeps the health room's medicines; the principal keeps the emergency numbers
// and closes incidents; a teacher raises an SOS and sees the life-saving card and who to call.
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

const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

test('health: medicines by batch, emergency numbers, SOS and closing the incident', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic SOS School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/health');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { personId: string; name: string }[];
  const child = students[0]!;

  // The owner keeps the emergency numbers.
  await page.goto('/health?tab=emergencies');
  await page.getByRole('button', { name: 'Add a number' }).click();
  const form = page.getByRole('dialog', { name: 'Add a number' });
  await form.getByLabel('Name').fill('Synthetic City Hospital');
  await form.getByLabel('Phone').fill('0000 000 112');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Synthetic City Hospital')).toBeVisible();
  await noA11yViolations(page);

  // The nurse: a record for the child, then a medicine received and given.
  const nurse = await sessionFor('nurse', s.orgId);
  await context.clearCookies();
  await signInAs(context, { ...nurse, institutionId: s.institutionId });
  await page.goto('/health');
  const put = await page.request.put(`/api/v1/health/students/${child.personId}`, {
    headers: { 'x-requested-with': 'campusverse' },
    data: {
      institutionId: s.institutionId,
      vault: { bloodGroup: 'A+', allergies: 'Bee stings', responderNotes: 'EpiPen in the office.' },
    },
  });
  expect(put.ok()).toBe(true);
  await page.goto('/health?tab=medicines');
  await expect(page.getByText('No medicines yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add medicine' }).click();
  const add = page.getByRole('dialog', { name: 'Add medicine' });
  await add.getByLabel('Medicine and strength').fill('Paracetamol 500 mg');
  await add.getByLabel('Unit').fill('tablet');
  await add.getByLabel('Reorder at').fill('5');
  await add.getByRole('button', { name: 'Save medicine' }).click();
  await page.getByRole('button', { name: /Paracetamol 500 mg/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Paracetamol 500 mg' });
  await drawer.getByRole('button', { name: 'Receive batch' }).click();
  const receive = page.getByRole('dialog', { name: 'Receive batch' });
  await receive.getByLabel('Quantity').fill('20');
  await receive.getByLabel('Expires on').fill(inDays(200));
  await receive.getByRole('button', { name: 'Receive batch' }).click();
  await expect(drawer.getByText('Received ·')).toBeVisible();
  await drawer.getByRole('button', { name: 'Give a dose' }).click();
  const give = page.getByRole('dialog', { name: 'Give a dose' });
  await give.getByLabel('Quantity').fill('2');
  await give.getByRole('button', { name: 'Give a dose' }).click();
  await expect(drawer.getByText('Given ·')).toBeVisible();
  await expect(drawer.getByText('18 tablet')).toBeVisible();
  await noA11yViolations(page);
  await page.keyboard.press('Escape');

  // A teacher raises an SOS naming the child.
  const teacher = await sessionFor('teacher', s.orgId);
  await context.clearCookies();
  await signInAs(context, { ...teacher, institutionId: s.institutionId });
  await page.goto('/emergency');
  await expect(page.getByRole('heading', { name: 'Raise SOS', level: 1 })).toBeVisible();
  await page.getByRole('radio', { name: 'Injury' }).click();
  await page.getByLabel('Where').fill('Playground, near the gate');
  await page.getByLabel('Student involved (optional)').fill(child.name.split(' ')[0]!);
  await page.getByRole('button', { name: child.name }).first().click();
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'Raise SOS now' }).click();
  await expect(
    page.getByText('SOS raised. Leaders and the nurse have been alerted.').first(),
  ).toBeVisible();
  await expect(page.getByText('Bee stings')).toBeVisible();
  await expect(page.getByRole('link', { name: /0000 000 112/ })).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: `e2e/screenshots/sos-${info.project.name}.png`, fullPage: true });

  // The owner closes the incident with a report.
  await context.clearCookies();
  await signInAs(context, s);
  await page.goto('/health?tab=emergencies');
  await expect(page.getByText('Injury · Playground, near the gate')).toBeVisible();
  await page.getByRole('button', { name: 'Close incident' }).click();
  const close = page.getByRole('dialog', { name: 'Close this incident' });
  await close.getByLabel('Outcome').selectOption('resolved_on_site');
  await close.getByLabel('What happened').fill('Grazed knee; cleaned and dressed by the nurse.');
  await close.getByRole('button', { name: 'Close incident' }).click();
  await expect(page.getByText('Incident closed.')).toBeAttached();
  await page.getByRole('button', { name: 'Read report' }).click();
  await expect(page.getByText('Grazed knee; cleaned and dressed by the nurse.')).toBeVisible();
});
