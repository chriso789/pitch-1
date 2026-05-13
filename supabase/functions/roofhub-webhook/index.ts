import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const EXPECTED_KEY = Deno.env.get('ROOFHUB_INTEGRATION_KEY');

function mapStatus(eventType: string, eventStatus: string): string {
  switch (eventType) {
    case 'OU': return 'submitted';
    case 'OC': return 'cancelled';
    case 'DU': {
      const s = (eventStatus || '').toLowerCase();
      if (s.includes('en route')) return 'delivery_en_route';
      if (s.includes('arrived')) return 'delivery_arrived';
      if (s.includes('completed')) return 'delivered';
      return 'delivery_update';
    }
    case 'IU': return 'invoiced';
    default: return 'unknown';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Auth: header X-Integration-Key or query ?key=
    const url = new URL(req.url);
    const key = req.headers.get('x-integration-key') || url.searchParams.get('key');
    if (!EXPECTED_KEY || key !== EXPECTED_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.json();
    const {
      eventId,
      eventType,
      eventStatus,
      eventDateTime,
      subscriberReferenceNum,    // PO# e.g. job:17286
      subscriberReferenceNum2,   // original sales order id
      subscriberReferenceNum3,   // transaction id
    } = payload || {};

    if (!eventType || !eventId) {
      return new Response(JSON.stringify({ error: 'Missing eventType/eventId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newStatus = mapStatus(eventType, eventStatus);
    const po = String(subscriberReferenceNum || '').trim();
    const salesOrderId = String(subscriberReferenceNum2 || eventId || '').trim();
    const txId = subscriberReferenceNum3 ? String(subscriberReferenceNum3) : null;

    // Locate srs_orders row: by srs_transaction_id, then srs_order_id, then order_number (PO)
    let order: any = null;
    if (txId) {
      const { data } = await supabase.from('srs_orders').select('*').eq('srs_transaction_id', txId).maybeSingle();
      if (data) order = data;
    }
    if (!order && salesOrderId) {
      const { data } = await supabase.from('srs_orders').select('*').eq('srs_order_id', salesOrderId).maybeSingle();
      if (data) order = data;
    }
    if (!order && po) {
      // Try raw PO, then strip optional `job:` prefix used when submitting orders
      const candidates = Array.from(new Set([po, po.replace(/^job:/i, '').trim()])).filter(Boolean);
      for (const candidate of candidates) {
        const { data } = await supabase.from('srs_orders').select('*').eq('order_number', candidate).maybeSingle();
        if (data) { order = data; break; }
      }
    }

    if (!order) {
      console.warn('roofhub-webhook: no matching srs_orders row', { eventType, eventId, po, salesOrderId, txId });
      return new Response(JSON.stringify({ ok: true, matched: false }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const oldStatus = order.status;
    const updates: Record<string, any> = { status: newStatus, updated_at: new Date().toISOString() };

    // Capture sales order id on first OU
    if (eventType === 'OU' && !order.srs_order_id && eventId) updates.srs_order_id = String(eventId);
    if (txId && !order.srs_transaction_id) updates.srs_transaction_id = txId;

    if (eventType === 'DU' && newStatus === 'delivered' && eventDateTime) {
      updates.delivery_date = String(eventDateTime).slice(0, 10);
    }

    await supabase.from('srs_orders').update(updates).eq('id', order.id);

    // Append status history
    await supabase.from('srs_order_status_history').insert({
      order_id: order.id,
      old_status: oldStatus,
      new_status: newStatus,
      status_message: `${eventType}: ${eventStatus || ''}`.trim(),
      raw_webhook_data: payload,
    });

    // IU → create a pending material invoice tied to the project for Profit Center
    if (eventType === 'IU' && order.project_id) {
      const invoiceNumber = String(eventId);
      const { data: existing } = await supabase
        .from('project_cost_invoices')
        .select('id')
        .eq('project_id', order.project_id)
        .eq('invoice_number', invoiceNumber)
        .maybeSingle();

      if (!existing) {
        await supabase.from('project_cost_invoices').insert({
          tenant_id: order.tenant_id,
          project_id: order.project_id,
          invoice_type: 'material',
          vendor_name: order.branch_name || 'SRS Distribution',
          invoice_number: invoiceNumber,
          invoice_date: eventDateTime ? String(eventDateTime).slice(0, 10) : null,
          invoice_amount: order.total_amount || 0,
          status: 'pending',
          notes: `Auto-created from RoofHub webhook (sales order ${salesOrderId})`,
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, matched: true, orderId: order.id, status: newStatus }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('roofhub-webhook error', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
