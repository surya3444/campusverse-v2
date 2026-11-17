import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // The dev server compiles each page on its first visit, which can take seconds under parallel load.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // A low-end Android width: 360 px.
    { name: 'phone', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 780 } } },
  ],
  // The web app, the API and the worker: the setup wizard needs all three.
  webServer: [
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @campusverse/api dev',
      url: 'http://127.0.0.1:4000/api/v1/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // The super admin portal (admin.spec.ts).
      command: 'pnpm --filter @campusverse/admin dev',
      url: 'http://localhost:3001/sign-in',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // Several workers are harmless (jobs are claimed once), so a running one doesn't matter.
      command: 'pnpm --filter @campusverse/worker dev',
      wait: { stdout: /worker started/ },
      timeout: 120_000,
    },
    {
      // The Expo app's web build, behind a same-origin proxy to the API (parent-app.spec.ts).
      command:
        'pnpm --filter @campusverse/mobile export:web && node ../mobile/scripts/serve-web.mjs 8081',
      url: 'http://localhost:8081',
      reuseExistingServer: true,
      timeout: 300_000,
    },
  ],
});
