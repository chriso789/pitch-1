import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BEACON_BASE_URL = 'https://api.becn.com';

async function login(conn: any) {
  const res = await fetch(`${BEACON_BASE_URL}/v1/rest/com/becn/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: conn.username,
      password: conn.password,
      siteId: conn.site_id || 'dealersChoice',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Login failed (${res.status})`);
  const info = data?.messageInfo;
  if (typeof info === 'string') throw new Error(`Beacon: ${info}`);
  if (!info?.profileId && !info?.lastSelectedAccount) {
    throw new Error('Beacon login returned no profile — credentials may be invalid.');
  }
  const cookie = res.headers.get('set-cookie') || '';
  return { data, cookie };
}

interface OrderItem {
  item_name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  notes?: string;
  color_specs?: string;
  srs_item_code?: string;
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
      estimate_id,
      job_id,
      project_id,
      job_number,
      customer_name,
      delivery_address,
      branch_code,
      requested_delivery_date,
      notes,
      items,
    }: {
      tenant_id: string;
      estimate_id?: string;
      job_id?: string;
      project_id?: string;
      job_number?: string;
      customer_name?: string;
      delivery_address?: any;
      branch_code?: string;
      requested_delivery_date?: string;
      notes?: string;
      items: OrderItem[];
    } = body;

    if (!tenant_id || !items?.length) {
      throw new Error('tenant_id and items[] are required');
    }

    const { data: conn, error: connErr } = await supabase
      .from('qxo_connections')
      .select('*')
      .eq('tenant_id', tenant_id)
      .maybeSingle();
    if (connErr) throw connErr;
    if (!conn) throw new Error('No QXO connection found for this tenant.');

    // Authenticate (also validates credentials surface in-body errors)
    const { data: loginData, cookie } = await login(conn);
    const info = loginData?.messageInfo || {};
    const accountId =
      conn.account_id ||
      info?.lastSelectedAccount?.accountId ||
      info?.lastSelectedAccount?.id ||
      null;
    const effectiveBranch =
      branch_code ||
      conn.default_branch_code ||
      info?.lastSelectedBranch?.branchCode ||
      info?.lastSelectedBranch?.code ||
      null;

    // Build Beacon order payload (best-effort; Beacon's official spec varies by partner)
    const subtotal = items.reduce((s, i) => s + Number(i.qty) * Number(i.unit_cost || 0), 0);
    const beaconPayload = {
      accountId,
      branchCode: effectiveBranch,
      customerPoNumber: job_number || estimate_id?.slice(-8).toUpperCase() || null,
      requestedDeliveryDate: requested_delivery_date || null,
      shipTo: delivery_address || null,
      notes: notes || null,
      lineItems: items.map((i) => ({
        productCode: i.srs_item_code || null,
        description: i.item_name,
        quantity: Number(i.qty),
        unitOfMeasure: i.unit,
        unitPrice: Number(i.unit_cost || 0),
        notes: i.notes || i.color_specs || null,
      })),
    };

    // Insert local PO record up-front so we always have a tracked record
    const poNumber = `QXO-${Date.now().toString(36).toUpperCase()}`;
    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .insert({
        tenant_id,
        po_number: poNumber,
        project_id: project_id || job_id || null,
        vendor_id: null,
        branch_code: effectiveBranch,
        status: 'submitting',
        subtotal,
        total_amount: subtotal,
        delivery_address,
        notes: `Pushed to QXO/Beacon${notes ? ` — ${notes}` : ''}`,
      })
      .select()
      .single();
    if (poErr) console.error('Local PO insert failed', poErr);

    if (po?.id && items.length) {
      await supabase.from('purchase_order_items').insert(
        items.map((i) => ({
          po_id: po.id,
          srs_item_code: i.srs_item_code || null,
          item_description: i.item_name,
          quantity: Number(i.qty),
          unit_price: Number(i.unit_cost || 0),
          line_total: Number(i.qty) * Number(i.unit_cost || 0),
          metadata: { unit: i.unit, notes: i.notes || i.color_specs || null },
        })),
      );
    }

    // Try to push to Beacon order endpoint(s)
    const candidates = [
      `/v1/rest/com/becn/order`,
      `/v1/rest/com/becn/orders`,
      `/v1/rest/com/becn/account/${accountId || ''}/order`,
    ].filter((p) => !p.endsWith('/'));

    let beaconResp: any = null;
    let lastErr: string | null = null;
    let successPath: string | null = null;
    for (const p of candidates) {
      try {
        const r = await fetch(`${BEACON_BASE_URL}${p}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify(beaconPayload),
        });
        const txt = await r.text();
        let parsed: any = null;
        try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = { raw: txt }; }
        if (r.ok) {
          beaconResp = parsed;
          successPath = p;
          break;
        }
        lastErr = `${p} → ${r.status} ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed).slice(0, 250)}`;
      } catch (e: any) {
        lastErr = `${p} → ${e.message}`;
      }
    }

    if (!beaconResp) {
      // Beacon push failed — keep local PO but mark it so user can retry / submit manually
      if (po?.id) {
        await supabase.from('purchase_orders').update({
          status: 'pending_qxo',
          notes: `QXO push failed: ${lastErr || 'no endpoint responded'}. PO saved locally.`,
        }).eq('id', po.id);
      }
      return new Response(JSON.stringify({
        success: false,
        po_id: po?.id,
        po_number: poNumber,
        error: `Beacon order endpoint unavailable. ${lastErr || ''}`,
        hint: 'Order saved as local PO. Ask your QXO/Beacon integrations rep to confirm the partner order endpoint path for your account.',
      }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const beaconOrderId =
      beaconResp?.orderId || beaconResp?.id || beaconResp?.orderNumber || null;

    if (po?.id) {
      await supabase.from('purchase_orders').update({
        status: 'submitted',
        notes: `Pushed to QXO/Beacon (${successPath}) order ${beaconOrderId || 'OK'}`,
      }).eq('id', po.id);
    }

    return new Response(JSON.stringify({
      success: true,
      po_id: po?.id,
      po_number: poNumber,
      beacon_order_id: beaconOrderId,
      endpoint: successPath,
      response: beaconResp,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('qxo-push-order error', e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
