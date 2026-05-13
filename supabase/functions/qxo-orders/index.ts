import { createClient } from 'npm:@supabase/supabase-js@2';
import { BEACON_BASE_URL, corsHeaders, getBeaconAuth } from '../_shared/qxo-auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'list';
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const tenant_id: string = body.tenant_id || url.searchParams.get('tenant_id') || '';
    if (!tenant_id) throw new Error('tenant_id is required');

    const auth = await getBeaconAuth(supabase, tenant_id);
    const accountId = body.accountId || auth.accountId;

    if (action === 'list') {
      const params = new URLSearchParams();
      params.set('accountId', String(accountId));
      const passthrough = ['pageSize', 'pageNo', 'searchBy', 'searchTerm', 'searchStartDate', 'searchEndDate', 'searchEnum', 'orderBy'];
      for (const k of passthrough) {
        const v = body[k] ?? url.searchParams.get(k);
        if (v != null && v !== '') params.set(k, String(v));
      }
      if (!params.has('pageSize')) params.set('pageSize', '25');
      if (!params.has('pageNo')) params.set('pageNo', '1');

      const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/orderhistory_v2?${params}`, {
        headers: auth.headers,
      });
      const data = await r.json().catch(() => ({}));
      const orders = Array.isArray(data?.orders) ? data.orders : [];

      // Cache to qxo_orders
      if (orders.length) {
        const rows = orders.map((o: any) => ({
          tenant_id,
          beacon_order_id: String(o.orderId),
          account_id: String(o.accountId ?? accountId ?? ''),
          po_number: o.purchaseOrderNo || null,
          customer_uuid: o.UUID || null,
          job_name: o.job?.jobName || null,
          job_number: o.job?.jobNumber || null,
          status_code: o.orderStatusCode || null,
          status_value: o.orderStatusValue || null,
          on_hold: !!o.onHold,
          total: o.total ?? null,
          sub_total: o.subTotal ?? null,
          tax: o.tax ?? null,
          order_placed_date: o.orderPlacedDate ? new Date(o.orderPlacedDate).toISOString() : null,
          invoiced_date: o.invoicedDate ? new Date(o.invoicedDate).toISOString() : null,
          payment_status: o.paymentStatus || null,
          selling_branch: o.sellingBranch || null,
          shipping_branch: o.shipping?.shippingBranchDisplayName || String(o.shipping?.shippingBranch ?? '') || null,
          shipping_method: o.shipping?.shippingMethod || null,
          ship_address: o.shipping?.address || null,
          raw_payload: o,
          last_synced_at: new Date().toISOString(),
        }));
        await supabase.from('qxo_orders').upsert(rows, { onConflict: 'tenant_id,beacon_order_id' });
      }

      return new Response(JSON.stringify({ success: true, ...data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'detail') {
      const orderId = body.orderId || url.searchParams.get('orderId');
      if (!orderId) throw new Error('orderId is required');
      const params = new URLSearchParams({
        orderId: String(orderId),
        accountId: String(accountId),
        showDT: 'true',
      });
      const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/orderdetail?${params}`, {
        headers: auth.headers,
      });
      const data = await r.json().catch(() => ({}));
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'pdf') {
      const orderId = body.orderId || url.searchParams.get('orderId');
      const accountToken = body.accountToken || url.searchParams.get('accountToken') || '';
      const branchId = body.branchId || url.searchParams.get('branchId') || auth.branch || '';
      if (!orderId) throw new Error('orderId is required');
      const params = new URLSearchParams({
        orderId: String(orderId),
        accountId: String(accountId),
        accountToken: String(accountToken),
        branchId: String(branchId),
        showBackToOrderDetailPageLink: 'false',
        showPrice: 'true',
        showShipTips: 'false',
        enableSwitchOrderQty: 'false',
        showShipQty: 'true',
      });
      const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/downloadOrderDetailAsPDF?${params}`, {
        headers: auth.headers,
      });
      const buf = await r.arrayBuffer();
      return new Response(buf, {
        headers: { ...corsHeaders, 'Content-Type': r.headers.get('content-type') || 'application/pdf' },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error('qxo-orders error', e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
