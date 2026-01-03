import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { action, ...data } = await req.json();
    console.log(`[inventory-audit-processor] Action: ${action}`, data);

    switch (action) {
      case 'start_cycle_count': {
        const { tenant_id, location_id, items } = data;
        
        const auditId = crypto.randomUUID();
        const auditItems = items.map((item: any) => ({
          audit_id: auditId,
          tenant_id,
          location_id,
          item_id: item.item_id,
          expected_quantity: item.expected_quantity,
          status: 'pending'
        }));

        // This would go to an inventory_audits table
        console.log(`[inventory-audit-processor] Started cycle count: ${auditId} with ${items.length} items`);
        return new Response(JSON.stringify({ success: true, audit_id: auditId, items_count: items.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'record_count': {
        const { tenant_id, item_id, location_id, counted_quantity, expected_quantity, counted_by } = data;
        
        const variance = counted_quantity - expected_quantity;
        const variancePercent = expected_quantity > 0 ? (variance / expected_quantity) * 100 : 0;

        // Log the count
        const countRecord = {
          tenant_id,
          item_id,
          location_id,
          expected_quantity,
          counted_quantity,
          variance,
          variance_percent: variancePercent,
          counted_by,
          counted_at: new Date().toISOString()
        };

        // If variance exists, flag for review
        if (Math.abs(variancePercent) > 5) {
          console.log(`[inventory-audit-processor] Variance detected: ${variancePercent.toFixed(2)}% for item ${item_id}`);
        }

        // Update actual inventory if approved
        if (data.auto_adjust) {
          await supabase
            .from('inventory_levels')
            .update({ quantity_on_hand: counted_quantity })
            .eq('item_id', item_id)
            .eq('location_id', location_id);

          await supabase
            .from('inventory_transactions')
            .insert({
              tenant_id,
              item_id,
              location_id,
              quantity: variance,
              transaction_type: 'adjustment',
              reason: 'Cycle count adjustment'
            });
        }

        return new Response(JSON.stringify({ success: true, count: countRecord }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'calculate_shrinkage': {
        const { tenant_id, start_date, end_date } = data;
        
        // Get all adjustments in period
        const { data: adjustments } = await supabase
          .from('inventory_transactions')
          .select('*, inventory_items(*)')
          .eq('tenant_id', tenant_id)
          .eq('transaction_type', 'adjustment')
          .gte('created_at', start_date)
          .lte('created_at', end_date);

        const totalShrinkage = adjustments?.reduce((sum, adj) => {
          if (adj.quantity < 0) {
            return sum + Math.abs(adj.quantity) * (adj.inventory_items?.unit_cost || 0);
          }
          return sum;
        }, 0) || 0;

        console.log(`[inventory-audit-processor] Calculated shrinkage: $${totalShrinkage.toFixed(2)}`);
        return new Response(JSON.stringify({ 
          success: true, 
          shrinkage: {
            total_value: totalShrinkage,
            adjustment_count: adjustments?.length || 0,
            period: { start_date, end_date }
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'get_valuation': {
        const { tenant_id, location_id, method = 'weighted_average' } = data;
        
        let query = supabase
          .from('inventory_levels')
          .select('*, inventory_items(*)')
          .eq('tenant_id', tenant_id);

        if (location_id) {
          query = query.eq('location_id', location_id);
        }

        const { data: levels } = await query;

        let totalValue = 0;
        const itemValues = levels?.map(level => {
          const unitCost = level.inventory_items?.unit_cost || 0;
          const value = level.quantity_on_hand * unitCost;
          totalValue += value;
          return {
            item_id: level.item_id,
            item_name: level.inventory_items?.name,
            quantity: level.quantity_on_hand,
            unit_cost: unitCost,
            total_value: value
          };
        }) || [];

        return new Response(JSON.stringify({ 
          success: true, 
          valuation: {
            method,
            total_value: totalValue,
            items: itemValues
          }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[inventory-audit-processor] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
