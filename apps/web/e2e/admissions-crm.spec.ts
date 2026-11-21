// Admissions as a module, through the real screens (owner's brief, 20 Nov 2026): the office sets
// up the form, adds a lead and sends them a personal link, logs a call and finishes a follow-up;
// the family applies on their phone with papers; the office rejects a blurred photo and asks
// again; the family sends it; the office verifies, offers, enrols, and the student record shows
// the admission. A bulk upload is checked, imported and undone. All data synthetic.
import { expect, test, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);

/** The personal link inside the ready message. */
async function linkIn(page: Page) {
  const dialog = page.getByRole('dialog', { name: /ready/ });
  await expect(dialog).toBeVisible();
  const text = (await dialog.getByText(/https?:\/\/\S+\/apply\//).textContent()) ?? '';
  const url = /(https?:\/\/\S+\?invite=[A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';
  expect(url).toContain('/apply/');
  return url.replace(/^https?:\/\/[^/]+/, 'http://localhost:3000');
}

async function verifyMobile(apply: Page, phone: string) {
  await apply.getByLabel('Mobile number').first().fill(phone);
  await apply.getByRole('button', { name: 'Send code' }).first().click();
  const sms = apply.getByText(/Simulated SMS/).first();
  await expect(sms).toBeVisible();
  await apply
    .getByLabel('6-digit code')
    .first()
    .fill(/(\d{6})/.exec((await sms.textContent()) ?? '')?.[1] ?? '');
  await apply.getByRole('button', { name: 'Check my mobile' }).click();
}

const paper = (apply: Page, title: string) =>
  apply.locator('li').filter({ hasText: title }).locator('input[type=file]');

test('a lead becomes a student: personal form, papers, verification, enrolment', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(info.project.name === 'phone', 'the family side runs on a phone inside this test');
  test.setTimeout(300_000);
  const owner = devSession(`Synthetic CRM School ${randomInt(1e6)}`);
  await signInAs(context, owner);
  await page.goto('/admissions');
  await schoolWithStudents(page, owner.institutionId);
  const head = (await apiPost(page, `/finance/${owner.institutionId}/heads`, {
    code: 'TUITION',
    name: 'Tuition',
    taxClass: 'education_exempt',
    rteExempt: true,
    refundable: false,
  })) as { id: string };
  const groups = (await (
    await page.request.get(`/api/v1/communications/${owner.institutionId}/audience-groups`)
  ).json()) as { id: string; label: string }[];
  const plan = (await apiPost(page, `/finance/${owner.institutionId}/plans`, {
    name: 'Class 3 fees',
    groupIds: [groups.find((g) => g.label === 'Class 3')?.id ?? ''],
    lines: [{ headId: head.id, amountPaise: 1_800_000 }],
    instalments: [{ label: 'Annual', dueOn: iso(30), shareBp: 10_000 }],
    lateFeePaise: 0,
    graceDays: 0,
  })) as { id: string };
  await apiPost(page, `/finance/plans/${plan.id}/publish`);

  // The office sets up this year's form.
  await page.goto('/admissions/forms');
  await expect(page.getByRole('heading', { name: 'Application forms', level: 1 })).toBeVisible();
  await page.getByLabel('A few words for families').fill('Visit us any Saturday, 10 to 12.');
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'Create the form' }).click();
  await expect(page.getByRole('textbox', { name: 'Link to share' })).toHaveValue(/\/apply\//);
  await page.screenshot({ path: 'e2e/screenshots/admissions-forms.png', fullPage: true });

  // A lead from a phone call, sent the form on WhatsApp.
  const mobile = `9${randomInt(100_000_000, 999_999_999)}`;
  await page.goto('/admissions');
  await page.getByRole('button', { name: 'New lead' }).first().click();
  const lead = page.getByRole('dialog', { name: 'New lead' });
  await lead.getByLabel("Child's name").fill('Ravi Synthetic Journey');
  await lead
    .getByRole('combobox', { name: 'Class', exact: true })
    .selectOption({ label: 'Class 3' });
  await lead.getByLabel("Parent or guardian's name").fill('Lakshmi Synthetic Journey');
  await lead.getByLabel('Mobile number').fill(mobile);
  await lead.getByRole('combobox', { name: 'Source' }).selectOption('phone');
  await lead.getByLabel(/^Campaign/).fill('Open day');
  await noA11yViolations(page);
  await lead.getByRole('button', { name: 'Save lead' }).click();
  const send = page.getByRole('dialog', { name: /Send the application form for Ravi/ });
  await expect(send.getByLabel('Mobile number')).toHaveValue(mobile);
  await noA11yViolations(page);
  await send.getByRole('button', { name: 'Create link' }).click();
  const link = await linkIn(page);
  await expect(page.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/91\d{10}\?text=/,
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('link', { name: /Ravi Synthetic Journey/ })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/admissions-pipeline.png', fullPage: true });

  // A call logged on the Leads page with the next follow-up, then done from Follow-ups.
  await page.goto('/admissions/leads');
  await page
    .getByRole('button', { name: 'Log a call or note for Ravi Synthetic Journey' })
    .first()
    .click();
  const log = page.getByRole('dialog', { name: /Log what happened/ });
  await log.getByText('Interested', { exact: true }).click();
  await log.getByLabel(/^Notes/).fill('Asked about the school bus');
  await log.getByLabel('Schedule the next follow-up').check();
  await log.getByLabel('Due on').fill(iso(0));
  await log.getByLabel('What for').fill('Check the form came back');
  await log.getByRole('button', { name: 'Save' }).click();
  await expect(log).toBeHidden();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/admissions-leads.png', fullPage: true });
  await page.goto('/admissions/follow-ups?tab=everyone');
  await expect(page.getByText('Check the form came back')).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'Mark done: Ravi Synthetic Journey' }).first().click();
  const done = page.getByRole('dialog', { name: /Follow-up done/ });
  await done.getByRole('button', { name: 'Form sent' }).click();
  await done.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Form sent ·').first()).toBeVisible();

  // The family, on their phone, with no account.
  const family = await browser.newContext({
    viewport: { width: 360, height: 780 },
    isMobile: true,
    reducedMotion: 'reduce',
  });
  const apply = await family.newPage();
  await apply.goto(link);
  await expect(apply.getByText(/invited you to apply for Ravi Synthetic Journey/)).toBeVisible();
  await noA11yViolations(apply);
  await verifyMobile(apply, mobile);
  await expect(apply.getByLabel('Child’s full name')).toHaveValue('Ravi Synthetic Journey');
  await apply.getByLabel('Date of birth').fill('2018-06-15');
  await apply.getByLabel('Gender').selectOption({ label: 'Boy' });
  await apply.getByRole('button', { name: 'Continue' }).click();
  await expect(apply.getByText('Checked')).toBeVisible();
  await apply.getByLabel('Full name', { exact: true }).fill('Arun Synthetic Journey');
  await apply.getByLabel('They are the child’s').selectOption('father');
  await apply.getByRole('button', { name: 'Continue' }).click();
  await apply.getByLabel('House, street and area').fill('12 Synthetic Lane');
  await apply.getByLabel('City or town').fill('Mysuru');
  await apply.getByLabel('PIN code').fill('570001');
  await apply.getByLabel(/^Mother tongue/).fill('Kannada');
  await noA11yViolations(apply);
  await apply.getByRole('button', { name: 'Continue' }).click();
  await paper(apply, 'Birth certificate').setInputFiles({
    name: 'birth.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(apply.getByText('birth.pdf')).toBeVisible();
  await paper(apply, 'Passport-size photo').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await paper(apply, 'Address proof').setInputFiles({
    name: 'address.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(apply.getByText('address.pdf')).toBeVisible();
  await noA11yViolations(apply);
  await apply.getByRole('button', { name: 'Continue' }).click();
  await expect(apply.getByText('Arun Synthetic Journey')).toBeVisible();
  await apply.getByRole('checkbox').check();
  await noA11yViolations(apply);
  await apply.screenshot({ path: 'e2e/screenshots/apply-review.png', fullPage: true });
  await apply.getByRole('button', { name: 'Submit application' }).click();
  await expect(apply.getByText('Application received')).toBeVisible();
  await apply.screenshot({ path: 'e2e/screenshots/apply-received.png', fullPage: true });

  // The office checks the papers: the photo is blurred.
  await page.goto('/admissions/applications');
  await page.getByRole('link', { name: /Ravi Synthetic Journey/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Ravi Synthetic Journey', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('Check the papers')).toBeVisible();
  await page.getByRole('tab', { name: /^Papers/ }).click();
  await page.getByRole('button', { name: 'Accept Birth certificate' }).click();
  await page.getByRole('button', { name: 'Accept Address proof' }).click();
  await page.getByRole('button', { name: 'Reject Passport-size photo' }).click();
  const reject = page.getByRole('dialog', { name: /Reject Passport-size photo/ });
  await reject.getByLabel('Reason').fill('Too blurred to see the face');
  await reject.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByText('Rejected: Too blurred to see the face')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/admissions-papers.png', fullPage: true });
  await page.getByRole('button', { name: 'Ask for papers' }).first().click();
  await page
    .getByRole('dialog', { name: /Ask for papers/ })
    .getByRole('button', { name: 'Create the request' })
    .click();
  const papersLink = await linkIn(page);
  await page.getByRole('button', { name: 'Done' }).click();

  // The family sends a clear photo through the papers link.
  await apply.goto(papersLink);
  await expect(apply.getByText(/needs a few papers/)).toBeVisible();
  await verifyMobile(apply, mobile);
  await expect(apply.getByText('The school said: Too blurred to see the face')).toBeVisible();
  await paper(apply, 'Passport-size photo').setInputFiles({
    name: 'clear.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(apply.getByText('clear.png')).toBeVisible();
  await apply.getByRole('button', { name: 'Send papers' }).click();
  await expect(apply.getByText('Papers sent')).toBeVisible();
  await noA11yViolations(apply);
  await family.close();

  // Verified, offered, accepted, enrolled.
  await page.reload();
  await page.getByRole('tab', { name: /^Papers/ }).click();
  await page.getByRole('button', { name: 'Accept Passport-size photo' }).click();
  await page.getByRole('button', { name: 'Verify application' }).first().click();
  await expect(page.getByText('Offer a seat')).toBeVisible();
  await page.getByRole('button', { name: 'Make offer' }).click();
  await expect(page.getByText('Waiting for the family')).toBeVisible();
  await page.getByRole('button', { name: 'Family accepted' }).click();
  await page.getByLabel('Section').selectOption({ label: 'Class 3-A' });
  await page.getByRole('button', { name: 'Enrol', exact: true }).click();
  await expect(page.getByText(/In Class 3-A, roll number \d+/)).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('Family submitted the form')).toBeVisible();
  await expect(page.getByText('Family sent the papers')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/admissions-record.png', fullPage: true });

  // The student record has everything, and how they were admitted.
  await page.getByRole('link', { name: 'Open student record' }).click();
  await page.getByRole('tab', { name: 'Personal' }).click();
  const card = page.getByRole('region', { name: 'Admission' });
  await expect(card.getByText('Open day')).toBeVisible();
  await expect(card.getByText(/Meera|Owner|Synthetic/).first()).toBeVisible();
  await expect(page.getByText('Mysuru').first()).toBeVisible();
  await expect(page.getByText('Kannada').first()).toBeVisible();
  await noA11yViolations(page);
});

test('bulk upload: checked row by row, imported, undone', async ({ page, context }, info) => {
  test.skip(
    info.project.name === 'phone',
    'one run is enough; the page is checked on a phone in the sweep',
  );
  test.setTimeout(180_000);
  const owner = devSession(`Synthetic Upload School ${randomInt(1e6)}`);
  await signInAs(context, owner);
  await page.goto('/admissions/import');
  await schoolWithStudents(page, owner.institutionId);
  await page.reload();
  await expect(page.getByText('No uploads yet')).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose an \.xlsx/ })).toBeEnabled();
  const fresh = `9${randomInt(100_000_000, 999_999_999)}`;
  const csv = [
    'Student Name,Class,Father Name,Mobile No.,DOB',
    `Synthetic Kavya Upload,Class 3,Synthetic Ravi,${fresh},15/06/2018`,
    'Synthetic Bad Row,Class 99,Synthetic X,12345,',
  ].join('\n');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(
    page.getByText('Mobile is not a 10-digit Indian number · Class not found'),
  ).toBeVisible();
  await page.getByLabel(/^Campaign/).fill('Newspaper ad');
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/admissions-import.png', fullPage: true });
  await page.getByRole('button', { name: 'Add 1 lead' }).click();
  await expect(page.getByText('1 lead added, 1 rows skipped.').first()).toBeAttached();
  await page.getByRole('button', { name: 'Undo leads.csv' }).click();
  await page
    .getByRole('dialog', { name: 'Undo leads.csv' })
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(page.getByText(/^Undone /)).toBeVisible();
});
