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

    const { project_id } = await req.json();

    if (!project_id) {
      throw new Error('project_id is required');
    }

    console.log(`[request-cost-verification] Starting verification for project: ${project_id}`);

    // Get user's tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      throw new Error('User has no tenant');
    }

    // Get project with estimate data
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select(`
        *,
        estimates(*),
        enhanced_estimates(*)
      `)
      .eq('id', project_id)
      .single();

    if (projectError || !project) {
      throw new Error('Project not found');
    }

    // Get original estimate values - prefer locked costs
    const estimate = project.estimates?.[0];
    const enhancedEstimate = project.enhanced_estimates?.[0];
    
    // Use locked costs if available, otherwise fall back to manual/calculated costs
    const originalMaterialCost = enhancedEstimate?.material_cost_locked_at 
      ? enhancedEstimate.material_cost
      : (enhancedEstimate?.material_cost_manual || estimate?.material_cost || 0);
    
    const originalLaborCost = enhancedEstimate?.labor_cost_locked_at
      ? enhancedEstimate.labor_cost
      : (enhancedEstimate?.labor_cost_manual || estimate?.labor_cost || 0);
    
    const originalOverhead = estimate?.overhead_amount || 0;
    const originalSellingPrice = enhancedEstimate?.selling_price || estimate?.selling_price || 0;
    const originalProfit = originalSellingPrice - originalMaterialCost - originalLaborCost - originalOverhead;
    
    // Check if costs are locked
    const materialsLocked = !!enhancedEstimate?.material_cost_locked_at;
    const laborLocked = !!enhancedEstimate?.labor_cost_locked_at;
    
    console.log(`[request-cost-verification] Using costs - Materials: ${originalMaterialCost} (locked: ${materialsLocked}), Labor: ${originalLaborCost} (locked: ${laborLocked})`);

    // Create or update cost reconciliation record
    const { data: reconciliation, error: reconError } = await supabase
      .from('project_cost_reconciliation')
      .upsert({
        tenant_id: profile.tenant_id,
        project_id,
        original_material_cost: originalMaterialCost,
        original_labor_cost: originalLaborCost,
        original_overhead: originalOverhead,
        original_profit: originalProfit,
        original_selling_price: originalSellingPrice,
        status: 'pending'
      }, {
        onConflict: 'project_id'
      })
      .select()
      .single();

    if (reconError) {
      console.error('[request-cost-verification] Error creating reconciliation:', reconError);
      throw new Error('Failed to create reconciliation record');
    }

    // Update production workflow
    await supabase
      .from('production_workflows')
      .update({
        cost_verification_requested_at: new Date().toISOString(),
        cost_verification_status: 'pending'
      })
      .eq('project_id', project_id);

    console.log(`[request-cost-verification] Created reconciliation record: ${reconciliation.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        reconciliation,
        message: 'Cost verification initiated'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[request-cost-verification] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
