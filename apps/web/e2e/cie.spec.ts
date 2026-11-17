// Academics › Assessments (rule book §13.2: "CIE Plan: weighted components from the regulation";
// "Gradebook: marks per component") through the real marks form: a course with two components,
// scores entered per component, the internal mark worked out and saved. All data synthetic.
import { expect, test } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('CIE components: scores per component give the internal mark', async ({
  page,
  context,
}, info) => {
  test.setTimeout(150_000);
  const s = devSession(`Synthetic CIE Trust ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/exam-results');
  await schoolWithStudents(page, s.institutionId);
  const tree = (await (await page.request.get('/api/v1/school/setup/tree')).json()) as {
    campuses: { campusId: string }[];
  };
  const { institutionId } = (await apiPost(
    page,
    `/organisation/campuses/${tree.campuses[0]!.campusId}/institutions`,
    { profile: 'autonomous_college', name: 'Synthetic CIE College', authorityCode: 'VTU' },
  )) as { institutionId: string };
  const { id: programId } = (await apiPost(page, '/academics/programs', {
    institutionId,
    code: 'BBA',
    name: 'BBA',
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
  await apiPost(page, `/academics/regulations/${regulationId}/courses`, {
    code: 'BA101',
    title: 'Management',
    termNumber: 1,
    kind: 'core',
    lecture: 4,
    tutorial: 0,
    practical: 0,
    credits: 4,
    cieComponents: [
      { name: 'Test', maxMarks: 50, weight: 70 },
      { name: 'Assignment', maxMarks: 10, weight: 30 },
    ],
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
  await apiPost(page, `/academics/batches/${batchId}/students`, {
    sectionId: batch.sectionList[0]!.id,
    name: 'Synthetic Asha Pillai',
    registerNumber: '26BA001',
  });
  await page.evaluate((id) => window.localStorage.setItem('cv.institution', id), institutionId);
  await page.reload();

  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Enter marks: BA101' }).click();
  const form = page.getByRole('form', { name: /BA101/ });
  await form.getByLabel('Test: Synthetic Asha Pillai').fill('40');
  await form.getByLabel('Assignment: Synthetic Asha Pillai').fill('9');
  // (70×40/50 + 30×9/10) ÷ 100 × 40 = 33.2.
  await expect(form.getByLabel('Internal marks: Synthetic Asha Pillai')).toHaveText('33.2');
  await form.getByLabel('End-exam marks: Synthetic Asha Pillai').fill('45');
  await noA11yViolations(page);
  await form.getByRole('button', { name: 'Save marks' }).click();
  await expect(form).toBeHidden();
  await expect(main.getByRole('region', { name: 'Results' })).toContainText(
    'Synthetic Asha Pillai',
  );
  // 33.2 + 45 = 78.2 → A (8).
  await expect(
    main
      .getByRole('region', { name: 'Results' })
      .getByRole('row', { name: /Synthetic Asha Pillai/ }),
  ).toContainText('8.00');
});
