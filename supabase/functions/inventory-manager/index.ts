import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = supabaseService();

    const { action, ...data } = await req.json();
    console.log(`[inventory-manager] Action: ${action}`, data);

    switch (action) {
      case 'get_levels': {
        const { tenant_id, location_id } = data;
        
        let query = supabase
          .from('inventory_levels')
          .select('*, inventory_items(*), inventory_locations(*)')
          .eq('tenant_id', tenant_id);

        if (location_id) {
          query = query.eq('location_id', location_id);
        }

        const { data: levels, error } = await query;
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, levels }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'adjust_quantity': {
        const { tenant_id, item_id, location_id, quantity_change, reason, reference_id } = data;
        
        // Get current level
        const { data: currentLevel } = await supabase
          .from('inventory_levels')
          .select('*')
          .eq('item_id', item_id)
          .eq('location_id', location_id)
          .single();

        const newQuantity = (currentLevel?.quantity_on_hand || 0) + quantity_change;

        // Update or insert level
        const { error: levelError } = await supabase
          .from('inventory_levels')
          .upsert({
            tenant_id,
            item_id,
            location_id,
            quantity_on_hand: newQuantity,
            updated_at: new Date().toISOString()
          }, { onConflict: 'item_id,location_id' });

        if (levelError) throw levelError;

        // Log transaction
        const { data: transaction, error: txError } = await supabase
          .from('inventory_transactions')
          .insert({
            tenant_id,
            item_id,
            location_id,
            quantity: quantity_change,
            transaction_type: quantity_change > 0 ? 'receipt' : 'issue',
            reason,
            reference_id
          })
          .select()
          .single();

        if (txError) throw txError;

        console.log(`[inventory-manager] Adjusted quantity for item ${item_id}: ${quantity_change}`);
        return new Response(JSON.stringify({ success: true, transaction, new_quantity: newQuantity }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'transfer': {
        const { tenant_id, item_id, from_location_id, to_location_id, quantity } = data;
        
        // Decrease from source
        await supabase
          .from('inventory_levels')
          .update({ 
            quantity_on_hand: supabase.rpc('decrement_inventory', { loc_id: from_location_id, itm_id: item_id, qty: quantity })
          })
          .eq('item_id', item_id)
          .eq('location_id', from_location_id);

        // Increase at destination
        const { data: destLevel } = await supabase
          .from('inventory_levels')
          .select('*')
          .eq('item_id', item_id)
          .eq('location_id', to_location_id)
          .single();

        if (destLevel) {
          await supabase
            .from('inventory_levels')
            .update({ quantity_on_hand: destLevel.quantity_on_hand + quantity })
            .eq('id', destLevel.id);
        } else {
          await supabase
            .from('inventory_levels')
            .insert({
              tenant_id,
              item_id,
              location_id: to_location_id,
              quantity_on_hand: quantity
            });
        }

        // Log transactions
        await supabase.from('inventory_transactions').insert([
          { tenant_id, item_id, location_id: from_location_id, quantity: -quantity, transaction_type: 'transfer_out' },
          { tenant_id, item_id, location_id: to_location_id, quantity: quantity, transaction_type: 'transfer_in' }
        ]);

        console.log(`[inventory-manager] Transferred ${quantity} of item ${item_id}`);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'check_low_stock': {
        const { tenant_id } = data;
        
        const { data: lowStock, error } = await supabase
          .from('inventory_levels')
          .select('*, inventory_items(*), inventory_locations(*)')
          .eq('tenant_id', tenant_id)
          .filter('quantity_on_hand', 'lte', supabase.rpc('get_reorder_point'));

        if (error) throw error;
        
        console.log(`[inventory-manager] Found ${lowStock?.length || 0} low stock items`);
        return new Response(JSON.stringify({ success: true, low_stock: lowStock }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[inventory-manager] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
