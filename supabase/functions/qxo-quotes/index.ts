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
    const body = req.method !== 'GET' ? await req.json().catch(() => ({})) : {};
    const action = body.action || url.searchParams.get('action') || 'detail';
    const tenant_id: string = body.tenant_id || url.searchParams.get('tenant_id') || '';
    if (!tenant_id) throw new Error('tenant_id is required');

    const auth = await getBeaconAuth(supabase, tenant_id);
    const accountId = body.accountId || auth.accountId;

    if (action === 'detail') {
      const quoteId = body.quoteId || url.searchParams.get('quoteId');
      if (!quoteId) throw new Error('quoteId is required');
      const params = new URLSearchParams({
        quoteId: String(quoteId),
        account: String(accountId),
      });
      const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/getMincronQuoteDetail?${params}`, {
        headers: auth.headers,
      });
      const data = await r.json().catch(() => ({}));
      const q = data?.quote;
      if (q) {
        await supabase.from('qxo_quotes').upsert({
          tenant_id,
          beacon_quote_id: String(q.id ?? quoteId),
          mincron_id: q.mincronId || null,
          account_id: q.accountNumber || String(accountId),
          account_name: q.accountName || null,
          status: q.status || null,
          status_description: q.statusDescription || null,
          job_name: q.jobName || null,
          job_number: q.jobNumber || null,
          work_type: q.workType || null,
          total: q.total ?? null,
          sub_total: q.subTotal ?? null,
          tax: q.tax ?? null,
          expires: q.expires && /^\d{2}-\d{2}-\d{4}$/.test(q.expires)
            ? `${q.expires.slice(6, 10)}-${q.expires.slice(0, 2)}-${q.expires.slice(3, 5)}`
            : null,
          creation_date: q.creationDate && /^\d{2}-\d{2}-\d{4}$/.test(q.creationDate)
            ? `${q.creationDate.slice(6, 10)}-${q.creationDate.slice(0, 2)}-${q.creationDate.slice(3, 5)}`
            : null,
          quote_notes: q.quoteNotes || null,
          quote_items: q.quoteItems || null,
          raw_payload: q,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,beacon_quote_id' });
      }
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'revise') {
      const r = await fetch(`${BEACON_BASE_URL}/v2/reviseQuote`, {
        method: 'POST',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: String(accountId),
          quoteId: String(body.quoteId),
          quoteNotes: body.quoteNotes || '',
        }),
      });
      const data = await r.json().catch(() => ({}));
      return new Response(JSON.stringify(data), {
        status: r.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'reject') {
      const r = await fetch(`${BEACON_BASE_URL}/v2/rejectQuote`, {
        method: 'POST',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: String(accountId),
          quoteId: String(body.quoteId),
          reason: body.reason || '',
        }),
      });
      const data = await r.json().catch(() => ({}));
      return new Response(JSON.stringify(data), {
        status: r.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'submitDelegated') {
      const payload = { ...body, accountId: String(accountId) };
      delete (payload as any).action;
      delete (payload as any).tenant_id;
      const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/submitDelegatedQuote`, {
        method: 'POST',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      return new Response(JSON.stringify(data), {
        status: r.ok ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error('qxo-quotes error', e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
