// Verse AI first (decision 0021) in the browser: the AI home shows what needs the owner, Verse AI
// prepares approving a bill and returning a book as cards, and nothing changes until Confirm. The
// panel does the same from any page. Works with the offline model or a real one: the checks are
// on the cards the server builds, not on the model's wording.
import { expect, test } from '@playwright/test';
import {
  apiPost,
  devSession,
  noA11yViolations,
  schoolWithStudents,
  sessionFor,
  signInAs,
} from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('Verse AI home: needs you, prepare, confirm; and the panel on a page', async ({
  page,
  context,
}, info) => {
  test.setTimeout(300_000);
  const s = devSession(`Synthetic Ask School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/ask');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  // The class teacher also works in the office and records a plumber's bill.
  const clerk = await sessionFor('teacher', s.orgId);
  const { roles } = (await (await page.request.get('/api/v1/access/roles')).json()) as {
    roles: { id: string; key: string }[];
  };
  await apiPost(page, '/access/assignments', {
    personId: clerk.personId,
    roleId: roles.find((r) => r.key === 'office')?.id,
    scope: { type: 'institution', id: s.institutionId },
    from: today,
    until: null,
  });
  const asClerk = {
    authorization: `Bearer ${clerk.accessToken}`,
    'x-org-id': clerk.orgId,
    'x-person-id': clerk.personId,
  };
  const cats = (await (
    await page.request.get(
      `http://localhost:4000/api/v1/expenses/categories?institutionId=${s.institutionId}`,
      { headers: asClerk },
    )
  ).json()) as { id: string; name: string }[];
  const bill = await page.request.post('http://localhost:4000/api/v1/expenses/bills', {
    headers: asClerk,
    data: {
      institutionId: s.institutionId,
      categoryId: cats.find((c) => c.name === 'Repairs and maintenance')?.id,
      payee: 'Synthetic Plumber',
      billDate: today,
      description: 'Leaking tank fixed',
      amountPaise: 185_000,
    },
  });
  expect(bill.ok(), await bill.text()).toBe(true);

  // A book on loan to a student.
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { personId: string }[];
  const { id: titleId } = (await apiPost(page, '/library/titles', {
    institutionId: s.institutionId,
    title: 'Synthetic Panchatantra Tales',
  })) as { id: string };
  await apiPost(page, `/library/titles/${titleId}/copies`, {
    institutionId: s.institutionId,
    accessionNos: ['ACC-0001', 'ACC-0002'],
  });
  for (const accessionNo of ['ACC-0001', 'ACC-0002'])
    await apiPost(page, '/library/issue', {
      institutionId: s.institutionId,
      accessionNo,
      personId: students[0]?.personId,
    });

  // The AI home: what needs the owner, and asking about it.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /What do you need/ })).toBeVisible();
  const needs = page.getByRole('region', { name: 'Needs you' });
  await expect(needs.getByText('1 bill waiting for approval · ₹1,850.00').first()).toBeVisible();
  await noA11yViolations(page);
  await needs.getByRole('button', { name: /Ask Verse AI.*1 bill waiting/ }).click();
  await expect(page.getByText('Which bills are waiting for approval?')).toBeVisible();
  await expect(page.getByText(/Synthetic Plumber/).last()).toBeVisible({ timeout: 60_000 });

  // Approve it: a card first, nothing changed yet; Confirm does it.
  const box = page.getByRole('textbox', { name: /follow-up/ });
  await box.fill('Approve the Synthetic Plumber bill');
  await box.press('Enter');
  const card = page.getByRole('region', { name: /Approve ₹1,850\.00 to Synthetic Plumber/ });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText('Money changes hands')).toBeVisible();
  const before = (await (
    await page.request.get(`/api/v1/expenses/figures?institutionId=${s.institutionId}`)
  ).json()) as { waiting: number };
  expect(before.waiting).toBe(1);
  await noA11yViolations(page);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card.getByRole('status')).toContainText('Done');
  const after = (await (
    await page.request.get(`/api/v1/expenses/figures?institutionId=${s.institutionId}`)
  ).json()) as { waiting: number; toPay: number };
  expect(after).toMatchObject({ waiting: 0, toPay: 1 });

  // A return prepared and put aside changes nothing.
  await box.fill('Return ACC-0002');
  await box.press('Enter');
  const ret = page.getByRole('region', { name: /Return Synthetic Panchatantra Tales/ }).last();
  await expect(ret).toBeVisible({ timeout: 60_000 });
  await ret.getByRole('button', { name: 'Not now' }).click();
  await expect(ret.getByRole('status')).toContainText('Put aside');
  await expect(
    page.getByRole('region', { name: 'Recent conversations' }).getByRole('button').first(),
  ).toBeVisible();
  await page.screenshot({ path: `e2e/screenshots/ask-${info.project.name}.png`, fullPage: true });

  // The panel, from the library page: return ACC-0001 and confirm.
  await page.goto('/library');
  await page.getByRole('banner').getByRole('button', { name: 'Ask Verse AI', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Verse AI' });
  await expect(panel.getByText(/Knows you.re on \/library/)).toBeVisible();
  await panel.getByRole('textbox').fill('Return ACC-0001');
  await panel.getByRole('button', { name: 'Ask' }).click();
  const panelCard = panel.getByRole('region', { name: /Return Synthetic Panchatantra Tales/ });
  await expect(panelCard).toBeVisible({ timeout: 60_000 });
  await panelCard.getByRole('button', { name: 'Return' }).click();
  await expect(panelCard.getByRole('status')).toContainText(
    /Done\. Synthetic Panchatantra Tales returned/,
  );
  await noA11yViolations(page);
});
