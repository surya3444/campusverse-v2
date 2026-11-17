// Milestone 20: adding staff, the record with sealed details, documents with checks, checking
// in from the home screen, and the office's staff register.
import { expect, test } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, signInAs } from './helpers';

// A tiny valid PDF (synthetic).
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const GATE = { latitude: 12.971599, longitude: 77.594566 };

test('the office adds staff, files their papers, and runs the staff register', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === 'phone', 'one full run; screens are checked on phone below');
  test.setTimeout(240_000);
  const owner = devSession('Synthetic Staff School');
  await signInAs(context, owner);
  await context.grantPermissions(['geolocation'], { origin: 'http://localhost:3000' });
  await context.setGeolocation(GATE);
  await page.goto('/staff');

  // Add a staff member; their record opens.
  await page.getByRole('button', { name: 'Add staff' }).click();
  const form = page.getByRole('form', { name: 'Add a staff member' });
  await form.getByLabel('Full name').fill('Synthetic Lakshmi Teacher');
  await form
    .getByLabel('Mobile number')
    .fill(`9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`);
  await form.getByLabel('Designation').fill('TGT English');
  await form.getByLabel('Department').fill('Languages');
  await form.getByRole('button', { name: 'Add staff member' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Lakshmi Teacher' })).toBeVisible();
  await expect(page.getByText(/Created by Meera Owner Synthetic/)).toBeVisible();

  // Sealed bank details: only the last four come back (on the details tab of the 360 record).
  await page.getByRole('tab', { name: 'Personal & job details' }).click();
  await page.getByLabel('Bank account number').fill('0011 2233 4455 66');
  await page.getByLabel('IFSC').fill('SBIN0001234');
  await page.getByLabel('Qualifications').fill('B.Ed., M.A. English');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('On file: XXXX XXXX 5566')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/staff-record.png', fullPage: true });

  // A document, uploaded, scanned, then verified with the checker's name.
  await page.getByRole('tab', { name: 'Documents' }).click();
  await page.getByRole('button', { name: 'Add a document' }).click();
  const doc = page.getByRole('form', { name: 'Add a document' });
  await doc.getByLabel('Document').fill('B.Ed. certificate');
  await doc.getByLabel('Folder').selectOption('qualifications');
  await doc
    .getByLabel('File')
    .setInputFiles({ name: 'bed.pdf', mimeType: 'application/pdf', buffer: PDF });
  await doc.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('B.Ed. certificate')).toBeVisible();
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText(/Checked by Meera Owner Synthetic/)).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/staff-documents.png', fullPage: true });

  // The owner joins the staff too (same person, by name and number), then checks in at the gate.
  const me = (await (await page.request.get('/api/v1/people/me/profile')).json()) as {
    name: string;
    phone: string;
  };
  await apiPost(page, '/people/staff', {
    institutionId: owner.institutionId,
    name: me.name,
    phone: me.phone,
    joinedOn: new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10),
  });
  await apiPost(page, `/organisation/campuses/${await campusId(page)}`, {
    latitude: String(GATE.latitude),
    longitude: String(GATE.longitude),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByText('On campus')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check out' })).toBeVisible();

  // The office's register: the owner is in; the new teacher is marked on duty with a reason.
  await page.goto('/staff-attendance');
  const mine = page.getByRole('listitem').filter({ hasText: me.name }).first();
  await expect(mine.getByRole('combobox', { name: /Mark/ })).toHaveValue('present');
  const lakshmi = page.getByRole('listitem').filter({ hasText: 'Synthetic Lakshmi Teacher' });
  await lakshmi.getByRole('combobox', { name: /Mark/ }).selectOption('on_duty');
  await lakshmi.getByRole('button', { name: 'Save' }).click();
  await expect(lakshmi.getByText(/Marked by Meera Owner Synthetic/)).toBeVisible();
  // Changing a marked day needs a reason.
  await lakshmi.getByRole('combobox', { name: /Mark/ }).selectOption('absent');
  await expect(lakshmi.getByPlaceholder('Reason for the change')).toBeVisible();
  await lakshmi.getByPlaceholder('Reason for the change').fill('Duty cancelled; did not come in');
  await lakshmi.getByRole('button', { name: 'Save' }).click();
  await expect(lakshmi.getByText('Duty cancelled; did not come in')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/staff-register.png', fullPage: true });

  await page.getByRole('radio', { name: 'Month' }).click();
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
  await noA11yViolations(page);
});

test('a driver is added with the work role, and their safety checks are tracked', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const owner = devSession('Synthetic Driver School');
  await signInAs(context, owner);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add staff' }).click();
  const form = page.getByRole('form', { name: 'Add a staff member' });
  await form.getByText('Driver', { exact: true }).click();
  await expect(form.getByText(/Needs on file: Driving licence, Police verification/)).toBeVisible();
  await form.getByLabel('Full name').fill('Synthetic Ravi Driver');
  await form
    .getByLabel('Mobile number')
    .fill(`9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`);
  await noA11yViolations(page);
  await form.getByRole('button', { name: 'Add staff member' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Ravi Driver' })).toBeVisible();

  // The staff list shows the role and the checks still to do.
  await page.goto('/staff');
  await page.getByRole('radio', { name: 'Support' }).click();
  const row = page.getByRole('link', { name: /Synthetic Ravi Driver/ });
  await expect(row).toContainText('Driver');
  await expect(row).toContainText('3 checks due');
  await row.click();

  await page.getByRole('tab', { name: 'Safety checks' }).click();
  await page.getByRole('button', { name: 'Record a check: Driving licence' }).click();
  const check = page.getByRole('form', { name: 'Record a safety check' });
  await check.getByLabel('Reference or number').fill('TS0920190001234');
  await check.getByLabel('Valid until').fill('2031-01-31');
  await check.getByRole('button', { name: 'Save check' }).click();
  const licence = page.getByRole('listitem').filter({ hasText: 'Driving licence' });
  await expect(licence).toContainText('Valid');
  await expect(licence).toContainText('TS0920190001234');
  await noA11yViolations(page);
});

test('staff screens fit a phone and pass axe', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  test.setTimeout(120_000);
  const owner = devSession('Synthetic Staff Phone');
  await signInAs(context, owner);
  for (const path of ['/staff', '/staff-attendance']) {
    await page.goto(path);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await noA11yViolations(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, path).toBe(false);
  }
});

async function campusId(page: import('@playwright/test').Page): Promise<string> {
  const tree = (await (await page.request.get('/api/v1/school/setup/tree')).json()) as {
    campuses: { campusId: string }[];
  };
  return tree.campuses[0]!.campusId;
}
