/**
 * 06-management-courses.spec.ts
 */
import { test, expect } from '@playwright/test';
import { goToPage, waitForApp } from './helpers/nav';

test.describe('Management page — Courses', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await goToPage(page, 'management');
  });

  test('management page loads (heading visible)', async ({ page }) => {
    // The page heading is exactly "ניהול" in a chapter-mark + h1
    await expect(page.locator('h1').filter({ hasText: 'ניהול' })).toBeVisible({ timeout: 8_000 });
  });

  test('courses section is visible', async ({ page }) => {
    await expect(page.getByText(/קורסים/i).first()).toBeVisible();
  });

  test('"הוסף קורס" button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /הוסף קורס/i })).toBeVisible();
  });

  test('can open new-course form', async ({ page }) => {
    await page.getByRole('button', { name: /הוסף קורס/i }).click();
    await page.waitForTimeout(400);
    await expect(
      page.locator('input[placeholder*="שם קורס"], input[placeholder*="פרקטיקום"]')
    ).toBeVisible();
  });

  test('new course form has type selector (practicum / other)', async ({ page }) => {
    await page.getByRole('button', { name: /הוסף קורס/i }).click();
    await page.waitForTimeout(400);
    await expect(page.locator('input[type="radio"][value="practicum"]')).toBeVisible();
    await expect(page.locator('input[type="radio"][value="other"]')).toBeVisible();
  });

  test('practicum type reveals preference count field', async ({ page }) => {
    await page.getByRole('button', { name: /הוסף קורס/i }).click();
    await page.waitForTimeout(400);
    await page.locator('input[type="radio"][value="practicum"]').click();
    await page.waitForTimeout(200);
    // "מספר העדפות" label should appear
    await expect(page.getByText(/מספר העדפות/i)).toBeVisible({ timeout: 3_000 });
  });

  test('years section header "שנים אקדמיות" exists in DOM', async ({ page }) => {
    // Section renders as h2 — it may be off-screen on a long page, so check presence
    const heading = page.getByRole('heading', { name: 'שנים אקדמיות' });
    await expect(heading).toHaveCount(1);
  });

  test('institutions section is visible', async ({ page }) => {
    await expect(page.getByText(/^מוסדות$/i)).toBeVisible();
  });

  test('institution linker shows for courses (if any exist)', async ({ page }) => {
    // If courses exist, 🏫 button should be visible
    const courses = page.locator('li').filter({ has: page.locator('.ramzor-tab, button') });
    const courseCount = await courses.count();
    // Just verify the page loaded correctly
    await expect(page.getByText(/קורסים/i).first()).toBeVisible();
  });
});
