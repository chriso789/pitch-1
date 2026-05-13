import { createClient } from 'npm:@supabase/supabase-js@2';
import { BEACON_BASE_URL, corsHeaders, cap, getBeaconAuth } from '../_shared/qxo-auth.ts';

interface OrderItem {
  item_name: string;
  qty: number;
  unit: string;
  unit_cost?: number;
  unit_price?: number;
  notes?: string;
  color_specs?: string;
  srs_item_code?: string; // Beacon itemNumber
  product_number?: string;
  vendor_code?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const body = await req.json();
    const {
      tenant_id,
      project_id,
      job_id,
      job_name,
      job_number,
      purchase_order_no,
      extended_po,
      delivery_address,
      shipping_method = 'D', // D = delivery
      shipping_branch,
      selling_branch,
      delivery_type,
      special_instruction,
      check_for_availability = 'no',
      pickup_date,
      pickup_time = 'Anytime',
      on_hold = true,
      api_site_id,
      items,
      notes,
    }: {
      tenant_id: string;
      project_id?: string;
      job_id?: string;
      job_name?: string;
      job_number?: string;
      purchase_order_no?: string;
      extended_po?: string;
      delivery_address?: any;
      shipping_method?: string;
      shipping_branch?: string;
      selling_branch?: string;
      delivery_type?: string;
      special_instruction?: string;
      check_for_availability?: 'yes' | 'no';
      pickup_date?: string;
      pickup_time?: string;
      on_hold?: boolean;
      api_site_id?: string;
      items: OrderItem[];
      notes?: string;
    } = body;

    if (!tenant_id || !items?.length) throw new Error('tenant_id and items[] are required');

    const auth = await getBeaconAuth(supabase, tenant_id);
    const accountId = auth.accountId;
    const branch = shipping_branch || auth.branch || '';
    const sBranch = selling_branch || auth.branch || '';
    const siteId = api_site_id || auth.apiSiteId || 'BDD';

    // Insert local PO first so we always have a tracked record
    const subtotal = items.reduce(
      (s, i) => s + Number(i.qty) * Number(i.unit_cost ?? i.unit_price ?? 0),
      0,
    );
    const poNumber = purchase_order_no || `QXO-${Date.now().toString(36).toUpperCase()}`;
    const { data: po } = await supabase
      .from('purchase_orders')
      .insert({
        tenant_id,
        po_number: poNumber,
        project_id: project_id || job_id || null,
        branch_code: branch,
        status: 'submitting',
        subtotal,
        total_amount: subtotal,
        delivery_address,
        notes: `Submitted via QXO Beacon submitOrder${notes ? ` — ${notes}` : ''}`,
      })
      .select()
      .single();

    if (po?.id && items.length) {
      await supabase.from('purchase_order_items').insert(
        items.map((i) => ({
          po_id: po.id,
          srs_item_code: i.srs_item_code || null,
          item_description: i.item_name,
          quantity: Number(i.qty),
          unit_price: Number(i.unit_cost ?? i.unit_price ?? 0),
          line_total: Number(i.qty) * Number(i.unit_cost ?? i.unit_price ?? 0),
          metadata: { unit: i.unit, notes: i.notes || i.color_specs || null },
        })),
      );
      await supabase
        .from('purchase_orders')
        .update({ beacon_uuid: po.id })
        .eq('id', po.id);
    }

    // Build official v2 submitOrder body
    const payload: any = {
      accountId: cap(accountId, 6),
      job: {
        jobName: cap(job_name || '', 15),
        jobNumber: cap(job_number || '', 7),
      },
      purchaseOrderNo: cap(poNumber, 22),
      extendedPO: cap(extended_po || '', 50),
      orderStatusCode: '',
      lineItems: items.map((i) => ({
        itemNumber: cap(i.srs_item_code || '', 6),
        quantity: Number(i.qty),
        unitOfMeasure: cap(i.unit || 'EA', 3),
        description: cap(i.item_name, 128),
        productNumber: cap(i.product_number || i.srs_item_code || '', 40),
        lineComments: cap(i.notes || i.color_specs || '', 2048),
        cost: Number(i.unit_cost ?? 0),
        price: Number(i.unit_price ?? i.unit_cost ?? 0),
        vendorCode: cap(i.vendor_code || '', 50),
      })),
      shipping: {
        shippingMethod: cap(shipping_method, 1),
        shippingBranch: cap(branch, 4),
        address: {
          address1: cap(delivery_address?.address1 || delivery_address?.street || '', 30),
          address2: cap(delivery_address?.address2 || '', 30),
          address3: cap(delivery_address?.address3 || '', 30),
          city: cap(delivery_address?.city || '', 25),
          postalCode: cap(delivery_address?.postalCode || delivery_address?.zip || '', 10),
          state: cap(delivery_address?.state || '', 2),
        },
        deliveryType: delivery_type || '',
      },
      sellingBranch: cap(sBranch, 4),
      specialInstruction: cap(special_instruction || notes || '', 234),
      checkForAvailability: check_for_availability,
      pickupDate: pickup_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      apiSiteId: siteId,
      pickupTime: pickup_time,
      onHold: !!on_hold,
      UUID: cap(po?.id || crypto.randomUUID(), 100),
    };

    const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/submitOrder`, {
      method: 'POST',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    let parsed: any;
    try { parsed = txt ? JSON.parse(txt) : {}; } catch { parsed = { raw: txt }; }

    const orderId = parsed?.orderId || null;
    const messageCode = parsed?.messageCode != null ? String(parsed.messageCode) : null;
    const message = parsed?.message != null ? String(parsed.message) : null;

    if (po?.id) {
      await supabase.from('purchase_orders').update({
        status: orderId ? 'submitted' : 'qxo_rejected',
        beacon_order_id: orderId,
        beacon_message_code: messageCode,
        beacon_message: message,
        external_order_id: orderId,
      }).eq('id', po.id);
    }

    if (!r.ok || !orderId) {
      return new Response(JSON.stringify({
        success: false,
        po_id: po?.id,
        po_number: poNumber,
        status: r.status,
        message_code: messageCode,
        message: message || `Beacon submitOrder failed (${r.status})`,
        response: parsed,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      po_id: po?.id,
      po_number: poNumber,
      beacon_order_id: orderId,
      response: parsed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('qxo-submit-order error', e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
