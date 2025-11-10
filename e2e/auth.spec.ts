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

  test('should display Remember Me checkbox', async ({ page }) => {
    await page.goto('/login');
    
    // Should see Remember Me checkbox
    await expect(page.getByTestId('auth-remember-me')).toBeVisible();
    
    // Should have label
    await expect(page.getByText('Keep me signed in')).toBeVisible();
  });

  test('should check Remember Me checkbox and save preference', async ({ page }) => {
    await page.goto('/login');
    
    // Check Remember Me
    await page.getByTestId('auth-remember-me').check();
    await expect(page.getByTestId('auth-remember-me')).toBeChecked();
    
    // Login with Remember Me checked
    await loginAsUser(page, TEST_USER);
    
    // Should redirect to dashboard
    await expect(page).toHaveURL('/');
    
    // Verify localStorage has remember me preference
    const rememberMe = await page.evaluate(() => 
      localStorage.getItem('pitch_remember_me')
    );
    expect(rememberMe).toBe('true');
  });

  test('should uncheck Remember Me checkbox and save preference', async ({ page }) => {
    await page.goto('/login');
    
    // Check then uncheck Remember Me
    await page.getByTestId('auth-remember-me').check();
    await page.getByTestId('auth-remember-me').uncheck();
    await expect(page.getByTestId('auth-remember-me')).not.toBeChecked();
    
    // Login without Remember Me
    await page.getByTestId('auth-email-input').fill(TEST_USER.email);
    await page.getByTestId('auth-password-input').fill(TEST_USER.password);
    await page.getByTestId('auth-submit-button').click();
    await page.waitForURL('/');
    
    // Verify localStorage has remember me set to false
    const rememberMe = await page.evaluate(() => 
      localStorage.getItem('pitch_remember_me')
    );
    expect(rememberMe).toBe('false');
  });

  test('should persist Remember Me state on page reload', async ({ page }) => {
    await page.goto('/login');
    
    // Set Remember Me preference in localStorage
    await page.evaluate(() => 
      localStorage.setItem('pitch_remember_me', 'true')
    );
    
    // Reload page
    await page.reload();
    
    // Remember Me should be checked
    await expect(page.getByTestId('auth-remember-me')).toBeChecked();
  });

  test('should show appropriate toast message when Remember Me is checked', async ({ page }) => {
    await page.goto('/login');
    
    // Check Remember Me
    await page.getByTestId('auth-remember-me').check();
    
    // Login
    await page.getByTestId('auth-email-input').fill(TEST_USER.email);
    await page.getByTestId('auth-password-input').fill(TEST_USER.password);
    await page.getByTestId('auth-submit-button').click();
    
    // Should see Remember Me confirmation in toast
    await expect(page.getByText(/stay signed in/i)).toBeVisible({ timeout: 5000 });
  });
});
