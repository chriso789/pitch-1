/**
 * Response Caching for Edge Functions
 * Phase 4: Edge Function Hardening
 * 
 * Caches expensive computation results to reduce load.
 * Critical for scaling AI/measurement operations.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

interface CacheOptions {
  /** Time-to-live in seconds */
  ttlSeconds: number;
  /** Tenant ID for cache isolation */
  tenantId?: string;
}

const DEFAULT_TTL = 3600; // 1 hour

/**
 * Get a cached response if available and not expired
 * 
 * @param supabase - Supabase client (service role)
 * @param cacheKey - Unique key for this cached item
 * @returns Cached result as string, or null if not found/expired
 */
export async function getCachedResponse(
  supabase: SupabaseClient,
  cacheKey: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('function_cache')
      .select('result, created_at, ttl_seconds')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    // Check if expired
    const age = Date.now() - new Date(data.created_at).getTime();
    const ttl = (data.ttl_seconds || DEFAULT_TTL) * 1000;

    if (age > ttl) {
      // Expired - delete async and return null
      supabase
        .from('function_cache')
        .delete()
        .eq('cache_key', cacheKey)
        .then(() => {})
        .catch(() => {});
      return null;
    }

    console.log(`[Cache] HIT for key: ${cacheKey} (age: ${Math.round(age / 1000)}s)`);
    return data.result;
  } catch (error) {
    console.error('[Cache] Error reading cache:', error);
    return null;
  }
}

/**
 * Store a response in the cache
 * 
 * @param supabase - Supabase client (service role)
 * @param cacheKey - Unique key for this cached item
 * @param result - Object to cache (will be JSON stringified)
 * @param options - Cache options including TTL
 */
export async function setCachedResponse(
  supabase: SupabaseClient,
  cacheKey: string,
  result: object,
  options: CacheOptions = { ttlSeconds: DEFAULT_TTL }
): Promise<void> {
  try {
    await supabase.from('function_cache').upsert(
      {
        cache_key: cacheKey,
        result: JSON.stringify(result),
        ttl_seconds: options.ttlSeconds,
        tenant_id: options.tenantId || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' }
    );

    console.log(`[Cache] SET key: ${cacheKey} (TTL: ${options.ttlSeconds}s)`);
  } catch (error) {
    console.error('[Cache] Error writing cache:', error);
    // Don't throw - caching is best-effort
  }
}

/**
 * Delete a cached response
 */
export async function deleteCachedResponse(
  supabase: SupabaseClient,
  cacheKey: string
): Promise<void> {
  try {
    await supabase.from('function_cache').delete().eq('cache_key', cacheKey);
  } catch (error) {
    console.error('[Cache] Error deleting cache:', error);
  }
}

/**
 * Delete all cached responses matching a prefix
 */
export async function deleteCacheByPrefix(
  supabase: SupabaseClient,
  prefix: string
): Promise<void> {
  try {
    await supabase
      .from('function_cache')
      .delete()
      .like('cache_key', `${prefix}%`);
  } catch (error) {
    console.error('[Cache] Error deleting cache by prefix:', error);
  }
}

/**
 * Generate a cache key from parameters
 */
export function generateCacheKey(
  prefix: string,
  params: Record<string, string | number | boolean | undefined>
): string {
  const sortedParams = Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join(':');

  return `${prefix}:${sortedParams}`;
}

/**
 * Wrapper for caching function results
 */
export async function withCache<T>(
  supabase: SupabaseClient,
  cacheKey: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  // Try cache first
  const cached = await getCachedResponse(supabase, cacheKey);
  if (cached) {
    return JSON.parse(cached) as T;
  }

  // Execute function
  const result = await fn();

  // Cache result async (don't wait)
  setCachedResponse(supabase, cacheKey, result as object, { ttlSeconds }).catch(() => {});

  return result;
}
