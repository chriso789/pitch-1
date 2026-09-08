import { supabase } from "@/integrations/supabase/client";
import { getTabTenantId, TAB_TENANT_HEADER } from "@/lib/tabTenant";


/**
 * API Error Interceptor
 * Wraps fetch calls to automatically log failures to the monitoring system via edge function
 * 
 * CIRCUIT BREAKER: Prevents infinite loops when crash logging itself fails
 */

// Store original fetch
const originalFetch = window.fetch;

// Track if interceptor is active
let interceptorActive = false;

// Circuit breaker state to prevent infinite crash logging loops
let isLoggingCrash = false;
let crashLogCount = 0;
let lastCrashLogReset = Date.now();
const MAX_CRASH_LOGS_PER_MINUTE = 10;
const CRASH_LOG_RESET_INTERVAL = 60000; // 1 minute

// Error deduplication cache
const recentErrors = new Map<string, number>();
const ERROR_DEDUP_WINDOW = 5000; // 5 seconds

/**
 * Generate a hash for error deduplication
 */
function getErrorHash(url: string, status: number, method: string): string {
  return `${method}:${url}:${status}`;
}

/**
 * Check if we should log this error (deduplication + rate limiting)
 */
function shouldLogError(errorHash: string): boolean {
  const now = Date.now();
  
  // Reset crash log count if window expired
  if (now - lastCrashLogReset > CRASH_LOG_RESET_INTERVAL) {
    crashLogCount = 0;
    lastCrashLogReset = now;
  }
  
  // Rate limit check
  if (crashLogCount >= MAX_CRASH_LOGS_PER_MINUTE) {
    return false;
  }
  
  // Deduplication check
  const lastSeen = recentErrors.get(errorHash);
  if (lastSeen && now - lastSeen < ERROR_DEDUP_WINDOW) {
    return false;
  }
  
  // Clean old entries from dedup cache
  for (const [hash, timestamp] of recentErrors.entries()) {
    if (now - timestamp > ERROR_DEDUP_WINDOW) {
      recentErrors.delete(hash);
    }
  }
  
  recentErrors.set(errorHash, now);
  crashLogCount++;
  return true;
}

/**
 * Check if URL is a crash logging endpoint (to prevent infinite loops)
 */
function isCrashLoggingEndpoint(url: string): boolean {
  return url.includes('log-system-crash') || 
         url.includes('system_crashes') ||
         url.includes('log-health-check') ||
         url.includes('health_checks') ||
         url.includes('system_metrics');
}

/**
 * Report crash via edge function to bypass RLS issues
 */
async function reportCrashViaEdge(crash: {
  error_type: string;
  error_message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  component: string;
  route: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('log-system-crash', {
      body: crash
    });

    if (error) {
      console.error('[APIInterceptor] Edge function failed, falling back to direct insert:', error);
      // Fallback to direct insert (will use new RLS policies)
      await supabase.from('system_crashes').insert([{
        error_type: crash.error_type,
        error_message: crash.error_message,
        severity: crash.severity,
        component: crash.component,
        route: crash.route,
        metadata: crash.metadata ? JSON.parse(JSON.stringify(crash.metadata)) : {}
      }]);
    }
  } catch (err) {
    console.error('[APIInterceptor] Failed to report crash:', err);
  }
}

/**
 * Intercepted fetch that logs all API errors with circuit breaker protection
 */
