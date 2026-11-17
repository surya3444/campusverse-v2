// The helpdesk through the real screens (docs/specs/HELPDESK.md): a parent asks for help in the
// app; the owner replies with an internal note and a public answer and resolves it; the parent
// sees the answer. Staff raise their own requests on the web.
import { expect, test } from '@playwright/test';
import {
  apiPost,
  devSession,
  noA11yViolations,
  openApp,
  schoolWithStudents,
  sessionFor,
  signInAs,
} from './helpers';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('helpdesk: a parent asks in the app, the school answers and resolves', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic Helpdesk School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/helpdesk');
  await schoolWithStudents(page, s.institutionId);
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const parent = await sessionFor('guardian', s.orgId);
  await page.reload();
  await expect(page.getByText('No open requests.')).toBeVisible();
  await noA11yViolations(page);

  // A staff request of the owner's own.
  await page.getByRole('button', { name: 'New request' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Category').selectOption({ label: 'Facilities and repairs' });
  await dialog.getByLabel('Subject').fill('Synthetic: fan in the staff room');
  await dialog.getByLabel('Details').fill('It makes a noise.');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Synthetic: fan in the staff room')).toBeVisible();

  // The parent asks in the app (desktop run only; the app is phone-sized either way).
  const subject = 'Synthetic: bus timing changed?';
  if (info.project.name === 'desktop') {
    const app = await openApp(browser, parent);
    const v = { visible: true };
    await app.getByRole('button', { name: 'Help' }).filter(v).first().click({ timeout: 30_000 });
    await app.getByRole('button', { name: 'Ask for help' }).filter(v).click();
    await app.getByRole('radio', { name: 'Transport' }).filter(v).click();
    await app.getByLabel('Subject').filter(v).fill(subject);
    await app.getByLabel('Details').filter(v).fill('The bus came at 7:40 today instead of 7:20.');
    await noA11yViolations(app);
    await app.getByRole('button', { name: 'Send' }).filter(v).click();
    await expect(app.getByText(/The school will reply here/).filter(v)).toBeVisible();
    await app.close();
  } else {
    const home = (await (
      await page.request.get('http://localhost:4000/api/v1/parent/home', {
        headers: {
          authorization: `Bearer ${parent.accessToken}`,
          'x-org-id': parent.orgId,
          'x-person-id': parent.personId,
        },
      })
    ).json()) as { children: { personId: string }[] };
    const cats = (await (await page.request.get('/api/v1/helpdesk/categories')).json()) as {
      id: string;
      name: string;
    }[];
    const r = await page.request.post('http://localhost:4000/api/v1/helpdesk/tickets', {
      headers: {
        authorization: `Bearer ${parent.accessToken}`,
        'x-org-id': parent.orgId,
        'x-person-id': parent.personId,
      },
      data: {
        studentId: home.children[0]?.personId,
        categoryId: cats.find((c) => c.name === 'Transport')?.id,
        subject,
        body: 'The bus came at 7:40 today instead of 7:20.',
      },
    });
    expect(r.ok(), await r.text()).toBe(true);
  }

  // The school answers: an internal note, then a public answer that resolves it.
  await page.getByRole('radio', { name: 'Open' }).click();
  await page.reload();
  await page.getByRole('button', { name: new RegExp(subject.replace('?', '\\?')) }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText(/About /)).toBeVisible();
  await drawer.getByLabel('Reply').fill('Synthetic note: checking with the driver.');
  await drawer.getByRole('checkbox', { name: /Internal note/ }).check();
  await drawer.getByRole('button', { name: 'Send' }).click();
  await expect(drawer.getByText('Synthetic note: checking with the driver.')).toBeVisible();
  // The box clears once the note is saved.
  await expect(drawer.getByLabel('Reply')).toHaveValue('');
  await expect(drawer.getByRole('checkbox', { name: /Internal note/ })).not.toBeChecked();
  await drawer
    .getByLabel('Reply')
    .fill('From Monday the bus comes at 7:40. Sorry for the short notice.');
  await drawer.getByLabel('Then mark it').selectOption('resolved');
  await noA11yViolations(page);
  await drawer.getByRole('button', { name: 'Send' }).click();
  // Saved once the box clears; the panel then shows the request resolved.
  await expect(drawer.getByLabel('Reply')).toHaveValue('');
  await expect(drawer.getByText(/From Monday the bus comes at 7:40/)).toBeVisible();
  await expect(drawer.getByText(/^Transport · Resolved$/)).toBeVisible();
  await page.keyboard.press('Escape');

  // The parent sees the answer, never the note.
  const thread = (await (
    await page.request.get('http://localhost:4000/api/v1/helpdesk/requests', {
      headers: {
        authorization: `Bearer ${parent.accessToken}`,
        'x-org-id': parent.orgId,
        'x-person-id': parent.personId,
      },
    })
  ).json()) as { ticketId: string; state: string }[];
  expect(thread[0]?.state).toBe('resolved');
  const detail = (await (
    await page.request.get(`http://localhost:4000/api/v1/helpdesk/tickets/${thread[0]?.ticketId}`, {
      headers: {
        authorization: `Bearer ${parent.accessToken}`,
        'x-org-id': parent.orgId,
        'x-person-id': parent.personId,
      },
    })
  ).json()) as { messages: { body: string; internal: boolean }[] };
  expect(detail.messages.map((m) => m.internal)).toEqual([false, false]);
  await page.screenshot({
    path: `e2e/screenshots/helpdesk-${info.project.name}.png`,
    fullPage: true,
  });
});
