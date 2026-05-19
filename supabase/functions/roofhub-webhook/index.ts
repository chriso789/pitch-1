import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const EXPECTED_KEY = Deno.env.get('ROOFHUB_INTEGRATION_KEY');

// Allowed values per srs_orders.status CHECK constraint:
//   draft | submitted | confirmed | processing | shipped | delivered | cancelled | error
// Anything outside this list silently fails the UPDATE, so map every RoofHub
// event code to one of the allowed buckets and persist the granular SRS code
// in srs_order_status_history.status_message + raw_webhook_data.
function mapStatus(eventType: string, eventStatus: string): string {
  const s = (eventStatus || '').toLowerCase();
  switch (eventType) {
    case 'OU': {
      if (s.includes('cancel')) return 'cancelled';
      if (s.includes('confirm')) return 'confirmed';
      if (s.includes('ship')) return 'shipped';
      if (s.includes('deliver')) return 'delivered';
      return 'submitted';
    }
    case 'OC': return 'cancelled';
    case 'DU': {
      if (s.includes('completed') || s.includes('delivered')) return 'delivered';
      if (s.includes('en route') || s.includes('arrived') || s.includes('out for delivery')) return 'shipped';
      return 'processing';
    }
    case 'IU': return 'delivered';
    default: return 'processing';
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

    // Extract any delivery photos / documents (BOL, POD, signed slips) from the
    // RoofHub payload. SRS sends them under several possible keys depending on
    // event type, so we collect from any of them.
    const docCandidates: Array<{ url: string; name?: string; type?: string }> = [];
    const collect = (arr: any) => {
      if (!Array.isArray(arr)) return;
      for (const a of arr) {
        if (!a) continue;
        const url = a.url || a.URL || a.href || a.link || a.fileUrl || a.downloadUrl;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
          docCandidates.push({
            url,
            name: a.fileName || a.name || a.title,
            type: a.documentType || a.type || a.category,
          });
        }
      }
    };
    collect(payload?.attachments);
    collect(payload?.documents);
    collect(payload?.images);
    collect(payload?.proofOfDelivery);
    collect(payload?.pod);
    collect(payload?.deliveryDocuments);

    for (const doc of docCandidates) {
      try {
        // Skip if already captured
        const { data: dupe } = await supabase
          .from('srs_order_documents')
          .select('id')
          .eq('order_id', order.id)
          .eq('source_url', doc.url)
          .maybeSingle();
        if (dupe) continue;

        const resp = await fetch(doc.url);
        if (!resp.ok) {
          console.warn('roofhub-webhook: failed to fetch attachment', doc.url, resp.status);
          continue;
        }
        const mime = resp.headers.get('content-type') || 'application/octet-stream';
        const buf = new Uint8Array(await resp.arrayBuffer());
        const safeName = (doc.name || doc.url.split('/').pop() || `doc-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${order.tenant_id}/${order.id}/${Date.now()}-${safeName}`;

        const { error: upErr } = await supabase.storage
          .from('srs-order-documents')
          .upload(path, buf, { contentType: mime, upsert: false });
        if (upErr) {
          console.error('roofhub-webhook: storage upload failed', upErr);
          continue;
        }

        await supabase.from('srs_order_documents').insert({
          order_id: order.id,
          tenant_id: order.tenant_id,
          doc_type: (doc.type || (mime.startsWith('image/') ? 'delivery_photo' : 'delivery_document')),
          file_name: safeName,
          mime_type: mime,
          storage_path: path,
          source_url: doc.url,
          event_id: String(eventId),
          captured_at: eventDateTime ? new Date(eventDateTime).toISOString() : new Date().toISOString(),
          raw: doc as any,
        });
      } catch (e) {
        console.error('roofhub-webhook: doc capture failed', e);
      }
    }

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
