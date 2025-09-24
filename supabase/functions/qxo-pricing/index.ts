import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface QXOPricingRequest {
  sku?: string
  branch?: string
  skus?: string[]
  refresh?: boolean
}

interface QXOPricingResponse {
  sku: string
  price: number
  listPrice?: number
  discount?: number
  branch: string
  availability: boolean
  leadTime?: number
  minOrderQty?: number
  lastUpdated: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { sku, branch, skus, refresh } = await req.json() as QXOPricingRequest

    console.log('QXO Pricing request:', { sku, branch, skus, refresh })

    // Get QXO API credentials from secrets
    const qxoApiKey = Deno.env.get('QXO_API_KEY')
    const qxoBaseUrl = Deno.env.get('QXO_BASE_URL') || 'https://api.qxo.com/v1'

    if (!qxoApiKey) {
      throw new Error('QXO API key not configured')
    }

    // Determine which SKUs to fetch
    const targetSkus = skus || (sku ? [sku] : [])
    if (targetSkus.length === 0) {
      throw new Error('No SKUs specified for pricing lookup')
    }

    const results: QXOPricingResponse[] = []
    const errors: string[] = []

    // Fetch pricing for each SKU
    for (const targetSku of targetSkus) {
      try {
        // Check if we have recent cached data (unless refresh is requested)
        if (!refresh) {
          const { data: cachedPrice } = await supabase
            .from('price_cache')
            .select(`
              *,
              products!inner (sku, name),
              vendors!inner (name, vendor_code)
            `)
            .eq('products.sku', targetSku)
            .eq('vendors.vendor_code', 'QXO')
            .gte('seen_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()) // 2 hours
            .single()

          if (cachedPrice) {
            results.push({
              sku: targetSku,
              price: cachedPrice.price,
              listPrice: cachedPrice.list_price,
              discount: cachedPrice.discount_percent,
              branch: cachedPrice.branch_code,
              availability: true,
              lastUpdated: cachedPrice.seen_at
            })
            continue
          }
        }

        // Fetch live pricing from QXO API
        const qxoResponse = await fetch(`${qxoBaseUrl}/pricing`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${qxoApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sku: targetSku,
            branch: branch || 'DEFAULT',
            includeAvailability: true,
            includeLeadTime: true
          })
        })

        if (!qxoResponse.ok) {
          const errorText = await qxoResponse.text()
          console.error(`QXO API error for SKU ${targetSku}:`, errorText)
          errors.push(`QXO API error for ${targetSku}: ${qxoResponse.status}`)
          continue
        }

        const qxoData = await qxoResponse.json()
        console.log(`QXO response for ${targetSku}:`, qxoData)

        // Transform QXO response to our format
        const pricingResult: QXOPricingResponse = {
          sku: targetSku,
          price: qxoData.price || 0,
          listPrice: qxoData.listPrice,
          discount: qxoData.discount || 0,
          branch: qxoData.branch || branch || 'DEFAULT',
          availability: qxoData.available || false,
          leadTime: qxoData.leadTimeDays,
          minOrderQty: qxoData.minimumOrderQuantity,
          lastUpdated: new Date().toISOString()
        }

        results.push(pricingResult)

        // Cache the pricing data
        try {
          // Find the product and vendor IDs
          const { data: product } = await supabase
            .from('products')
            .select('id')
            .eq('sku', targetSku)
            .single()

          const { data: vendor } = await supabase
            .from('vendors')
            .select('id')
            .eq('vendor_code', 'QXO')
            .single()

          if (product && vendor && pricingResult.price > 0) {
            // Upsert to price_cache
            await supabase
              .from('price_cache')
              .upsert({
                product_id: product.id,
                vendor_id: vendor.id,
                branch_code: pricingResult.branch,
                price: pricingResult.price,
                list_price: pricingResult.listPrice,
                discount_percent: pricingResult.discount,
                source: 'api',
                seen_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), // 6 hours
                metadata: {
                  availability: pricingResult.availability,
                  leadTime: pricingResult.leadTime,
                  minOrderQty: pricingResult.minOrderQty,
                  qxo_response: qxoData
                }
              }, {
                onConflict: 'tenant_id,vendor_id,product_id,branch_code'
              })

            console.log(`Cached pricing for ${targetSku}:`, pricingResult.price)
          }
        } catch (cacheError) {
          console.error(`Error caching pricing for ${targetSku}:`, cacheError)
          // Don't fail the whole request if caching fails
        }

      } catch (error) {
        console.error(`Error processing SKU ${targetSku}:`, error)
        errors.push(`Error processing ${targetSku}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Return results
    const response = {
      success: true,
      results,
      errors: errors.length > 0 ? errors : undefined,
      cached: !refresh,
      timestamp: new Date().toISOString()
    }

    console.log('QXO pricing response:', response)

    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('QXO pricing function error:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})