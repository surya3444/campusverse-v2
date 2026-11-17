// Academics › Course Registration (rule book §13.2, §16.6 step 2) through the real screens: the
// owner opens the window with an elective capped at one seat; the office registers two students
// (the second finds it full); the owner approves one and returns the other with a reason.
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

test('course registration: window, seats, credit limits, approval', async ({
  page,
  context,
}, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic Registration Trust ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/course-registration');
  // The school's teacher gets a login, to sign in later as office staff.
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);

  // A college with one batch on a published regulation, through the API the screens use.
  const tree = (await (await page.request.get('/api/v1/school/setup/tree')).json()) as {
    campuses: { campusId: string }[];
  };
  const { institutionId } = (await apiPost(
    page,
    `/organisation/campuses/${tree.campuses[0]!.campusId}/institutions`,
    { profile: 'affiliated_college', name: 'Synthetic Commerce College', authorityCode: 'BU' },
  )) as { institutionId: string };
  const { id: programId } = (await apiPost(page, '/academics/programs', {
    institutionId,
    code: 'BCOM',
    name: 'B.Com.',
    level: 'ug',
    termKind: 'semester',
    terms: 6,
    framework: null,
  })) as { id: string };
  const { id: regulationId } = (await apiPost(
    page,
    `/academics/programs/${programId}/regulations`,
    {
      code: 'R26',
      effectiveFrom: '2026-06-01',
    },
  )) as { id: string };
  for (const [code, title, kind, credits] of [
    ['BC101', 'Financial Accounting', 'core', 4],
    ['BC151', 'Digital Marketing', 'elective', 3],
    ['BC152', 'Business Analytics', 'elective', 3],
  ] as const)
    await apiPost(page, `/academics/regulations/${regulationId}/courses`, {
      code,
      title,
      termNumber: 1,
      kind,
      lecture: credits,
      tutorial: 0,
      practical: 0,
      credits,
    });
  await apiPost(page, `/academics/regulations/${regulationId}/publish`, {});
  const { id: batchId } = (await apiPost(page, `/academics/programs/${programId}/batches`, {
    regulationId,
    startYear: 2026,
    sections: ['A'],
    capacity: 60,
    startsOn: '2026-07-01',
    endsOn: '2030-11-30',
  })) as { id: string };
  const batch = (await (await page.request.get(`/api/v1/academics/batches/${batchId}`)).json()) as {
    sectionList: { id: string }[];
  };
  for (const [name, registerNumber] of [
    ['Synthetic Kavya Iyer', '26BC001'],
    ['Synthetic Arjun Das', '26BC002'],
  ])
    await apiPost(page, `/academics/batches/${batchId}/students`, {
      sectionId: batch.sectionList[0]!.id,
      name,
      registerNumber,
    });
  await page.evaluate((id) => window.localStorage.setItem('cv.institution', id), institutionId);

  // The owner opens the window.
  await page.reload();
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Course Registration', level: 1 })).toBeVisible();
  await expect(main.getByText('Semester 1 of 6 · Odd term')).toBeVisible();
  await main.getByRole('button', { name: 'Open registration' }).click();
  const win = page.getByRole('form', { name: 'Open registration' });
  await win.getByLabel('Opens on').fill('2026-01-01');
  await win.getByLabel('Closes on').fill('2030-11-01');
  await win.getByLabel('Minimum credits').fill('7');
  await win.getByLabel('Maximum credits').fill('10');
  await win.getByLabel('Seats in BC151').fill('1');
  await win.getByRole('button', { name: 'Open registration' }).click();
  await expect(win).toBeHidden();
  await expect(main.getByText('7 to 10 credits')).toBeVisible();
  await noA11yViolations(page);

  // The office registers both students from their forms.
  const office = await sessionFor('office', s.orgId);
  await context.clearCookies();
  await signInAs(context, { ...office, institutionId });
  await page.reload();
  await main.getByRole('button', { name: 'Register Synthetic Kavya Iyer' }).click();
  let form = page.getByRole('form', { name: 'Register Synthetic Kavya Iyer' });
  await expect(form.getByRole('status')).toContainText('4 credits · allowed 7 to 10');
  await expect(form.getByRole('button', { name: 'Register' })).toBeDisabled();
  await form.getByRole('checkbox', { name: /BC151/ }).check();
  await expect(form.getByRole('status')).toContainText('7 credits');
  await noA11yViolations(page);
  await form.getByRole('button', { name: 'Register' }).click();
  await expect(form).toBeHidden();

  await main.getByRole('button', { name: 'Register Synthetic Arjun Das' }).click();
  form = page.getByRole('form', { name: 'Register Synthetic Arjun Das' });
  await expect(form.getByRole('checkbox', { name: /BC151/ })).toBeDisabled();
  await expect(form.getByText(/Full/)).toBeVisible();
  await form.getByRole('checkbox', { name: /BC152/ }).check();
  await form.getByRole('button', { name: 'Register' }).click();
  await expect(form).toBeHidden();
  const table = main.getByRole('table', { name: 'Students' });
  await expect(table.getByText('Waiting for approval')).toHaveCount(2);
  await expect(main.getByText('1 of 1 seat')).toBeVisible();
  // Office staff enter; they don't approve.
  await expect(table.getByRole('button', { name: /^Approve/ })).toHaveCount(0);

  // The owner approves one and returns the other.
  await context.clearCookies();
  await signInAs(context, s);
  await page.reload();
  await table.getByRole('button', { name: 'Approve registration: Synthetic Kavya Iyer' }).click();
  await expect(table.getByRole('row', { name: /Synthetic Kavya Iyer/ })).toContainText('Approved');
  await table.getByRole('button', { name: 'Return registration: Synthetic Arjun Das' }).click();
  const back = page.getByRole('form', { name: 'Return the registration' });
  await back
    .getByLabel('What should change')
    .fill('Meet the advisor about the analytics prerequisite');
  await back.getByRole('button', { name: 'Return' }).click();
  await expect(back).toBeHidden();
  const arjun = table.getByRole('row', { name: /Synthetic Arjun Das/ });
  await expect(arjun).toContainText('Returned');
  await expect(arjun).toContainText('Meet the advisor');
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/course-registration-${info.project.name}.png`,
    fullPage: true,
  });
});
