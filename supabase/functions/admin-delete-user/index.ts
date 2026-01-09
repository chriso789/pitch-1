import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Get the current user from JWT
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Get current user's role from user_roles (ONLY source of truth for roles)
    const { data: callerRoleData } = await supabaseAdmin
      .from('user_roles')
      .select('role, tenant_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!callerRoleData) {
      throw new Error('User role not found');
    }

    const callerRole = callerRoleData.role;
    const callerTenantId = callerRoleData.tenant_id;

    // Parse request body
    const { userId } = await req.json();

    if (!userId) {
      throw new Error('User ID is required');
    }

    // Prevent self-deletion
    if (userId === user.id) {
      throw new Error('Cannot delete your own account');
    }

    // Get the target user's profile
    const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id, first_name, last_name, email, company_email')
      .eq('id', userId)
      .maybeSingle();

    if (targetProfileError || !targetProfile) {
      throw new Error('Target user profile not found');
    }

    // Get target user's role from user_roles
    const { data: targetRoleData } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    const targetRole = targetRoleData?.role || 'unknown';

    // SECURITY: Master can delete across tenants, others can only delete within their tenant
    const isMaster = callerRole === 'master';
    if (!isMaster && targetProfile.tenant_id !== callerTenantId) {
      console.log('[admin-delete-user] Cross-tenant deletion blocked:', {
        callerRole,
        callerTenantId,
        targetTenantId: targetProfile.tenant_id
      });
      throw new Error('Cannot delete users from different tenant');
    }

    // Role hierarchy for permission check
    const roleHierarchy: Record<string, number> = {
      master: 1,
      owner: 2,
      corporate: 3,
      office_admin: 4,
      regional_manager: 5,
      sales_manager: 6,
      project_manager: 7
    };
    
    const currentLevel = roleHierarchy[callerRole] || 999;
    const targetLevel = roleHierarchy[targetRole] || 999;
    
    // Can only delete users below you in hierarchy (master can delete anyone except other masters)
    if (currentLevel >= targetLevel && callerRole !== 'master') {
      throw new Error('Insufficient permissions to delete this user');
    }

    console.log(`[admin-delete-user] Deactivating user ${userId} by ${user.id} (${callerRole})`);

    // Soft delete: deactivate the user (no deleted_at column - just set is_active=false)
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ 
        is_active: false
      })
      .eq('id', userId);

    if (updateError) {
      console.error('[admin-delete-user] Update error:', updateError);
      throw new Error(`Failed to deactivate user: ${updateError.message}`);
    }

    // Log the deletion in audit log
    try {
      await supabaseAdmin.from('audit_log').insert({
        tenant_id: targetProfile.tenant_id,
        table_name: 'profiles',
        record_id: userId,
        action: 'SOFT_DELETE',
        changed_by: user.id,
        old_values: {
          first_name: targetProfile.first_name,
          last_name: targetProfile.last_name,
          email: targetProfile.email || targetProfile.company_email,
          role: targetRole,
          is_active: true
        },
        new_values: {
          is_active: false
        }
      });
    } catch (auditError) {
      console.warn('[admin-delete-user] Audit log insert failed:', auditError);
    }

    console.log(`[admin-delete-user] User ${userId} deactivated successfully by ${user.id}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'User deactivated successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('[admin-delete-user] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
