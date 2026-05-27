/**
 * 10-dashboard.spec.ts
 * Tests the Dashboard:
 *  - Loads after login
 *  - Shows stat cards
 *  - Navigation to other pages from dashboard links
 */
import { test, expect } from '@playwright/test';
import { waitForApp } from './helpers/nav';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    // Dashboard is the default page
  });

  test('dashboard loads with stats', async ({ page }) => {
    // Should show at least one stat card or section
    const mainContent = await page.locator('main, [role="main"]').textContent();
    expect(mainContent).toBeTruthy();
    expect(mainContent!.length).toBeGreaterThan(50);
  });

  test('TopBar navigation is visible', async ({ page }) => {
    // Main nav buttons should be in the TopBar
    await expect(page.getByRole('button', { name: /מועמדים|candidates/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /סטודנטים|students/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /מעסיקים|employers/i })).toBeVisible();
  });

  test('navigating to candidates via TopBar', async ({ page }) => {
    await page.getByRole('button', { name: /מועמדים/i }).first().click();
    await waitForApp(page);
    await expect(page.getByText(/מועמדים/i).first()).toBeVisible();
  });

  test('navigating to employers via TopBar', async ({ page }) => {
    await page.getByRole('button', { name: /מעסיקים/i }).first().click();
    await waitForApp(page);
    await expect(page.getByText(/מעסיקים/i).first()).toBeVisible();
  });

  test('context selector (course + year) is in TopBar', async ({ page }) => {
    // Course and year dropdowns should be in the header
    await expect(page.locator('select').first()).toBeVisible();
  });
});
