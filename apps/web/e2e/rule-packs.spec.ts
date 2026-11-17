// Campus Core › Rule Packs (rule book §15.1): a CBSE school in Karnataka sees the packs it follows,
// the version in use, what it sets and its sources, each marked unchecked until verified.
import { expect, test } from '@playwright/test';
import { devSession, noA11yViolations, signInAs } from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('rule packs: the versions a school follows, with what they set and their sources', async ({
  page,
  context,
}, info) => {
  const s = devSession(`Synthetic Rules School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/rule-packs');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Rule Packs', level: 1 })).toBeVisible();
  const cbse = main.getByRole('region', { name: 'CBSE' });
  await expect(cbse.getByText('Version 1 in use')).toBeVisible();
  await expect(cbse.getByText(/Attendance: at least 75% for exams/)).toBeVisible();
  await expect(cbse.getByText(/Grading: A1 from 91%; pass mark 33%/)).toBeVisible();
  await expect(cbse.getByText('Not yet checked against the official order').first()).toBeVisible();
  const ka = main.getByRole('region', { name: 'Karnataka' });
  await expect(ka.getByText(/Professional tax: ₹200.00 a month from ₹25,000.00/)).toBeVisible();
  await expect(ka.getByText(/Transfer certificate within 7 days/)).toBeVisible();
  await expect(main.getByRole('region', { name: 'EPF and ESI (central)' })).toContainText(
    'EPF: 12% on wages up to ₹15,000.00',
  );
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/rule-packs-${info.project.name}.png`,
    fullPage: true,
  });
});
