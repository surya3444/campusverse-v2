// Online application forms through the real screens (docs/specs/ONLINE_APPLICATIONS.md): the
// office sets up the form and copies its link; a family with no account applies after the mobile
// check and looks up its status; the application shows in the pipeline as Online.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('online form: set up, a family applies and checks status', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const s = devSession(`Synthetic Online School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/admissions');
  await schoolWithStudents(page, s.institutionId);
  await page.reload();

  // The office sets up this year's form.
  await page.goto('/admissions/forms');
  await page.getByLabel('A few words for families').fill('Visit us any Saturday, 10 to 12.');
  await page.getByRole('button', { name: 'Create the form' }).click();
  const link = page.getByRole('textbox', { name: 'Link to share' });
  await expect(link).toHaveValue(/\/apply\/[a-z0-9-]+$/);
  const url = await link.inputValue();
  await noA11yViolations(page);

  // A family on their phone, with no account, applies without papers to hand.
  const family = await browser.newContext({
    viewport: { width: 360, height: 780 },
    isMobile: true,
    reducedMotion: 'reduce',
  });
  const apply = await family.newPage();
  await apply.goto(url);
  await expect(apply.getByText('Visit us any Saturday, 10 to 12.')).toBeVisible();
  await noA11yViolations(apply);
  const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const code = async (scope: ReturnType<typeof apply.locator> | typeof apply) => {
    await scope.getByLabel('Mobile number').first().fill(phone);
    await scope.getByRole('button', { name: 'Send code' }).first().click();
    const sms = scope.getByText(/Simulated SMS/).first();
    await expect(sms).toBeVisible();
    await scope
      .getByLabel('6-digit code')
      .first()
      .fill(/(\d{6})/.exec((await sms.textContent()) ?? '')?.[1] ?? '');
  };
  await code(apply);
  await apply.getByRole('button', { name: 'Check my mobile' }).click();
  await apply.getByLabel('Child’s full name').fill('Synthetic Kavya Rao');
  await apply.getByLabel('Date of birth').fill('2018-05-20');
  await apply.getByLabel('Gender').selectOption({ label: 'Girl' });
  await apply.getByRole('button', { name: 'Continue' }).click();
  await apply.getByLabel('Your full name').fill('Synthetic Lakshmi Rao');
  await apply.getByRole('button', { name: 'Continue' }).click();
  await apply.getByRole('button', { name: 'Continue' }).click();
  await expect(apply.getByText(/Missing a paper\?/)).toBeVisible();
  await noA11yViolations(apply);
  await apply.getByRole('button', { name: 'Continue' }).click();
  await apply.getByRole('checkbox').check();
  await apply.getByRole('button', { name: 'Submit application' }).click();
  await expect(apply.getByText('Application received')).toBeVisible();
  const ref = /reference is ([A-Z2-9]{6})/.exec(
    (await apply.getByText(/Your reference is/).textContent()) ?? '',
  )?.[1];
  expect(ref).toMatch(/^[A-Z2-9]{6}$/);
  await apply.screenshot({
    path: `e2e/screenshots/online-application-${info.project.name}.png`,
    fullPage: true,
  });

  // Checking where it stands: papers are needed, and they go up from here.
  const check = apply.getByRole('region', { name: 'Check an application' });
  await code(check as unknown as typeof apply);
  await check.getByRole('button', { name: 'Show my applications' }).click();
  await expect(check.getByText('Papers needed: upload them below')).toBeVisible();
  const [chooser] = await Promise.all([
    apply.waitForEvent('filechooser'),
    check.getByRole('button', { name: 'Upload Birth certificate' }).click(),
  ]);
  await chooser.setFiles({
    name: 'birth.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
  });
  await expect(check.getByText('birth.pdf')).toBeVisible();
  await check.getByRole('button', { name: 'Send papers' }).click();
  await expect(check.getByText(/The school will check them/)).toBeVisible();
  await noA11yViolations(apply);
  await family.close();

  // The office sees it as an online application waiting on papers, with one to check.
  await page.goto('/admissions/applications?tab=papers');
  const row = page.getByRole('link').filter({ hasText: 'Synthetic Kavya Rao' });
  await expect(row.getByText('Online form')).toBeVisible();
  await expect(row.getByText('1 to check')).toBeVisible();
});
