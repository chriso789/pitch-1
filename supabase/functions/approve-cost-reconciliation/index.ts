import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { project_id, notes } = await req.json();

    if (!project_id) {
      throw new Error('project_id is required');
    }

    console.log(`[approve-cost-reconciliation] Approving reconciliation for project: ${project_id}`);

    // Get user's profile to verify role
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      throw new Error('User has no tenant');
    }

    // Check if user has appropriate role (admin, owner, manager)
    const allowedRoles = ['admin', 'owner', 'manager', 'office_admin'];
    if (!allowedRoles.includes(profile.role)) {
      throw new Error('Insufficient permissions to approve cost reconciliation');
    }

    // Get reconciliation record
    const { data: reconciliation, error: reconError } = await supabase
      .from('project_cost_reconciliation')
      .select('*')
      .eq('project_id', project_id)
      .single();

    if (reconError || !reconciliation) {
      throw new Error('Reconciliation record not found');
    }

    // Get all pending invoices and approve them
    await supabase
      .from('project_cost_invoices')
      .update({
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString()
      })
      .eq('project_id', project_id)
      .eq('status', 'pending');

    // Update reconciliation to completed
    const { data: updatedReconciliation, error: updateError } = await supabase
      .from('project_cost_reconciliation')
      .update({
        status: 'completed',
        final_approved_by: user.id,
        final_approved_at: new Date().toISOString()
      })
      .eq('project_id', project_id)
      .select()
      .single();

    if (updateError) {
      console.error('[approve-cost-reconciliation] Error updating reconciliation:', updateError);
      throw new Error('Failed to approve reconciliation');
    }

    // Update production workflow
    await supabase
      .from('production_workflows')
      .update({
        cost_verification_completed_at: new Date().toISOString(),
        cost_verification_status: 'completed'
      })
      .eq('project_id', project_id);

    // Update project budget snapshot with final actual costs
    const { data: existingSnapshot } = await supabase
      .from('project_budget_snapshots')
      .select('id')
      .eq('project_id', project_id)
      .single();

    if (existingSnapshot) {
      await supabase
        .from('project_budget_snapshots')
        .update({
          actual_material_cost: updatedReconciliation.actual_material_cost,
          actual_labor_cost: updatedReconciliation.actual_labor_cost,
          actual_total_cost: updatedReconciliation.actual_material_cost + updatedReconciliation.actual_labor_cost,
          final_profit: updatedReconciliation.final_profit,
          verified_at: new Date().toISOString(),
          verified_by: user.id
        })
        .eq('id', existingSnapshot.id);
    }

    // Create audit log entry
    await supabase
      .from('audit_log')
      .insert({
        tenant_id: profile.tenant_id,
        table_name: 'project_cost_reconciliation',
        record_id: reconciliation.id,
        action: 'COST_RECONCILIATION_APPROVED',
        changed_by: user.id,
        new_values: {
          original_material_cost: reconciliation.original_material_cost,
          actual_material_cost: updatedReconciliation.actual_material_cost,
          original_labor_cost: reconciliation.original_labor_cost,
          actual_labor_cost: updatedReconciliation.actual_labor_cost,
          material_variance: updatedReconciliation.material_variance,
          labor_variance: updatedReconciliation.labor_variance,
          final_profit: updatedReconciliation.final_profit,
          notes: notes
        }
      });

    console.log(`[approve-cost-reconciliation] Approved reconciliation: ${reconciliation.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        reconciliation: updatedReconciliation,
        message: 'Cost reconciliation approved successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[approve-cost-reconciliation] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
