import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PricingSyncResult {
  sku: string;
  oldPrice: number | null;
  newPrice: number;
  success: boolean;
  error?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting SRS price refresh scheduler...');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get request parameters
    const { vendor_code = 'SRS', batch_size = 50, tenant_id } = await req.json().catch(() => ({}));

    console.log(`Refreshing prices for vendor: ${vendor_code}, batch size: ${batch_size}`);

    // Create sync log entry
    const { data: syncLog, error: syncLogError } = await supabase
      .from('price_sync_logs')
      .insert({
        tenant_id: tenant_id || null,
        sync_type: req.headers.get('x-sync-type') || 'scheduled',
        vendor_code,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (syncLogError || !syncLog) {
      console.error('Failed to create sync log:', syncLogError);
      throw new Error('Failed to initialize sync log');
    }

    console.log('Created sync log:', syncLog.id);

    // Get all SKUs from price_cache for this vendor
    const { data: cachedPrices, error: cacheError } = await supabase
      .from('price_cache')
      .select('sku, price, vendor, branch')
      .eq('vendor', vendor_code)
      .order('last_updated', { ascending: true })
      .limit(batch_size * 5); // Get more than needed to handle failures

    if (cacheError) {
      console.error('Failed to fetch cached prices:', cacheError);
      throw new Error('Failed to fetch cached prices');
    }

    console.log(`Found ${cachedPrices?.length || 0} cached prices to refresh`);

    if (!cachedPrices || cachedPrices.length === 0) {
      await supabase
        .from('price_sync_logs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          total_skus: 0,
          successful_updates: 0,
          failed_updates: 0,
        })
        .eq('id', syncLog.id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No prices to refresh',
          sync_log_id: syncLog.id,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process in batches
    const results: PricingSyncResult[] = [];
    let successCount = 0;
    let failCount = 0;
    const errors: any[] = [];

    for (let i = 0; i < cachedPrices.length; i += batch_size) {
      const batch = cachedPrices.slice(i, i + batch_size);
      const skus = batch.map(p => p.sku);

      console.log(`Processing batch ${Math.floor(i / batch_size) + 1}: ${skus.length} SKUs`);

      try {
        // Call srs-pricing edge function to get live prices
        const { data: pricingData, error: pricingError } = await supabase.functions.invoke(
          'srs-pricing',
          {
            body: {
              skus,
              branch: batch[0]?.branch,
              refresh: true,
            },
          }
        );

        if (pricingError) {
          console.error('Pricing function error:', pricingError);
          failCount += skus.length;
          errors.push({ batch: i / batch_size + 1, error: pricingError.message });
          continue;
        }

        // Process each SKU result
        for (const result of pricingData?.results || []) {
          const oldPrice = batch.find(p => p.sku === result.sku)?.price;
          const newPrice = result.price;

          if (result.success && newPrice) {
            // Track price change in history if price changed
            if (oldPrice && oldPrice !== newPrice) {
              const priceChangePct = ((newPrice - oldPrice) / oldPrice) * 100;

              await supabase.from('price_history').insert({
                tenant_id: tenant_id || null,
                sku: result.sku,
                product_name: result.description || result.sku,
                vendor_code,
                old_price: oldPrice,
                new_price: newPrice,
                price_change_pct: Math.round(priceChangePct * 100) / 100,
                branch_code: result.branch,
                sync_log_id: syncLog.id,
              });

              console.log(`Price changed for ${result.sku}: $${oldPrice} → $${newPrice} (${priceChangePct.toFixed(2)}%)`);
            }

            results.push({
              sku: result.sku,
              oldPrice,
              newPrice,
              success: true,
            });
            successCount++;
          } else {
            results.push({
              sku: result.sku,
              oldPrice,
              newPrice: 0,
              success: false,
              error: result.error || 'Unknown error',
            });
            failCount++;
          }
        }
      } catch (batchError) {
        console.error('Batch processing error:', batchError);
        failCount += skus.length;
        errors.push({ 
          batch: i / batch_size + 1, 
          error: batchError instanceof Error ? batchError.message : 'Unknown error' 
        });
      }

      // Rate limiting: wait 1 second between batches
      if (i + batch_size < cachedPrices.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Update sync log with results
    await supabase
      .from('price_sync_logs')
      .update({
        status: failCount === 0 ? 'completed' : (successCount > 0 ? 'partial' : 'failed'),
        completed_at: new Date().toISOString(),
        total_skus: cachedPrices.length,
        successful_updates: successCount,
        failed_updates: failCount,
        errors: errors.length > 0 ? errors : null,
      })
      .eq('id', syncLog.id);

    console.log(`Price refresh completed: ${successCount} success, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        sync_log_id: syncLog.id,
        total_skus: cachedPrices.length,
        successful_updates: successCount,
        failed_updates: failCount,
        errors: errors.length > 0 ? errors : null,
        results: results.slice(0, 10), // Return first 10 for preview
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Price refresh scheduler error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
