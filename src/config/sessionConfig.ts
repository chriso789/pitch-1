/**
 * Session Configuration Constants
 * Controls session timeout durations and expiry behavior
 */

export const SESSION_CONFIG = {
  // Duration when "Remember Me" is checked (30 days)
  REMEMBER_ME_DURATION: 30 * 24 * 60 * 60 * 1000,
  
  // Duration when "Remember Me" is unchecked (24 hours)
  DEFAULT_DURATION: 24 * 60 * 60 * 1000,
  
  // Idle timeout - session expires after inactivity (30 minutes)
  IDLE_TIMEOUT: 30 * 60 * 1000,
  
  // Warning shown before session expires (5 minutes)
  WARNING_BEFORE_EXPIRY: 5 * 60 * 1000,
  
  // Check interval for session expiry (every minute)
  CHECK_INTERVAL: 60 * 1000,
} as const;

// Storage keys
export const SESSION_KEYS = {
  SESSION_STARTED: 'pitch_session_started_at',
  SESSION_EXPIRES: 'pitch_session_expires_at',
  REMEMBER_ME: 'pitch_remember_me',
  LAST_ACTIVITY: 'pitch_last_activity',
  SUPABASE_AUTH: 'sb-alxelfrbjzkmtnsulcei-auth-token',
} as const;
