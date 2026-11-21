// Seat draws through the real screens (rule book §13.1, §16.2): the office draws an RTE lottery
// for Class 3 with a seed called out in public; it can't publish its own draw; the owner checks
// the seed reproduces and publishes two offers and an ordered waitlist.
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
const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const YEAR = '2026-27';

test('seat draws: RTE lottery, second person publishes', async ({ page, context }, info) => {
  test.setTimeout(200_000);
  const owner = devSession(`Synthetic Draw School ${info.project.name}`);
  await signInAs(context, owner);
  await page.goto('/admissions/draws');
  await schoolWithStudents(page, owner.institutionId);
  await apiPost(page, `/school/setup/${owner.institutionId}/invites`);
  const office = await sessionFor('office', owner.orgId);

  // Fees for Class 3 (an offer discloses them), two RTE seats and four RTE applicants.
  const head = (await apiPost(page, `/finance/${owner.institutionId}/heads`, {
    code: 'TUITION',
    name: 'Tuition',
    taxClass: 'education_exempt',
    rteExempt: true,
    refundable: false,
  })) as { id: string };
  const groups = (await (
    await page.request.get(`/api/v1/communications/${owner.institutionId}/audience-groups`)
  ).json()) as { id: string; label: string }[];
  const plan = (await apiPost(page, `/finance/${owner.institutionId}/plans`, {
    name: 'Class 3 fees',
    groupIds: [groups.find((g) => g.label === 'Class 3')!.id],
    lines: [{ headId: head.id, amountPaise: 1_800_000 }],
    instalments: [{ label: 'Annual', dueOn: iso(30), shareBp: 10_000 }],
    lateFeePaise: 0,
    graceDays: 0,
  })) as { id: string };
  await apiPost(page, `/finance/plans/${plan.id}/publish`);
  const pipeline = (await (
    await page.request.get(`/api/v1/school/admissions/${owner.institutionId}?year=${YEAR}`)
  ).json()) as { classes: { classId: string; name: string }[] };
  const classId = pipeline.classes.find((c) => c.name === 'Class 3')!.classId;
  await apiPost(page, `/school/admissions/${owner.institutionId}/seats`, {
    yearLabel: YEAR,
    classId,
    category: 'rte',
    seats: 2,
  });
  for (const n of ['Asha', 'Bilal', 'Chitra', 'Dev']) {
    const { id } = (await apiPost(page, `/school/admissions/${owner.institutionId}/enquiries`, {
      yearLabel: YEAR,
      classId,
      category: 'rte',
      source: 'rte_portal',
      childName: `${n} Synthetic Draw`,
      dateOfBirth: '2018-06-15',
      guardianName: `${n} Synthetic Parent`,
      guardianPhone: `+919${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
    })) as { id: string };
    await apiPost(page, `/school/admissions/applications/${id}/move`, { to: 'applied' });
  }

  // The office draws.
  await context.clearCookies();
  await signInAs(context, { ...office, institutionId: owner.institutionId });
  await page.goto('/admissions/draws');
  await expect(page.getByText('No draws this year')).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'New draw' }).first().click();
  const form = page.getByRole('dialog', { name: 'New draw' });
  await form
    .getByRole('combobox', { name: 'Class', exact: true })
    .selectOption({ label: 'Class 3' });
  await form.getByRole('combobox', { name: 'Category' }).selectOption('rte');
  await form.getByLabel(/^Seed/).fill('4-17-29');
  await noA11yViolations(page);
  await form.getByRole('button', { name: 'Draw', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: /Class 3 · RTE/ });
  await expect(drawer.getByText('4-17-29')).toBeVisible();
  await expect(
    drawer.getByText('Running it again from the recorded seed gives the same order.'),
  ).toBeVisible();
  await expect(drawer.getByText('You made this draw, so someone else publishes it.')).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Publish offers' })).toBeDisabled();
  await expect(drawer.getByRole('listitem').filter({ hasText: 'Synthetic Draw' })).toHaveCount(4);

  // The owner publishes.
  await context.clearCookies();
  await signInAs(context, owner);
  await page.goto('/admissions/draws');
  await page.getByRole('button', { name: /Class 3 · RTE/ }).click();
  const review = page.getByRole('dialog', { name: /Class 3 · RTE/ });
  await review.getByRole('button', { name: 'Publish offers' }).click();
  await expect(review.getByText('Published: 2 offered, 2 waitlisted.')).toBeAttached();
  await expect(review.getByText('Offered', { exact: true })).toHaveCount(2);
  await expect(review.getByText('Waitlisted', { exact: true })).toHaveCount(2);
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/seat-draws-${info.project.name}.png`,
    fullPage: true,
  });
});
