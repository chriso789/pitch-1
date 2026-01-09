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

    const { pipeline_entry_id, estimate_id, section } = await req.json();

    if (!pipeline_entry_id && !estimate_id) {
      throw new Error('pipeline_entry_id or estimate_id is required');
    }

    if (!section || !['material', 'labor', 'both'].includes(section)) {
      throw new Error('section must be "material", "labor", or "both"');
    }

    let targetEstimateId = estimate_id;

    // If no direct estimate_id, look up from pipeline metadata
    if (!targetEstimateId && pipeline_entry_id) {
      const { data: pipelineEntry, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipeline_entry_id)
        .single();
      
      if (pipelineError) {
        console.error('[lock-original-costs] Error fetching pipeline:', pipelineError);
        throw new Error('Failed to fetch pipeline entry');
      }

      targetEstimateId = (pipelineEntry?.metadata as any)?.selected_estimate_id;
      
      if (!targetEstimateId) {
        throw new Error('No estimate selected for this pipeline entry');
      }
    }

    console.log(`[lock-original-costs] Locking ${section} costs for estimate: ${targetEstimateId}`);

    // Get existing enhanced estimate by ID
    const { data: estimate, error: fetchError } = await supabase
      .from('enhanced_estimates')
      .select('*')
      .eq('id', targetEstimateId)
      .single();

    if (fetchError) {
      console.error('[lock-original-costs] Error fetching estimate:', fetchError);
      throw new Error('Failed to fetch estimate');
    }

    if (!estimate) {
      throw new Error('Estimate not found. Please add materials/labor first.');
    }

    // Build update object based on section
    const now = new Date().toISOString();
    const updateData: Record<string, any> = {};

    if (section === 'material' || section === 'both') {
      if (estimate.material_cost_locked_at) {
        throw new Error('Material costs are already locked');
      }
      updateData.material_cost_locked_at = now;
      updateData.material_cost_locked_by = user.id;
    }

    if (section === 'labor' || section === 'both') {
      if (estimate.labor_cost_locked_at) {
        throw new Error('Labor costs are already locked');
      }
      updateData.labor_cost_locked_at = now;
      updateData.labor_cost_locked_by = user.id;
    }

    // Update the estimate with locked timestamps
    const { data: updatedEstimate, error: updateError } = await supabase
      .from('enhanced_estimates')
      .update(updateData)
      .eq('id', estimate.id)
      .select()
      .single();

    if (updateError) {
      console.error('[lock-original-costs] Error updating estimate:', updateError);
      throw new Error('Failed to lock costs');
    }

    console.log(`[lock-original-costs] Successfully locked ${section} costs for estimate: ${estimate.id}`);

    // Get user profile for response
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        message: `${section === 'both' ? 'Material and labor' : section.charAt(0).toUpperCase() + section.slice(1)} costs locked successfully`,
        locked_by: profile?.full_name || user.email,
        locked_at: now,
        material_cost: updatedEstimate.material_cost,
        labor_cost: updatedEstimate.labor_cost,
        material_cost_locked_at: updatedEstimate.material_cost_locked_at,
        labor_cost_locked_at: updatedEstimate.labor_cost_locked_at
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[lock-original-costs] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
