// Milestone 12 exit check through the real screens: an enquiry becomes an enrolled student, then
// later receives a TC (class teacher checks, owner approves and issues), verified by QR without
// signing in; a duplicate supersedes the original.
import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiPost, devSession, noA11yViolations, schoolWithStudents, signInAs } from './helpers';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const API = 'http://127.0.0.1:4000/api/v1';
const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);

function teacherSession(orgId: string, requestId = '') {
  for (let i = 0; ; i++) {
    try {
      const out = execSync(
        `pnpm --filter @campusverse/api -s dev-session --teacher ${orgId} ${requestId}`,
        {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      return JSON.parse(out.trim().split('\n').pop() ?? '{}') as {
        orgId: string;
        personId: string;
        accessToken: string;
      };
    } catch (e) {
      if (i > 30) throw e;
      execSync('sleep 1');
    }
  }
}

test('admissions to TC: an enquiry is enrolled, then leaves with a verified TC', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(
    info.project.name === 'phone',
    'one full run; the screens are checked for phone overflow elsewhere',
  );
  test.setTimeout(240_000);
  const owner = devSession('Synthetic Admissions School');
  await signInAs(context, owner);
  await page.goto('/admissions');
  await schoolWithStudents(page, owner.institutionId);
  await apiPost(page, `/school/setup/${owner.institutionId}/invites`);
  // A published fee plan for Class 3: an offer discloses it in full.
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
  const class3 = groups.find((g) => g.label === 'Class 3')!;
  const plan = (await apiPost(page, `/finance/${owner.institutionId}/plans`, {
    name: 'Class 3 fees',
    groupIds: [class3.id],
    lines: [{ headId: head.id, amountPaise: 1_800_000 }],
    instalments: [{ label: 'Annual', dueOn: iso(30), shareBp: 10_000 }],
    lateFeePaise: 0,
    graceDays: 0,
  })) as { id: string };
  await apiPost(page, `/finance/plans/${plan.id}/publish`);

  // The enquiry.
  await page.reload();
  await page.getByRole('button', { name: 'New enquiry' }).click();
  await page.getByLabel("Child's name").fill('Ravi Synthetic Journey');
  await page.getByLabel('Date of birth').fill('2018-06-15');
  await page.getByLabel("Parent or guardian's name").fill('Lakshmi Synthetic Journey');
  await page
    .getByLabel('Mobile number')
    .fill(`9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`);
  await page.getByRole('button', { name: 'Save enquiry' }).click();
  const card = page.getByRole('link', { name: /Ravi Synthetic Journey/ });
  await expect(card).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/admissions-pipeline.png', fullPage: true });

  // Applied → offered (fees disclosed) → accepted → enrolled.
  await card.click();
  await page.getByLabel('Move to').selectOption('applied');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByText('Applied', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Class 3 fees')).toBeVisible();
  await page.getByRole('button', { name: 'Make offer' }).click();
  await expect(page.getByText(/Offer made\. It ends on/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Family accepted' }).click();
  await page.getByLabel('Section').selectOption({ label: 'Class 3-A' });
  await page.getByRole('button', { name: 'Enrol', exact: true }).click();
  await expect(page.getByText(/Enrolled\. Admission number \d{4}-\d{4}\./).first()).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: 'e2e/screenshots/admissions-enrolled.png', fullPage: true });

  // Later, the TC.
  await page.goto('/certificates');
  await page.getByRole('button', { name: 'Request a certificate' }).click();
  await page.getByLabel('Find the student').fill('Ravi Synthetic');
  await page.getByRole('button', { name: /Ravi Synthetic Journey/ }).click();
  await page.getByRole('combobox', { name: /^Certificate/ }).selectOption('tc');
  await page.getByLabel('Last day at school').fill(iso(0));
  await page.getByLabel('Reason for leaving').fill('Family moving to another city');
  await page.getByRole('button', { name: 'Request', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Transfer certificate/ })).toBeVisible();
  await expect(page.getByText(/in fees is unpaid\. A warning only/)).toBeVisible();
  await expect(
    page
      .getByText('Twelfth June', { exact: false })
      .or(page.getByText('Fifteenth June', { exact: false })),
  ).toBeVisible();
  await noA11yViolations(page);
  const requestId = page.url().split('/').pop()!;

  // The class teacher checks it (as they would from their own login); the owner approves and issues.
  const teacher = teacherSession(owner.orgId, requestId);
  const checked = await page.request.post(`${API}/school/certificates/${requestId}/check`, {
    headers: {
      authorization: `Bearer ${teacher.accessToken}`,
      'x-org-id': teacher.orgId,
      'x-person-id': teacher.personId,
    },
  });
  expect(checked.status()).toBe(204);
  await page.reload();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('button', { name: 'Issue', exact: true }).click();
  await expect(page.getByText(/Issued as TC\/\d{4}-\d{2}\/0001\./).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/certificate-issued.png', fullPage: true });
  const verifyHref = await page.getByRole('link', { name: 'Public check' }).getAttribute('href');

  // Anyone can check the QR code, with no sign-in, and sees no student details.
  const stranger = await browser.newContext();
  const pub = await stranger.newPage();
  await pub.goto(`http://localhost:3000${verifyHref}`);
  await expect(pub.getByText('This document is genuine and current.')).toBeVisible();
  await expect(pub.getByText('Ravi')).toHaveCount(0);
  await noA11yViolations(pub);
  await pub.screenshot({ path: 'e2e/screenshots/verify-valid.png', fullPage: true });

  // A duplicate for a lost copy: the original now shows as superseded.
  await page.getByRole('button', { name: 'Issue a duplicate' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Original lost in transit');
  await page.getByRole('dialog').getByRole('button', { name: 'Issue a duplicate' }).click();
  await expect(page.getByText(/version 2/)).toBeVisible();
  await pub.reload();
  await expect(pub.getByText(/replaced by a newer version/)).toBeVisible();

  // The student has left: no longer in the class list.
  const students = (await (
    await page.request.get(
      `/api/v1/people/students?institutionId=${owner.institutionId}&search=Ravi`,
    )
  ).json()) as {
    status: string;
  }[];
  expect(students[0]?.status).toBe('left');
});
