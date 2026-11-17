// Design review: every school screen, signed in to a school with students, captured on desktop
// and a 360 px phone into e2e/screenshots/tour/. Not an assertion-heavy test; it exists so the
// whole product can be looked at in one place after any visual change.
import { expect, test } from '@playwright/test';
import { devSession, schoolWithStudents, signInAs } from './helpers';

const SCREENS: [string, string][] = [
  ['today', '/'],
  ['ask', '/ask'],
  ['my-work', '/my-work'],
  ['organisation', '/organisation'],
  ['apps', '/apps'],
  ['setup', '/setup'],
  ['years', '/years'],
  ['classes', '/classes'],
  ['subjects', '/subjects'],
  ['timetable', '/timetable'],
  ['attendance', '/attendance'],
  ['homework', '/homework'],
  ['syllabus', '/syllabus'],
  ['exams', '/exams'],
  ['library', '/library'],
  ['year-end', '/year-end'],
  ['students', '/students'],
  ['admissions', '/admissions'],
  ['certificates', '/certificates'],
  ['fees', '/fees'],
  ['fee-plans', '/fees/plans'],
  ['expenses', '/expenses'],
  ['staff', '/staff'],
  ['staff-attendance', '/staff-attendance'],
  ['staff-leave', '/staff-leave'],
  ['appraisals', '/appraisals'],
  ['payroll', '/payroll'],
  ['transport', '/transport'],
  ['hostel', '/hostel'],
  ['assets', '/assets'],
  ['gate', '/gate'],
  ['helpdesk', '/helpdesk'],
  ['health', '/health'],
  ['government-reports', '/government-reports'],
  ['notices', '/notices'],
  ['notice-new', '/notices/new'],
  ['org-settings', '/settings/organisation'],
  ['roles', '/settings/roles'],
  ['rule-packs', '/rule-packs'],
  ['approvals', '/settings/approvals'],
  ['privacy', '/privacy'],
  ['activity-log', '/activity-log'],
  ['data-import', '/data-import'],
  ['settings', '/settings'],
];

test('visual tour of every school screen', async ({ page, context }, info) => {
  test.setTimeout(240_000);
  const owner = devSession('Sunrise Public School');
  await signInAs(context, owner);
  await page.goto('/setup');
  await schoolWithStudents(page, owner.institutionId);
  for (const [name, path] of SCREENS) {
    await page.goto(path);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await page.screenshot({
      path: `e2e/screenshots/tour/${name}-${info.project.name}.png`,
      fullPage: true,
    });
  }
  await page.goto('/login');
  await page.context().clearCookies();
  await page.goto('/login');
  await page.screenshot({
    path: `e2e/screenshots/tour/login-${info.project.name}.png`,
    fullPage: true,
    // Hiding the caret styles the autofocused input mid-hydration; keep it for this screen.
    caret: 'initial',
  });
});

const COLLEGE_SCREENS: [string, string][] = [
  ['college-today', '/'],
  ['academic-structure', '/academic-structure'],
  ['course-registration', '/course-registration'],
  ['course-attendance', '/course-attendance'],
  ['exam-results', '/exam-results'],
  ['obe', '/obe'],
  ['college-students', '/students'],
  ['college-fees', '/fees'],
  ['college-staff', '/staff'],
];

test('visual tour of the college screens', async ({ page, context }, info) => {
  test.setTimeout(240_000);
  const owner = devSession('Sunrise Education Trust');
  await signInAs(context, owner);
  await page.goto('/setup');
  await schoolWithStudents(page, owner.institutionId);
  const post = async <T>(path: string, body: unknown) => {
    const res = await page.request.post(`/api/v1${path}`, {
      headers: { 'x-requested-with': 'campusverse' },
      data: body,
    });
    expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
    return (res.status() === 204 ? null : await res.json()) as T;
  };
  const tree = (await (await page.request.get('/api/v1/school/setup/tree')).json()) as {
    campuses: { campusId: string }[];
  };
  const { institutionId } = await post<{ institutionId: string }>(
    `/organisation/campuses/${tree.campuses[0]!.campusId}/institutions`,
    { profile: 'autonomous_college', name: 'Sunrise College of Engineering', authorityCode: 'VTU' },
  );
  const { id: programId } = await post<{ id: string }>('/academics/programs', {
    institutionId,
    code: 'BECS',
    name: 'B.E. Computer Science',
    level: 'ug',
    termKind: 'semester',
    terms: 8,
    framework: null,
  });
  const { id: regulationId } = await post<{ id: string }>(
    `/academics/programs/${programId}/regulations`,
    { code: 'R26', effectiveFrom: '2026-06-01' },
  );
  for (const [code, title, kind] of [
    ['CS101', 'Programming in C', 'core'],
    ['MA101', 'Engineering Mathematics', 'core'],
    ['PH101', 'Engineering Physics', 'core'],
    ['CS151', 'Web Basics', 'elective'],
  ] as const)
    await post(`/academics/regulations/${regulationId}/courses`, {
      code,
      title,
      termNumber: 1,
      kind,
      lecture: 3,
      tutorial: 1,
      practical: 0,
      credits: 4,
    });
  await post(`/academics/regulations/${regulationId}/publish`, {});
  const { id: batchId } = await post<{ id: string }>(`/academics/programs/${programId}/batches`, {
    regulationId,
    startYear: 2026,
    sections: ['A', 'B'],
    capacity: 60,
    startsOn: '2026-07-01',
    endsOn: '2026-12-15',
  });
  const batch = (await (await page.request.get(`/api/v1/academics/batches/${batchId}`)).json()) as {
    sectionList: { id: string }[];
  };
  const names = [
    'Aarav Rao',
    'Diya Menon',
    'Ishaan Gupta',
    'Kavya Iyer',
    'Rohan Das',
    'Sneha Pillai',
  ];
  for (const [n, name] of names.entries())
    await post(`/academics/batches/${batchId}/students`, {
      sectionId: batch.sectionList[n % 2]!.id,
      name: `Synthetic ${name}`,
      registerNumber: `26CS00${n + 1}`,
    });
  await page.evaluate((id) => window.localStorage.setItem('cv.institution', id), institutionId);
  for (const [name, path] of COLLEGE_SCREENS) {
    await page.goto(path);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await page.screenshot({
      path: `e2e/screenshots/tour/${name}-${info.project.name}.png`,
      fullPage: true,
    });
  }
});
