// Multi-supplier price-refresh scheduler.
//
// vendor_code: 'SRS' | 'ABC' | 'QXO' (required for the bi-weekly cron jobs).
// Each vendor's prices are tracked in completely isolated rows in
// `price_history` (tagged by vendor_code) and only that vendor's entries
// in `price_cache` are touched. ABC and QXO never mutate SRS pricing.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Vendor = 'SRS' | 'ABC' | 'QXO';

interface PricingSyncResult {
  sku: string;
  oldPrice: number | null;
  newPrice: number;
  success: boolean;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const vendor_code = String(body?.vendor_code || 'SRS').toUpperCase() as Vendor;
    const batch_size: number = Number(body?.batch_size ?? 50);
    const tenant_id: string | null = body?.tenant_id || null;

    if (!['SRS', 'ABC', 'QXO'].includes(vendor_code)) {
      throw new Error(`Unsupported vendor_code: ${vendor_code}`);
    }

    console.log(`[price-refresh] vendor=${vendor_code} batch=${batch_size} tenant=${tenant_id ?? 'ALL'}`);

    const { data: syncLog, error: syncLogError } = await supabase
      .from('price_sync_logs')
      .insert({
        tenant_id,
        sync_type: req.headers.get('x-sync-type') || 'scheduled-biweekly',
        vendor_code,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (syncLogError || !syncLog) throw new Error('Failed to initialize sync log');

    // ---- Pull cached prices SCOPED TO THIS VENDOR ONLY ----
    // (vendor isolation is enforced both in this select and on every write below)
    let cacheQuery = supabase
      .from('price_cache')
      .select('sku, price, vendor, branch, tenant_id')
      .eq('vendor', vendor_code)
      .order('last_updated', { ascending: true })
      .limit(batch_size * 5);
    if (tenant_id) cacheQuery = cacheQuery.eq('tenant_id', tenant_id);
    const { data: cachedPrices, error: cacheError } = await cacheQuery;
    if (cacheError) throw new Error(`Failed to fetch cached prices: ${cacheError.message}`);

    if (!cachedPrices || cachedPrices.length === 0) {
      await supabase.from('price_sync_logs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_skus: 0, successful_updates: 0, failed_updates: 0,
      }).eq('id', syncLog.id);
      return new Response(
        JSON.stringify({ success: true, vendor_code, message: 'No prices to refresh', sync_log_id: syncLog.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const results: PricingSyncResult[] = [];
    let successCount = 0, failCount = 0;
    const errors: any[] = [];

    for (let i = 0; i < cachedPrices.length; i += batch_size) {
      const batch = cachedPrices.slice(i, i + batch_size);
      const skus = batch.map((p: any) => p.sku);
      const branch = batch[0]?.branch;

      try {
        const pricingResults = await fetchVendorPricing(
          supabase, vendor_code, skus, branch, batch[0]?.tenant_id,
        );

        for (const result of pricingResults) {
          const oldPrice = batch.find((p: any) => p.sku === result.sku)?.price ?? null;
          const newPrice = result.price;

          if (result.success && newPrice) {
            if (oldPrice && oldPrice !== newPrice) {
              const pct = ((newPrice - oldPrice) / oldPrice) * 100;
              // Supplier-specific row — vendor_code keeps ABC/QXO/SRS isolated
              await supabase.from('price_history').insert({
                tenant_id,
                sku: result.sku,
                product_name: result.description || result.sku,
                vendor_code,
                old_price: oldPrice,
                new_price: newPrice,
                price_change_pct: Math.round(pct * 100) / 100,
                branch_code: result.branch,
                sync_log_id: syncLog.id,
              });
              console.log(`[${vendor_code}] ${result.sku}: $${oldPrice} → $${newPrice} (${pct.toFixed(2)}%)`);
            }
            results.push({ sku: result.sku, oldPrice, newPrice, success: true });
            successCount++;
          } else {
            results.push({ sku: result.sku, oldPrice, newPrice: 0, success: false, error: result.error || 'Unknown' });
            failCount++;
          }
        }
      } catch (e: any) {
        failCount += skus.length;
        errors.push({ batch: i / batch_size + 1, error: e?.message || String(e) });
      }

      if (i + batch_size < cachedPrices.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    await supabase.from('price_sync_logs').update({
      status: failCount === 0 ? 'completed' : (successCount > 0 ? 'partial' : 'failed'),
      completed_at: new Date().toISOString(),
      total_skus: cachedPrices.length,
      successful_updates: successCount,
      failed_updates: failCount,
      errors: errors.length > 0 ? errors : null,
    }).eq('id', syncLog.id);

    return new Response(
      JSON.stringify({
        success: true, vendor_code, sync_log_id: syncLog.id,
        total_skus: cachedPrices.length,
        successful_updates: successCount, failed_updates: failCount,
        errors: errors.length > 0 ? errors : null,
        results: results.slice(0, 10),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[price-refresh] error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ---- Vendor dispatch — each supplier hits its OWN proxy/pricing function ----
async function fetchVendorPricing(
  supabase: any,
  vendor: Vendor,
  skus: string[],
  branch: string | undefined,
  tenant_id: string | undefined,
): Promise<Array<{ sku: string; price: number; description?: string; branch?: string; success: boolean; error?: string }>> {
  if (vendor === 'SRS') {
    const { data, error } = await supabase.functions.invoke('srs-pricing', {
      body: { skus, branch, refresh: true },
    });
    if (error) throw new Error(error.message);
    return (data?.results || []).map((r: any) => ({
      sku: r.sku, price: r.price, description: r.description, branch: r.branch,
      success: !!r.success, error: r.error,
    }));
  }

  if (vendor === 'QXO') {
    const { data, error } = await supabase.functions.invoke('qxo-pricing', {
      body: { skus, branch, refresh: true },
    });
    if (error) throw new Error(error.message);
    const out = (data?.results || []).map((r: any) => ({
      sku: r.sku, price: r.price, description: r.description, branch: r.branch,
      success: r.price != null, error: undefined,
    }));
    const errs = (data?.errors || []) as string[];
    for (const e of errs) {
      const m = /SKU\s+([^\s:]+)/.exec(e);
      if (m) out.push({ sku: m[1], price: 0, branch, success: false, error: e });
    }
    return out;
  }

  // ABC — uses action: 'price_items' on abc-api-proxy. Requires tenant_id + branchNumber.
  if (!tenant_id) {
    return skus.map(sku => ({ sku, price: 0, success: false, error: 'tenant_id required for ABC pricing' }));
  }
  const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
    body: {
      action: 'price_items',
      tenant_id,
      environment: 'production',
      branchNumber: branch,
      shipToNumber: branch,
      lines: skus.map(sku => ({ itemNumber: sku, quantity: 1, unitOfMeasure: 'EA' })),
    },
  });
  if (error) throw new Error(error.message);
  const linesOut = (data?.body?.lines || data?.body?.items || []) as any[];
  return skus.map(sku => {
    const hit = linesOut.find((l: any) =>
      String(l.itemNumber || l.sku || '').toUpperCase() === sku.toUpperCase()
    );
    const price = Number(hit?.unitPrice ?? hit?.netPrice ?? hit?.price ?? 0);
    return {
      sku,
      price,
      description: hit?.description,
      branch,
      success: price > 0,
      error: price > 0 ? undefined : 'no price returned',
    };
  });
}
