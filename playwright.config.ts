import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  workers: 1, // serial — avoid Supabase write conflicts
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4325',
    locale: 'he-IL',
    // Persist auth across tests via storageState
    storageState: 'e2e/.auth/state.json',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // Setup project — runs first, creates the authenticated storageState
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      use: {
        // No storageState here — we ARE creating it
        storageState: undefined,
      },
    },
    // Main test project — depends on setup
    {
      name: 'practicum',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/state.json',
        viewport: { width: 1400, height: 900 },
        locale: 'he-IL',
        timezoneId: 'Asia/Jerusalem',
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4325',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
