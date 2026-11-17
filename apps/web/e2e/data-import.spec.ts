// Campus Core › Data Import (rule book §17 P0 item 16) through the real screen: a school brings
// its students across from a Campusverse V1 export — checked, shown as a dry run (a student who
// left V1 is left out), imported, then undone.
import { STAFF_HEADER, toXlsx } from '@campusverse/test-data';
import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiPost, devSession, noA11yViolations, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const v1 = (n: number, status = 'active') => ({
  _id: { $oid: `64f0000000000000000000${String(n).padStart(2, '0')}` },
  admissionNumber: `V1-${n}`,
  displayName: `Synthetic Vone ${n}`,
  dateOfBirth: { $date: '2018-03-04T18:30:00.000Z' },
  status,
  currentEnrollment: { className: 'Class 3', sectionName: 'A' },
  parents: {
    father: { name: `Synthetic Parent ${n}`, phone: `98450000${String(n).padStart(2, '0')}` },
  },
});

test('data import: students from Campusverse V1, dry run, import, undo', async ({
  page,
  context,
}, info) => {
  test.setTimeout(150_000);
  const s = devSession(`Synthetic Import School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/data-import');
  const iso = (d: number) =>
    new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
  await apiPost(page, `/school/setup/${s.institutionId}/structure`, {
    board: 'CBSE',
    yearLabel: '2026-27',
    starts: iso(-10),
    ends: iso(300),
    classes: [{ code: '3', sections: 1, capacity: 30 }],
  });
  await page.reload();
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Data Import', level: 1 })).toBeVisible();
  await noA11yViolations(page);

  // One JSON document per line, as mongoexport writes it.
  const lines = [v1(1), v1(2), v1(3), v1(4, 'transferred')]
    .map((d) => JSON.stringify(d))
    .join('\n');
  await main.getByLabel('From Campusverse V1: Students and guardians').setInputFiles({
    name: 'students.json',
    mimeType: 'application/json',
    buffer: Buffer.from(lines),
  });
  const panel = main.getByRole('region', { name: 'Students and guardians' });
  await expect(panel.getByText('3 ready')).toBeVisible();
  await expect(panel.getByText('1 left out (no longer active in V1)')).toBeVisible();
  await noA11yViolations(page);
  await panel.getByRole('button', { name: /Import 3/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Import 3/ })
    .click();
  const history = main.getByRole('region', { name: 'Recent imports' });
  await expect(history.getByText(/From V1/)).toBeVisible({ timeout: 30_000 });
  await expect(history.getByText('Imported')).toBeVisible({ timeout: 30_000 });
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { name: string }[];
  expect(students.map((x) => x.name).sort()).toEqual([
    'Synthetic Vone 1',
    'Synthetic Vone 2',
    'Synthetic Vone 3',
  ]);
  await page.screenshot({
    path: `e2e/screenshots/data-import-${info.project.name}.png`,
    fullPage: true,
  });

  await history.getByRole('button', { name: 'Undo import' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Undo import' }).click();
  await expect(history.getByText('Undone')).toBeVisible({ timeout: 30_000 });
});

test('data import: a college imports its staff, and is pointed to its batches for students', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  const s = devSession(`Synthetic Import Trust ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/data-import');
  const tree = (await (await page.request.get('/api/v1/school/setup/tree')).json()) as {
    campuses: { campusId: string }[];
  };
  const { institutionId } = (await apiPost(
    page,
    `/organisation/campuses/${tree.campuses[0]!.campusId}/institutions`,
    { profile: 'affiliated_college', name: 'Synthetic Arts College', authorityCode: 'OU' },
  )) as { institutionId: string };
  await page.evaluate((id) => window.localStorage.setItem('cv.institution', id), institutionId);
  await page.reload();
  const main = page.getByRole('main');
  await expect(main.getByText('Students are enrolled into a batch')).toBeVisible();
  await expect(main.getByRole('region', { name: 'Students and guardians' })).toHaveCount(0);
  await noA11yViolations(page);

  const phone = () => `9${randomInt(100_000_000, 999_999_999)}`;
  await main.getByLabel('Upload .xlsx file: Staff').setInputFiles({
    name: 'staff.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await toXlsx([
      STAFF_HEADER,
      ['AC-1', 'Synthetic Lecturer One', phone(), null, 'Assistant Professor', null, null],
      ['AC-2', 'Synthetic Registrar Two', phone(), null, 'Registrar', null, null],
    ]),
  });
  const panel = main.getByRole('region', { name: 'Staff' });
  await expect(panel.getByText('2 ready')).toBeVisible();
  await panel.getByRole('button', { name: /Import 2/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Import 2/ })
    .click();
  const history = main.getByRole('region', { name: 'Recent imports' });
  await expect(history.getByText('Imported')).toBeVisible({ timeout: 30_000 });
});
