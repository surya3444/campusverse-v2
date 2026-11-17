import { defineConfig } from 'vitest/config';

// Local values for integration tests (real Postgres and Redis). CI sets the variables directly and has no such file.
try {
  process.loadEnvFile('.env.development');
} catch {
  // no file: rely on the environment
}

const ignore = ['**/node_modules/**', '**/dist/**'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages,modules}/**/*.test.ts'],
          exclude: [...ignore, '**/*.{rls,db}.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{apps,packages,modules}/**/*.{rls,db}.test.ts'],
          exclude: ignore,
          // Files share one database and the global outbox, so they run one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
