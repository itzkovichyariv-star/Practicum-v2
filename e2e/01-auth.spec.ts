/**
 * 01-auth.spec.ts
 * Tests the PasswordGate login/logout flow.
 */
import { test, expect } from '@playwright/test';

// These tests bypass storageState to test the gate itself
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('PasswordGate', () => {
  test('shows gate when not authenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('rejects wrong password', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'yarivi@ariel.ac.il');
    await page.fill('input[type="password"]', 'wrongpass');
    await page.click('button[type="submit"]');
    await expect(page.getByText(/סיסמה שגויה/i)).toBeVisible();
    // Still on the gate
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('rejects empty email', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="password"]', 'ariel2026');
    await page.click('button[type="submit"]');
    await expect(page.getByText(/נא להזין/i)).toBeVisible();
  });

  test('logs in successfully with correct credentials', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'yarivi@ariel.ac.il');
    await page.fill('input[type="password"]', 'ariel2026');
    await page.click('button[type="submit"]');

    // Session must be set in localStorage
    await page.waitForFunction(
      () => !!localStorage.getItem('practicum_v2_session'),
      { timeout: 10_000 }
    );
    // App loads — gate is gone
    await expect(page.locator('input[type="password"]')).not.toBeVisible({ timeout: 10_000 });
  });
});
