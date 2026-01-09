/**
 * Session Manager Service
 * Handles session initialization, expiry checking, and data clearing
 */

import { SESSION_CONFIG, SESSION_KEYS } from '@/config/sessionConfig';

export interface SessionInfo {
  isValid: boolean;
  expiresAt: number | null;
  remainingTime: number;
  rememberMe: boolean;
}

/**
 * Initialize a new session with appropriate duration
 */
export function initSession(rememberMe: boolean): void {
  const now = Date.now();
  const duration = rememberMe 
    ? SESSION_CONFIG.REMEMBER_ME_DURATION 
    : SESSION_CONFIG.DEFAULT_DURATION;
  const expiresAt = now + duration;

  localStorage.setItem(SESSION_KEYS.SESSION_STARTED, now.toString());
  localStorage.setItem(SESSION_KEYS.SESSION_EXPIRES, expiresAt.toString());
  localStorage.setItem(SESSION_KEYS.REMEMBER_ME, rememberMe.toString());
  localStorage.setItem(SESSION_KEYS.LAST_ACTIVITY, now.toString());
  
  console.log('[SessionManager] Session initialized:', {
    rememberMe,
    expiresAt: new Date(expiresAt).toISOString(),
    duration: rememberMe ? '30 days' : '24 hours'
  });
}

/**
 * Check if the current session is valid and not expired
 */
export function checkSessionExpiry(): SessionInfo {
  const expiresAtStr = localStorage.getItem(SESSION_KEYS.SESSION_EXPIRES);
  const rememberMe = localStorage.getItem(SESSION_KEYS.REMEMBER_ME) === 'true';
  
  if (!expiresAtStr) {
    return {
      isValid: false,
      expiresAt: null,
      remainingTime: 0,
      rememberMe: false
    };
  }

  const expiresAt = parseInt(expiresAtStr, 10);
  const now = Date.now();
  const remainingTime = expiresAt - now;
  const isValid = remainingTime > 0;

  return {
    isValid,
    expiresAt,
    remainingTime: Math.max(0, remainingTime),
    rememberMe
  };
}

/**
 * Update last activity timestamp (for idle timeout tracking)
 */
export function updateActivity(): void {
  localStorage.setItem(SESSION_KEYS.LAST_ACTIVITY, Date.now().toString());
}

/**
 * Extend the current session
 */
export function extendSession(): void {
  const rememberMe = localStorage.getItem(SESSION_KEYS.REMEMBER_ME) === 'true';
  const duration = rememberMe 
    ? SESSION_CONFIG.REMEMBER_ME_DURATION 
    : SESSION_CONFIG.DEFAULT_DURATION;
  const newExpiresAt = Date.now() + duration;

  localStorage.setItem(SESSION_KEYS.SESSION_EXPIRES, newExpiresAt.toString());
  localStorage.setItem(SESSION_KEYS.LAST_ACTIVITY, Date.now().toString());
  
  console.log('[SessionManager] Session extended to:', new Date(newExpiresAt).toISOString());
}

/**
 * Get remaining time until session expires
 */
export function getSessionRemainingTime(): number {
  const { remainingTime } = checkSessionExpiry();
  return remainingTime;
}

/**
 * Check if session is about to expire (within warning threshold)
 */
export function isSessionExpiringSoon(): boolean {
  const { remainingTime, isValid } = checkSessionExpiry();
  return isValid && remainingTime <= SESSION_CONFIG.WARNING_BEFORE_EXPIRY;
}

/**
 * Clear all session data - localStorage, sessionStorage, and cookies
 * SECURITY: This must clear ALL cached authentication data to prevent session leaks
 */
export function clearAllSessionData(): void {
  console.log('[SessionManager] Clearing all session data...');

  // Clear Supabase auth token
  localStorage.removeItem(SESSION_KEYS.SUPABASE_AUTH);

  // Clear device fingerprint to prevent cross-user fingerprint reuse
  localStorage.removeItem('pitch_device_fingerprint');

  // Clear app-specific non-prefixed keys that can cause stale state
  const appSpecificKeys = [
    'user-profile-cache',
    'company-switching',
    'pitch_workspace_identity_v1',
  ];
  appSpecificKeys.forEach(key => {
    localStorage.removeItem(key);
    console.log('[SessionManager] Removed app key:', key);
  });

  // Clear all pitch_ prefixed items from localStorage
  const localStorageKeys = Object.keys(localStorage);
  localStorageKeys
    .filter(key => key.startsWith('pitch_') || key.startsWith('sb-'))
    .forEach(key => {
      localStorage.removeItem(key);
      console.log('[SessionManager] Removed localStorage:', key);
    });

  // Clear session storage completely
  sessionStorage.clear();

  // Clear all cookies
  const cookies = document.cookie.split(';');
  cookies.forEach(cookie => {
    const eqPos = cookie.indexOf('=');
    const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
    if (name) {
      // Clear cookie for current path and domain
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${window.location.hostname}`;
    }
  });

  console.log('[SessionManager] All session data cleared');
}

/**
 * Format remaining time for display
 */
export function formatRemainingTime(ms: number): string {
  if (ms <= 0) return 'Expired';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}
