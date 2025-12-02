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
    // Extract and verify JWT token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('Missing or invalid Authorization header');
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Create Supabase client with user's JWT to respect RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const token = authHeader.replace('Bearer ', '');
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    // Verify the user and get their identity
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error('Invalid token or user not found:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    console.log('Authenticated user:', user.id);

    // Get user's tenant_id from their profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      console.error('Could not get user tenant:', profileError);
      return new Response(
        JSON.stringify({ success: false, error: 'User tenant not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    const tenant_id = profile.tenant_id;
    console.log('User tenant_id:', tenant_id);

    const orderRequest: MaterialOrderRequest = await req.json();
    console.log('Creating material order:', { 
      vendor_id: orderRequest.vendor_id, 
      item_count: orderRequest.materials?.length,
      user_id: user.id,
      tenant_id
    });

    // Validate required fields
    if (!orderRequest.vendor_id) {
      throw new Error('Vendor ID is required');
    }

    if (!orderRequest.materials || orderRequest.materials.length === 0) {
      throw new Error('Materials list is required and cannot be empty');
    }

    // Verify vendor belongs to user's tenant
    const { data: vendor, error: vendorError } = await supabase
      .from('vendors')
      .select('id, tenant_id')
      .eq('id', orderRequest.vendor_id)
      .single();

    if (vendorError || !vendor) {
      console.error('Vendor not found:', vendorError);
      return new Response(
        JSON.stringify({ success: false, error: 'Vendor not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    if (vendor.tenant_id !== tenant_id) {
      console.error('Vendor tenant mismatch:', { vendor_tenant: vendor.tenant_id, user_tenant: tenant_id });
      return new Response(
        JSON.stringify({ success: false, error: 'Access denied: Vendor not in your organization' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    // Get project_id from pipeline entry if provided and verify tenant access
    let project_id = null;
    if (orderRequest.pipeline_entry_id) {
      const { data: pipelineEntry, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .select('project_id, tenant_id')
        .eq('id', orderRequest.pipeline_entry_id)
        .single();

      if (pipelineError) {
        console.error('Error fetching pipeline entry:', pipelineError);
      } else if (pipelineEntry) {
        if (pipelineEntry.tenant_id !== tenant_id) {
          console.error('Pipeline entry tenant mismatch');
          return new Response(
            JSON.stringify({ success: false, error: 'Access denied: Pipeline entry not in your organization' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
          );
        }
        project_id = pipelineEntry.project_id;
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

    // Create purchase order with tenant isolation
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
        tenant_id, // Explicit tenant isolation
        created_by: user.id, // Track who created the order
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

    // Log to audit trail
    await supabase.from('audit_log').insert({
      action: 'create',
      table_name: 'purchase_orders',
      record_id: order.id,
      changed_by: user.id,
      tenant_id,
      new_values: {
        po_number,
        vendor_id: orderRequest.vendor_id,
        total_amount,
        item_count: orderItems.length
      }
    }).then(({ error }) => {
      if (error) console.error('Audit log error:', error);
    });

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
