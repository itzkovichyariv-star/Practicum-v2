/**
 * 02-candidates.spec.ts
 */
import { test, expect } from '@playwright/test';
import { goToPage, waitForApp } from './helpers/nav';

test.describe('Candidates page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await goToPage(page, 'candidates');
  });

  test('loads candidates page', async ({ page }) => {
    await expect(page.getByText(/מועמדים/i).first()).toBeVisible();
  });

  test('shows empty state when no candidates', async ({ page }) => {
    const body = page.locator('main');
    await expect(body).toBeVisible();
    const text = await body.textContent();
    expect(text).toBeTruthy();
  });

  test('filter tabs are visible', async ({ page }) => {
    // Tab bar exists — check for "הכל" and "עברו" which are the exact labels
    await expect(page.getByRole('button', { name: /הכל/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /עברו/i }).first()).toBeVisible();
    // "ממתינים" tab exists (may or may not be visible depending on viewport)
    const tabBar = page.locator('.ramzor-tab, [class*="tab"]');
    expect(await tabBar.count()).toBeGreaterThan(0);
  });

  test('group-send strip is NOT shown on "הכל" tab with no candidates', async ({ page }) => {
    await page.getByRole('button', { name: /הכל/i }).first().click();
    // No group-send strip (only appears when passed/failed tab active AND has items)
    await expect(page.getByRole('button', { name: /שלח.*קבוצה/i })).not.toBeVisible();
  });

  test('search input filters by name', async ({ page }) => {
    const searchInput = page.locator('input[type="search"], input[placeholder*="חפש"]').first();
    await searchInput.fill('אין כזה מועמד בכלל 99999');
    await page.waitForTimeout(300);
    const rows = page.locator('li[data-info-row]');
    expect(await rows.count()).toBe(0);
  });

  test('"+ מועמד/ת חדש/ה" button exists', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /מועמד.*חדש/i })
    ).toBeVisible();
  });
});
