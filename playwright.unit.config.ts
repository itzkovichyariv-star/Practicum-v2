import { defineConfig } from '@playwright/test';

/**
 * Pure-logic tests. Deliberately separate from playwright.config.ts, which boots a dev
 * server and signs into Supabase to drive a browser — none of which the placement clocks
 * need, and all of which makes them too slow to run while editing.
 *
 * No new dependency: this reuses the Playwright runner the repo already installs, which
 * reads TypeScript natively. Tests here must not touch `page` — nothing launches a browser.
 *
 *   npm run test:unit
 */
export default defineConfig({
  testDir: './unit',
  timeout: 10_000,
  reporter: [['list']],
});
