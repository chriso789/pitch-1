import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pitch-tenant',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export const handle = async (req) => {
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

    const deny = (status: number, error: string) =>
      new Response(JSON.stringify({ error }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return deny(401, 'Unauthorized');

    const jwt = authHeader.slice(7);
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt);
    if (userError || !user) return deny(401, 'Unauthorized');

    const body = await req.json().catch(() => null);
    const userId = body?.userId;
    if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
      return deny(400, 'A valid user ID is required');
    }
    if (userId === user.id) return deny(403, 'Cannot delete your own account');

    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id, first_name, last_name, email, company_email')
      .eq('id', userId)
      .maybeSingle();
    if (!targetProfile) return deny(404, 'User not found');

    // Roles come only from user_roles, matched to the target's company.
    const { data: callerRoles } = await supabaseAdmin
      .from('user_roles')
      .select('role, tenant_id')
      .eq('user_id', user.id);
    const { data: targetRoles } = await supabaseAdmin
      .from('user_roles')
      .select('role, tenant_id')
      .eq('user_id', userId);

    const isMaster = (callerRoles ?? []).some((r: { role: string }) => r.role === 'master');
    const callerRole = isMaster
      ? 'master'
      : (callerRoles ?? []).find((r: { tenant_id: string | null }) => r.tenant_id === targetProfile.tenant_id)?.role;
    if (!callerRole) return deny(403, 'You do not have access to this company');

    const targetIsMaster = (targetRoles ?? []).some((r: { role: string }) => r.role === 'master');
    const targetRole = targetIsMaster
      ? 'master'
      : (targetRoles ?? []).find((r: { tenant_id: string | null }) => r.tenant_id === targetProfile.tenant_id)?.role || 'unknown';

    const roleHierarchy: Record<string, number> = {
      master: 1, owner: 2, corporate: 3, office_admin: 4,
      regional_manager: 5, sales_manager: 6, project_manager: 7,
    };
    const currentLevel = roleHierarchy[callerRole] ?? 999;
    const targetLevel = roleHierarchy[targetRole] ?? 999;

    // Only admin roles may delete, only users strictly below them; nobody deletes a master here.
    if (currentLevel > 4) return deny(403, 'Insufficient permissions to delete users');
    if (targetIsMaster || currentLevel >= targetLevel) {
      return deny(403, 'Insufficient permissions to delete this user');
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
  } catch (error: unknown) {
    console.error('[admin-delete-user] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ 
        error: errorMessage
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
};
