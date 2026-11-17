// Academics › Exams & Results for colleges (rule book §13.2; P0 item 12) through the real screens:
// the exam controller enters and locks marks and sends the term's results; office staff, set as
// the approvers in the designer, publish them from My Work; the grade card shows the grades.
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

test('exams & results: marks, locks, results published by a second person', async ({
  page,
  context,
}, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic Results Trust ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/exam-results');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const office = await sessionFor('office', s.orgId);

  const tree = (await (await page.request.get('/api/v1/school/setup/tree')).json()) as {
    campuses: { campusId: string }[];
  };
  const { institutionId } = (await apiPost(
    page,
    `/organisation/campuses/${tree.campuses[0]!.campusId}/institutions`,
    { profile: 'autonomous_college', name: 'Synthetic Results College', authorityCode: 'VTU' },
  )) as { institutionId: string };
  const { id: programId } = (await apiPost(page, '/academics/programs', {
    institutionId,
    code: 'BSC',
    name: 'B.Sc.',
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
  for (const [code, title, credits] of [
    ['PH101', 'Mechanics', 4],
    ['PH102', 'Optics', 3],
  ] as const)
    await apiPost(page, `/academics/regulations/${regulationId}/courses`, {
      code,
      title,
      termNumber: 1,
      kind: 'core',
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
    endsOn: '2026-12-15',
  })) as { id: string };
  const batch = (await (await page.request.get(`/api/v1/academics/batches/${batchId}`)).json()) as {
    sectionList: { id: string }[];
  };
  for (const [name, registerNumber] of [
    ['Synthetic Ravi Menon', '26PH001'],
    ['Synthetic Lata Rao', '26PH002'],
  ])
    await apiPost(page, `/academics/batches/${batchId}/students`, {
      sectionId: batch.sectionList[0]!.id,
      name,
      registerNumber,
    });
  for (const process of ['academics.results', 'academics.reexam'])
    await apiPost(page, '/workflow/design', {
      process,
      institutionId: null,
      steps: [{ role: 'office' }],
    });
  await page.evaluate((id) => window.localStorage.setItem('cv.institution', id), institutionId);

  // The exam controller enters marks course by course, then locks them.
  await page.reload();
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Exams & Results', level: 1 })).toBeVisible();
  for (const [code, rows] of [
    [
      'PH101',
      [
        ['Synthetic Ravi Menon', '38', '54'],
        ['Synthetic Lata Rao', '30', '30'],
      ],
    ],
    [
      'PH102',
      [
        ['Synthetic Ravi Menon', '32', '38'],
        ['Synthetic Lata Rao', '35', null],
      ],
    ],
  ] as const) {
    await main.getByRole('button', { name: `Enter marks: ${code}` }).click();
    const form = page.getByRole('form', { name: new RegExp(code) });
    for (const [name, cie, see] of rows) {
      await form.getByLabel(`Internal marks: ${name}`).fill(cie);
      if (see) await form.getByLabel(`End-exam marks: ${name}`).fill(see);
      else await form.getByLabel(`Absent from the end exam: ${name}`).check();
    }
    await noA11yViolations(page);
    await form.getByRole('button', { name: 'Save marks' }).click();
    await expect(form).toBeHidden();
    await main.getByRole('button', { name: `Lock marks: ${code}` }).click();
    await expect(main.getByRole('button', { name: `Reopen marks: ${code}` })).toBeVisible();
  }
  const results = main.getByRole('region', { name: 'Results' });
  // Ravi: O and A → 9.14. Lata: B+ and F (absent) → 4.00.
  await expect(results.getByRole('row', { name: /Synthetic Ravi Menon/ })).toContainText('9.14');
  await expect(results.getByRole('row', { name: /Synthetic Lata Rao/ })).toContainText('PH102');
  await results.getByRole('button', { name: 'Send results for approval' }).click();
  await expect(results).toContainText('Waiting for approval');
  await noA11yViolations(page);

  // Office staff publish from My Work.
  await context.clearCookies();
  await signInAs(context, { ...office, institutionId });
  await page.goto('/my-work');
  await page.getByRole('button', { name: /Results: BSC 2026–29, term 1/ }).click();
  await expect(page).toHaveURL(/exam-results/);
  await results.getByRole('button', { name: 'Publish' }).click();
  await expect(results).toContainText('Published');
  await results.getByRole('button', { name: 'Synthetic Ravi Menon' }).click();
  const card = page.getByRole('dialog');
  await expect(card).toContainText('PH101 · Mechanics');
  await expect(card).toContainText('SGPA 9.14');
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/exam-results-${info.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press('Escape');

  // Government Reports: the published term's credits for ABC and NAD (the owner may reveal IDs).
  await context.clearCookies();
  await signInAs(context, s);
  await page.goto('/government-reports');
  const abc = main.getByRole('region', { name: 'ABC & NAD credits' });
  const file = page.waitForEvent('download');
  await abc.getByRole('button', { name: 'Download credit file' }).click();
  expect((await file).suggestedFilename()).toBe('ABC-BSC-2026–29-term1.csv');
  await expect(abc.getByRole('status')).toContainText('2 students · 4 course rows');
  await expect(abc).toContainText('No ABC ID on record for');
  await noA11yViolations(page);

  // Re-exams: Lata sits a supplementary for PH102; office staff approve the new grade.
  await page.goto('/exam-results');
  const reexams = main.getByRole('region', { name: 'Re-exams' });
  await reexams.getByRole('button', { name: 'Supplementary: Synthetic Lata Rao, PH102' }).click();
  await reexams.getByRole('button', { name: 'Enter mark: Synthetic Lata Rao, PH102' }).click();
  const markForm = page.getByRole('dialog');
  await markForm.getByLabel('End-exam mark (out of 60)').fill('45');
  await noA11yViolations(page);
  await markForm.getByRole('button', { name: 'Send for approval' }).click();
  await expect(markForm).toBeHidden();
  await expect(reexams).toContainText('F → A+ (80)');
  await expect(reexams).toContainText('Waiting for approval');

  await context.clearCookies();
  await signInAs(context, { ...office, institutionId });
  await page.goto('/my-work');
  await page
    .getByRole('button', { name: /Supplementary: Synthetic Lata Rao · PH102 · F → A\+/ })
    .click();
  await expect(page).toHaveURL(/exam-results/);
  await reexams.getByRole('button', { name: 'Approve re-exam: Synthetic Lata Rao, PH102' }).click();
  await expect(reexams).toContainText('Counted');
  await noA11yViolations(page);
  await results.getByRole('button', { name: 'Synthetic Lata Rao' }).click();
  // B+ (4×7) and A+ (3×9) → 55 ÷ 7 = 7.86, all seven credits earned.
  await expect(page.getByRole('dialog')).toContainText('SGPA 7.86');
});
