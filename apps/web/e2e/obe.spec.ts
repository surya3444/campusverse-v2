// Academics › OBE (rule book §13.2; P1 item 17) through the real screens: the owner writes the
// programme outcomes and publishes them, writes a course outcome mapped to PO1 and measured by the
// end exam; once the term's results are published, attainment shows the CO level and the PO
// worked out from it, against the same target. All data synthetic.
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

test('OBE: outcomes, a mapped course outcome, attainment from published results', async ({
  page,
  context,
}, info) => {
  test.setTimeout(200_000);
  const s = devSession(`Synthetic OBE Trust ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/obe');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const office = await sessionFor('office', s.orgId);
  const tree = (await (await page.request.get('/api/v1/school/setup/tree')).json()) as {
    campuses: { campusId: string }[];
  };
  const { institutionId } = (await apiPost(
    page,
    `/organisation/campuses/${tree.campuses[0]!.campusId}/institutions`,
    { profile: 'autonomous_college', name: 'Synthetic OBE College', authorityCode: 'VTU' },
  )) as { institutionId: string };
  const { id: programId } = (await apiPost(page, '/academics/programs', {
    institutionId,
    code: 'BECS',
    name: 'B.E. Computer Science',
    level: 'ug',
    termKind: 'semester',
    terms: 8,
    framework: null,
  })) as { id: string };
  const { id: regulationId } = (await apiPost(
    page,
    `/academics/programs/${programId}/regulations`,
    { code: 'R26', effectiveFrom: '2026-06-01' },
  )) as { id: string };
  const { id: courseId } = (await apiPost(page, `/academics/regulations/${regulationId}/courses`, {
    code: 'CS101',
    title: 'Programming',
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
  const ids: string[] = [];
  for (const [name, registerNumber] of [
    ['Synthetic Rohan Gupta', '26CS001'],
    ['Synthetic Neha Joshi', '26CS002'],
  ])
    ids.push(
      (
        (await apiPost(page, `/academics/batches/${batchId}/students`, {
          sectionId: batch.sectionList[0]!.id,
          name,
          registerNumber,
        })) as { personId: string }
      ).personId,
    );
  // End exam (of 60): 50 and 20 → one of two achieves 60% → level 1.
  await apiPost(page, `/academics/batches/${batchId}/exams/courses/${courseId}`, {
    rows: [
      { studentId: ids[0], cie: 30, see: 50, absent: false },
      { studentId: ids[1], cie: 20, see: 20, absent: false },
    ],
  });
  await apiPost(page, `/academics/batches/${batchId}/exams/courses/${courseId}/lock`, {
    locked: true,
  });
  await apiPost(page, '/workflow/design', {
    process: 'academics.results',
    institutionId: null,
    steps: [{ role: 'office' }],
  });
  const { id: resultId } = (await apiPost(page, `/academics/batches/${batchId}/results`, {})) as {
    id: string;
  };
  await page.evaluate((id) => window.localStorage.setItem('cv.institution', id), institutionId);
  await page.reload();

  // Programme outcomes: the first version, one PO and one PSO, published.
  const main = page.getByRole('main');
  const outcomes = main.getByRole('region', { name: 'Programme outcomes', exact: true });
  await outcomes.getByRole('button', { name: 'Start the first version' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start a new version' }).click();
  await outcomes.getByRole('button', { name: 'Edit draft' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('Vision').fill('Synthetic vision for computing graduates');
  await edit.getByRole('button', { name: 'Add PO' }).click();
  await edit.getByLabel('Statement: PO1').fill('Apply engineering knowledge');
  await edit.getByRole('button', { name: 'Add PSO' }).click();
  await edit.getByLabel('Statement: PSO1').fill('Design software systems');
  await noA11yViolations(page);
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await outcomes.getByRole('button', { name: 'Publish' }).click();
  await expect(outcomes).toContainText('Published');
  await expect(outcomes).toContainText('PO1 · Apply engineering knowledge');

  // Course outcomes: CO1 serves PO1 strongly and is measured by the end exam.
  await page.getByRole('radio', { name: 'Course outcomes' }).click();
  const courses = main.getByRole('region', { name: 'Course outcomes', exact: true });
  await courses.getByRole('button', { name: 'Edit course outcomes' }).click();
  const cos = page.getByRole('dialog');
  await cos.getByRole('button', { name: 'Add CO' }).click();
  await cos.getByLabel('Statement: CO1').fill('Write and test small programs');
  await cos.getByLabel('CO1 → PO1').selectOption('3');
  await cos.getByLabel('End exam measures CO1').check();
  await noA11yViolations(page);
  await cos.getByRole('button', { name: 'Save' }).click();
  await expect(cos).toBeHidden();
  const matrix = courses.getByRole('table', { name: 'CO–PO matrix: CS101' });
  await expect(matrix.getByRole('row', { name: /CO1/ })).toContainText('3');
  await expect(matrix.getByRole('row', { name: /CO1/ })).toContainText('End exam');

  // Office staff publish the term's results (the owner sent them).
  await context.clearCookies();
  await signInAs(context, { ...office, institutionId });
  await page.goto('/my-work');
  await apiPost(page, `/academics/results/${resultId}/decision`, { approve: true, note: null });

  // Attainment: CO1 at level 1, and PO1 the same, both below the target of 2.
  await context.clearCookies();
  await signInAs(context, s);
  await page.evaluate((id) => window.localStorage.setItem('cv.institution', id), institutionId);
  await page.goto('/obe');
  await page.getByRole('radio', { name: 'Attainment' }).click();
  const co = main.getByRole('region', { name: 'Course outcome attainment', exact: true });
  await expect(co.getByRole('row', { name: /CS101 CO1/ })).toContainText('1 of 2 · level 1');
  await expect(co.getByRole('row', { name: /CS101 CO1/ })).toContainText('Below target');
  const po = main.getByRole('region', { name: 'PO and PSO attainment' });
  await expect(po.getByRole('listitem').filter({ hasText: 'PO1' })).toContainText('1.00');
  await expect(po.getByRole('listitem').filter({ hasText: 'PSO1' })).toContainText(
    'No mapped course outcome measured yet',
  );
  await noA11yViolations(page);
  await page.screenshot({ path: `e2e/screenshots/obe-${info.project.name}.png`, fullPage: true });
});
