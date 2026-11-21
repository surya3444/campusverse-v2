// Students › Mentoring through the real screens (rule book §13.5, §16.4): the head of department
// gives two students a mentor; the mentor records a check-in with a concern and escalates; the
// head of department closes the escalation.
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

test('mentoring: allocate, check in, escalate, close', async ({ page, context }, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic Mentoring School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/mentoring');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const teacher = await sessionFor('teacher', s.orgId);
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { personId: string; name: string }[];
  const [a, b] = students;

  // The head of department (the owner here) allocates.
  await page.goto('/mentoring?tab=allocation');
  await expect(page.getByRole('heading', { name: 'Mentoring', level: 1 })).toBeVisible();
  // The school's one teacher (the class teacher who signs in below).
  await page.getByRole('combobox', { name: 'Mentor', exact: true }).selectOption({ index: 1 });
  await page.getByRole('checkbox', { name: a!.name }).check();
  await page.getByRole('checkbox', { name: b!.name }).check();
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'Give 2 students this mentor' }).click();
  await expect(page.getByText('2 students given a mentor.')).toBeAttached();
  await expect(page.getByRole('checkbox', { name: a!.name })).toBeHidden();

  // The mentor checks in and escalates.
  await context.clearCookies();
  await signInAs(context, { ...teacher, institutionId: s.institutionId });
  await page.goto('/mentoring');
  await page.getByRole('button', { name: `Open: ${a!.name}` }).click();
  const drawer = page.getByRole('dialog', { name: a!.name });
  await drawer.getByRole('button', { name: 'Record a check-in' }).click();
  const rec = page.getByRole('dialog', { name: 'Record a check-in' });
  await rec.getByLabel('Concern level').selectOption('watch');
  await rec
    .getByLabel('What you talked about')
    .fill('Falling behind in maths; weekly practice agreed.');
  await rec.getByRole('button', { name: 'Save check-in' }).click();
  await expect(drawer.getByText('Falling behind in maths; weekly practice agreed.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Escalate' }).click();
  const esc = page.getByRole('dialog', { name: 'Escalate' });
  await esc.getByLabel('What you’re worried about').fill('Three weeks of missed homework now.');
  await esc.getByRole('button', { name: 'Escalate' }).click();
  await expect(drawer.getByText('Three weeks of missed homework now.')).toBeVisible();
  await noA11yViolations(page);
  await page.keyboard.press('Escape');
  await expect(page.getByText('1 open escalation')).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/mentoring-${info.project.name}.png`,
    fullPage: true,
  });

  // The head of department closes it.
  await context.clearCookies();
  await signInAs(context, s);
  await page.goto('/mentoring?tab=escalations');
  await page.getByRole('button', { name: `Close escalation ${a!.name}` }).click();
  const close = page.getByRole('dialog', { name: `Close escalation: ${a!.name}` });
  await close.getByLabel('What was done').fill('Met the parents; tutoring set up.');
  await close.getByRole('button', { name: 'Close escalation' }).click();
  await expect(page.getByText('Met the parents; tutoring set up.', { exact: false })).toBeVisible();
  await noA11yViolations(page);
});
