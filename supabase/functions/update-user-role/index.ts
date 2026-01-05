import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const ROLE_HIERARCHY: Record<string, number> = {
  master: 1,
  owner: 2,
  corporate: 3,
  office_admin: 4,
  regional_manager: 5,
  sales_manager: 6,
  project_manager: 7,
};

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabaseClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { userId, newRole, tenantId } = await req.json();

    if (!userId || !newRole) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: userId, newRole' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate newRole is valid
    if (!ROLE_HIERARCHY[newRole]) {
      return new Response(
        JSON.stringify({ error: 'Invalid role specified' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get caller's role
    const { data: callerRoleData } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    const callerRole = callerRoleData?.role;
    
    // Fallback to profiles if no user_roles entry
    if (!callerRole) {
      const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      
      if (!callerProfile?.role) {
        return new Response(
          JSON.stringify({ error: 'Could not determine your role' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const effectiveCallerRole = callerRole || 'project_manager';
    const callerLevel = ROLE_HIERARCHY[effectiveCallerRole] || 999;
    const newRoleLevel = ROLE_HIERARCHY[newRole] || 999;

    // Get target user's current role
    const { data: targetRoleData } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    const targetCurrentRole = targetRoleData?.role;
    const targetLevel = targetCurrentRole ? (ROLE_HIERARCHY[targetCurrentRole] || 999) : 999;

    // Permission check: caller must be higher in hierarchy than both current and new role
    // Master can do anything
    if (effectiveCallerRole !== 'master') {
      // Can't change own role
      if (user.id === userId) {
        return new Response(
          JSON.stringify({ error: 'You cannot change your own role' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Can't promote someone to or above your level
      if (newRoleLevel <= callerLevel) {
        return new Response(
          JSON.stringify({ error: 'You cannot assign a role equal to or higher than your own' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Can't change role of someone at or above your level
      if (targetLevel <= callerLevel) {
        return new Response(
          JSON.stringify({ error: 'You cannot change the role of someone at or above your level' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Upsert the role in user_roles table
    const effectiveTenantId = tenantId || null;
    
    const { error: roleUpdateError } = await supabaseAdmin
      .from('user_roles')
      .upsert({
        user_id: userId,
        role: newRole,
        tenant_id: effectiveTenantId,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,tenant_id'
      });

    if (roleUpdateError) {
      console.error('Role update error:', roleUpdateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update role in user_roles', details: roleUpdateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Also update the role in profiles table for backwards compatibility
    const { error: profileUpdateError } = await supabaseAdmin
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);

    if (profileUpdateError) {
      console.error('Profile role update error:', profileUpdateError);
      // Non-fatal - continue
    }

    // Update auth metadata with new role
    const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { role: newRole }
    });

    if (metadataError) {
      console.error('Metadata update error:', metadataError);
      // Non-fatal - continue
    }

    // Log the role change to audit_log
    await supabaseAdmin.from('audit_log').insert({
      table_name: 'user_roles',
      action: 'UPDATE',
      record_id: userId,
      changed_by: user.id,
      tenant_id: effectiveTenantId,
      old_values: { role: targetCurrentRole },
      new_values: { role: newRole }
    });

    console.log(`[update-user-role] Role updated for ${userId}: ${targetCurrentRole} -> ${newRole} by ${user.id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Role updated to ${newRole}`,
        previousRole: targetCurrentRole,
        newRole: newRole
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[update-user-role] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
