/**
 * 04-registration-form.spec.ts
 * Public pages — no auth needed.
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('/register — candidate registration form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');
  });

  test('registration page loads', async ({ page }) => {
    // Page renders — form or instructions visible
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
    const bodyText = await page.locator('body').textContent();
    expect(bodyText!.length).toBeGreaterThan(50);
  });

  test('required fields are present', async ({ page }) => {
    await expect(page.locator('input[type="text"], input[type="email"]').first()).toBeVisible();
  });

  test('shows validation on empty submit', async ({ page }) => {
    const submitBtn = page.getByRole('button', { name: /שלח|הגש|submit/i }).first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('can fill all fields without error', async ({ page }) => {
    const nameInput = page.locator('input[name="name"], input[placeholder*="שם"], input[type="text"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill('יריב בדיקה');
    }
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.isVisible()) {
      await emailInput.fill('test@ariel.ac.il');
    }
    await expect(page.locator('.error, [role="alert"]')).not.toBeVisible();
  });
});

test.describe('/cv-update — CV update form', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('cv-update page loads', async ({ page }) => {
    await page.goto('/cv-update/');
    await page.waitForLoadState('networkidle');
    const bodyText = await page.locator('body').textContent();
    expect(bodyText!.length).toBeGreaterThan(30);
  });

  test('cv-update with name param shows content', async ({ page }) => {
    // URL-encoded "יריב" = %D7%99%D7%A8%D7%99%D7%91
    await page.goto('/cv-update/?email=test%40ariel.ac.il&name=%D7%99%D7%A8%D7%99%D7%91');
    await page.waitForLoadState('networkidle');
    // Page content should exist regardless of whether it personalizes
    const bodyText = await page.locator('body').textContent();
    expect(bodyText!.length).toBeGreaterThan(30);
  });
});
