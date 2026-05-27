/**
 * 08-lectures.spec.ts
 */
import { test, expect } from '@playwright/test';
import { goToPage, waitForApp } from './helpers/nav';

test.describe('Lectures page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await goToPage(page, 'lectures');
  });

  test('lectures page loads', async ({ page }) => {
    await expect(page.getByText(/הרצאות/i).first()).toBeVisible();
  });

  test('lecture rows or empty state renders', async ({ page }) => {
    const main = page.locator('main');
    await expect(main).toBeVisible();
    const text = await main.textContent();
    expect(text!.length).toBeGreaterThan(50);
  });

  test('search input is present and functional', async ({ page }) => {
    const input = page.locator('input[type="search"], input[placeholder*="חפש"]').first();
    await expect(input).toBeVisible();
    await input.fill('XYZ_NO_MATCH_9999');
    await page.waitForTimeout(300);
    const rows = page.locator('li[data-info-row]');
    expect(await rows.count()).toBe(0);
  });

  test('"+ הרצאה חדשה →" button exists and opens form', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /הרצאה חדשה/i });
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await page.waitForTimeout(400);
    // The LectureEditor drawer should open
    await expect(
      page.locator('input[placeholder*="מרצה"], input[placeholder*="נושא"], select').first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
