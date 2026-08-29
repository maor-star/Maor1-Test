import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * E2E runs against a real build with every external integration swapped for
 * its in-memory fake (CLAUDE.md §9 — no network in CI).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        viewport: { width: 1440, height: 900 },
        launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    // `/` redirects to the login page; probe a route that answers 200 so the
    // readiness check does not mistake a healthy server for a dead one.
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      USE_FAKE_INTEGRATIONS: '1',
      // Auth.js builds its redirect URLs from AUTH_URL. Left pointing at the
      // dev origin, every unauthenticated redirect would send the test browser
      // to a port nothing is listening on.
      AUTH_URL: baseURL,
      NEXTAUTH_URL: baseURL,
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      AUTH_SECRET: process.env.AUTH_SECRET ?? '',
      ALLOWED_EMAILS: process.env.ALLOWED_EMAILS ?? '',
      CLICKUP_DEFAULT_LIST_ID: process.env.CLICKUP_DEFAULT_LIST_ID ?? 'e2e-list',
      OWNER_EMAIL: process.env.OWNER_EMAIL ?? '',
      OWNER_PASSWORD_HASH: process.env.OWNER_PASSWORD_HASH ?? '',
    },
  },
});
