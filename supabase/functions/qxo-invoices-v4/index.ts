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
    const company = body.company || url.searchParams.get('company') || '1';
    const branchNumber = body.branchNumber || url.searchParams.get('branchNumber') || auth.branch || '';

    if (action === 'list') {
      const params = new URLSearchParams();
      params.set('accountId', String(accountId));
      params.set('company', String(company));
      params.set('branchNumber', String(branchNumber));
      const passthrough = ['pageSize', 'pageNo', 'searchBy', 'searchTerm', 'searchStartDate', 'searchEndDate', 'searchEnum'];
      for (const k of passthrough) {
        const v = body[k] ?? url.searchParams.get(k);
        if (v != null && v !== '') params.set(k, String(v));
      }
      if (!params.has('pageSize')) params.set('pageSize', '25');
      if (!params.has('pageNo')) params.set('pageNo', '1');

      const r = await fetch(`${BEACON_BASE_URL}/v4/rest/com/becn/invoice?${params}`, {
        headers: auth.headers,
      });
      const data = await r.json().catch(() => ({}));
      const invoices = Array.isArray(data?.invoices) ? data.invoices : [];

      if (invoices.length) {
        const rows = invoices.map((inv: any) => ({
          tenant_id,
          qxo_invoice_id: String(inv.orderNumber ?? inv.invoiceNumber ?? crypto.randomUUID()),
          invoice_number: inv.orderNumber || inv.invoiceNumber || null,
          po_number: inv.purchaseOrderNumber || null,
          branch_code: branchNumber ? String(branchNumber) : null,
          branch_number: Number(branchNumber) || null,
          company: Number(company) || null,
          status: 'invoiced',
          issued_date: inv.invoiceDate || inv.orderPlacedDate || null,
          amount: inv.salesPlusOtherCharges ?? inv.sales ?? null,
          balance: inv.salesPlusOtherCharges ?? null,
          sales: inv.sales ?? null,
          other_charges: inv.otherCharges ?? null,
          sales_plus_other_charges: inv.salesPlusOtherCharges ?? null,
          raw_payload: inv,
          last_synced_at: new Date().toISOString(),
        }));
        await supabase.from('qxo_invoices').upsert(rows, { onConflict: 'tenant_id,qxo_invoice_id' });
      }

      return new Response(JSON.stringify({ success: true, ...data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'pdf') {
      const invoiceNumbers = body.invoiceNumbers || url.searchParams.get('invoiceNumbers');
      if (!invoiceNumbers) throw new Error('invoiceNumbers is required');
      const params = new URLSearchParams({
        invoiceNumbers: String(invoiceNumbers),
        accountId: String(accountId),
        siteId: auth.apiSiteId || 'BDD',
      });
      const r = await fetch(`${BEACON_BASE_URL}/v2/rest/com/becn/downloadBillTrustInvoiceAsPDF?${params}`, {
        headers: auth.headers,
      });
      const buf = await r.arrayBuffer();
      return new Response(buf, {
        headers: { ...corsHeaders, 'Content-Type': r.headers.get('content-type') || 'application/pdf' },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error('qxo-invoices-v4 error', e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
