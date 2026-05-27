/**
 * 12-trainers.spec.ts
 * Tests the Trainers/Lecturers page.
 */
import { test, expect } from '@playwright/test';
import { goToPage, waitForApp } from './helpers/nav';

test.describe('Trainers page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await goToPage(page, 'trainers');
  });

  test('trainers page loads', async ({ page }) => {
    await expect(page.getByText(/מנחים|מרצים/i).first()).toBeVisible();
  });

  test('add trainer button is present', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /מנחה חדש|הוסף מנחה/i })
    ).toBeVisible();
  });

  test('trainer editor opens', async ({ page }) => {
    await page.getByRole('button', { name: /מנחה חדש|הוסף מנחה/i }).click();
    await page.waitForTimeout(300);
    await expect(
      page.locator('input[placeholder*="שם"], input[placeholder*="ארגון"]').first()
    ).toBeVisible();
  });

  test('search input is present', async ({ page }) => {
    await expect(
      page.locator('input[type="search"], input[placeholder*="חפש"]').first()
    ).toBeVisible();
  });
});
