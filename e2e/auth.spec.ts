/**
 * Auth E2E Tests
 * Phase 1 - Week 1-2: Testing Infrastructure
 */

import { test, expect } from '@playwright/test';
import { TEST_USER, loginAsUser, logout } from '../tests/utils/auth-helpers';

test.describe('Authentication Flow', () => {
  test('should display login form', async ({ page }) => {
    await page.goto('/login');
    
    await expect(page.getByTestId('auth-email-input')).toBeVisible();
    await expect(page.getByTestId('auth-password-input')).toBeVisible();
    await expect(page.getByTestId('auth-submit-button')).toBeVisible();
  });

  test('should login with valid credentials', async ({ page }) => {
    await loginAsUser(page, TEST_USER);
    
    // Should redirect to dashboard
    await expect(page).toHaveURL('/');
    
    // Should see navigation
    await expect(page.getByTestId('sidebar-dashboard')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByTestId('auth-email-input').fill('invalid@test.com');
    await page.getByTestId('auth-password-input').fill('wrongpassword');
    await page.getByTestId('auth-submit-button').click();
    
    // Should show error toast
    await expect(page.getByText(/invalid/i)).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    await loginAsUser(page, TEST_USER);
    await logout(page);
    
    // Should redirect to login
    await expect(page).toHaveURL('/login');
  });

  test('should toggle between login and signup', async ({ page }) => {
    await page.goto('/login');
    
    // Click toggle to signup
    await page.getByTestId('auth-toggle-mode').click();
    
    // Should show signup fields
    await expect(page.getByTestId('auth-firstname-input')).toBeVisible();
    await expect(page.getByTestId('auth-lastname-input')).toBeVisible();
  });
});
