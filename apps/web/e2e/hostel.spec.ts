// The hostel through the real screens (docs/specs/HOSTEL.md): a hostel, a room and a bed for a
// guardian's child; the night roll call; the parent asks for an outpass in the app; the warden
// approves it, lets the child out and marks them back.
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

test('hostel: rooms and beds, roll call, an outpass from the parent app', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const s = devSession(`Synthetic Hostel School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/hostel');
  await schoolWithStudents(page, s.institutionId);
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
  const child = students.find((x) => x.personId === home.children[0]?.personId)!;
  await page.reload();
  await expect(page.getByText('No hostel yet.')).toBeVisible();
  await noA11yViolations(page);

  // A hostel, a room with two beds, and bed 1 for the child.
  await page.getByRole('button', { name: 'Add hostel' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Synthetic Residence');
  await dialog.getByLabel('For').selectOption('mixed');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Add room' }).click();
  await dialog.getByLabel('Room number').fill('101');
  await dialog.getByLabel('Beds').fill('2');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Give this bed Room 101, bed 1' }).click();
  await dialog.getByLabel('Student').fill(child.reference);
  await dialog.getByRole('button', { name: new RegExp(child.name) }).click();
  await noA11yViolations(page);
  await dialog.getByRole('button', { name: 'Give this bed' }).click();
  await expect(dialog).toBeHidden();
  const rooms = page.getByRole('region', { name: /Synthetic Residence/ });
  await expect(rooms.getByText(child.name, { exact: true }).first()).toBeVisible();
  await expect(rooms.getByText('Free')).toBeVisible();
  await noA11yViolations(page);

  // Tonight's roll call: the child is absent.
  await page.getByRole('radio', { name: 'Roll call' }).click();
  const roll = page.getByRole('region', { name: /Roll call/ });
  await expect(roll.getByText('1 not marked yet')).toBeVisible();
  await roll
    .getByRole('radiogroup', { name: child.name })
    .getByRole('radio', { name: 'Absent' })
    .click();
  await roll.getByRole('button', { name: 'Save roll call' }).click();
  await expect(roll.getByText(/Saved\. 1 absent/)).toBeVisible();
  await noA11yViolations(page);

  // The parent sees the bed and the roll call, and asks for an outpass (once, at desktop width).
  if (info.project.name === 'desktop') {
    const app = await openApp(browser, parent);
    const v = { visible: true };
    await app.getByRole('button', { name: 'Hostel' }).filter(v).first().click({ timeout: 30_000 });
    await expect(app.getByText('Synthetic Residence · Room 101 · Bed 1').filter(v)).toBeVisible();
    await expect(app.getByText('Absent').filter(v)).toBeVisible();
    await app.getByRole('button', { name: 'Ask for an outpass' }).filter(v).click();
    await app.getByLabel('Reason').filter(v).fill('Family function');
    await app.getByRole('radio').filter(v).first().click();
    await noA11yViolations(app);
    await app.getByRole('button', { name: 'Send' }).filter(v).click();
    await expect(app.getByText(/The warden will approve/).filter(v)).toBeVisible();
    await expect(app.getByText(/Waiting for the warden/).filter(v)).toBeVisible();
    await app.screenshot({ path: 'e2e/screenshots/parent-app-hostel.png', fullPage: true });
  } else {
    // At phone width the warden issues it instead.
    const r = await page.request.post('/api/v1/hostel/children/outpasses', {
      headers: { 'x-requested-with': 'campusverse' },
      data: {},
    });
    expect(r.status()).toBe(400);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const kin = (await (
      await page.request.get(`/api/v1/hostel/children/${child.personId}`)
    ).json()) as {
      collectors: { personId: string }[];
    };
    await apiPost(page, '/hostel/outpasses', {
      institutionId: s.institutionId,
      studentId: child.personId,
      leavesOn: today,
      backBy: today,
      reason: 'Family function',
      collector: { guardianId: kin.collectors[0]?.personId },
    });
  }

  // The warden approves (if asked), lets the child out, then marks them back.
  await page.getByRole('radio', { name: 'Outpasses' }).click();
  if (info.project.name === 'desktop') {
    await expect(page.getByText(new RegExp(`Asked by .* in the app`))).toBeVisible();
    await page.getByRole('button', { name: `Approve ${child.name}` }).click();
    // Saved once it leaves the requests.
    await expect(page.getByText('No outpass requests.')).toBeVisible();
  }
  await page.getByRole('radio', { name: 'Approved' }).click();
  await page.getByRole('button', { name: `Left ${child.name}` }).click();
  await page.getByRole('radio', { name: 'Out', exact: true }).click();
  await expect(page.getByText(/With .* \(/)).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole('button', { name: `Back ${child.name}` }).click();
  await expect(page.getByText('Nobody is out on an outpass.')).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/hostel-${info.project.name}.png`,
    fullPage: true,
  });
});
