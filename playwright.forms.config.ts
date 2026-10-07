import { defineConfig, devices } from '@playwright/test';

/**
 * PUBLIC-FORM tests. A real browser, a real build of the page — and no Supabase.
 *
 * Separate from playwright.config.ts because that one signs a coordinator into Supabase and
 * drives the admin app: these pages have no login, and the point here is to exercise them
 * against INTERCEPTED network calls, so the form's own behaviour is what is under test and
 * a sandbox with no route to Supabase can still run it. Separate from the unit config
 * because these need a page.
 *
 *   npm run test:forms
 */
export default defineConfig({
  testDir: './forms-e2e',
  timeout: 45_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    // Use whatever Chromium this machine already has when its build number does not match
    // the one this Playwright wants — a CI image or sandbox pins browsers outside the
    // project, and downloading another copy is both slow and, in some sandboxes, blocked.
    // Unset PW_CHROMIUM_PATH (or set it empty) to go back to Playwright's own download.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
    baseURL: 'http://localhost:4327',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    storageState: undefined, // public pages: never carry an admin session
    // The app registers a service worker (public/sw.js). A request the SW makes on the
    // page's behalf is NOT seen by page.route, so every Supabase stub below was silently
    // bypassed and the real (unreachable) host was contacted instead. Blocking the worker
    // puts the page's own fetches back in front of the interceptor.
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx astro dev --port 4327',
    url: 'http://localhost:4327/ma',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
