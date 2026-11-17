import { describe, expect, it } from 'vitest';
import { loadEnv, migrationEnv } from './env.js';

const valid = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_PEPPER: 'x'.repeat(32),
  FIELD_KEYS: `1:${'A'.repeat(43)}=`,
  S3_BUCKET: 'campusverse-dev',
  PUBLIC_VERIFY_BASE_URL: 'http://localhost:3000/verify',
};

describe('loadEnv', () => {
  it('accepts a complete config', () => {
    expect(loadEnv(valid).APP_ENV).toBe('development');
  });

  it('rejects missing values and names them without leaking secrets', () => {
    const run = () => loadEnv({ ...valid, DATABASE_URL: undefined, REDIS_URL: 'http://secret' });
    expect(run).toThrow(/DATABASE_URL, REDIS_URL/);
    expect(run).not.toThrow(/secret/);
  });

  it('parses the message allowlist', () => {
    const env = loadEnv({ ...valid, MESSAGE_ALLOWLIST: '+919000000001, +919000000002' });
    expect(env.MESSAGE_ALLOWLIST).toEqual(['+919000000001', '+919000000002']);
    expect(loadEnv(valid).MESSAGE_ALLOWLIST).toEqual([]);
  });

  it('refuses the S3 emulator endpoint in production', () => {
    expect(() =>
      loadEnv({ ...valid, APP_ENV: 'production', S3_ENDPOINT: 'http://localhost:9090' }),
    ).toThrow(/S3_ENDPOINT/);
  });

  it('rejects a short pepper', () => {
    expect(() => loadEnv({ ...valid, AUTH_PEPPER: 'short' })).toThrow(/AUTH_PEPPER/);
  });

  it('rejects an unknown environment name', () => {
    expect(() => loadEnv({ ...valid, APP_ENV: 'staging' })).toThrow(/APP_ENV/);
  });
});

describe('migrationEnv', () => {
  it('needs only the migrator login', () => {
    expect(
      migrationEnv({ MIGRATION_DATABASE_URL: 'postgres://m:m@db:5432/campusverse' })
        .MIGRATION_DATABASE_URL,
    ).toContain('postgres://');
    expect(() => migrationEnv({})).toThrow(/MIGRATION_DATABASE_URL/);
  });
});
