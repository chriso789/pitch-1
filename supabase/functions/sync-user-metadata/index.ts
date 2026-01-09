import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with user's token
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Client for user verification
    const supabaseClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get user from token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error('User verification failed:', userError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[sync-user-metadata] Syncing metadata for user: ${user.id}`);

    // Use service role client to bypass RLS and update auth metadata
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Use admin client to fetch profile and role to bypass RLS
    const [profileResult, roleResult] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('first_name, last_name, company_name, title, tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single(),
      supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
    ]);

    const profile = profileResult.data;
    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'Profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CRITICAL: roles MUST come only from user_roles (no profile fallback)
    const userRole = roleResult.data?.role || '';
    if (!userRole) {
      console.warn(`[sync-user-metadata] No role found in user_roles for user: ${user.id}`);
    }

    // Determine active_tenant_id (use profile's active_tenant_id or fallback to tenant_id)
    const activeTenantId = profile.active_tenant_id || profile.tenant_id;

    // Fetch tenant name for company branding
    let tenantName = profile.company_name || '';
    if (activeTenantId) {
      const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('name')
        .eq('id', activeTenantId)
        .single();
      tenantName = tenant?.name || tenantName;
    }

    console.log(`[sync-user-metadata] User ${user.id} - active_tenant: ${activeTenantId}, company: ${tenantName}`);

    const { data: updatedUser, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      {
        user_metadata: {
          first_name: profile.first_name,
          last_name: profile.last_name,
          company_name: tenantName,
          title: profile.title || '',
          tenant_id: profile.tenant_id,
          active_tenant_id: activeTenantId,
          role: userRole
        }
      }
    );

    if (updateError) {
      console.error('Metadata update failed:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update metadata', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[sync-user-metadata] Successfully synced metadata for ${profile.first_name} ${profile.last_name}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'User metadata synced successfully',
        user_metadata: {
          first_name: profile.first_name,
          last_name: profile.last_name,
          tenant_id: profile.tenant_id,
          active_tenant_id: activeTenantId,
          role: userRole,
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[sync-user-metadata] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
