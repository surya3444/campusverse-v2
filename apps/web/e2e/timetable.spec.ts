// The timetable through the real screens: the bell schedule, a lesson placed in the grid with
// its teacher defaulting from Subjects, publishing from today, then copying it into a new draft.
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

test('timetable: schedule, a lesson, publish, copy', async ({ page, context, browser }, info) => {
  test.setTimeout(180_000);
  const s = devSession(`Synthetic Timetable School ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/timetable');
  await schoolWithStudents(page, s.institutionId);

  // Subjects for Class 3: Mathematics six a week, taught by the first teacher.
  const id = s.institutionId;
  const overview = (await (
    await page.request.get(`/api/v1/school/setup/${id}/subjects`)
  ).json()) as {
    classes: { classId: string; sections: { sectionId: string }[] }[];
    staff: { personId: string; name: string }[];
  };
  const cls = overview.classes[0]!;
  const teacher = overview.staff[0]!;
  const { subjectId } = await apiPost(page, `/school/setup/${id}/subjects`, {
    code: 'MATH',
    name: 'Mathematics',
    kind: 'scholastic',
  });
  await apiPost(page, `/school/setup/${id}/offerings`, {
    classId: cls.classId,
    subjectId,
    offered: true,
    periodsPerWeek: 6,
  });
  await apiPost(page, `/school/setup/${id}/teachers`, {
    sectionId: cls.sections[0]!.sectionId,
    subjectId,
    personId: teacher.personId,
  });

  // A second teacher, free in period 1, to cover.
  await apiPost(page, '/people/staff', {
    institutionId: id,
    name: 'Synthetic Cover Teacher',
    phone: `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
    joinedOn: new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10),
  });

  await page.reload();
  await expect(page.getByText('No timetable yet')).toBeVisible();
  await noA11yViolations(page);

  // The bell schedule starts from a usual day: eight periods, a break and lunch.
  await page.getByRole('button', { name: 'Make one by hand' }).click();
  const form = page.getByRole('form', { name: 'New timetable' });
  await form.getByLabel('Name').fill('Term 1');
  await noA11yViolations(page);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  // Today's weekday (Monday on a Sunday), period 1: Mathematics; the maths teacher is chosen already.
  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(new Date());
  const day = weekday === 'Sunday' ? 'Monday' : weekday;
  await page.getByRole('button', { name: new RegExp(`3-A, ${day}, period 1: Free`) }).click();
  const cell = page.getByRole('form', { name: new RegExp(`3-A · ${day} · Period 1`) });
  await cell.getByLabel('Subject').selectOption({ label: 'MATH · Mathematics' });
  await expect(cell.getByLabel('Teacher')).toHaveValue(teacher.personId);
  await cell.getByLabel('Room (optional)').fill('Room 3');
  await cell.getByRole('button', { name: 'Save' }).click();
  await expect(cell).toBeHidden();
  await expect(
    page.getByRole('button', { name: new RegExp(`3-A, ${day}, period 1: Mathematics`) }),
  ).toBeVisible();
  await expect(page.getByText(/^Mathematics( \(MATH\))? 1 of 6$/)).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({
    path: `e2e/screenshots/timetable-${info.project.name}.png`,
    fullPage: true,
  });

  // Publish from today: it's the one in use, and read-only.
  await page.getByRole('button', { name: 'Publish' }).click();
  const publish = page.getByRole('form', { name: 'Publish: Term 1' });
  await publish.getByRole('button', { name: 'Publish' }).click();
  await expect(publish).toBeHidden();
  await expect(page.getByText('In use', { exact: true })).toBeVisible();
  await expect(page.getByText(/Published versions don’t change/)).toBeVisible();

  // The teacher's week.
  await page.getByRole('radio', { name: 'By teacher' }).click();
  await expect(page.getByText('1 period a week')).toBeVisible();

  // Changes go through a new draft.
  await page.getByRole('button', { name: 'Copy to new draft' }).click();
  const copy = page.getByRole('form', { name: 'Copy to new draft' });
  await copy.getByRole('button', { name: 'Copy to new draft' }).click();
  await expect(copy).toBeHidden();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Version' })).toContainText('Term 1 (changes)');
  await noA11yViolations(page);

  // Cover: the maths teacher calls in sick today; the office marks them away and covers the lesson.
  test.skip(weekday === 'Sunday', 'no lessons on a Sunday');
  await page.getByRole('radio', { name: 'Cover' }).click();
  await expect(page.getByText('Everyone is in')).toBeVisible();
  await page.getByRole('button', { name: 'Mark someone away' }).click();
  const away = page.getByRole('form', { name: 'Mark someone away' });
  await away.getByLabel('Teacher').selectOption({ value: teacher.personId });
  await away.getByLabel('Note (optional)').fill('Fever');
  await away.getByRole('button', { name: 'Mark someone away' }).click();
  await expect(away).toBeHidden();
  await expect(page.getByText('1 lesson needs cover')).toBeVisible();

  // Today says so too, and leads straight back here.
  await page.goto('/');
  await expect(page.getByText('1 lesson needs cover today')).toBeVisible();
  await page.getByRole('button', { name: 'Arrange cover' }).click();
  await expect(page).toHaveURL(/\/timetable\?tab=cover/);
  await expect(page.getByText('Not covered')).toBeVisible();
  await noA11yViolations(page);
  await page.screenshot({ path: `e2e/screenshots/cover-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: /^Synthetic Cover Teacher covers Period 1/ }).click();
  await expect(page.getByText('Covered by Synthetic Cover Teacher')).toBeVisible();
  await expect(page.getByText('Every lesson is covered.')).toBeVisible();
  await noA11yViolations(page);

  // The parent sees today's lesson in the app, and that it's covered (the app is phone-sized).
  if (info.project.name === 'phone') return;
  await apiPost(page, `/school/setup/${id}/invites`);

  // The maths teacher's own week: today's lesson, covered while they're away; and their calendar
  // link, which a calendar app can fetch with no session.
  const mine = await browser.newContext();
  const teacherSession = await sessionFor('teacher', s.orgId);
  await signInAs(mine, { ...teacherSession, institutionId: id });
  const tpage = await mine.newPage();
  await tpage.goto('/my-timetable');
  await expect(tpage.getByRole('heading', { name: 'My timetable' })).toBeVisible();
  const todayPanel = tpage.locator('section', {
    has: tpage.getByRole('heading', { name: 'Today', exact: true }),
  });
  await expect(todayPanel).toContainText('You’re away today');
  await expect(todayPanel.getByText('Mathematics')).toBeVisible();
  await expect(todayPanel.getByText(/Covered by Synthetic Cover Teacher/)).toBeVisible();
  await noA11yViolations(tpage);
  await tpage.screenshot({ path: 'e2e/screenshots/my-timetable.png', fullPage: true });
  await tpage.getByRole('button', { name: 'Add to my calendar' }).click();
  const link = tpage.getByRole('dialog', { name: /Google Calendar or Outlook/ });
  await link.getByRole('button', { name: 'Make my link' }).click();
  const url = await link.getByLabel('Your calendar link').inputValue();
  expect(url).toMatch(/\/api\/v1\/public\/calendar\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.ics$/);
  await noA11yViolations(tpage);
  await tpage.screenshot({ path: 'e2e/screenshots/my-timetable-calendar.png' });
  const anonymous = await browser.newContext();
  const ics = await anonymous.request.get(url);
  expect(ics.headers()['content-type']).toMatch(/^text\/calendar/);
  expect(await ics.text()).toMatch(/^BEGIN:VCALENDAR/);
  await anonymous.close();
  await mine.close();
  const app = await openApp(browser, await sessionFor('guardian', s.orgId));
  await app.getByRole('button', { name: 'Timetable' }).first().click();
  await expect(app.getByText('Today', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(app.getByText('Mathematics')).toBeVisible();
  await expect(app.getByText('Period 1 · Synthetic Cover Teacher · Cover · Room 3')).toBeVisible();
  await noA11yViolations(app);
  await app.screenshot({ path: 'e2e/screenshots/parent-timetable.png', fullPage: true });
});

// Step 4: generate from periods per week under the school's rules (previewed first), then a teaching group
// (second language) placed in a free period, split into two subjects.
test('timetable: generate under rules, and a teaching group', async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const s = devSession(`Synthetic Timetable Groups ${info.project.name}`);
  await signInAs(context, s);
  await page.goto('/timetable');
  await schoolWithStudents(page, s.institutionId);
  const id = s.institutionId;
  const overview = (await (
    await page.request.get(`/api/v1/school/setup/${id}/subjects`)
  ).json()) as {
    classes: { classId: string; sections: { sectionId: string }[] }[];
    staff: { personId: string; name: string }[];
  };
  const cls = overview.classes[0]!;
  const subject = async (code: string, name: string, periodsPerWeek: number | null) => {
    const { subjectId } = await apiPost(page, `/school/setup/${id}/subjects`, {
      code,
      name,
      kind: periodsPerWeek ? 'scholastic' : 'language',
    });
    await apiPost(page, `/school/setup/${id}/offerings`, {
      classId: cls.classId,
      subjectId,
      offered: true,
      ...(periodsPerWeek ? { periodsPerWeek } : {}),
    });
    return subjectId as string;
  };
  const maths = await subject('MATH', 'Mathematics', 6);
  await subject('L2HI', 'Hindi second language', null);
  await subject('L2KA', 'Kannada second language', null);
  await apiPost(page, `/school/setup/${id}/teachers`, {
    sectionId: cls.sections[0]!.sectionId,
    subjectId: maths,
    personId: overview.staff[0]!.personId,
  });
  await page.reload();
  await page.getByRole('button', { name: 'Make one by hand' }).click();
  const form = page.getByRole('form', { name: 'New timetable' });
  await form.getByLabel('Name').fill('Term 1');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  // Generate: the rules (maths as a double once a week, in the morning), the worker's search,
  // then the preview of the six maths periods; placing them meets the target.
  await page.getByRole('button', { name: 'Generate timetable' }).click();
  const gen = page.getByRole('dialog', { name: 'Timetable generator' });
  // It opens at the school day; the rules are step 4.
  await expect(gen.getByRole('button', { name: 'School day' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await gen.getByRole('button', { name: 'Rules & preferences' }).click();
  await page.screenshot({ path: `e2e/screenshots/generator-setup-${info.project.name}.png` });
  await gen.getByRole('radio', { name: 'Subjects' }).click();
  await gen.getByLabel('Double periods a week: Mathematics').selectOption('1');
  await gen.getByLabel('Time of day: Mathematics').selectOption('morning');
  await gen.getByLabel('Needs a room: Mathematics').fill('Maths room');
  await gen.getByLabel('Needs a room: Mathematics').blur();
  // The maths teacher isn't available in period 1…
  await gen.getByRole('radio', { name: 'Teachers' }).click();
  await gen.getByRole('button', { name: /not available in P1$/ }).click();
  // …and not on Monday in period 2.
  await gen.getByText(/^Not available at particular times/).click();
  await gen.getByRole('checkbox', { name: /not available Monday period 2$/ }).check();
  await noA11yViolations(page);
  await gen.getByRole('button', { name: 'Check & generate' }).click();
  await expect(gen.getByText('Periods to place')).toBeVisible();
  await gen.getByRole('button', { name: 'Generate timetable' }).click();
  await expect(gen.getByText('Every period is placed and every rule kept.')).toBeVisible({
    timeout: 30_000,
  });
  const wish = gen.getByRole('list', { name: 'Preferences met' }).getByRole('listitem');
  await expect(wish.filter({ hasText: 'Subjects in their time of day' })).toContainText('6 of 6');
  const week = gen.getByRole('region', { name: 'Class 3-A' });
  await expect(week.getByRole('row', { name: /^Period 1/ })).not.toContainText('Mathematics');
  await expect(week.getByText(/Maths room/).first()).toBeVisible();
  await page.screenshot({ path: `e2e/screenshots/generator-result-${info.project.name}.png` });
  await noA11yViolations(page);
  // Another arrangement keeps the rules; placing writes exactly what is shown.
  await gen.getByRole('button', { name: 'Try another arrangement' }).click();
  await expect(gen.getByText('Every period is placed and every rule kept.')).toBeVisible({
    timeout: 30_000,
  });
  await gen.getByRole('button', { name: 'Place 6 lessons' }).click();
  // Placed: publish now, or look at the week first (here: look, then add a group by hand).
  await expect(gen.getByText('6 lessons placed.')).toBeVisible();
  await gen.getByRole('button', { name: 'See the week' }).click();
  await expect(gen).toBeHidden();
  await expect(page.getByText(/^Mathematics( \(MATH\))? 6 of 6$/)).toBeVisible();

  // A second-language group of 3-A, placed in a free period as Hindi and Kannada.
  await page.getByRole('button', { name: 'New group' }).click();
  const group = page.getByRole('form', { name: 'New group' });
  await group.getByLabel('Name').fill('Second language');
  await group.getByLabel('Class 3-A').check();
  await noA11yViolations(page);
  await group.getByRole('button', { name: 'Save' }).click();
  await expect(group).toBeHidden();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: /^Second language/ })
      .filter({ hasText: 'Class 3-A' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: /3-A, \w+, period \d+: Free/ })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole('button', { name: 'Place a group here' }).click();
  const cell = page.getByRole('form', { name: /^Second language · / });
  await cell.getByLabel('Subject 1').selectOption({ label: 'L2HI · Hindi second language' });
  await cell.getByRole('button', { name: 'Add a subject' }).click();
  await cell.getByLabel('Subject 2').selectOption({ label: 'L2KA · Kannada second language' });
  await noA11yViolations(page);
  await cell.getByRole('button', { name: 'Save' }).click();
  await expect(cell).toBeHidden();
  await expect(
    page.getByRole('button', {
      name: /3-A, \w+, period \d+: Second language Hindi second language, Kannada second language/,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `e2e/screenshots/timetable-groups-${info.project.name}.png`,
    fullPage: true,
  });
});
