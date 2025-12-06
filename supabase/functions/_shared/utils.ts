import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuditEventPayload, ApiResponse } from './types.ts';

// ============================================================================
// SUPABASE CLIENT (SERVICE_ROLE)
// ============================================================================

export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, supabaseServiceKey);
}

// ============================================================================
// TOKEN HASHING (SHA-256)
// ============================================================================

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSecureToken(length: number = 32): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

export async function logAuditEvent(
  supabase: SupabaseClient,
  payload: AuditEventPayload
): Promise<void> {
  const { error } = await supabase
    .from('audit_log')
    .insert({
      tenant_id: payload.tenant_id,
      changed_by: payload.actor_user_id,
      action: payload.action,
      table_name: payload.target_type,
      record_id: payload.target_id,
      new_values: payload.changes,
      ip_address: payload.ip_address,
      user_agent: payload.user_agent,
    });

  if (error) {
    console.error('Failed to log audit event:', error);
  }
}

// ============================================================================
// CREATE IN-APP NOTIFICATION
// ============================================================================

export async function createNotification(
  supabase: SupabaseClient,
  params: {
    tenant_id: string;
    user_id: string;
    type: string;
    title: string;
    message: string;
    action_url?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase
    .from('user_notifications')
    .insert({
      tenant_id: params.tenant_id,
      user_id: params.user_id,
      type: params.type,
      title: params.title,
      message: params.message,
      action_url: params.action_url,
      metadata: params.metadata,
    });

  if (error) {
    console.error('Failed to create notification:', error);
  }
}

// ============================================================================
// PERMISSION CHECKS
// ============================================================================

export async function checkTenantPermission(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string
): Promise<boolean> {
  // Check if user belongs to tenant via profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, active_tenant_id')
    .eq('id', userId)
    .single();

  if (profile?.tenant_id === tenantId || profile?.active_tenant_id === tenantId) {
    return true;
  }

  // Check user_company_access
  const { data: access } = await supabase
    .from('user_company_access')
    .select('id')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .single();

  return !!access;
}

// ============================================================================
// ERROR RESPONSES
// ============================================================================

export function successResponse<T>(data: T, status: number = 200): Response {
  const body: ApiResponse<T> = { success: true, data };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number = 400,
  details?: unknown
): Response {
  const body: ApiResponse = {
    success: false,
    error: { code, message, details },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

// ============================================================================
// CORS PREFLIGHT HANDLER
// ============================================================================

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      },
    });
  }
  return null;
}

// ============================================================================
// EXTRACT REQUEST INFO
// ============================================================================

export function getClientInfo(req: Request): {
  ip: string;
  userAgent: string;
} {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  return { ip, userAgent };
}

// ============================================================================
// GET USER FROM AUTH HEADER
// ============================================================================

export async function getUserFromAuth(
  supabase: SupabaseClient,
  authHeader: string | null
): Promise<{ userId: string; email: string } | null> {
  if (!authHeader) return null;
  
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) return null;
  
  return { userId: user.id, email: user.email || '' };
}