export const interceptedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method || 'GET';
  const start = performance.now();

  // CIRCUIT BREAKER: Skip logging for crash-related endpoints to prevent infinite loops
  if (isCrashLoggingEndpoint(url)) {
    return originalFetch(input, init);
  }

  try {
    const response = await originalFetch(input, init);
    const duration = Math.round(performance.now() - start);

    // Log non-OK responses (with circuit breaker protection)
    // Ignore known-benign endpoints to avoid noisy crash reports
    const isBenignNoise =
      // Dev-only scrubber report; 404 expected in production
      (response.status === 404 && url.includes('/tools/scrubber/')) ||
      // customer_photos cross-tenant RLS denials surface as 400; not a real crash
      (response.status === 400 && url.includes('/rest/v1/customer_photos'));

    if (!response.ok && !isLoggingCrash && !isBenignNoise) {
      const errorHash = getErrorHash(url, response.status, method);
      
      // Only log if not deduplicated and under rate limit
      if (shouldLogError(errorHash)) {
        const severity = response.status >= 500 ? 'high' : response.status >= 400 ? 'medium' : 'low';
        
        // Clone response to read body without consuming it
        const clonedResponse = response.clone();
        let errorBody = '';
        try {
          errorBody = await clonedResponse.text();
        } catch {
          // Ignore if can't read body
        }

        // Determine API type from URL
        let apiType = 'external_api';
        if (url.includes('supabase')) {
          apiType = 'supabase';
        } else if (url.includes('googleapis') || url.includes('google.com')) {
          apiType = 'google_api';
        } else if (url.includes('telnyx')) {
          apiType = 'telnyx_api';
        }

        // Use edge function to report crash (with circuit breaker)
        isLoggingCrash = true;
        reportCrashViaEdge({
          error_type: 'api_error',
          error_message: `${method} ${url} - ${response.status} ${response.statusText}`,
          severity: severity as 'low' | 'medium' | 'high',
          component: apiType,
          route: window.location.pathname,
          metadata: {
            status: response.status,
            statusText: response.statusText,
            duration,
            method,
            url: url.substring(0, 500),
            errorBody: errorBody.substring(0, 1000)
          }
        }).finally(() => {
          isLoggingCrash = false;
        });
      }
    }

    return response;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Network errors - only log if circuit breaker allows
    if (!isLoggingCrash) {
      const errorHash = getErrorHash(url, 0, method);
      
      if (shouldLogError(errorHash)) {
        isLoggingCrash = true;
        reportCrashViaEdge({
          error_type: 'network_error',
          error_message: `${method} ${url} - ${errorMessage}`,
          severity: 'high',
          component: 'fetch',
          route: window.location.pathname,
          metadata: {
            duration,
            method,
            url: url.substring(0, 500),
            errorName: error instanceof Error ? error.name : 'Unknown'
          }
        }).finally(() => {
          isLoggingCrash = false;
        });
      }
    }

    throw error;
  }
};

/**
 * Auth endpoints (token exchange / user lookup) occasionally return upstream
 * gateway timeouts (502/503/504) when the auth service is under load. Those
 * transient failures used to surface as "login failed" or an immediate sign-out.
 * Retry them a couple of times with a short backoff before giving up.
 */
const AUTH_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryableAuthRequest(url: string, method: string): boolean {
  if (!url.includes('/auth/v1/')) return false;
  // Never retry sign-out or one-time-use flows.
  if (url.includes('/logout') || url.includes('/verify') || url.includes('/recover')) return false;
  // A password exchange creates a new session/refresh token. Replaying it after
  // an upstream timeout can create competing sessions and makes the sign-in
  // spinner last through multiple gateway timeout windows.
  if (url.includes('/token') && url.includes('grant_type=password')) return false;
  return method === 'GET' || url.includes('/token') || url.includes('/user');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithAuthRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

  if (!isRetryableAuthRequest(url, method)) {
    return interceptedFetch(input, init);
  }

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await interceptedFetch(input, init);
      if (!AUTH_RETRY_STATUSES.has(response.status) || attempt === maxAttempts) {
        return response;
      }
      console.warn(`[APIInterceptor] Auth request ${response.status}, retrying (${attempt}/${maxAttempts - 1})`);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
      console.warn(`[APIInterceptor] Auth request network failure, retrying (${attempt}/${maxAttempts - 1})`);
    }
    await sleep(600 * attempt);
  }

  if (lastError) throw lastError;
  return interceptedFetch(input, init);
}


/**
 * Install the fetch interceptor globally
 */
export function installFetchInterceptor(): void {
  if (interceptorActive) return;
  
  window.fetch = interceptedFetch;
  interceptorActive = true;
  console.log('[APIInterceptor] Fetch interceptor installed');
}

/**
 * Uninstall the fetch interceptor
 */
export function uninstallFetchInterceptor(): void {
  if (!interceptorActive) return;
  
  window.fetch = originalFetch;
  interceptorActive = false;
  console.log('[APIInterceptor] Fetch interceptor removed');
}

/**
 * Create a custom fetch wrapper for Supabase client.
 * Attaches the per-tab active company header so each browser tab can work in a
 * different company without affecting other tabs. The database verifies access
 * to the requested tenant before honoring the header.
 */
export function createSupabaseFetch(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const tabTenant = getTabTenantId();
    if (!tabTenant) return fetchWithAuthRetry(input, init);

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set(TAB_TENANT_HEADER, tabTenant);
    return fetchWithAuthRetry(input, { ...init, headers });
  }) as typeof fetch;
}

