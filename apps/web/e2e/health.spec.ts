// Health Connect through the real screens (rule book §13.9, §16.5): the nurse writes a sealed
// record and a sick-room visit; the owner sees totals only, and opens life-saving details in an
// emergency, on the record.
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

test('health: the nurse’s record and visit, totals for the owner, break-glass', async ({
  page,
  context,
}, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic Health School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/health');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { personId: string; name: string }[];
  const child = students[0]!;
  const first = child.name.split(' ')[0]!;

  // The owner: totals and emergency access, never named records.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Health Records', level: 1 })).toBeVisible();
  await expect(page.getByText('Named health records are for the school nurse.')).toBeVisible();
  await noA11yViolations(page);

  // The nurse writes the record and a visit.
  const nurse = await sessionFor('nurse', s.orgId);
  await context.clearCookies();
  await signInAs(context, { ...nurse, institutionId: s.institutionId });
  await page.goto('/health');
  await page.getByRole('textbox', { name: 'Find a student' }).fill(first);
  await page.getByRole('button', { name: `Open health record: ${child.name}` }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('Nothing recorded yet.')).toBeVisible();
  await drawer.getByLabel('Blood group').selectOption('O+');
  await drawer.getByLabel('Allergies').fill('Peanuts');
  await drawer.getByLabel('For a first responder').fill('EpiPen in the class teacher’s drawer.');
  await drawer.getByRole('button', { name: 'Save record' }).click();
  await expect(drawer.getByText('Health record saved.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Record a visit' }).click();
  const visit = page.getByRole('dialog', { name: 'Record a visit' });
  await visit.getByLabel('What they came with').fill('Headache after assembly');
  await visit.getByLabel('Outcome').selectOption('sent_home');
  await visit.getByRole('button', { name: 'Record visit' }).click();
  await expect(visit).toBeHidden();
  await expect(drawer.getByText('Headache after assembly')).toBeVisible();
  await noA11yViolations(page);
  await page.keyboard.press('Escape');
  await expect(
    page
      .getByRole('region', { name: 'Sick-room today' })
      .getByRole('button', { name: new RegExp(child.name) }),
  ).toContainText('Sent home');

  // The owner again: emergency access shows blood group and allergies, for an hour.
  await context.clearCookies();
  await signInAs(context, s);
  await page.goto('/health');
  await page.getByRole('button', { name: 'Emergency access' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Student').fill(first);
  await form.getByRole('button', { name: new RegExp(child.name) }).click();
  await form.getByLabel('What is happening').fill('Breathing difficulty on the playground');
  await form.getByRole('button', { name: 'Open life-saving details' }).click();
  const card = page.getByRole('dialog');
  await expect(card.getByText('O+')).toBeVisible();
  await expect(card.getByText('Peanuts')).toBeVisible();
  await expect(card.getByText(/Access ends at/)).toBeVisible();
});
