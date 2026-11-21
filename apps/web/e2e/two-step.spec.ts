// Two-step sign-in (rule book §12.4 decision 10, "MFA for staff") through the real screens: a staff
// member turns it on from their profile by scanning the code; someone with it on signs in with
// their phone code, then the authenticator code. The test computes codes as an app would.
import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { devSession, noA11yViolations, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** RFC 6238 for a base32 secret: what an authenticator app shows `drift` steps from now. */
function appCode(secret: string, drift = 0): string {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret.replace(/\s/g, '')) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + drift));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

test('two-step sign-in: turned on from the profile', async ({ page, context }, info) => {
  const s = devSession(`Synthetic Two-step School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/settings/profile');
  const section = page.getByRole('region', { name: 'Two-step sign-in' });
  await expect(section.getByText('Off', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  await expect(section.getByRole('img', { name: /QR code/ })).toBeVisible();
  const key = (await section.locator('.font-mono').textContent())!;
  await section.getByLabel('Code from the app').fill('000000');
  await section.getByRole('button', { name: 'Turn on' }).click();
  await expect(section.getByRole('alert')).toContainText('That code is wrong');
  await section.getByLabel('Code from the app').fill(appCode(key));
  await noA11yViolations(page);
  await section.getByRole('button', { name: 'Turn on' }).click();
  await expect(section.getByText('On', { exact: true })).toBeVisible();
  await noA11yViolations(page);
});

test('two-step sign-in: the phone code, then the app code', async ({ page, context }, info) => {
  test.setTimeout(120_000);
  const s = devSession(`Synthetic Two-step Login ${info.project.name}`);
  const phone = (s as typeof s & { phone: string }).phone;
  await signInAs(context, s);
  const headers = { 'x-requested-with': 'campusverse' };
  const setup = (await (
    await page.request.post('/api/v1/auth/mfa/setup', { headers, data: {} })
  ).json()) as { secret: string };
  const on = await page.request.post('/api/v1/auth/mfa/confirm', {
    headers,
    data: { code: appCode(setup.secret) },
  });
  expect(on.status()).toBe(204);
  await context.clearCookies();

  // Signing in now asks for the app's code after the phone code.
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: /Send code/ }).click();
  const again = page.getByRole('status').filter({ hasText: 'Simulated SMS' });
  await page
    .getByLabel('6-digit code')
    .fill(/(\d{6}) is your/.exec((await again.textContent()) ?? '')?.[1] ?? '');
  await page.getByRole('button', { name: /Verify|Sign in/ }).click();
  const app = page.getByLabel('Code from your authenticator app');
  await expect(app).toBeVisible();
  await app.fill('000000');
  await page.getByRole('button', { name: /Verify|Sign in/ }).click();
  await expect(page.getByText('That code from the app is wrong')).toBeVisible();
  await noA11yViolations(page);
  await app.fill(appCode(setup.secret, 1));
  await page.getByRole('button', { name: /Verify|Sign in/ }).click();
  await expect(page).not.toHaveURL(/\/login/);
});
