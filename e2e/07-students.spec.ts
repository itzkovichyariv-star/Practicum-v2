/**
 * 07-students.spec.ts
 */
import { test, expect } from '@playwright/test';
import { goToPage, waitForApp } from './helpers/nav';

test.describe('Students page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await goToPage(page, 'students');
  });

  test('students page loads', async ({ page }) => {
    await expect(page.getByText(/סטודנטים/i).first()).toBeVisible();
  });

  test('search input is present', async ({ page }) => {
    await expect(
      page.locator('input[type="search"], input[placeholder*="חפש"]').first()
    ).toBeVisible();
  });

  test('search filters by name', async ({ page }) => {
    const input = page.locator('input[type="search"], input[placeholder*="חפש"]').first();
    await input.fill('אין כזה סטודנט XYZ99999');
    await page.waitForTimeout(300);
    const rows = page.locator('li[data-info-row]');
    expect(await rows.count()).toBe(0);
  });

  test('"+ חדש/ה →" button exists', async ({ page }) => {
    // Exact label is "+ חדש/ה →"
    await expect(
      page.getByRole('button', { name: /חדש/ })
    ).toBeVisible();
  });

  test('student editor opens on click', async ({ page }) => {
    await page.getByRole('button', { name: /חדש/ }).click();
    await page.waitForTimeout(400);
    // Editor should open with form fields
    await expect(
      page.locator('input[placeholder*="שם"], input[placeholder*="מייל"], input[type="email"]').first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
