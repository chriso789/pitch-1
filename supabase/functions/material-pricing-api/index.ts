import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PricingRequest {
  sku?: string
  skus?: string[]
  branch?: string
  vendors?: string[]
  refresh?: boolean
}

interface PricingResponse {
  sku: string
  vendor: string
  price: number
  listPrice?: number
  discount?: number
  branch: string
  availability: boolean
  leadTime?: number
  minOrderQty?: number
  lastUpdated: string
  source: string
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

    if (req.method === 'GET') {
      // GET /pricing?sku=ABC123&branch=DEFAULT
      const url = new URL(req.url)
      const sku = url.searchParams.get('sku')
      const branch = url.searchParams.get('branch') || 'DEFAULT'
      const vendor = url.searchParams.get('vendor')

      if (!sku) {
        return new Response(
          JSON.stringify({ error: 'SKU parameter is required' }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
          }
        )
      }

      // Query price cache
      let query = supabase
        .from('price_cache')
        .select(`
          *,
          products!inner (sku, name, unit_of_measure),
          vendors!inner (name, vendor_code)
        `)
        .eq('products.sku', sku)
        .eq('branch_code', branch)
        .order('seen_at', { ascending: false })

      if (vendor) {
        query = query.eq('vendors.vendor_code', vendor)
      }

      const { data: pricingData, error } = await query

      if (error) {
        throw error
      }

      // Transform to API response format
      const results: PricingResponse[] = (pricingData || []).map(item => ({
        sku: item.products.sku,
        vendor: item.vendors.vendor_code,
        price: item.price,
        listPrice: item.list_price,
        discount: item.discount_percent,
        branch: item.branch_code,
        availability: item.metadata?.availability || true,
        leadTime: item.metadata?.leadTime,
        minOrderQty: item.metadata?.minOrderQty,
        lastUpdated: item.seen_at,
        source: item.source
      }))

      return new Response(
        JSON.stringify({
          success: true,
          sku,
          branch,
          results,
          count: results.length,
          timestamp: new Date().toISOString()
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    if (req.method === 'POST') {
      // POST for bulk operations or refresh
      const body = await req.json() as PricingRequest
      const { sku, skus, branch, vendors, refresh } = body

      const targetSkus = skus || (sku ? [sku] : [])
      if (targetSkus.length === 0) {
        return new Response(
          JSON.stringify({ error: 'At least one SKU must be specified' }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
          }
        )
      }

      const results: PricingResponse[] = []
      const errors: string[] = []

      if (refresh) {
        // Call vendor APIs to refresh pricing
        const refreshPromises = []

        // Refresh QXO pricing if available
        if (!vendors || vendors.includes('QXO')) {
          refreshPromises.push(
            supabase.functions.invoke('qxo-pricing', {
              body: { skus: targetSkus, branch, refresh: true }
            })
          )
        }

        // Refresh Billtrust pricing if available
        if (!vendors || vendors.includes('BILLTRUST')) {
          refreshPromises.push(
            supabase.functions.invoke('billtrust-pricing', {
              body: { products: targetSkus, branchCode: branch }
            })
          )
        }

        // Wait for all refresh operations
        const refreshResults = await Promise.allSettled(refreshPromises)
        refreshResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error(`Refresh failed for vendor ${index}:`, result.reason)
            errors.push(`Vendor refresh failed: ${result.reason}`)
          }
        })

        // Small delay to allow cache updates to propagate
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      // Query updated pricing data
      let query = supabase
        .from('price_cache')
        .select(`
          *,
          products!inner (sku, name, unit_of_measure),
          vendors!inner (name, vendor_code)
        `)
        .in('products.sku', targetSkus)
        .order('seen_at', { ascending: false })

      if (branch) {
        query = query.eq('branch_code', branch)
      }

      if (vendors && vendors.length > 0) {
        query = query.in('vendors.vendor_code', vendors)
      }

      const { data: pricingData, error } = await query

      if (error) {
        throw error
      }

      // Transform results
      const transformedResults: PricingResponse[] = (pricingData || []).map(item => ({
        sku: item.products.sku,
        vendor: item.vendors.vendor_code,
        price: item.price,
        listPrice: item.list_price,
        discount: item.discount_percent,
        branch: item.branch_code,
        availability: item.metadata?.availability || true,
        leadTime: item.metadata?.leadTime,
        minOrderQty: item.metadata?.minOrderQty,
        lastUpdated: item.seen_at,
        source: item.source
      }))

      return new Response(
        JSON.stringify({
          success: true,
          skus: targetSkus,
          branch,
          vendors,
          refreshed: refresh || false,
          results: transformedResults,
          count: transformedResults.length,
          errors: errors.length > 0 ? errors : undefined,
          timestamp: new Date().toISOString()
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 405,
      }
    )

  } catch (error) {
    console.error('Material pricing API error:', error)

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