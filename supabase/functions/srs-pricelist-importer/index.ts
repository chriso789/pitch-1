import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface SRSPricelistItem {
  category: string;
  brand?: string;
  product: string;
  item_code: string;
  unit_of_measure: string;
  unit_cost: number;
  metadata?: Record<string, any>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Get tenant_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile) {
      throw new Error('Profile not found');
    }

    const tenant_id = profile.tenant_id;

    // Parse request body
    const { items, vendor_id, effective_date } = await req.json() as {
      items: SRSPricelistItem[];
      vendor_id: string;
      effective_date?: string;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Items array is required');
    }

    if (!vendor_id) {
      throw new Error('vendor_id is required');
    }

    const effectiveDate = effective_date || new Date().toISOString().split('T')[0];

    console.log(`Importing ${items.length} SRS pricelist items for tenant ${tenant_id}`);

    // Prepare supplier_pricebooks records
    const pricebookRecords = items.map(item => ({
      tenant_id,
      supplier_name: 'SRS Distribution',
      item_code: item.item_code,
      item_description: item.product,
      category: item.category,
      unit_of_measure: item.unit_of_measure,
      unit_cost: item.unit_cost,
      markup_percent: 0, // Can be configured later
      effective_date: effectiveDate,
      is_active: true,
      metadata: {
        brand: item.brand,
        ...item.metadata
      },
      imported_at: new Date().toISOString()
    }));

    // Bulk insert into supplier_pricebooks
    const { data: insertedPricebooks, error: pricebookError } = await supabase
      .from('supplier_pricebooks')
      .upsert(pricebookRecords, {
        onConflict: 'tenant_id,supplier_name,item_code',
        ignoreDuplicates: false
      })
      .select();

    if (pricebookError) {
      console.error('Error inserting pricebooks:', pricebookError);
      throw pricebookError;
    }

    console.log(`Inserted ${insertedPricebooks?.length || 0} pricebook records`);

    // Create or update products for commonly used items
    const productRecords = items.map(item => ({
      tenant_id,
      sku: item.item_code,
      name: item.product,
      description: `${item.brand || ''} ${item.product}`.trim(),
      category: item.category,
      unit_of_measure: item.unit_of_measure,
      manufacturer: item.brand || 'Multiple',
      srs_item_code: item.item_code,
      vendor_id,
      specifications: {
        brand: item.brand,
        unit_cost: item.unit_cost,
        ...item.metadata
      },
      is_active: true,
      created_by: user.id
    }));

    const { data: insertedProducts, error: productError } = await supabase
      .from('products')
      .upsert(productRecords, {
        onConflict: 'tenant_id,sku',
        ignoreDuplicates: false
      })
      .select();

    if (productError) {
      console.error('Error inserting products:', productError);
      // Don't throw - pricebook is more important
    }

    console.log(`Inserted ${insertedProducts?.length || 0} product records`);

    // Update price_cache
    const cacheRecords = items.map(item => ({
      tenant_id,
      sku: item.item_code,
      vendor_id,
      branch: 'SRS-FL',
      unit_cost: item.unit_cost,
      unit_of_measure: item.unit_of_measure,
      available_quantity: 999999, // Assume available
      metadata: {
        source: 'srs_pricelist_import',
        category: item.category,
        brand: item.brand
      }
    }));

    const { error: cacheError } = await supabase
      .from('price_cache')
      .upsert(cacheRecords, {
        onConflict: 'tenant_id,sku,vendor_id,branch',
        ignoreDuplicates: false
      });

    if (cacheError) {
      console.error('Error updating price cache:', cacheError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Imported ${items.length} SRS pricelist items`,
        pricebook_count: insertedPricebooks?.length || 0,
        product_count: insertedProducts?.length || 0
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
  } catch (error) {
    console.error('Error in srs-pricelist-importer:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});
