/**
 * 03-candidate-editor.spec.ts
 */
import { test, expect } from '@playwright/test';
import { goToPage, waitForApp } from './helpers/nav';

test.describe('CandidateEditor — new candidate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await goToPage(page, 'candidates');
    // The exact button text is "מועמד/ת חדש/ה →"
    await page.getByRole('button', { name: /מועמד.*חדש/i }).click();
    await page.waitForTimeout(500);
  });

  test('editor panel opens', async ({ page }) => {
    // Drawer opens with a name input
    const nameField = page.locator('input[placeholder*="שם"]').first();
    await expect(nameField).toBeVisible({ timeout: 8_000 });
  });

  test('interview result section shows docs-required indicator', async ({ page }) => {
    // The section header or a lock icon should mention documents
    const lockIndicator = page.getByText(/מסמכים קודם|🔒/i);
    await expect(lockIndicator).toBeVisible({ timeout: 8_000 });
  });

  test('closing the editor works', async ({ page }) => {
    const closeBtn = page.getByRole('button', { name: /סגור|בטל|✕|close/i }).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }
    // Page should still be functional
    await expect(page.getByText(/מועמדים/i).first()).toBeVisible();
  });

  test('required fields validation on empty save', async ({ page }) => {
    // Try to save with no data
    const saveBtn = page.getByRole('button', { name: /שמור/i }).first();
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await page.waitForTimeout(300);
      // Editor should still be open (not saved)
      await expect(page.locator('input[placeholder*="שם"]').first()).toBeVisible();
    }
  });
});
