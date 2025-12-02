import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Service role client for database operations
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

interface BilltrustAuthRequest {
  email: string;
  password: string;
  supplierAccountId?: string;
}

// Rate limiting configuration
const RATE_LIMITS = {
  attemptsPerMinute: 5,
  attemptsPerHour: 20,
};

// Allowed roles for managing supplier integrations
const ALLOWED_ROLES = ['master', 'corporate', 'office_admin'];

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ============================================
    // 1. AUTHENTICATION & AUTHORIZATION
    // ============================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.warn('Billtrust auth attempt without authorization header');
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create auth client to verify user token
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);

    if (authError || !user) {
      console.error('Auth verification failed:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired authentication token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's profile to check tenant and permissions
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, tenant_id, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('Profile lookup failed for user:', user.id);
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has appropriate role
    if (!ALLOWED_ROLES.includes(profile.role)) {
      console.warn(`Unauthorized Billtrust access attempt by user ${user.id} with role ${profile.role}`);
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions to manage supplier integrations' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================
    // 2. RATE LIMITING
    // ============================================
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Check per-minute rate limit
    const { count: minuteCount } = await supabase
      .from('api_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', profile.tenant_id)
      .eq('user_id', user.id)
      .eq('endpoint', 'billtrust-auth')
      .gte('created_at', oneMinuteAgo);

    if ((minuteCount ?? 0) >= RATE_LIMITS.attemptsPerMinute) {
      console.warn(`Rate limit exceeded: ${minuteCount} attempts/minute by user ${user.id}`);
      return new Response(
        JSON.stringify({ 
          error: 'Too many authentication attempts. Please try again in a minute.',
          retry_after: 60 
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Retry-After': '60'
          } 
        }
      );
    }

    // Check per-hour rate limit
    const { count: hourCount } = await supabase
      .from('api_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', profile.tenant_id)
      .eq('user_id', user.id)
      .eq('endpoint', 'billtrust-auth')
      .gte('created_at', oneHourAgo);

    if ((hourCount ?? 0) >= RATE_LIMITS.attemptsPerHour) {
      console.warn(`Hourly rate limit exceeded: ${hourCount} attempts/hour by user ${user.id}`);
      return new Response(
        JSON.stringify({ 
          error: 'Too many authentication attempts this hour. Please try again later.',
          retry_after: 3600 
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Retry-After': '3600'
          } 
        }
      );
    }

    // Log this authentication attempt for rate limiting
    await supabase
      .from('api_rate_limits')
      .insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        endpoint: 'billtrust-auth'
      });

    // ============================================
    // 3. INPUT VALIDATION
    // ============================================
    const { email, password, supplierAccountId }: BilltrustAuthRequest = await req.json();

    // Validate email
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(
        JSON.stringify({ error: 'Valid email address is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate password
    if (!password || typeof password !== 'string' || password.length < 1) {
      return new Response(
        JSON.stringify({ error: 'Password is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate supplierAccountId if provided - ensure it belongs to user's tenant
    if (supplierAccountId) {
      const { data: account, error: accountError } = await supabase
        .from('supplier_accounts')
        .select('id, tenant_id')
        .eq('id', supplierAccountId)
        .single();

      if (accountError || !account || account.tenant_id !== profile.tenant_id) {
        console.warn(`Supplier account access denied: ${supplierAccountId} for tenant ${profile.tenant_id}`);
        return new Response(
          JSON.stringify({ error: 'Supplier account not found or access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ============================================
    // 4. BILLTRUST AUTHENTICATION
    // ============================================
    console.log(`Billtrust auth attempt by user ${user.id} for tenant ${profile.tenant_id}`);

    const billtrustResponse = await fetch('https://secure.billtrust.com/srsicorp/ig/signin', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: new URLSearchParams({
        'username': email,
        'password': password,
        'remember': 'false'
      }).toString()
    });

    const responseText = await billtrustResponse.text();
    let loginData: Record<string, unknown> = {};
    let isSuccess = false;

    if (!billtrustResponse.ok) {
      console.error('Billtrust login failed with status:', billtrustResponse.status);
      
      // Log failed attempt
      await logAuditEvent(supabase, profile.tenant_id, user.id, 'billtrust_auth_failed', supplierAccountId, {
        billtrust_email: email,
        status_code: billtrustResponse.status,
        ip_address: req.headers.get('x-forwarded-for') || 'unknown'
      });

      return new Response(
        JSON.stringify({ 
          error: 'Authentication failed', 
          details: 'Invalid credentials or Billtrust service unavailable' 
        }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Parse response
    try {
      loginData = JSON.parse(responseText);
      isSuccess = loginData.status === 'LOGIN_SUCCESS' || loginData.success === true;
    } catch {
      isSuccess = responseText.includes('dashboard') || 
                  responseText.includes('success') ||
                  (!responseText.includes('error') && !responseText.includes('invalid'));
      
      if (isSuccess) {
        loginData = {
          status: 'LOGIN_SUCCESS',
          accessToken: 'srs-session-token',
          tenantId: 'srs-tenant',
          email: email
        };
      }
    }

    if (!isSuccess) {
      // Log failed attempt
      await logAuditEvent(supabase, profile.tenant_id, user.id, 'billtrust_auth_failed', supplierAccountId, {
        billtrust_email: email,
        ip_address: req.headers.get('x-forwarded-for') || 'unknown'
      });

      return new Response(
        JSON.stringify({ 
          error: 'Login failed', 
          details: 'Invalid credentials or login failed'
        }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // ============================================
    // 5. UPDATE SUPPLIER ACCOUNT & LOG SUCCESS
    // ============================================
    const sessionCookies = billtrustResponse.headers.get('set-cookie') || '';
    
    if (supplierAccountId) {
      const { error: updateError } = await supabase
        .from('supplier_accounts')
        .update({
          billtrust_tenant_id: (loginData.tenantId as string) || 'srs-tenant',
          api_key_id: null,
          encrypted_credentials: {
            accessToken: (loginData.accessToken as string) || 'srs-session',
            sessionCookies: sessionCookies,
            loginEmail: email,
            expiresIn: 3600
          },
          connection_status: 'connected',
          last_sync_at: new Date().toISOString(),
          last_error: null
        })
        .eq('id', supplierAccountId);

      if (updateError) {
        console.error('Failed to update supplier account:', updateError);
      }
    }

    // Log successful authentication
    await logAuditEvent(supabase, profile.tenant_id, user.id, 'billtrust_auth_success', supplierAccountId, {
      billtrust_email: email,
      ip_address: req.headers.get('x-forwarded-for') || 'unknown'
    });

    console.log(`Billtrust auth successful for user ${user.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        tenantId: (loginData.tenantId as string) || 'srs-tenant',
        tenantName: 'SRS Corp',
        accessToken: (loginData.accessToken as string) || 'srs-session',
        sessionCookies: sessionCookies,
        apiKey: null,
        keyId: null,
        expiresIn: (loginData.expiresIn as number) || 3600
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in billtrust-auth:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : String(error) 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Helper function to log audit events
async function logAuditEvent(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  userId: string,
  action: string,
  entityId: string | null,
  details: Record<string, unknown>
) {
  try {
    await supabase
      .from('audit_log')
      .insert({
        tenant_id: tenantId,
        changed_by: userId,
        action: action,
        table_name: 'supplier_accounts',
        record_id: entityId || 'none',
        new_values: details
      });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}
