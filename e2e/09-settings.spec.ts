/**
 * 09-settings.spec.ts
 * Tests the Settings page:
 *  - Email settings card loads with fields
 *  - Placement settings: numeric inputs, template toggle
 *  - JSON backup button exists
 *  - Sharing guide is shown
 */
import { test, expect } from '@playwright/test';
import { goToPage, waitForApp } from './helpers/nav';

test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await goToPage(page, 'settings');
  });

  test('settings page loads', async ({ page }) => {
    await expect(page.getByText(/הגדרות/i).first()).toBeVisible();
  });

  test('email settings card is visible', async ({ page }) => {
    await expect(page.getByText(/הגדרות מייל/i)).toBeVisible();
    // Coordinator email input
    await expect(
      page.locator('input[type="email"], input[placeholder*="ariel"]').first()
    ).toBeVisible();
  });

  test('placement settings card is visible', async ({ page }) => {
    // Use heading role to target the section title specifically
    const heading = page.getByRole('heading', { name: /הגדרות שיבוץ/i });
    await expect(heading).toBeVisible();
    await heading.scrollIntoViewIfNeeded();
    await expect(page.locator('input[type="number"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('template expand/collapse works', async ({ page }) => {
    const toggleBtn = page.getByRole('button', { name: /הצג.*תבניות|הסתר.*תבניות/i });
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();
    await page.waitForTimeout(200);
    // Textarea fields should appear
    await expect(page.locator('textarea').first()).toBeVisible();
    // Click again to collapse
    await page.getByRole('button', { name: /הסתר.*תבניות/i }).click();
    await page.waitForTimeout(200);
    await expect(page.locator('textarea').first()).not.toBeVisible();
  });

  test('JSON backup button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /גיבוי JSON|הורד גיבוי/i })).toBeVisible();
  });

  test('sharing guide section is visible', async ({ page }) => {
    // Use heading role to disambiguate from the subtitle paragraph
    await expect(page.getByRole('heading', { name: 'שיתוף עם רחל' })).toBeVisible();
  });
});
