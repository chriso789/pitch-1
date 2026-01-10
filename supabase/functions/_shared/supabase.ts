// ============================================
// SUPABASE CLIENT UTILITIES
// ============================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { ENV } from './env.ts';

/**
 * Create Supabase client with user's auth token
 * Use for authenticated requests that should respect RLS
 */
export function supabaseAnon(authHeader?: string): SupabaseClient {
  return createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

/**
 * Create Supabase client with service role (bypasses RLS)
 * Use for system operations, webhooks, and background jobs
 */
export function supabaseService(): SupabaseClient {
  return createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Get authenticated user from request
 * Returns null if not authenticated
 */
export async function getAuthUser(supabase: SupabaseClient): Promise<{
  id: string;
  email: string;
  tenantId: string | null;
} | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    return null;
  }
  
  // Get tenant from profile
  const { data: profile } = await supabaseService()
    .from('profiles')
    .select('tenant_id, active_tenant_id')
    .eq('id', user.id)
    .single();
  
  const tenantId = profile?.active_tenant_id || profile?.tenant_id || null;
  
  return {
    id: user.id,
    email: user.email || '',
    tenantId,
  };
}

/**
 * Verify user is member of tenant
 */
export async function verifyTenantMembership(
  userId: string,
  tenantId: string
): Promise<boolean> {
  const admin = supabaseService();
  
  const { data: profile } = await admin
    .from('profiles')
    .select('tenant_id, active_tenant_id')
    .eq('id', userId)
    .single();
  
  if (!profile) return false;
  
  // Check if user belongs to this tenant
  if (profile.tenant_id === tenantId || profile.active_tenant_id === tenantId) {
    return true;
  }
  
  // Check user_company_access for multi-tenant users
  const { data: access } = await admin
    .from('user_company_access')
    .select('id')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .single();
  
  return !!access;
}
