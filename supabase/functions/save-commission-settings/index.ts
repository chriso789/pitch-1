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
  // New manager override configuration fields
  manager_override_applies_to?: string;
  manager_override_basis?: string;
  manager_override_min_profit_percent?: number;
  manager_override_selected_reps?: string[];
  manager_override_location_id?: string | null;
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
      is_manager,
      manager_override_applies_to,
      manager_override_basis,
      manager_override_min_profit_percent,
      manager_override_selected_reps,
      manager_override_location_id,
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
      profileUpdate.manager_override_applies_to = manager_override_applies_to || 'assigned_reps';
      profileUpdate.manager_override_basis = manager_override_basis || 'contract_value';
      profileUpdate.manager_override_min_profit_percent = manager_override_min_profit_percent || 0;
      profileUpdate.manager_override_selected_reps = manager_override_selected_reps || [];
      profileUpdate.manager_override_location_id = manager_override_location_id || null;
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
      // Check for orphaned plan with the same name (from a previously failed save)
      console.log(`[save-commission-settings] Checking for existing orphaned plan with name: ${planName}`);
      
      const { data: orphanedPlan } = await serviceClient
        .from('commission_plans')
        .select('id')
        .eq('tenant_id', targetProfile.tenant_id)
        .eq('name', planName)
        .maybeSingle();

      if (orphanedPlan) {
        // Reuse the orphaned plan
        planId = orphanedPlan.id;
        console.log(`[save-commission-settings] Found orphaned plan, reusing: ${planId}`);

        const { error: planUpdateError } = await serviceClient
          .from('commission_plans')
          .update({
            commission_type: dbCommissionType,
            plan_config: {
              commission_rate: commission_rate,
              description: `Personal commission plan for ${targetProfile.first_name} ${targetProfile.last_name}`
            },
            include_overhead: false,
            payment_method: dbPaymentMethod,
            is_active: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', planId);

        if (planUpdateError) {
          console.error('[save-commission-settings] Orphaned plan update error:', planUpdateError);
          return new Response(
            JSON.stringify({ success: false, error: `Failed to update orphaned commission plan: ${planUpdateError.message}` }),
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
      }

      // Link user to the plan - check for existing active link first
      const { data: existingLink } = await serviceClient
        .from('user_commission_plans')
        .select('id')
        .eq('user_id', target_user_id)
        .eq('is_active', true)
        .maybeSingle();

      if (existingLink) {
        // Update the existing link to point to the new/reused plan
        console.log(`[save-commission-settings] Updating existing user_commission_plans link: ${existingLink.id}`);
        const { error: linkUpdateError } = await serviceClient
          .from('user_commission_plans')
          .update({ 
            commission_plan_id: planId,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingLink.id);

        if (linkUpdateError) {
          console.error('[save-commission-settings] Link update error:', linkUpdateError);
          return new Response(
            JSON.stringify({ success: false, error: `Failed to update commission plan link: ${linkUpdateError.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        // Insert new link
        console.log(`[save-commission-settings] Creating new user_commission_plans link`);
        const { error: linkInsertError } = await serviceClient
          .from('user_commission_plans')
          .insert({
            user_id: target_user_id,
            commission_plan_id: planId,
            tenant_id: targetProfile.tenant_id,
            is_active: true
          });

        if (linkInsertError) {
          console.error('[save-commission-settings] Link insert error:', linkInsertError);
          return new Response(
            JSON.stringify({ success: false, error: `Failed to link commission plan: ${linkInsertError.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    console.log(`[save-commission-settings] Commission settings saved successfully for user ${target_user_id}, plan: ${planId}`);

    // ==========================================
    // RECALCULATE PENDING/APPROVED COMMISSIONS
    // ==========================================
    console.log(`[save-commission-settings] Recalculating pending commissions for user ${target_user_id}`);
    let earningsRecalculated = 0;

    // Fetch all pending/approved commission earnings for this user
    const { data: pendingEarnings, error: fetchEarningsError } = await serviceClient
      .from('commission_earnings')
      .select('*')
      .eq('user_id', target_user_id)
      .in('status', ['pending', 'approved']);

    if (fetchEarningsError) {
      console.warn('[save-commission-settings] Error fetching earnings to recalculate:', fetchEarningsError);
    } else if (pendingEarnings && pendingEarnings.length > 0) {
      console.log(`[save-commission-settings] Found ${pendingEarnings.length} earnings to recalculate`);
      
      for (const earning of pendingEarnings) {
        let newCommissionAmount = 0;
        const contractValue = earning.contract_value || 0;
        const grossProfit = earning.gross_profit || 0;
        
        // Recalculate rep overhead
        const newRepOverheadAmount = contractValue * (rep_overhead_rate / 100);
        
        // Recalculate net profit
        const newNetProfit = grossProfit - newRepOverheadAmount;
        
        // Calculate commission based on NEW type (profit_split vs percentage_contract_price)
        if (commission_type === 'profit_split') {
          // Net profit split: Commission = Net Profit × Rate %
          newCommissionAmount = Math.max(0, newNetProfit * (commission_rate / 100));
        } else {
          // Percentage of contract: Commission = Contract Value × Rate %
          newCommissionAmount = contractValue * (commission_rate / 100);
        }
        
        // Update the earning record
        const { error: updateError } = await serviceClient
          .from('commission_earnings')
          .update({
            commission_rate: commission_rate,
            commission_type: commission_type === 'profit_split' ? 'net_percent' : 'gross_percent',
            commission_amount: Math.round(newCommissionAmount * 100) / 100,
            rep_overhead_rate: rep_overhead_rate,
            rep_overhead_amount: Math.round(newRepOverheadAmount * 100) / 100,
            net_profit: Math.round(newNetProfit * 100) / 100,
            updated_at: new Date().toISOString()
          })
          .eq('id', earning.id);
        
        if (updateError) {
          console.error(`[save-commission-settings] Failed to update earning ${earning.id}:`, updateError);
        } else {
          console.log(`[save-commission-settings] Updated earning ${earning.id}: $${earning.commission_amount} -> $${newCommissionAmount.toFixed(2)}`);
          earningsRecalculated++;
        }
      }
      
      console.log(`[save-commission-settings] Successfully recalculated ${earningsRecalculated} commission earnings`);
    }

    // Recalculate manager overrides if this user is a manager
    let managerOverridesRecalculated = 0;
    if (is_manager && manager_override_rate !== undefined && manager_override_rate > 0) {
      // Find earnings where this user is the manager getting an override
      const { data: managerOverrides, error: overrideError } = await serviceClient
        .from('commission_earnings')
        .select('*')
        .eq('manager_id', target_user_id)
        .in('status', ['pending', 'approved']);
      
      if (!overrideError && managerOverrides && managerOverrides.length > 0) {
        for (const earning of managerOverrides) {
          const newOverrideAmount = (earning.contract_value || 0) * (manager_override_rate / 100);
          
          const { error: updateError } = await serviceClient
            .from('commission_earnings')
            .update({
              manager_override_rate: manager_override_rate,
              manager_override_amount: Math.round(newOverrideAmount * 100) / 100,
              updated_at: new Date().toISOString()
            })
            .eq('id', earning.id);
          
          if (!updateError) {
            managerOverridesRecalculated++;
          }
        }
        
        console.log(`[save-commission-settings] Recalculated ${managerOverridesRecalculated} manager overrides`);
      }
    }

    // Log audit event with recalculation details
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
          plan_id: planId,
          earnings_recalculated: earningsRecalculated,
          manager_overrides_recalculated: managerOverridesRecalculated
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
