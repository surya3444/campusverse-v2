import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '../src/client.js';
import { seedTenant } from '../src/seed.js';
import { organisation } from '../src/schema.js';

const env = loadEnv();
if (env.APP_ENV !== 'development') throw new Error('db:seed runs in development only');

// Fixed IDs keep reruns idempotent.
const DEV_TENANTS = [
  { id: '01900000-0000-7000-8000-00000000000a', name: 'Synthetic Vidya' },
  { id: '01900000-0000-7000-8000-00000000000b', name: 'Synthetic Gurukul' },
];

const { db, close } = createDb(env.DATABASE_URL);
try {
  for (const t of DEV_TENANTS) {
    const exists = await withTenant(db, t.id, (tx) => tx.select().from(organisation));
    if (exists.length) {
      console.log(`${t.name}: already seeded`);
      continue;
    }
    const seeded = await seedTenant(db, t.name, t.id);
    console.log(`${t.name}: seeded`, seeded);
  }
} finally {
  await close();
}
