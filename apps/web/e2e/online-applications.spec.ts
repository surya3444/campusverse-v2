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
  await page.getByRole('button', { name: 'Online form' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/No online form for/)).toBeVisible();
  await dialog.getByLabel('A few words for families').fill('Visit us any Saturday, 10 to 12.');
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Set up the online form' }).click();
  const link = dialog.getByRole('textbox', { name: 'Link to share' });
  await expect(link).toHaveValue(/\/apply\/[a-z0-9-]+$/);
  const url = await link.inputValue();
  await dialog.getByRole('button', { name: 'Cancel' }).last().click();

  // A family on their phone, with no account.
  const family = await browser.newContext({
    viewport: { width: 360, height: 780 },
    isMobile: true,
    reducedMotion: 'reduce',
  });
  const apply = await family.newPage();
  await apply.goto(url);
  await expect(apply.getByText('Visit us any Saturday, 10 to 12.')).toBeVisible();
  await noA11yViolations(apply);
  await apply.getByLabel('Child’s full name').fill('Synthetic Kavya Rao');
  await apply.getByLabel('Date of birth').fill('2018-05-20');
  await apply.getByLabel('Gender').selectOption({ label: 'Girl' });
  await apply.getByLabel('Your full name').fill('Synthetic Lakshmi Rao');
  const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const form = apply.locator('form').first();
  await form.getByLabel('Mobile number').fill(phone);
  await form.getByRole('button', { name: 'Send code' }).click();
  const sms = form.getByText(/Simulated SMS/);
  await expect(sms).toBeVisible();
  const code = /(\d{6})/.exec((await sms.textContent()) ?? '')?.[1] ?? '';
  await form.getByLabel('6-digit code').fill(code);
  await form.getByRole('checkbox').last().check();
  await noA11yViolations(apply);
  await form.getByRole('button', { name: 'Submit application' }).click();
  await expect(apply.getByText('Application received')).toBeVisible();
  const ref = /reference is ([A-Z2-9]{6})/.exec(
    (await apply.getByText(/Your reference is/).textContent()) ?? '',
  )?.[1];
  expect(ref).toMatch(/^[A-Z2-9]{6}$/);
  await apply.screenshot({
    path: `e2e/screenshots/online-application-${info.project.name}.png`,
    fullPage: true,
  });

  // Checking where it stands.
  const check = apply.getByRole('region', { name: 'Check an application' });
  await check.getByLabel('Mobile number').fill(phone);
  await check.getByRole('button', { name: 'Send code' }).click();
  const sms2 = check.getByText(/Simulated SMS/);
  await expect(sms2).toBeVisible();
  await check
    .getByLabel('6-digit code')
    .fill(/(\d{6})/.exec((await sms2.textContent()) ?? '')?.[1] ?? '');
  await check.getByRole('button', { name: 'Show my applications' }).click();
  await expect(check.getByText(`Received · ${ref}`)).toBeVisible();
  await family.close();

  // The office sees it in the pipeline, marked Online.
  await page.reload();
  const card = page.getByRole('link').filter({ hasText: 'Synthetic Kavya Rao' });
  await expect(card.getByText('Online', { exact: true })).toBeVisible();
});
