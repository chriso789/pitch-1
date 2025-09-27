import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SRSPricingRequest {
  sku?: string
  branch?: string
  skus?: string[]
  refresh?: boolean
}

interface SRSPricingResponse {
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

    const { sku, branch, skus, refresh } = await req.json() as SRSPricingRequest

    console.log('SRS/Sunilland Pricing request:', { sku, branch, skus, refresh })

    // Get SRS API credentials from secrets
    const srsApiKey = Deno.env.get('SRS_API_KEY')
    const srsBaseUrl = Deno.env.get('SRS_BASE_URL') || 'https://api.srs.com/v1'
    const srsAccountNumber = Deno.env.get('SRS_ACCOUNT_NUMBER')

    if (!srsApiKey || !srsAccountNumber) {
      throw new Error('SRS API credentials not configured')
    }

    // Determine which SKUs to fetch
    const targetSkus = skus || (sku ? [sku] : [])
    if (targetSkus.length === 0) {
      throw new Error('No SKUs specified for pricing lookup')
    }

    const results: SRSPricingResponse[] = []
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
            .eq('vendors.vendor_code', 'SRS')
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

        // Fetch live pricing from SRS API
        const srsResponse = await fetch(`${srsBaseUrl}/pricing`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${srsApiKey}`,
            'Content-Type': 'application/json',
            'X-Customer-Number': srsAccountNumber
          },
          body: JSON.stringify({
            productSku: targetSku,
            locationCode: branch || 'DEFAULT',
            includeAvailability: true,
            includeLeadTime: true
          })
        })

        if (!srsResponse.ok) {
          const errorText = await srsResponse.text()
          console.error(`SRS API error for SKU ${targetSku}:`, errorText)
          errors.push(`SRS API error for ${targetSku}: ${srsResponse.status}`)
          continue
        }

        const srsData = await srsResponse.json()
        console.log(`SRS response for ${targetSku}:`, srsData)

        // Transform SRS response to our format
        const pricingResult: SRSPricingResponse = {
          sku: targetSku,
          price: srsData.contractPrice || srsData.price || 0,
          listPrice: srsData.listPrice,
          discount: srsData.discountPercent || 0,
          branch: srsData.locationCode || branch || 'DEFAULT',
          availability: srsData.available || false,
          leadTime: srsData.leadTimeDays,
          minOrderQty: srsData.minimumOrderQuantity || 1,
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
            .eq('vendor_code', 'SRS')
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
                  srs_response: srsData
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

    console.log('SRS pricing response:', response)

    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('SRS pricing function error:', error)

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