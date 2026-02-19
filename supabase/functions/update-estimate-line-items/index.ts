import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LineItem {
  id: string;
  item_name: string;
  qty: number;
  qty_original: number;
  unit: string;
  unit_cost: number;
  unit_cost_original: number;
  line_total: number;
  is_override: boolean;
}

interface LineItemsJson {
  materials: LineItem[];
  labor: LineItem[];
}

interface PricingConfig {
  overheadPercent: number;
  repCommissionPercent: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.error('[update-estimate-line-items] Auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[update-estimate-line-items] User ${user.id} making request`);

    // Parse request body
    const { estimate_id, line_items, selling_price, pricing_config, display_name, pricing_tier } = await req.json();

    if (!estimate_id || !line_items) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: estimate_id, line_items' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[update-estimate-line-items] Updating estimate ${estimate_id}`);

    // Get user profile to verify access
    const { data: profile, error: profileError } = await serviceClient
      .from('profiles')
      .select('tenant_id, active_tenant_id, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[update-estimate-line-items] Profile error:', profileError);
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userTenantId = profile.active_tenant_id || profile.tenant_id;

    // Fetch the existing estimate
    const { data: estimate, error: estimateError } = await serviceClient
      .from('enhanced_estimates')
      .select('*')
      .eq('id', estimate_id)
      .single();

    if (estimateError || !estimate) {
      console.error('[update-estimate-line-items] Estimate fetch error:', estimateError);
      return new Response(
        JSON.stringify({ error: 'Estimate not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has access to this estimate's tenant
    if (estimate.tenant_id !== userTenantId && profile.role !== 'master') {
      console.error(`[update-estimate-line-items] Access denied: user tenant ${userTenantId} vs estimate tenant ${estimate.tenant_id}`);
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const lineItemsData = line_items as LineItemsJson;
    
    // Fetch assigned rep's rates from the pipeline entry
    let repOverheadRate = pricing_config?.overheadPercent || estimate.overhead_percent || 10;
    let repCommissionRate = pricing_config?.repCommissionPercent || estimate.rep_commission_percent || 50;
    let commissionStructure = 'profit_split';

    if (estimate.pipeline_entry_id) {
      const { data: pipelineData } = await serviceClient
        .from('pipeline_entries')
        .select(`
          assigned_to,
          profiles!pipeline_entries_assigned_to_fkey(
            overhead_rate,
            personal_overhead_rate,
            commission_rate,
            commission_structure
          )
        `)
        .eq('id', estimate.pipeline_entry_id)
        .single();
      
      if (pipelineData?.profiles) {
        const repProfile = pipelineData.profiles as any;
        // Apply overhead hierarchy: personal_overhead_rate > 0 takes priority
        const personalOverhead = repProfile.personal_overhead_rate ?? 0;
        const baseOverhead = repProfile.overhead_rate ?? 10;
        repOverheadRate = personalOverhead > 0 ? personalOverhead : baseOverhead;
        repCommissionRate = repProfile.commission_rate ?? 50;
        commissionStructure = repProfile.commission_structure || 'profit_split';
        
        console.log('[update-estimate-line-items] Using assigned rep rates:', {
          effectiveOverhead: repOverheadRate,
          personalOverhead,
          baseOverhead,
          commissionRate: repCommissionRate,
          commissionStructure
        });
      }
    }

    // Calculate totals from line items
    const materialsTotal = lineItemsData.materials.reduce((sum, item) => sum + (item.line_total || 0), 0);
    const laborTotal = lineItemsData.labor.reduce((sum, item) => sum + (item.line_total || 0), 0);
    const directCost = materialsTotal + laborTotal;

    // Use provided selling price or calculate from estimate
    const finalSellingPrice = selling_price || estimate.selling_price;

    // Calculate overhead using rep's effective rate on PRE-TAX selling price
    const overheadPercent = repOverheadRate;
    const salesTaxAmount = estimate.sales_tax_amount || 0;
    const preTaxSellingPrice = finalSellingPrice - salesTaxAmount;
    const overheadAmount = preTaxSellingPrice * (overheadPercent / 100);
    
    // Calculate commission based on rep's structure
    let repCommissionAmount: number;
    const netProfitForSplit = finalSellingPrice - directCost - overheadAmount;
    
    if (commissionStructure === 'profit_split') {
      // Profit Split: Commission = Net Profit × Rate %
      repCommissionAmount = Math.max(0, netProfitForSplit * (repCommissionRate / 100));
    } else {
      // Percent of Contract: Commission = Selling Price × Rate %
      repCommissionAmount = finalSellingPrice * (repCommissionRate / 100);
    }

    // Calculate profit
    const profitAmount = finalSellingPrice - directCost - overheadAmount - repCommissionAmount;
    const profitPercent = finalSellingPrice > 0 ? (profitAmount / finalSellingPrice) * 100 : 0;

    console.log(`[update-estimate-line-items] Calculations:`, {
      materialsTotal,
      laborTotal,
      directCost,
      finalSellingPrice,
      overheadAmount,
      repCommissionAmount,
      profitAmount,
      profitPercent
    });

    // Build old values for audit log
    const oldValues = {
      line_items: estimate.line_items,
      material_cost: estimate.material_cost,
      labor_cost: estimate.labor_cost,
      actual_profit_amount: estimate.actual_profit_amount,
      actual_profit_percent: estimate.actual_profit_percent
    };

    // Build update payload - include display_name and pricing_tier if provided
    const updatePayload: Record<string, any> = {
      line_items: lineItemsData,
      material_cost: Math.round(materialsTotal * 100) / 100,
      material_total: Math.round(materialsTotal * 100) / 100,
      materials_total: Math.round(materialsTotal * 100) / 100,
      labor_cost: Math.round(laborTotal * 100) / 100,
      labor_total: Math.round(laborTotal * 100) / 100,
      subtotal: Math.round(directCost * 100) / 100,
      overhead_percent: overheadPercent,
      overhead_amount: Math.round(overheadAmount * 100) / 100,
      rep_commission_percent: repCommissionRate,
      rep_commission_amount: Math.round(repCommissionAmount * 100) / 100,
      selling_price: Math.round(finalSellingPrice * 100) / 100,
      actual_profit_amount: Math.round(profitAmount * 100) / 100,
      actual_profit_percent: Math.round(profitPercent * 100) / 100,
      updated_at: new Date().toISOString(),
      calculation_metadata: {
        ...((estimate.calculation_metadata as object) || {}),
        last_updated_by: user.id,
        last_updated_at: new Date().toISOString(),
        pricing_config: pricing_config
      }
    };

    // Only update display_name/pricing_tier if explicitly provided (allows clearing with empty string/null)
    if (display_name !== undefined) {
      updatePayload.display_name = display_name?.trim() || null;
    }
    if (pricing_tier !== undefined) {
      updatePayload.pricing_tier = pricing_tier || null;
    }

    console.log(`[update-estimate-line-items] Updating display_name: ${display_name}, pricing_tier: ${pricing_tier}`);

    // Update the estimate
    const { data: updatedEstimate, error: updateError } = await serviceClient
      .from('enhanced_estimates')
      .update(updatePayload)
      .eq('id', estimate_id)
      .select()
      .single();

    if (updateError) {
      console.error('[update-estimate-line-items] Update error:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update estimate', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log to audit trail
    await serviceClient.from('audit_log').insert({
      tenant_id: estimate.tenant_id,
      changed_by: user.id,
      action: 'UPDATE',
      table_name: 'enhanced_estimates',
      record_id: estimate_id,
      old_values: oldValues,
      new_values: {
        material_cost: materialsTotal,
        labor_cost: laborTotal,
        actual_profit_amount: profitAmount,
        actual_profit_percent: profitPercent,
        line_items_count: lineItemsData.materials.length + lineItemsData.labor.length
      }
    });

    console.log(`[update-estimate-line-items] Successfully updated estimate ${estimate_id}`);

    // Sync display_name/pricing_tier to associated documents
    if ((display_name !== undefined || pricing_tier !== undefined) && estimate.estimate_number) {
      const docUpdatePayload: Record<string, any> = {};
      
      if (display_name !== undefined) {
        docUpdatePayload.estimate_display_name = display_name?.trim() || null;
      }
      if (pricing_tier !== undefined) {
        docUpdatePayload.estimate_pricing_tier = pricing_tier || null;
      }

      // Update documents where filename matches the estimate number
      const { error: docUpdateError } = await serviceClient
        .from('documents')
        .update(docUpdatePayload)
        .eq('document_type', 'estimate')
        .eq('tenant_id', estimate.tenant_id)
        .like('filename', `${estimate.estimate_number}%`);

      if (docUpdateError) {
        console.warn('[update-estimate-line-items] Document sync warning:', docUpdateError);
        // Don't fail the request - estimate was updated successfully
      } else {
        console.log(`[update-estimate-line-items] Synced display_name to documents for ${estimate.estimate_number}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        estimate: updatedEstimate,
        calculations: {
          materialsTotal,
          laborTotal,
          directCost,
          overheadAmount,
          repCommissionAmount,
          profitAmount,
          profitPercent
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[update-estimate-line-items] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
