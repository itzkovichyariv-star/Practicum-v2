/**
 * nav.ts — shared Playwright helpers.
 */
import type { Page } from '@playwright/test';

/** Navigate to a page by injecting localStorage key and reloading. */
export async function goToPage(page: Page, pageKey: string) {
  await page.evaluate((key) => {
    localStorage.setItem('practicum_v2_page', key);
  }, pageKey);
  await page.reload();
  await waitForApp(page);
}

/** Wait until the app has loaded data (no skeleton/loader). */
export async function waitForApp(page: Page, timeout = 15_000) {
  // "טוען נתונים" loader should disappear
  await page.waitForFunction(
    () => !document.body.innerText.includes('טוען נתונים'),
    { timeout }
  );
}

/** Click a TopBar nav button whose label matches. */
export async function clickNav(page: Page, label: string | RegExp) {
  const btn = page.getByRole('button', { name: label }).first();
  await btn.click();
  await waitForApp(page);
}

/** Open a specific editor by clicking Edit button on the first matching row. */
export async function openFirstEditor(page: Page) {
  const editBtn = page.locator('button[title*="ערוך"], button[title*="edit"]').first();
  await editBtn.click();
}
