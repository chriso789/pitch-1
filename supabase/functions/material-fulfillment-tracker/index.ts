import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FulfillmentRequest {
  action: 'update_status' | 'confirm_delivery' | 'report_damage' | 'get_tracking' | 'list_pending';
  tenant_id: string;
  order_id?: string;
  status?: string;
  tracking_number?: string;
  delivery_data?: {
    delivered_at?: string;
    received_by?: string;
    photo_urls?: string[];
    notes?: string;
  };
  damage_data?: {
    description: string;
    photo_urls: string[];
    items_affected: string[];
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: FulfillmentRequest = await req.json();
    const { action, tenant_id, order_id, status, tracking_number, delivery_data, damage_data } = body;

    if (!action || !tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action or tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    switch (action) {
      case 'update_status': {
        if (!order_id || !status) {
          return new Response(
            JSON.stringify({ success: false, error: 'order_id and status required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const validStatuses = ['processing', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
          return new Response(
            JSON.stringify({ success: false, error: `Invalid status. Must be: ${validStatuses.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const updateData: Record<string, unknown> = {
          status,
          updated_at: new Date().toISOString()
        };

        if (tracking_number) {
          updateData.tracking_number = tracking_number;
        }

        if (status === 'shipped') {
          updateData.shipped_at = new Date().toISOString();
        }

        const { data: order, error } = await supabaseAdmin
          .from('material_orders')
          .update(updateData)
          .eq('id', order_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (error) {
          console.error('[material-fulfillment-tracker] Update error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to update status' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Create notification for status change
        if (order?.created_by) {
          await supabaseAdmin
            .from('user_notifications')
            .insert({
              tenant_id,
              user_id: order.created_by,
              type: 'order_status',
              title: 'Order Status Update',
              message: `Order #${order_id.slice(0, 8)} is now ${status}`,
              metadata: { order_id, status }
            });
        }

        console.log(`[material-fulfillment-tracker] Updated order ${order_id} to ${status}`);
        return new Response(
          JSON.stringify({ success: true, data: order }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'confirm_delivery': {
        if (!order_id || !delivery_data) {
          return new Response(
            JSON.stringify({ success: false, error: 'order_id and delivery_data required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: order, error } = await supabaseAdmin
          .from('material_orders')
          .update({
            status: 'delivered',
            delivered_at: delivery_data.delivered_at || new Date().toISOString(),
            delivery_confirmation: {
              received_by: delivery_data.received_by,
              photo_urls: delivery_data.photo_urls,
              notes: delivery_data.notes,
              confirmed_at: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', order_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to confirm delivery' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[material-fulfillment-tracker] Confirmed delivery for order ${order_id}`);
        return new Response(
          JSON.stringify({ success: true, data: order }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'report_damage': {
        if (!order_id || !damage_data) {
          return new Response(
            JSON.stringify({ success: false, error: 'order_id and damage_data required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Create damage claim record
        const { data: claim, error } = await supabaseAdmin
          .from('material_damage_claims')
          .insert({
            tenant_id,
            order_id,
            description: damage_data.description,
            photo_urls: damage_data.photo_urls,
            items_affected: damage_data.items_affected,
            status: 'pending',
            reported_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) {
          console.error('[material-fulfillment-tracker] Report damage error:', error);
          // Table might not exist, create inline record in order
          await supabaseAdmin
            .from('material_orders')
            .update({
              damage_report: damage_data,
              has_damage_claim: true,
              updated_at: new Date().toISOString()
            })
            .eq('id', order_id);
        }

        console.log(`[material-fulfillment-tracker] Damage reported for order ${order_id}`);
        return new Response(
          JSON.stringify({ success: true, data: claim || { order_id, damage_data } }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_tracking': {
        if (!order_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'order_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: order } = await supabaseAdmin
          .from('material_orders')
          .select('id, status, tracking_number, shipped_at, delivered_at, delivery_confirmation, supplier')
          .eq('id', order_id)
          .eq('tenant_id', tenant_id)
          .single();

        if (!order) {
          return new Response(
            JSON.stringify({ success: false, error: 'Order not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Build tracking timeline
        const timeline = [
          { status: 'created', timestamp: order.shipped_at, label: 'Order Created' }
        ];

        if (order.shipped_at) {
          timeline.push({ status: 'shipped', timestamp: order.shipped_at, label: 'Shipped' });
        }

        if (order.status === 'delivered') {
          timeline.push({ status: 'delivered', timestamp: order.delivered_at, label: 'Delivered' });
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: {
              ...order,
              timeline,
              tracking_url: order.tracking_number 
                ? `https://track.example.com/${order.tracking_number}` 
                : null
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list_pending': {
        const { data: orders, error } = await supabaseAdmin
          .from('material_orders')
          .select('id, status, supplier, submitted_at, tracking_number, delivery_address')
          .eq('tenant_id', tenant_id)
          .in('status', ['submitted', 'processing', 'shipped', 'in_transit', 'out_for_delivery'])
          .order('submitted_at', { ascending: true });

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to list orders' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: orders }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('[material-fulfillment-tracker] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
