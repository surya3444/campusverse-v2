// The library through the real screens (docs/specs/LIBRARY.md): a title and its copies with
// suggested accession numbers, issuing to a student found by admission number, returning, and the
// parent seeing the child's book in the app.
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

test('library: catalogue, issue, return, and the parent app', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic Library School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/library');
  await schoolWithStudents(page, s.institutionId);
  // The borrower is a guardian's own child, so the app can show the book.
  await apiPost(page, `/school/setup/${s.institutionId}/invites`);
  const parent = await sessionFor('guardian', s.orgId);
  const home = (await (
    await page.request.get('http://localhost:4000/api/v1/parent/home', {
      headers: {
        authorization: `Bearer ${parent.accessToken}`,
        'x-org-id': parent.orgId,
        'x-person-id': parent.personId,
      },
    })
  ).json()) as { children: { personId: string; name: string }[] };
  const students = (await (
    await page.request.get(`/api/v1/people/students?institutionId=${s.institutionId}`)
  ).json()) as { personId: string; name: string; reference: string }[];
  const student = students.find((x) => x.personId === home.children[0]?.personId)!;
  await page.reload();
  await noA11yViolations(page);

  // A title, then two copies with the suggested accession numbers.
  await page.getByRole('radio', { name: 'Catalogue' }).click();
  await expect(page.getByText('No books yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add title' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Synthetic Panchatantra Tales');
  await dialog.getByLabel('Authors').fill('Synthetic Retold');
  await dialog.getByLabel('Shelf').fill('S-1');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: /Add copies/ }).click();
  await dialog.getByLabel('How many').fill('2');
  await expect(dialog.getByRole('textbox', { name: /Accession numbers/ })).toHaveValue('1\n2');
  await dialog.getByRole('textbox', { name: /Price/ }).fill('300');
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('2 copies, 2 in')).toBeVisible();

  // Issue copy 1 to a student found by admission number, then return copy 1.
  await page.getByRole('radio', { name: 'Desk' }).click();
  const issue = page.getByRole('region', { name: 'Issue a book' });
  await issue.getByLabel('Borrower').fill(student.reference);
  await issue.getByRole('button', { name: new RegExp(student.name) }).click();
  await issue.getByLabel('Accession number').fill('1');
  await issue.getByRole('button', { name: 'Issue', exact: true }).click();
  await expect(
    page.getByText(new RegExp(`Synthetic Panchatantra Tales issued to ${student.name}`)),
  ).toBeVisible();
  await expect(page.getByText(`${student.name}’s books`)).toBeVisible();
  await noA11yViolations(page);

  // Copy 2 to the same student, then copy 1 comes back.
  await issue.getByLabel('Accession number').fill('2');
  await issue.getByRole('button', { name: 'Issue', exact: true }).click();
  const ret = page.getByRole('region', { name: 'Return a book' });
  await ret.getByLabel('Accession number').fill('1');
  await ret.getByRole('button', { name: 'Return' }).click();
  await expect(
    page.getByText(new RegExp(`Synthetic Panchatantra Tales returned by ${student.name}`)),
  ).toBeVisible();

  // The parent sees copy 2 in the app (the app side runs once, at phone width).
  if (info.project.name === 'phone') return;
  const app = await openApp(browser, parent);
  const v = { visible: true };
  await app.getByRole('button', { name: 'Library' }).filter(v).first().click({ timeout: 30_000 });
  await expect(app.getByText('Synthetic Panchatantra Tales').filter(v)).toBeVisible();
  await expect(app.getByText(/Return by/).filter(v)).toBeVisible();
  await noA11yViolations(app);
  await app.screenshot({ path: 'e2e/screenshots/parent-app-library.png', fullPage: true });
});
