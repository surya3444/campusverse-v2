// Quality & Compliance › Government Reports (rule book §13.11): UDISE+ readiness from live
// records; a PEN added on the record moves the student out of "Without PEN"; the list exports.
import { expect, test } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('government reports: UDISE+ readiness and export', async ({ page, context }, info) => {
  test.setTimeout(150_000);
  const s = devSession(`Synthetic Returns School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/government-reports');
  await schoolWithStudents(page, s.institutionId);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Government Reports', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'UDISE+ readiness' });
  await expect(table.locator('tbody tr')).toHaveCount(6);
  await noA11yViolations(page);

  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { personId: string; name: string }[];
  const child = students[0]!;
  await apiPost(page, `/people/students/${child.personId}/pen`, { pen: '20230101234' });
  await page.reload();
  const row = table.getByRole('row', { name: new RegExp(child.name) });
  await expect(row).toContainText('20230101234');
  await expect(row.getByText('PEN', { exact: true })).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export list' }).click();
  expect((await download).suggestedFilename()).toBe('udise-readiness.csv');

  // APAAR from UDISE+: stored only once a verified guardian has allowed APAAR.
  const consent = (await (
    await page.request.get(`/api/v1/consent/students/${child.personId}`)
  ).json()) as { guardians: { personId: string }[] };
  const guardianId = consent.guardians[0]!.personId;
  const { id: noticeId } = (await apiPost(page, '/privacy/notices', {
    purpose: 'apaar_id',
    language: 'en',
    body: 'Synthetic notice: we create or link your child’s APAAR ID with UDISE+.',
  })) as { id: string };
  const list = `Student Name,PEN,APAAR ID\n${child.name},20230101234,123412341234\nNobody Known,20239999999,999988887777\n`;
  const upload = () =>
    page.getByLabel('Upload the UDISE+ APAAR list (.csv)').setInputFiles({
      name: 'apaar.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(list),
    });
  const sync = page.getByRole('region', { name: 'APAAR from UDISE+' });
  await upload();
  await expect(sync.getByRole('row', { name: new RegExp(child.name) })).toContainText(
    'No consent: not stored',
  );
  await expect(sync.getByRole('row', { name: /Nobody Known/ })).toContainText(
    'No student with this PEN',
  );
  await apiPost(page, `/consent/students/${child.personId}`, {
    noticeId,
    guardianId,
    decision: 'granted',
    source: 'paper',
  });
  await apiPost(page, `/consent/guardians/${guardianId}/verify`, {
    method: 'document_seen',
    document: 'aadhaar',
  });
  await upload();
  await expect(sync.getByRole('row', { name: new RegExp(child.name) })).toContainText(
    'Ready to store',
  );
  await noA11yViolations(page);
  await sync.getByRole('button', { name: 'Store 1 APAAR ID' }).click();
  await page
    .getByRole('form', { name: 'Store APAAR IDs' })
    .getByRole('button', { name: 'Store 1 APAAR ID' })
    .click();
  await expect(page.getByText('1 APAAR ID stored.')).toBeVisible();
  await page.reload();
  await expect(table.getByRole('row', { name: new RegExp(child.name) })).toContainText('Recorded');
});
