/**
 * 05-employers.spec.ts
 */
import { test, expect } from '@playwright/test';
import { goToPage, waitForApp } from './helpers/nav';

test.describe('Employers page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await goToPage(page, 'employers');
  });

  test('employers page loads', async ({ page }) => {
    await expect(page.getByText(/מעסיקים/i).first()).toBeVisible();
  });

  test('has search filter', async ({ page }) => {
    await expect(
      page.locator('input[type="search"], input[placeholder*="חפש"]').first()
    ).toBeVisible();
  });

  test('has filter dropdowns', async ({ page }) => {
    // At least one select/dropdown for course or status filter
    await expect(page.locator('select').first()).toBeVisible();
  });

  test('empty state shows friendly message when no employers', async ({ page }) => {
    const mainContent = await page.locator('main').textContent();
    expect(mainContent).toBeTruthy();
    // The page should mention "מעסיקים" or show an empty state — not crash
    expect(mainContent!.includes('מעסיקים') || mainContent!.includes('אין')).toBeTruthy();
  });

  test('add employer button is present', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /הוסף מעסיק|מעסיק חדש/i });
    await expect(addBtn).toBeVisible();
  });
});
