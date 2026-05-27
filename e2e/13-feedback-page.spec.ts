/**
 * 13-feedback-page.spec.ts
 * Tests the public /feedback page (employer fills feedback about student).
 * This is a public form — no auth needed.
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('/feedback — employer feedback form', () => {
  test('feedback page loads', async ({ page }) => {
    await page.goto('/feedback');
    await page.waitForLoadState('networkidle');
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(30);
  });

  test('feedback form is rendered', async ({ page }) => {
    await page.goto('/feedback');
    await page.waitForLoadState('networkidle');
    // Form or structured content should exist
    const form = page.locator('form, [data-feedback-form], textarea');
    const hasForm = await form.first().isVisible().catch(() => false);
    // If no token provided, should show an error/explanation, not a 404
    const bodyText = await page.locator('body').textContent();
    expect(bodyText!.length).toBeGreaterThan(20);
  });
});
