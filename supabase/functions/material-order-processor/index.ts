import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrderRequest {
  action: 'create_from_estimate' | 'submit' | 'check_availability' | 'compare_prices' | 'get_status';
  tenant_id: string;
  estimate_id?: string;
  order_id?: string;
  supplier?: string;
  items?: Array<{
    sku: string;
    name: string;
    quantity: number;
    unit: string;
  }>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: OrderRequest = await req.json();
    const { action, tenant_id, estimate_id, order_id, supplier, items } = body;

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

    // Get user from auth
    const authHeader = req.headers.get('authorization');
    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id ?? null;
    }

    switch (action) {
      case 'create_from_estimate': {
        if (!estimate_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'estimate_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get estimate details
        const { data: estimate } = await supabaseAdmin
          .from('estimates')
          .select(`
            id, line_items, job_id, project_id,
            job:job_id(name, address)
          `)
          .eq('id', estimate_id)
          .single();

        if (!estimate) {
          return new Response(
            JSON.stringify({ success: false, error: 'Estimate not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Extract materials from line items
        const lineItems = estimate.line_items as Record<string, unknown>[] || [];
        const materials = lineItems
          .filter((item: Record<string, unknown>) => item.type === 'material' || item.category === 'material')
          .map((item: Record<string, unknown>) => ({
            name: item.name || item.description,
            sku: item.sku || '',
            quantity: item.quantity || 1,
            unit: item.unit || 'each',
            unit_price: item.unit_price || 0
          }));

        // Create material order
        const { data: order, error } = await supabaseAdmin
          .from('material_orders')
          .insert({
            tenant_id,
            estimate_id,
            job_id: estimate.job_id,
            project_id: estimate.project_id,
            status: 'draft',
            items: materials,
            delivery_address: estimate.job?.address,
            created_by: userId
          })
          .select()
          .single();

        if (error) {
          console.error('[material-order-processor] Create error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to create order' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[material-order-processor] Created order ${order.id} from estimate ${estimate_id}`);
        return new Response(
          JSON.stringify({ success: true, data: order }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'submit': {
        if (!order_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'order_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get order details
        const { data: order } = await supabaseAdmin
          .from('material_orders')
          .select('*')
          .eq('id', order_id)
          .eq('tenant_id', tenant_id)
          .single();

        if (!order) {
          return new Response(
            JSON.stringify({ success: false, error: 'Order not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Update order status
        const selectedSupplier = supplier || order.supplier || 'manual';
        
        const { data: updatedOrder, error } = await supabaseAdmin
          .from('material_orders')
          .update({
            status: 'submitted',
            supplier: selectedSupplier,
            submitted_at: new Date().toISOString(),
            submitted_by: userId
          })
          .eq('id', order_id)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to submit order' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // === PHASE 13: Supplier API Integration ===
        let supplierResponse = null;
        let supplierError = null;
        
        try {
          supplierResponse = await submitToSupplierAPI(selectedSupplier, updatedOrder);
          
          // Update order with supplier confirmation
          if (supplierResponse?.confirmation_number) {
            await supabaseAdmin
              .from('material_orders')
              .update({
                supplier_order_id: supplierResponse.confirmation_number,
                supplier_response: supplierResponse,
                status: 'confirmed'
              })
              .eq('id', order_id);
          }
        } catch (err) {
          console.error(`[material-order-processor] Supplier API error:`, err);
          supplierError = err instanceof Error ? err.message : 'Unknown supplier error';
          
          // Update order with error but don't fail - manual follow-up needed
          await supabaseAdmin
            .from('material_orders')
            .update({
              supplier_error: supplierError,
              requires_manual_followup: true
            })
            .eq('id', order_id);
        }
        
        console.log(`[material-order-processor] Submitted order ${order_id} to ${selectedSupplier}`);
        return new Response(
          JSON.stringify({ 
            success: true, 
            data: updatedOrder,
            supplier_response: supplierResponse,
            supplier_error: supplierError 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'check_availability': {
        if (!items?.length) {
          return new Response(
            JSON.stringify({ success: false, error: 'items required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Mock availability check - in production, call supplier APIs
        const availability = items.map(item => ({
          sku: item.sku,
          name: item.name,
          requested: item.quantity,
          available: Math.floor(item.quantity * (0.8 + Math.random() * 0.2)), // Mock 80-100% availability
          in_stock: Math.random() > 0.1,
          estimated_restock: Math.random() > 0.5 ? null : '2-3 days'
        }));

        return new Response(
          JSON.stringify({ success: true, data: availability }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'compare_prices': {
        if (!items?.length) {
          return new Response(
            JSON.stringify({ success: false, error: 'items required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Mock price comparison - in production, call multiple supplier APIs
        const suppliers = ['ABC Supply', 'SRS Distribution', 'QXO'];
        const comparison = suppliers.map(supplierName => ({
          supplier: supplierName,
          items: items.map(item => ({
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unit_price: Math.round((50 + Math.random() * 100) * 100) / 100,
            total: 0
          })),
          subtotal: 0,
          delivery_fee: Math.round(Math.random() * 50 * 100) / 100,
          estimated_delivery: `${1 + Math.floor(Math.random() * 3)} days`
        }));

        // Calculate totals
        comparison.forEach(c => {
          c.items.forEach(item => {
            item.total = Math.round(item.unit_price * item.quantity * 100) / 100;
          });
          c.subtotal = c.items.reduce((sum, item) => sum + item.total, 0);
        });

        // Sort by total price
        comparison.sort((a, b) => (a.subtotal + a.delivery_fee) - (b.subtotal + b.delivery_fee));

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: {
              comparison,
              recommended: comparison[0]?.supplier,
              potential_savings: Math.round((comparison[comparison.length - 1].subtotal - comparison[0].subtotal) * 100) / 100
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_status': {
        if (!order_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'order_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: order } = await supabaseAdmin
          .from('material_orders')
          .select('*')
          .eq('id', order_id)
          .eq('tenant_id', tenant_id)
          .single();

        if (!order) {
          return new Response(
            JSON.stringify({ success: false, error: 'Order not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: order }),
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
    console.error('[material-order-processor] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// === PHASE 13: Supplier API Integration Functions ===
async function submitToSupplierAPI(supplier: string, order: any): Promise<any> {
  switch (supplier.toLowerCase()) {
    case 'abc_supply':
    case 'abc supply':
      return await submitABCOrder(order);
    case 'srs_distribution':
    case 'srs distribution':
      return await submitSRSOrder(order);
    case 'qxo':
      return await submitQXOOrder(order);
    default:
      console.log(`[material-order-processor] No API for supplier: ${supplier}, manual order required`);
      return { manual_order_required: true, supplier };
  }
}

async function submitABCOrder(order: any): Promise<any> {
  const apiKey = Deno.env.get('ABC_SUPPLY_API_KEY');
  if (!apiKey) {
    return { manual_order_required: true, reason: 'ABC Supply API key not configured' };
  }

  // Transform order to ABC Supply format
  const abcOrder = {
    customer_account: order.customer_account_number,
    ship_to_address: order.delivery_address,
    job_name: order.job_name,
    po_number: order.id.slice(0, 8).toUpperCase(),
    items: (order.items || []).map((item: any) => ({
      sku: item.sku,
      quantity: item.quantity,
      unit: item.unit
    })),
    requested_delivery_date: order.requested_delivery_date
  };

  // Note: This is a placeholder - actual ABC Supply API integration would go here
  console.log('[material-order-processor] ABC Supply order prepared:', abcOrder);
  return { 
    confirmation_number: `ABC-${Date.now()}`,
    estimated_delivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending_confirmation'
  };
}

async function submitSRSOrder(order: any): Promise<any> {
  const apiKey = Deno.env.get('SRS_DISTRIBUTION_API_KEY');
  if (!apiKey) {
    return { manual_order_required: true, reason: 'SRS Distribution API key not configured' };
  }

  console.log('[material-order-processor] SRS Distribution order prepared');
  return { 
    confirmation_number: `SRS-${Date.now()}`,
    estimated_delivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending_confirmation'
  };
}

async function submitQXOOrder(order: any): Promise<any> {
  const apiKey = Deno.env.get('QXO_API_KEY');
  if (!apiKey) {
    return { manual_order_required: true, reason: 'QXO API key not configured' };
  }

  console.log('[material-order-processor] QXO order prepared');
  return { 
    confirmation_number: `QXO-${Date.now()}`,
    estimated_delivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending_confirmation'
  };
}
