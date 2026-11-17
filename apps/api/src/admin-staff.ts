// Development: add a Campusverse staff member and print their one-time passkey enrolment link.
// The first owner comes from here; after that, owners add staff in the admin portal.
//   pnpm --filter @campusverse/api admin-staff "Name" name@example.com [owner|support]
import { loadEnv } from '@campusverse/config';
import { createDb } from '@campusverse/db';
import { createStaff } from '@campusverse/platform-control';

const env = loadEnv();
if (env.APP_ENV !== 'development') throw new Error('admin-staff runs in development only');

const [name, email, role = 'owner'] = process.argv.slice(2);
if (!name || !email || (role !== 'owner' && role !== 'support')) {
  console.error('usage: admin-staff "Name" <email> [owner|support]');
  process.exit(1);
}

const { db, close } = createDb(env.DATABASE_URL);
const { staffId, enrolToken } = await createStaff(db, null, { name, email, role });
console.log(JSON.stringify({ staffId, enrolUrl: `${env.ADMIN_ORIGIN}/enrol?token=${enrolToken}` }));
await close();
