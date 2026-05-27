/**
 * auth.setup.ts
 * Creates the authenticated storageState by injecting localStorage directly.
 * Bypasses the UI login form for speed and reliability.
 */
import { test as setup } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = path.join(__dirname, '.auth/state.json');

setup('create auth state', async ({ browser }) => {
  // Open a fresh context with NO storageState
  const ctx = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();

  await page.goto('http://localhost:4325/');
  await page.waitForLoadState('networkidle');

  // Inject session directly into localStorage — no UI interaction needed
  const session = JSON.stringify({
    profile: { name: 'יריב בדיקה', email: 'yarivi@ariel.ac.il' },
  });
  await page.evaluate((s) => {
    localStorage.setItem('practicum_v2_session', s);
    localStorage.setItem(
      'practicum_v2_context',
      JSON.stringify({ courseId: '__all__', year: '__all__' })
    );
  }, session);

  // Reload to trigger the app with the session
  await page.reload();
  await page.waitForFunction(
    () => !document.body.innerText.includes('טוען נתונים') || document.body.innerText.length > 200,
    { timeout: 15_000 }
  );

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  await ctx.storageState({ path: STATE_FILE });
  await ctx.close();
  console.log('✓ Auth state saved →', STATE_FILE);
});
