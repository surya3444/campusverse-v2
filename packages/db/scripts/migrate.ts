import { migrationEnv } from '@campusverse/config';
import { migrate } from '../src/migrate.js';

// Only the migrator's login: the migration task in AWS receives nothing else.
await migrate(migrationEnv().MIGRATION_DATABASE_URL);
console.log('migrations up to date');
