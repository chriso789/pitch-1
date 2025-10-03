/**
 * Auth Test Helpers
 * Phase 1 - Week 1-2: Testing Infrastructure
 */

import { Page } from '@playwright/test';

export const TEST_USER = {
  email: 'test@pitch.test',
  password: 'TestPass123!',
  firstName: 'Test',
  lastName: 'User',
};

export const TEST_ADMIN = {
  email: 'admin@pitch.test',
  password: 'AdminPass123!',
  firstName: 'Admin',
  lastName: 'User',
  role: 'admin' as const,
};

export const TEST_MANAGER = {
  email: 'manager@pitch.test',
  password: 'ManagerPass123!',
  firstName: 'Manager',
  lastName: 'User',
  role: 'manager' as const,
};

/**
 * Login helper for E2E tests
 */
export async function loginAsUser(page: Page, user = TEST_USER) {
  await page.goto('/login');
  await page.getByTestId('auth-email-input').fill(user.email);
  await page.getByTestId('auth-password-input').fill(user.password);
  await page.getByTestId('auth-submit-button').click();
  await page.waitForURL('/');
}

/**
 * Logout helper for E2E tests
 */
export async function logout(page: Page) {
  await page.getByTestId('sidebar-user-menu').click();
  await page.getByTestId('user-menu-logout').click();
  await page.waitForURL('/login');
}

/**
 * Mock authenticated session for unit tests
 */
export function mockAuthSession(role: 'admin' | 'manager' | 'sales_rep' | 'technician' = 'admin') {
  return {
    user: {
      id: 'test-user-id',
      email: TEST_USER.email,
      app_metadata: {},
      user_metadata: {
        first_name: TEST_USER.firstName,
        last_name: TEST_USER.lastName,
      },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
    access_token: 'test-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: Date.now() + 3600000,
    token_type: 'bearer',
  };
}
