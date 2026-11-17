// Academics › Attendance for colleges (rule book §13.2: "period-wise (college)"; "Shortage &
// Condonation") through the real screens: a period is taken, each student's standing shows
// against the rule pack, a condonable shortage is sent for condonation and office staff (the
// approvers in the designer) condone it from My Work. All data synthetic.
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

test('college attendance: a period taken, a shortage condoned from My Work', async ({
  page,
  context,
}, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic Attendance Trust ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/course-attendance');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const office = await sessionFor('office', s.orgId);
  const tree = (await (await page.request.get('/api/v1/school/setup/tree')).json()) as {
    campuses: { campusId: string }[];
  };
  const { institutionId } = (await apiPost(
    page,
    `/organisation/campuses/${tree.campuses[0]!.campusId}/institutions`,
    { profile: 'autonomous_college', name: 'Synthetic Attendance College', authorityCode: 'VTU' },
  )) as { institutionId: string };
  const { id: programId } = (await apiPost(page, '/academics/programs', {
    institutionId,
    code: 'BA',
    name: 'B.A.',
    level: 'ug',
    termKind: 'semester',
    terms: 6,
    framework: null,
  })) as { id: string };
  const { id: regulationId } = (await apiPost(
    page,
    `/academics/programs/${programId}/regulations`,
    { code: 'R26', effectiveFrom: '2026-06-01' },
  )) as { id: string };
  const { id: courseId } = (await apiPost(page, `/academics/regulations/${regulationId}/courses`, {
    code: 'HI101',
    title: 'History',
    termNumber: 1,
    kind: 'core',
    lecture: 4,
    tutorial: 0,
    practical: 0,
    credits: 4,
  })) as { id: string };
  await apiPost(page, `/academics/regulations/${regulationId}/publish`, {});
  const { id: batchId } = (await apiPost(page, `/academics/programs/${programId}/batches`, {
    regulationId,
    startYear: 2026,
    sections: ['A'],
    capacity: 60,
    startsOn: '2026-07-01',
    endsOn: '2026-12-15',
  })) as { id: string };
  const batch = (await (await page.request.get(`/api/v1/academics/batches/${batchId}`)).json()) as {
    sectionList: { id: string }[];
  };
  const sectionId = batch.sectionList[0]!.id;
  const ids: string[] = [];
  for (const [name, registerNumber] of [
    ['Synthetic Arjun Das', '26BA001'],
    ['Synthetic Kavya Iyer', '26BA002'],
  ])
    ids.push(
      (
        (await apiPost(page, `/academics/batches/${batchId}/students`, {
          sectionId,
          name,
          registerNumber,
        })) as { personId: string }
      ).personId,
    );
  // Five earlier periods: Kavya attends three.
  for (const [i, kavya] of (
    ['present', 'present', 'absent', 'present', 'absent'] as const
  ).entries())
    await apiPost(page, `/academics/batches/${batchId}/attendance`, {
      sectionId,
      courseId,
      onDate: `2026-08-0${i + 3}`,
      period: 1,
      marks: [
        { studentId: ids[0], status: 'present' },
        { studentId: ids[1], status: kavya },
      ],
    });
  await apiPost(page, '/workflow/design', {
    process: 'academics.condonation',
    institutionId: null,
    steps: [{ role: 'office' }],
  });
  await page.evaluate((id) => window.localStorage.setItem('cv.institution', id), institutionId);
  await page.reload();

  // The sixth period, taken on the screen: everyone present → Kavya 4 of 6 = 66.67%.
  const main = page.getByRole('main');
  const take = main.getByRole('region', { name: 'Take attendance' });
  await take.getByLabel('Date').fill('2026-08-10');
  await expect(take.getByRole('group', { name: 'Attendance: Synthetic Kavya Iyer' })).toBeVisible();
  await noA11yViolations(page);
  await take.getByRole('button', { name: 'Save attendance' }).click();
  await expect(take.getByRole('status')).toHaveText('Attendance saved.');

  const standing = main.getByRole('region', { name: 'Standing this term' });
  const kavya = standing.getByRole('row', { name: /Synthetic Kavya Iyer/ });
  await expect(kavya).toContainText('66.66%');
  await expect(kavya).toContainText('Short: can be condoned');
  await expect(standing.getByRole('row', { name: /Synthetic Arjun Das/ })).toContainText(
    'Eligible',
  );
  await kavya.getByRole('button', { name: 'Ask to condone: Synthetic Kavya Iyer, HI101' }).click();
  const ask = page.getByRole('dialog');
  await ask.getByLabel('Reason').fill('Hospitalised for a week (synthetic)');
  await noA11yViolations(page);
  await ask.getByRole('button', { name: 'Ask to condone' }).click();
  await expect(ask).toBeHidden();
  await expect(kavya).toContainText('Condonation waiting for approval');

  await context.clearCookies();
  await signInAs(context, { ...office, institutionId });
  await page.goto('/my-work');
  await page
    .getByRole('button', { name: /Condonation: Synthetic Kavya Iyer · HI101 · 66.66%/ })
    .click();
  await expect(page).toHaveURL(/course-attendance/);
  await kavya.getByRole('button', { name: 'Condone: Synthetic Kavya Iyer, HI101' }).click();
  await expect(kavya).toContainText('Condoned');
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/course-attendance-${info.project.name}.png`,
    fullPage: true,
  });

  // Hall tickets (rule book §13.2): both may sit HI101 now (Kavya condoned); the owner issues them.
  await context.clearCookies();
  await signInAs(context, s);
  await page.evaluate((id) => window.localStorage.setItem('cv.institution', id), institutionId);
  await page.goto('/exam-results');
  const tickets = main.getByRole('region', { name: 'Hall tickets' });
  await expect(tickets.getByRole('row', { name: /Synthetic Kavya Iyer/ })).toContainText(
    'Ready to issue',
  );
  await noA11yViolations(page);
  await tickets.getByRole('button', { name: 'Issue hall tickets (2)' }).click();
  await expect(tickets.getByRole('status')).toHaveText('2 hall tickets issued.');
  await expect(
    tickets.getByRole('button', { name: 'Download hall ticket: Synthetic Kavya Iyer' }),
  ).toBeVisible();
  await expect(tickets.getByRole('row', { name: /Synthetic Kavya Iyer/ })).toContainText(
    'HT-BA-202629-T1-26BA002',
  );
});
