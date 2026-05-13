import { createClient } from 'npm:@supabase/supabase-js@2';
import { BEACON_BASE_URL, corsHeaders, cap, getBeaconAuth } from '../_shared/qxo-auth.ts';

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
      bid_number,
      job_name,
      job_number,
      purchase_order_no,
      extended_po,
      shipping = {},
      selling_branch,
      special_instruction,
      check_for_availability = 'no',
      pickup_date,
      pickup_time = 'Anytime',
      on_hold = true,
      api_site_id,
      items,
    } = body;

    if (!tenant_id || !bid_number || !items?.length) {
      throw new Error('tenant_id, bid_number and items[] are required');
    }

    const auth = await getBeaconAuth(supabase, tenant_id);

    const payload = {
      accountId: cap(auth.accountId, 6),
      bidNumber: bid_number,
      job: { jobName: cap(job_name || '', 15), jobNumber: cap(job_number || '', 7) },
      purchaseOrderNo: cap(purchase_order_no || '', 22),
      extendedPO: cap(extended_po || '', 50),
      orderStatusCode: '',
      lineItems: items.map((i: any) => ({
        itemNumber: cap(i.itemNumber || i.srs_item_code || '', 6),
        quantity: Number(i.quantity ?? i.qty ?? 0),
        unitOfMeasure: cap(i.unitOfMeasure || i.unit || 'EA', 3),
        description: cap(i.description || i.item_name || '', 128),
        productNumber: cap(i.productNumber || i.product_number || '', 128),
        itemUnitPrice: Number(i.itemUnitPrice ?? i.unit_price ?? 0),
        itemSubTotal: Number(
          i.itemSubTotal ?? Number(i.quantity ?? i.qty ?? 0) * Number(i.unit_price ?? 0),
        ),
        lineComments: cap(i.lineComments || i.notes || '', 2048),
        itemType: cap(i.itemType || 'I', 5),
        nonStockItem: !!i.nonStockItem,
      })),
      shipping: {
        shippingMethod: cap(shipping.shippingMethod || 'D', 1),
        shippingBranch: cap(shipping.shippingBranch || auth.branch || '', 4),
        address: {
          address1: cap(shipping.address?.address1 || '', 30),
          address2: cap(shipping.address?.address2 || '', 30),
          address3: cap(shipping.address?.address3 || '', 30),
          city: cap(shipping.address?.city || '', 25),
          postalCode: cap(shipping.address?.postalCode || '', 10),
          state: cap(shipping.address?.state || '', 2),
        },
        deliveryType: shipping.deliveryType || '',
      },
      sellingBranch: cap(selling_branch || auth.branch || '', 4),
      specialInstruction: cap(special_instruction || '', 234),
      checkForAvailability: check_for_availability,
      pickupDate: pickup_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      apiSiteId: api_site_id || auth.apiSiteId || 'BDD',
      pickupTime: pickup_time,
      onHold: !!on_hold,
      UUID: crypto.randomUUID(),
    };

    const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/submitQuoteOrder`, {
      method: 'POST',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const parsed = await r.json().catch(() => ({}));

    return new Response(JSON.stringify({
      success: r.ok && !!parsed?.orderId,
      status: r.status,
      beacon_order_id: parsed?.orderId || null,
      message_code: parsed?.messageCode ?? null,
      message: parsed?.message ?? null,
      response: parsed,
    }), { status: r.ok ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('qxo-submit-quote-order error', e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
