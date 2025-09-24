import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

interface PricingSyncRequest {
  supplierAccountId: string;
  products?: string[]; // optional SKU filter
  branchCode?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { supplierAccountId, products, branchCode }: PricingSyncRequest = await req.json();

    console.log(`Starting pricing sync for supplier: ${supplierAccountId}`);

    // Get supplier account details
    const { data: supplierAccount, error: supplierError } = await supabase
      .from('supplier_accounts')
      .select('*, vendors!inner(*)')
      .eq('id', supplierAccountId)
      .single();

    if (supplierError || !supplierAccount) {
      return new Response(
        JSON.stringify({ error: 'Supplier account not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const credentials = supplierAccount.encrypted_credentials;
    if (!credentials || (!credentials.apiKey && !credentials.accessToken)) {
      return new Response(
        JSON.stringify({ error: 'No valid credentials found' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Start sync log
    const { data: syncLog, error: syncError } = await supabase
      .from('supplier_price_sync_logs')
      .insert({
        tenant_id: supplierAccount.tenant_id,
        supplier_account_id: supplierAccountId,
        sync_type: 'manual',
        status: 'running'
      })
      .select()
      .single();

    if (syncError) {
      console.error('Failed to create sync log:', syncError);
      return new Response(
        JSON.stringify({ error: 'Failed to start sync' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      // Use API key or access token for authentication
      const authHeaders: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };

      if (credentials.apiKey) {
        authHeaders['X-Billtrust-Api-Key'] = credentials.apiKey;
      } else {
        authHeaders['X-Billtrust-Auth'] = credentials.accessToken;
      }

      // Get products to sync
      let productsToSync = [];
      if (products && products.length > 0) {
        const { data: productData } = await supabase
          .from('products')
          .select('*')
          .eq('tenant_id', supplierAccount.tenant_id)
          .in('sku', products);
        productsToSync = productData || [];
      } else {
        const { data: productData } = await supabase
          .from('products')
          .select('*')
          .eq('tenant_id', supplierAccount.tenant_id)
          .eq('is_active', true);
        productsToSync = productData || [];
      }

      let processed = 0;
      let updated = 0;
      let added = 0;
      const errors: string[] = [];

      // Mock pricing sync - in real implementation, this would call Billtrust's pricing API
      // For now, we'll simulate pricing data
      for (const product of productsToSync) {
        try {
          // In a real implementation, you would call:
          // const pricingResponse = await fetch(`https://arc-aegis.billtrust.com/invoices/v1/...`, {
          //   headers: authHeaders
          // });

          // Mock pricing data for demonstration
          const mockPrice = Math.random() * 100 + 10; // Random price between $10-$110
          
          const { error: priceError } = await supabase
            .from('price_cache')
            .upsert({
              tenant_id: supplierAccount.tenant_id,
              vendor_id: supplierAccount.vendors.id,
              product_id: product.id,
              supplier_account_id: supplierAccountId,
              branch_code: branchCode || 'DEFAULT',
              price: mockPrice,
              currency: 'USD',
              quantity_break: 1,
              effective_date: new Date().toISOString().split('T')[0],
              last_seen_at: new Date().toISOString(),
              source_type: 'api',
              source_data: {
                sync_id: syncLog.id,
                billtrust_tenant_id: supplierAccount.billtrust_tenant_id
              }
            });

          if (priceError) {
            errors.push(`Failed to update price for ${product.sku}: ${priceError.message}`);
          } else {
            updated++;
          }
          processed++;

        } catch (productError) {
          errors.push(`Error processing ${product.sku}: ${productError instanceof Error ? productError.message : String(productError)}`);
          processed++;
        }
      }

      // Update sync log
      const { error: updateLogError } = await supabase
        .from('supplier_price_sync_logs')
        .update({
          status: errors.length > 0 ? 'failed' : 'completed',
          products_processed: processed,
          products_updated: updated,
          products_added: added,
          error_details: errors.length > 0 ? { errors } : null,
          completed_at: new Date().toISOString()
        })
        .eq('id', syncLog.id);

      if (updateLogError) {
        console.error('Failed to update sync log:', updateLogError);
      }

      // Update supplier account status
      const { error: statusError } = await supabase
        .from('supplier_accounts')
        .update({
          connection_status: errors.length > 0 ? 'error' : 'connected',
          last_sync_at: new Date().toISOString(),
          last_error: errors.length > 0 ? errors.join('; ') : null
        })
        .eq('id', supplierAccountId);

      if (statusError) {
        console.error('Failed to update supplier status:', statusError);
      }

      return new Response(
        JSON.stringify({
          success: true,
          syncId: syncLog.id,
          processed,
          updated,
          added,
          errors: errors.length > 0 ? errors : null
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );

    } catch (syncProcessError) {
      // Update sync log with error
      await supabase
        .from('supplier_price_sync_logs')
        .update({
          status: 'failed',
          error_details: { error: syncProcessError instanceof Error ? syncProcessError.message : String(syncProcessError) },
          completed_at: new Date().toISOString()
        })
        .eq('id', syncLog.id);

      throw syncProcessError;
    }

  } catch (error) {
    console.error('Error in billtrust-pricing:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : String(error) 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});