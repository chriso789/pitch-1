import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SaveCommissionRequest {
  target_user_id: string;
  commission_type: 'profit_split' | 'percentage_contract_price';
  commission_rate: number;
  rep_overhead_rate: number;
  manager_override_rate?: number;
  reports_to_manager_id?: string | null;
  is_manager: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[save-commission-settings] No authorization header');
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's token to verify identity
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get the authenticated user
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      console.error('[save-commission-settings] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication failed' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[save-commission-settings] User ${user.id} making request`);

    // Get caller's profile to check permissions
    const { data: callerProfile, error: callerError } = await serviceClient
      .from('profiles')
      .select('id, role, tenant_id, first_name, last_name')
      .eq('id', user.id)
      .single();

    if (callerError || !callerProfile) {
      console.error('[save-commission-settings] Caller profile error:', callerError);
      return new Response(
        JSON.stringify({ success: false, error: 'Caller profile not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[save-commission-settings] Caller: ${callerProfile.first_name} ${callerProfile.last_name}, Role: ${callerProfile.role}`);

    // Parse request body
    const body: SaveCommissionRequest = await req.json();
    const {
      target_user_id,
      commission_type,
      commission_rate,
      rep_overhead_rate,
      manager_override_rate,
      reports_to_manager_id,
      is_manager
    } = body;

    console.log(`[save-commission-settings] Target user: ${target_user_id}, Commission type: ${commission_type}, Rate: ${commission_rate}%`);

    // Get target user's profile
    const { data: targetProfile, error: targetError } = await serviceClient
      .from('profiles')
      .select('id, tenant_id, first_name, last_name, role')
      .eq('id', target_user_id)
      .single();

    if (targetError || !targetProfile) {
      console.error('[save-commission-settings] Target profile error:', targetError);
      return new Response(
        JSON.stringify({ success: false, error: 'Target user not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Permission check: caller must be owner, corporate, or master in same tenant
    const allowedRoles = ['owner', 'corporate', 'master'];
    const callerRole = callerProfile.role as string;
    
    if (!allowedRoles.includes(callerRole)) {
      console.error(`[save-commission-settings] Permission denied: caller role ${callerRole} not in allowed roles`);
      return new Response(
        JSON.stringify({ success: false, error: 'Permission denied: insufficient role' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Master can edit any tenant, others must be same tenant
    if (callerRole !== 'master' && callerProfile.tenant_id !== targetProfile.tenant_id) {
      console.error('[save-commission-settings] Permission denied: different tenant');
      return new Response(
        JSON.stringify({ success: false, error: 'Permission denied: cannot edit users in other companies' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[save-commission-settings] Permission check passed`);

    // Step 1: Update profile fields
    const profileUpdate: Record<string, unknown> = {
      personal_overhead_rate: rep_overhead_rate
    };

    if (is_manager) {
      profileUpdate.manager_override_rate = manager_override_rate || 0;
    } else {
      profileUpdate.reports_to_manager_id = reports_to_manager_id || null;
    }

    const { error: profileUpdateError } = await serviceClient
      .from('profiles')
      .update(profileUpdate)
      .eq('id', target_user_id);

    if (profileUpdateError) {
      console.error('[save-commission-settings] Profile update error:', profileUpdateError);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to update profile: ${profileUpdateError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[save-commission-settings] Profile updated successfully`);

    // Step 2: Check for existing commission plan assignment
    const { data: existingAssignment } = await serviceClient
      .from('user_commission_plans')
      .select(`
        id,
        commission_plan_id,
        commission_plans (id, name)
      `)
      .eq('user_id', target_user_id)
      .eq('is_active', true)
      .maybeSingle();

    const planName = `${targetProfile.first_name} ${targetProfile.last_name} - Commission Plan`;
    const dbCommissionType = commission_type === 'profit_split' ? 'net_percent' : 'gross_percent';
    const dbPaymentMethod = commission_type === 'profit_split' ? 'commission_after_costs' : 'percentage_selling_price';

    let planId: string;

    if (existingAssignment?.commission_plan_id) {
      // Update existing plan
      planId = existingAssignment.commission_plan_id;
      console.log(`[save-commission-settings] Updating existing plan: ${planId}`);

      const { error: planUpdateError } = await serviceClient
        .from('commission_plans')
        .update({
          name: planName,
          commission_type: dbCommissionType,
          plan_config: {
            commission_rate: commission_rate,
            description: `Personal commission plan for ${targetProfile.first_name} ${targetProfile.last_name}`
          },
          include_overhead: false,
          payment_method: dbPaymentMethod,
          updated_at: new Date().toISOString()
        })
        .eq('id', planId);

      if (planUpdateError) {
        console.error('[save-commission-settings] Plan update error:', planUpdateError);
        return new Response(
          JSON.stringify({ success: false, error: `Failed to update commission plan: ${planUpdateError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Create new plan
      console.log(`[save-commission-settings] Creating new commission plan`);

      const { data: newPlan, error: planInsertError } = await serviceClient
        .from('commission_plans')
        .insert({
          name: planName,
          commission_type: dbCommissionType,
          plan_config: {
            commission_rate: commission_rate,
            description: `Personal commission plan for ${targetProfile.first_name} ${targetProfile.last_name}`
          },
          include_overhead: false,
          payment_method: dbPaymentMethod,
          tenant_id: targetProfile.tenant_id,
          is_active: true,
          created_by: user.id
        })
        .select('id')
        .single();

      if (planInsertError || !newPlan) {
        console.error('[save-commission-settings] Plan insert error:', planInsertError);
        return new Response(
          JSON.stringify({ success: false, error: `Failed to create commission plan: ${planInsertError?.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      planId = newPlan.id;

      // Link user to the plan
      const { error: linkError } = await serviceClient
        .from('user_commission_plans')
        .upsert({
          user_id: target_user_id,
          commission_plan_id: planId,
          tenant_id: targetProfile.tenant_id,
          is_active: true
        }, {
          onConflict: 'user_id,commission_plan_id'
        });

      if (linkError) {
        console.error('[save-commission-settings] Link error:', linkError);
        return new Response(
          JSON.stringify({ success: false, error: `Failed to link commission plan: ${linkError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[save-commission-settings] Commission settings saved successfully for user ${target_user_id}, plan: ${planId}`);

    // Log audit event
    try {
      await serviceClient.from('audit_log').insert({
        tenant_id: targetProfile.tenant_id,
        changed_by: user.id,
        action: 'UPDATE',
        table_name: 'commission_settings',
        record_id: target_user_id,
        new_values: {
          commission_type,
          commission_rate,
          rep_overhead_rate,
          manager_override_rate: is_manager ? manager_override_rate : null,
          reports_to_manager_id: !is_manager ? reports_to_manager_id : null,
          plan_id: planId
        }
      });
    } catch (auditError) {
      console.warn('[save-commission-settings] Audit log error (non-fatal):', auditError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        plan_id: planId,
        message: 'Commission settings saved successfully'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[save-commission-settings] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
