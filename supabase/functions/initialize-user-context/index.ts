import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/**
 * Initialize User Context Edge Function
 * 
 * Called after password setup or location selection to ensure:
 * 1. active_tenant_id is properly set in profiles
 * 2. current_location_id is saved to app_settings (if provided)
 * 3. All relevant metadata is synced to auth.users
 * 4. Returns complete user context for immediate use
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { location_id } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Client for user verification
    const supabaseClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get user from token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error('[initialize-user-context] User verification failed:', userError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[initialize-user-context] Initializing context for user: ${user.id}, location_id: ${location_id || 'none'}`);

    // Use service role client to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Fetch profile and role
    const [profileResult, roleResult] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('first_name, last_name, email, company_name, title, tenant_id, active_tenant_id, role')
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
      console.error('[initialize-user-context] Profile not found for user:', user.id);
      return new Response(
        JSON.stringify({ error: 'Profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userRole = roleResult.data?.role || profile.role || 'user';
    let activeTenantId = profile.active_tenant_id || profile.tenant_id;

    // Step 1: Ensure active_tenant_id is set
    if (!profile.active_tenant_id && profile.tenant_id) {
      console.log(`[initialize-user-context] Setting active_tenant_id to ${profile.tenant_id}`);
      const { error: updateProfileError } = await supabaseAdmin
        .from('profiles')
        .update({ active_tenant_id: profile.tenant_id })
        .eq('id', user.id);
      
      if (updateProfileError) {
        console.error('[initialize-user-context] Failed to set active_tenant_id:', updateProfileError);
      }
      activeTenantId = profile.tenant_id;
    }

    // Step 2: Save location to app_settings if provided
    if (location_id && activeTenantId) {
      console.log(`[initialize-user-context] Saving location_id: ${location_id} to app_settings`);
      const { error: settingsError } = await supabaseAdmin
        .from('app_settings')
        .upsert({
          user_id: user.id,
          tenant_id: activeTenantId,
          setting_key: 'current_location_id',
          setting_value: location_id,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,tenant_id,setting_key'
        });
      
      if (settingsError) {
        console.error('[initialize-user-context] Failed to save location:', settingsError);
      }
    }

    // Step 3: Fetch tenant name for company branding
    let tenantName = profile.company_name || '';
    if (activeTenantId) {
      const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('name')
        .eq('id', activeTenantId)
        .single();
      tenantName = tenant?.name || tenantName;
    }

    // Step 4: Fetch location name if location_id provided
    let locationName = null;
    if (location_id) {
      const { data: location } = await supabaseAdmin
        .from('locations')
        .select('name')
        .eq('id', location_id)
        .single();
      locationName = location?.name || null;
    }

    // Step 5: Update auth.users metadata with complete context
    console.log(`[initialize-user-context] Syncing metadata - tenant: ${tenantName}, role: ${userRole}`);
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
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
      console.error('[initialize-user-context] Failed to update user metadata:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update metadata', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[initialize-user-context] Successfully initialized context for ${profile.first_name} ${profile.last_name}`);

    // Return complete context for immediate use
    return new Response(
      JSON.stringify({
        success: true,
        context: {
          user_id: user.id,
          email: profile.email,
          first_name: profile.first_name,
          last_name: profile.last_name,
          tenant_id: profile.tenant_id,
          active_tenant_id: activeTenantId,
          tenant_name: tenantName,
          location_id: location_id || null,
          location_name: locationName,
          role: userRole
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[initialize-user-context] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
