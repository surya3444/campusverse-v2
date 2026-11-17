// Development: sign up a school from the command line (the admin portal does the same).
//   pnpm --filter @campusverse/api provision "School name" KA 9876543210 "Owner name"
import { loadEnv } from '@campusverse/config';
import { createDb } from '@campusverse/db';
import { STATES, type StateCode } from '@campusverse/rules';
import { provisionSchool } from '@campusverse/school-setup';

const env = loadEnv();
if (env.APP_ENV !== 'development') throw new Error('provision runs in development only');

const [schoolName, state, phone, ownerName] = process.argv.slice(2);
if (!schoolName || !state || !phone || !ownerName || !(state in STATES)) {
  console.error('usage: provision "School name" <AP|TS|KA|TN> <owner mobile> "Owner name"');
  process.exit(1);
}

const { db, close } = createDb(env.DATABASE_URL);
const school = await provisionSchool(db, {
  schoolName,
  group: null,
  board: 'CBSE',
  state: state as StateCode,
  owner: { name: ownerName, phone },
});
console.log(JSON.stringify(school, null, 2));
await close();
