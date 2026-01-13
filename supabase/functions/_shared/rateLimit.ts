/**
 * Rate Limiting Middleware for Edge Functions
 * Phase 4: Edge Function Hardening
 * 
 * Standardized rate limiting across all edge functions.
 * Prevents abuse and ensures fair resource distribution.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

interface RateLimitConfig {
  perMinute: number;
  perHour: number;
}

/**
 * Rate limit tiers for different endpoint types
 */
const TIERS: Record<string, RateLimitConfig> = {
  // Standard endpoints (most APIs)
  default: { perMinute: 60, perHour: 500 },
  
  // Heavy computational endpoints (measure, generate-report, AI operations)
  heavy: { perMinute: 10, perHour: 100 },
  
  // Light endpoints (get-mapbox-token, health checks)
  light: { perMinute: 200, perHour: 2000 },
  
  // Critical AI-intensive operations (proposal generation, document analysis)
  critical: { perMinute: 5, perHour: 50 },
};

export type RateLimitTier = keyof typeof TIERS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds?: number;
}

/**
 * Check if request is within rate limits
 * 
 * @param supabase - Supabase client
 * @param userId - User making the request
 * @param endpoint - Endpoint name for tracking
 * @param tier - Rate limit tier to apply
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  endpoint: string,
  tier: RateLimitTier = 'default'
): Promise<RateLimitResult> {
  const limits = TIERS[tier] || TIERS.default;
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60000);
  const oneHourAgo = new Date(now.getTime() - 3600000);

  try {
    // Check minute limit
    const { count: minuteCount, error: minuteError } = await supabase
      .from('api_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .gte('created_at', oneMinuteAgo.toISOString());

    if (minuteError) {
      console.error('Rate limit check error:', minuteError);
      // Fail open - allow request if we can't check
      return { allowed: true, remaining: limits.perMinute, limit: limits.perMinute };
    }

    const currentMinuteCount = minuteCount || 0;

    if (currentMinuteCount >= limits.perMinute) {
      return {
        allowed: false,
        remaining: 0,
        limit: limits.perMinute,
        retryAfterSeconds: 60,
      };
    }

    // Check hour limit
    const { count: hourCount } = await supabase
      .from('api_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .gte('created_at', oneHourAgo.toISOString());

    const currentHourCount = hourCount || 0;

    if (currentHourCount >= limits.perHour) {
      return {
        allowed: false,
        remaining: 0,
        limit: limits.perHour,
        retryAfterSeconds: 300, // 5 minutes
      };
    }

    // Log this request (fire and forget for performance)
    supabase
      .from('api_rate_limits')
      .insert({
        user_id: userId,
        endpoint,
        tenant_id: null, // Can be populated if available
        created_at: now.toISOString(),
      })
      .then(() => {})
      .catch((err) => console.error('Failed to log rate limit:', err));

    return {
      allowed: true,
      remaining: limits.perMinute - currentMinuteCount - 1,
      limit: limits.perMinute,
    };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // Fail open
    return { allowed: true, remaining: limits.perMinute, limit: limits.perMinute };
  }
}

/**
 * Generate a rate limit exceeded response
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      message: `You have exceeded the rate limit. Please try again later.`,
      retryAfter: result.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfterSeconds || 60),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
      },
    }
  );
}

/**
 * Add rate limit headers to a response
 */
export function addRateLimitHeaders(
  headers: Headers,
  result: RateLimitResult
): Headers {
  headers.set('X-RateLimit-Limit', String(result.limit));
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  return headers;
}
