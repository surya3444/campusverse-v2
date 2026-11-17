// Visitors and gate through the real screens (docs/specs/VISITORS_GATE.md): a walk-in checked in
// to see a staff member and out again, a gate pass collected by the child's guardian, a barred
// visitor refused at the gate, and a visitor a staff member expects.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const phone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

test('gate: check in and out, a gate pass, a barred visitor, an expected visit', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic Gate School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/gate');
  await schoolWithStudents(page, s.institutionId);
  const staff = (await (
    await page.request.get(`/api/v1/people/staff?institutionId=${s.institutionId}`)
  ).json()) as { name: string }[];
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { name: string; reference: string }[];
  const host = staff[0]!;
  const student = students[0]!;
  await page.reload();
  await expect(page.getByText('Nobody is inside.')).toBeVisible();
  await noA11yViolations(page);

  // A walk-in to see a staff member.
  const visitorPhone = phone();
  const inside = page.getByRole('region', { name: 'Inside now' });
  await inside.getByRole('button', { name: 'Check in' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Mobile number').fill(visitorPhone);
  await dialog.getByLabel('Name', { exact: true }).fill('Synthetic Walk-in Visitor');
  await dialog.getByLabel('Purpose').selectOption('staff_meeting');
  await dialog.getByLabel(/Whom to meet/).fill(host.name);
  await dialog.getByRole('button', { name: new RegExp(host.name) }).click();
  await dialog.getByLabel(/Vehicle number/).fill('ka01ab1234');
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Check in' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    inside.getByText('Synthetic Walk-in Visitor', { exact: true }).first(),
  ).toBeVisible();
  await expect(inside.getByText(new RegExp(`To see ${host.name}.*KA01AB1234`))).toBeVisible();
  await inside.getByRole('button', { name: 'Check out Synthetic Walk-in Visitor' }).click();
  await expect(page.getByText('Nobody is inside.')).toBeVisible();

  // A gate pass: the student by admission number, collected by their guardian.
  await page.getByRole('radio', { name: 'Passes' }).click();
  await expect(page.getByText('No passes today.')).toBeVisible();
  await page.getByRole('button', { name: 'Issue pass' }).click();
  await dialog.getByLabel('Student').fill(student.reference);
  await dialog.getByRole('button', { name: new RegExp(student.name) }).click();
  const collectors = dialog.getByRole('radiogroup', { name: 'Who collects' });
  await collectors.getByRole('radio').first().check();
  await dialog.getByLabel('Reason').fill('Doctor appointment');
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Issue pass' }).click();
  await expect(dialog).toBeHidden();
  const passes = page.getByRole('region', { name: 'Passes' });
  await expect(passes.getByText('Waiting')).toBeVisible();
  await passes.getByRole('button', { name: `Left ${student.name}` }).click();
  await expect(passes.getByText(/Left at/)).toBeVisible();
  await noA11yViolations(page);

  // Bar a visitor; the gate then refuses them.
  const barredPhone = phone();
  await page.getByRole('radio', { name: 'Barred' }).click();
  await page.getByRole('button', { name: 'Bar a visitor' }).click();
  await dialog.getByLabel('Mobile number').fill(barredPhone);
  await dialog.getByLabel('Name', { exact: true }).fill('Synthetic Barred Visitor');
  await dialog.getByLabel('Reason').fill('Threatened staff');
  await dialog.getByRole('button', { name: 'Bar a visitor' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Synthetic Barred Visitor', { exact: true }).first()).toBeVisible();
  await page.getByRole('radio', { name: 'Gate', exact: true }).click();
  await inside.getByRole('button', { name: 'Check in' }).click();
  await dialog.getByLabel('Mobile number').fill(barredPhone);
  await expect(dialog.getByRole('alert')).toContainText('Barred: Threatened staff');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Synthetic Barred Visitor');
  await expect(dialog.getByRole('button', { name: 'Check in' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).first().click();

  // A visitor the owner expects today shows at the gate, and checks in with one tap.
  await page.getByRole('radio', { name: 'My visitors' }).click();
  await page.getByRole('button', { name: 'Expect a visitor' }).click();
  await dialog.getByLabel('Mobile number').fill(phone());
  await dialog.getByLabel('Name', { exact: true }).fill('Synthetic Expected Visitor');
  await dialog.getByLabel('Purpose').selectOption('interview');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Synthetic Expected Visitor', { exact: true }).first()).toBeVisible();
  await page.getByRole('radio', { name: 'Gate', exact: true }).click();
  const expected = page.getByRole('region', { name: 'Expected today' });
  await expected.getByRole('button', { name: 'Check in Synthetic Expected Visitor' }).click();
  await dialog.getByRole('button', { name: 'Check in' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    inside.getByText('Synthetic Expected Visitor', { exact: true }).first(),
  ).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: `e2e/screenshots/gate-${info.project.name}.png`, fullPage: true });
});
