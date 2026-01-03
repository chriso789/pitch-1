import { supabase } from "@/integrations/supabase/client";

/**
 * API Error Interceptor
 * Wraps fetch calls to automatically log failures to the monitoring system via edge function
 */

// Store original fetch
const originalFetch = window.fetch;

// Track if interceptor is active
let interceptorActive = false;

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
 * Intercepted fetch that logs all API errors
 */
export const interceptedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method || 'GET';
  const start = performance.now();

  try {
    const response = await originalFetch(input, init);
    const duration = Math.round(performance.now() - start);

    // Log non-OK responses
    if (!response.ok) {
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

      // Use edge function to report crash
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
          url: url.substring(0, 500), // Truncate long URLs
          errorBody: errorBody.substring(0, 1000) // Truncate long error bodies
        }
      });
    }

    return response;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Network errors are critical - use edge function
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
    });

    throw error;
  }
};

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
 * Create a custom fetch wrapper for Supabase client
 */
export function createSupabaseFetch(): typeof fetch {
  return interceptedFetch;
}
