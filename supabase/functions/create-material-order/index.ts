import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders } from '../_shared/cors.ts';

interface MaterialOrderRequest {
  measurement_id?: string;
  pipeline_entry_id?: string;
  vendor_id: string;
  materials: Array<{
    product_id?: string;
    srs_item_code?: string;
    item_description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    metadata?: any;
  }>;
  delivery_address?: any;
  branch_code?: string;
  notes?: string;
  expected_delivery_date?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const orderRequest: MaterialOrderRequest = await req.json();
    console.log('Creating material order:', { 
      vendor_id: orderRequest.vendor_id, 
      item_count: orderRequest.materials?.length 
    });

    // Validate required fields
    if (!orderRequest.vendor_id) {
      throw new Error('Vendor ID is required');
    }

    if (!orderRequest.materials || orderRequest.materials.length === 0) {
      throw new Error('Materials list is required and cannot be empty');
    }

    // Get project_id from pipeline entry if provided
    let project_id = null;
    if (orderRequest.pipeline_entry_id) {
      const { data: pipelineEntry, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .select('project_id')
        .eq('id', orderRequest.pipeline_entry_id)
        .single();

      if (pipelineError) {
        console.error('Error fetching pipeline entry:', pipelineError);
      } else {
        project_id = pipelineEntry?.project_id;
      }
    }

    // Calculate totals
    const subtotal = orderRequest.materials.reduce((sum, item) => sum + item.line_total, 0);
    const shipping_amount = 0; // Can be updated later
    const total_amount = subtotal + shipping_amount;

    // Generate PO number (format: PO-YYYYMMDD-XXXX)
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const po_number = `PO-${dateStr}-${random}`;

    console.log('Generated PO number:', po_number);

    // Create purchase order
    const { data: order, error: orderError } = await supabase
      .from('purchase_orders')
      .insert({
        po_number,
        vendor_id: orderRequest.vendor_id,
        project_id,
        branch_code: orderRequest.branch_code,
        status: 'draft',
        order_date: new Date().toISOString(),
        expected_delivery_date: orderRequest.expected_delivery_date,
        subtotal,
        shipping_amount,
        total_amount,
        delivery_address: orderRequest.delivery_address,
        notes: orderRequest.notes,
      })
      .select()
      .single();

    if (orderError) {
      console.error('Error creating purchase order:', orderError);
      throw orderError;
    }

    console.log('Purchase order created:', order.id);

    // Create purchase order items
    const orderItems = orderRequest.materials.map((material) => ({
      po_id: order.id,
      product_id: material.product_id,
      srs_item_code: material.srs_item_code,
      item_description: material.item_description,
      quantity: material.quantity,
      unit_price: material.unit_price,
      line_total: material.line_total,
      metadata: material.metadata,
    }));

    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('Error creating order items:', itemsError);
      // Rollback: delete the order
      await supabase.from('purchase_orders').delete().eq('id', order.id);
      throw itemsError;
    }

    console.log(`Created ${orderItems.length} order items`);

    // Link to measurement if provided
    if (orderRequest.measurement_id) {
      const { error: linkError } = await supabase
        .from('measurements')
        .update({ 
          metadata: { 
            material_order_id: order.id,
            material_order_created_at: new Date().toISOString()
          } 
        })
        .eq('id', orderRequest.measurement_id);

      if (linkError) {
        console.error('Error linking order to measurement:', linkError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        po_number: order.po_number,
        total_amount: order.total_amount,
        item_count: orderItems.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in create-material-order function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
