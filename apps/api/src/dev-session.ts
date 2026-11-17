// Development and browser tests only: prints a signed-in session, so tests can start signed in
// without reading OTP codes from logs.
//   pnpm --filter @campusverse/api dev-session "School name"      a new school and its owner
//   pnpm --filter @campusverse/api dev-session --guardian <orgId>  a guardian of that school (after invites)
//   pnpm --filter @campusverse/api dev-session --teacher <orgId> [certificateRequestId]   a class teacher (of that request's student)
//   pnpm --filter @campusverse/api dev-session --invite "Name"     an invited organisation admin (not onboarded)
//   pnpm --filter @campusverse/api dev-session --nurse <orgId>     a teacher with a login, given the School nurse role
//   pnpm --filter @campusverse/api dev-session --office <orgId>    a teacher with a login, given the Office staff role
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { createStaff, inviteAdmin } from '@campusverse/platform-control';
import { devSignIn } from '@campusverse/platform-identity';
import { provisionSchool } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';

const env = loadEnv();
if (env.APP_ENV !== 'development') throw new Error('dev-session runs in development only');

const { db, close } = createDb(env.DATABASE_URL);

if (process.argv[2] === '--invite') {
  // As the super admin's "Invite an admin" does, by a development staff member.
  const email = 'dev-invites@staff.campusverse.local';
  const [existing] = await db.execute<{ staffId: string }>(sql`
    select id::text as "staffId" from control.staff where email = ${email}`);
  const staffId =
    existing?.staffId ??
    (await createStaff(db, null, { name: 'Development invites', email, role: 'owner' })).staffId;
  const phone = `9${randomInt(100_000_000, 999_999_999)}`;
  await inviteAdmin(
    db,
    { staffId, name: 'Development invites', email, role: 'owner' },
    { name: process.argv[3] ?? 'Synthetic Admin', phone, planCode: 'pilot' },
  );
  console.log(JSON.stringify({ phone }));
} else if (['--guardian', '--teacher', '--nurse', '--office'].includes(process.argv[2] ?? '')) {
  const orgId = process.argv[3] ?? '';
  // A guardian with a login and a child, or a class teacher with a login: the same one each time.
  const [g] = await withTenant(db, orgId, (tx) =>
    process.argv[2] === '--guardian'
      ? tx.execute<{ accountId: string; personId: string }>(sql`
          select l.account_id::text as "accountId", l.person_id::text as "personId"
          from identity.account_person_link l
          join guardian_link g on g.org_id = l.org_id and g.guardian_person_id = l.person_id
          where l.org_id = app_current_org() and g.can_login and g.restricted_at is null
          order by g.is_fee_payer desc, l.created_at, l.person_id limit 1`)
      : tx.execute<{ accountId: string; personId: string }>(sql`
          select l.account_id::text as "accountId", l.person_id::text as "personId"
          from identity.account_person_link l
          join school_teacher_allocation a on a.org_id = l.org_id and a.teacher_person_id = l.person_id
          where l.org_id = app_current_org() and a.kind = 'class_teacher'
            -- Optionally the class teacher of a certificate request's student (their section's).
            and (${process.argv[4] ?? null}::uuid is null or a.section_id in (
              select e.section_id from school_enrolment e
              join school_certificate_request r on r.org_id = e.org_id and r.student_person_id = e.person_id
              where e.org_id = app_current_org() and r.id = ${process.argv[4] ?? null}::uuid))
          order by l.created_at, l.person_id limit 1`),
  );
  if (!g) throw new Error('Nobody with a login yet: send invites first');
  const extraRole = { '--nurse': 'nurse', '--office': 'office' }[process.argv[2] ?? ''];
  if (extraRole)
    await withTenant(db, orgId, (tx) =>
      tx.execute(sql`
        insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
        select app_current_org(), ${g.personId}, id, 'organisation', app_current_org()
        from role where org_id = app_current_org() and key = ${extraRole}
        on conflict do nothing`),
    );
  const tokens = await devSignIn(db, g.accountId, 'Development phone');
  console.log(
    JSON.stringify({
      orgId,
      personId: g.personId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      deviceId: tokens.deviceId,
    }),
  );
} else {
  const phone = `9${randomInt(100_000_000, 999_999_999)}`;
  const school = await provisionSchool(db, {
    schoolName: process.argv[2] ?? 'Synthetic Wizard School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner: { name: 'Meera Owner Synthetic', phone },
  });
  // Development schools get Verse AI switched on (the flag is off by default for customers).
  await db.execute(sql`
    insert into control.flag_override (key, org_id, enabled) values ('verse_ai', ${school.orgId}, true)`);
  const tokens = await devSignIn(db, school.ownerAccountId, 'Development browser');
  console.log(
    JSON.stringify({
      orgId: school.orgId,
      personId: school.ownerPersonId,
      institutionId: school.institutionId,
      phone,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }),
  );
}
await close();
