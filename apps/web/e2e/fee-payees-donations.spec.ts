// Fees collected for others and donations through the real screens (owner's brief, 21 Nov 2026):
// VTU is added, its head marked "collected for VTU", a plan shows who gets what, the counter's
// receipt states VTU's share, the college pays VTU on with a reference; then a voluntary donation
// gets its own receipt, and a family with an admission in progress is refused.
import { expect, test } from '@playwright/test';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);

test('a college collects VTU’s fee, pays it on, and records a voluntary donation', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const shot = (name: string) =>
    page.screenshot({
      path: `e2e/screenshots/${name}-${info.project.name}.png`,
      fullPage: true,
    });
  const owner = devSession('Synthetic Engineering College');
  await signInAs(context, owner);
  await page.goto('/fees/payees');
  await schoolWithStudents(page, owner.institutionId);

  // Nothing collected for others yet: add VTU.
  await page.reload();
  await expect(page.getByText('Nothing is collected for others yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add a body' }).first().click();
  const add = page.getByRole('dialog', { name: 'Add a body you collect for' });
  await add.getByLabel('Full name').fill('Visvesvaraya Technological University');
  await add.getByLabel('Short name').fill('VTU');
  await noA11yViolations(page);
  await add.getByRole('button', { name: 'Add a body' }).click();
  await expect(page.getByRole('heading', { name: 'VTU' })).toBeVisible();

  // Its head, and the college's own; a plan shows who gets what.
  await page.goto('/fees/plans');
  for (const [code, name, forVtu] of [
    ['VTU_FEE', 'University fee', true],
    ['TUITION', 'Tuition', false],
  ] as const) {
    await page.getByRole('button', { name: 'Add fee type' }).click();
    const head = page.getByRole('form', { name: 'Add fee type' });
    await head.getByLabel('Code').fill(code);
    await head.getByLabel('Name', { exact: true }).fill(name);
    if (forVtu)
      await head
        .getByLabel('Collected for')
        .selectOption({ label: 'VTU · Visvesvaraya Technological University' });
    await head.getByRole('button', { name: 'Add fee type' }).click();
    await expect(head).toBeHidden();
  }
  await expect(page.getByText('For VTU')).toBeVisible();
  await page.getByRole('link', { name: 'New fee structure' }).click();
  await page.getByLabel('Fee structure name').fill('Class 3 fees');
  await page.getByText('Class 3', { exact: true }).click();
  await page.getByLabel('University fee Amount (₹)').fill('20,000');
  await page.getByLabel('Tuition Amount (₹)').fill('1,00,000');
  await expect(page.getByText('Who gets what')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'VTU' })).toContainText('₹20,000.00');
  await expect(page.getByRole('listitem').filter({ hasText: 'Your own fees' })).toContainText(
    '₹1,00,000.00',
  );
  await page.getByLabel('Instalment', { exact: true }).fill('Annual');
  await page.getByLabel('Due on').fill(iso(20));
  await shot('fee-plan-split');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/fees\/plans\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Finalise' }).click();
  await page.getByRole('button', { name: 'Bill students' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bill students' }).click();
  await expect(page.getByText('6 bills made.')).toBeVisible();

  // One family pays in full at the counter: the receipt states VTU's share.
  const billed = (await (
    await page.request.get(`/api/v1/finance/${owner.institutionId}/students?search=Synthetic`)
  ).json()) as { studentId: string; name: string }[];
  await page.goto(`/fees/students/${billed[0]!.studentId}`);
  await expect(page.getByText('For VTU').first()).toBeVisible();
  await page.getByRole('button', { name: /^Collect ₹1,20,000\.00$/ }).click();
  await expect(page.getByText(/Collected\. Receipt/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Print receipt' }).click();
  await expect(
    page.getByText(
      'Includes ₹20,000.00 collected for Visvesvaraya Technological University, paid on to them.',
    ),
  ).toBeVisible();

  // ₹20,000 is held for VTU; the college pays it on with the bank reference.
  await page.goto('/fees/payees');
  const strip = page.getByRole('region', { name: 'Collected for others' });
  await expect(strip).toContainText('₹20,000');
  await expect(page.getByRole('article', { name: 'VTU' })).toContainText('₹1,20,000.00');
  await noA11yViolations(page);
  await shot('fee-payees');
  await page.getByRole('button', { name: 'Pay VTU' }).click();
  const pay = page.getByRole('dialog', { name: 'Pay VTU' });
  await expect(pay.getByLabel('Amount')).toHaveValue('20000.00');
  await pay.getByLabel('Bank or draft reference').fill('UTR-SYNTH-2026');
  await noA11yViolations(page);
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('₹20,000.00 paid to VTU recorded.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay VTU' })).toBeHidden();

  // The statement: the payment made, and the student list the university asks for.
  await page.getByRole('link', { name: 'Statement: VTU' }).click();
  await expect(
    page.getByRole('heading', { name: 'Visvesvaraya Technological University' }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: /UTR-SYNTH-2026/ })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(1 + 1 + 1 + 6); // two headers, a payment, six students
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download list' }).click();
  expect((await download).suggestedFilename()).toMatch(/^VTU-.*-students\.csv$/);
  await noA11yViolations(page);
  await shot('fee-payee-statement');

  // A voluntary donation gets its own receipt.
  await page.goto('/donations');
  await expect(page.getByText('No donations this year')).toBeVisible();
  await page.getByRole('button', { name: 'Record donation' }).first().click();
  const gift = page.getByRole('dialog', { name: 'Record a donation' });
  await gift.getByLabel('Name').fill('Synthetic Alumni Donor');
  await gift.getByLabel('Mobile').fill('98765 43210');
  await gift.getByLabel('Amount (₹)').fill('25,000');
  await gift.getByLabel('Fund').fill('Library fund');
  await gift.getByLabel('Reference').fill('UPI-SYNTH-1');
  await expect(gift.getByRole('button', { name: 'Record donation' })).toBeDisabled();
  await gift.getByLabel(/The donor gives this freely/).check();
  await noA11yViolations(page);
  await gift.getByRole('button', { name: 'Record donation' }).click();
  await expect(page.getByText('Donation receipt')).toBeVisible();
  await expect(page.getByText(/^DON\/\d{4}-\d{2}\/000001$/)).toBeVisible();
  await expect(page.getByText(/Received as a voluntary donation/)).toBeVisible();
  await expect(page.getByText('Rupees Twenty-five Thousand Only', { exact: false })).toBeVisible();
  await noA11yViolations(page);
  await shot('donation-receipt');

  // A family with an admission in progress can't donate.
  const pipeline = (await (
    await page.request.get(`/api/v1/school/admissions/${owner.institutionId}?year=2026-27`)
  ).json()) as { classes: { classId: string }[] };
  await apiPost(page, `/school/admissions/${owner.institutionId}/enquiries`, {
    yearLabel: '2026-27',
    classId: pipeline.classes[0]!.classId,
    category: 'general',
    source: 'walk_in',
    childName: 'Synthetic Applicant Child',
    dateOfBirth: '2018-06-15',
    guardianName: 'Synthetic Applicant Parent',
    guardianPhone: '+919812300001',
  });
  await page.goto('/donations');
  await expect(page.getByRole('region', { name: /This year/ })).toContainText('₹25,000');
  await page.getByRole('button', { name: 'Record donation' }).first().click();
  const refused = page.getByRole('dialog', { name: 'Record a donation' });
  await refused.getByLabel('Name').fill('Synthetic Applicant Parent');
  await refused.getByLabel('Mobile').fill('9812300001');
  await refused.getByLabel('Amount (₹)').fill('5,00,000');
  await refused.getByLabel('Paid by').selectOption({ label: 'Cash' });
  await refused.getByLabel(/The donor gives this freely/).check();
  await refused.getByRole('button', { name: 'Record donation' }).click();
  await expect(refused.getByText(/has an admission in progress here/)).toBeVisible();
  await shot('donations');
});
