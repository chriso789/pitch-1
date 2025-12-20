import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
const TELNYX_CONNECTION_ID = Deno.env.get('TELNYX_CONNECTION_ID');
const TELNYX_SMS_PROFILE_ID = Deno.env.get('TELNYX_SMS_PROFILE_ID');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface SearchRequest {
  action: 'search';
  areaCode: string;
  zipCode?: string;
  country?: string;
  limit?: number;
  features?: string[];
}

interface PurchaseRequest {
  action: 'purchase';
  phoneNumber: string;
  locationId: string;
  tenantId: string;
  setAsDefault?: boolean;
  label?: string;
}

interface ConfigureRequest {
  action: 'configure';
  phoneNumber: string;
  locationId?: string;
  tenantId: string;
}

interface ReleaseRequest {
  action: 'release';
  phoneNumber: string;
  tenantId: string;
}

type RequestBody = SearchRequest | PurchaseRequest | ConfigureRequest | ReleaseRequest;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY not configured');
    }

    const body: RequestBody = await req.json();
    console.log('📞 Location Phone Provision - Action:', body.action, body);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    switch (body.action) {
      case 'search':
        return await handleSearch(body);
      case 'purchase':
        return await handlePurchase(body, supabase);
      case 'configure':
        return await handleConfigure(body, supabase);
      case 'release':
        return await handleRelease(body, supabase);
      default:
        throw new Error(`Unknown action: ${(body as any).action}`);
    }
  } catch (error: any) {
    console.error('❌ Location Phone Provision Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================
// ZIP CODE TO AREA CODE MAPPING (most accurate)
// ============================================
const ZIP_TO_AREA_CODE: Record<string, string> = {
  // East Coast - Boca Raton / Palm Beach area (561)
  '33431': '561', '33432': '561', '33433': '561', '33434': '561', '33486': '561',
  '33487': '561', '33496': '561', '33498': '561', '33428': '561', '33444': '561',
  // West Coast - North Port / Sarasota area (941 - NOT 239!)
  '34286': '941', '34287': '941', '34288': '941', '34289': '941',
  '34229': '941', '34230': '941', '34231': '941', '34232': '941', '34233': '941',
  '34234': '941', '34235': '941', '34236': '941', '34237': '941', '34238': '941',
  // Naples / Fort Myers area (actual 239 territory)
  '34101': '239', '34102': '239', '34103': '239', '34104': '239', '34105': '239',
  '33901': '239', '33902': '239', '33903': '239', '33904': '239', '33905': '239',
};

// ============================================
// FLORIDA FALLBACK AREA CODES (same coast only)
// ============================================
const FLORIDA_FALLBACK_AREA_CODES: Record<string, string[]> = {
  // East Coast Florida - stay on east coast
  '561': ['561', '954', '772', '305', '786'],  // Palm Beach → Broward → Treasure Coast → Miami
  // West Coast Florida - Sarasota/North Port region (941)
  '941': ['941', '239', '727', '813'],  // Sarasota → Naples → Clearwater → Tampa
  // Naples/Fort Myers (239)
  '239': ['239', '941', '727', '813'],  // Naples → Sarasota → Clearwater → Tampa
};

// Catchy number patterns to prioritize (7663 = ROOF)
const CATCHY_PATTERNS = ['7663', '7665', '2255', '0000', '1111', '2222', '7777', '8888'];

// ============================================
// SEARCH - Find available phone numbers with fallback
// ============================================
async function handleSearch(request: SearchRequest): Promise<Response> {
  const { areaCode, zipCode, country = 'US', limit = 20, features = ['sms'] } = request;

  console.log('🔍 Searching for numbers:', { areaCode, zipCode, country, limit, features });

  // Priority 1: Use ZIP code mapping if available (most accurate)
  let effectiveAreaCode = areaCode;
  if (zipCode && ZIP_TO_AREA_CODE[zipCode]) {
    effectiveAreaCode = ZIP_TO_AREA_CODE[zipCode];
    console.log(`📍 ZIP ${zipCode} mapped to area code ${effectiveAreaCode}`);
  }

  if (!effectiveAreaCode || effectiveAreaCode.length !== 3) {
    throw new Error('Area code must be exactly 3 digits');
  }

  // Get fallback area codes for this region (same coast only)
  const areaCodesToTry = FLORIDA_FALLBACK_AREA_CODES[effectiveAreaCode] || [effectiveAreaCode];
  console.log('📍 Area codes to try:', areaCodesToTry);

  let allNumbers: any[] = [];
  let successfulAreaCode = '';

  // Try each area code until we find numbers
  for (const tryAreaCode of areaCodesToTry) {
    console.log(`🔎 Trying area code: ${tryAreaCode}`);
    
    const params = new URLSearchParams({
      'filter[phone_number][starts_with]': `+1${tryAreaCode}`,
      'filter[country_code]': country,
      'filter[limit]': limit.toString(),
      'filter[best_effort]': 'true'
    });

    // Only add features filter if specified (sms is more widely available)
    if (features.length > 0) {
      params.set('filter[features]', features.join(','));
    }

    const searchUrl = `https://api.telnyx.com/v2/available_phone_numbers?${params}`;
    console.log('Telnyx search URL:', searchUrl);

    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️ Search failed for ${tryAreaCode}:`, response.status, errorText);
      continue; // Try next area code
    }

    const data = await response.json();
    const foundNumbers = data.data || [];
    console.log(`✅ Found ${foundNumbers.length} numbers in area code ${tryAreaCode}`);

    if (foundNumbers.length > 0) {
      allNumbers = foundNumbers;
      successfulAreaCode = tryAreaCode;
      break; // Found numbers, stop searching
    }
  }

  // If still no numbers, try a broader search without area code filter
  if (allNumbers.length === 0) {
    console.log('🌐 Trying broader Florida search...');
    const broadParams = new URLSearchParams({
      'filter[country_code]': 'US',
      'filter[administrative_area]': 'FL',
      'filter[features]': 'sms',
      'filter[limit]': limit.toString(),
      'filter[best_effort]': 'true'
    });

    const broadResponse = await fetch(
      `https://api.telnyx.com/v2/available_phone_numbers?${broadParams}`,
      {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (broadResponse.ok) {
      const broadData = await broadResponse.json();
      allNumbers = broadData.data || [];
      successfulAreaCode = 'FL-ANY';
      console.log(`✅ Broad search found ${allNumbers.length} Florida numbers`);
    }
  }

  // Sort numbers to prioritize catchy patterns
  const sortedNumbers = sortByCatchiness(allNumbers);

  // Format the results to match the frontend AvailableNumber interface
  const numbers = sortedNumbers.map((num: any) => ({
    phone_number: num.phone_number,
    formatted: formatPhoneNumber(num.phone_number),
    locality: num.region_information?.[0]?.rate_center || 'Unknown',
    region: num.region_information?.[0]?.region_name || 'Florida',
    monthly_cost: num.cost_information?.monthly_cost || 'N/A',
    features: num.features || [],
  }));

  return new Response(
    JSON.stringify({ 
      success: true, 
      areaCode,
      searchedAreaCode: successfulAreaCode || areaCode,
      triedAreaCodes: areaCodesToTry,
      count: numbers.length,
      numbers 
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================
// HELPER: Check if number contains catchy pattern
// ============================================
function isCatchyNumber(phone: string): boolean {
  const digits = phone.replace(/\D/g, '').slice(-4); // Last 4 digits
  return CATCHY_PATTERNS.some(pattern => digits.includes(pattern)) ||
         /(\d)\1{2,}/.test(digits); // Repeating digits like 7777
}

// ============================================
// HELPER: Sort numbers by catchiness
// ============================================
function sortByCatchiness(numbers: any[]): any[] {
  return [...numbers].sort((a, b) => {
    const aDigits = a.phone_number.replace(/\D/g, '');
    const bDigits = b.phone_number.replace(/\D/g, '');
    
    // Prioritize 7663 (ROOF)
    const aHasROOF = aDigits.includes('7663');
    const bHasROOF = bDigits.includes('7663');
    if (aHasROOF && !bHasROOF) return -1;
    if (bHasROOF && !aHasROOF) return 1;

    // Then other catchy patterns
    const aCatchy = isCatchyNumber(a.phone_number);
    const bCatchy = isCatchyNumber(b.phone_number);
    if (aCatchy && !bCatchy) return -1;
    if (bCatchy && !aCatchy) return 1;

    // Then by repeating digits
    const aRepeats = (aDigits.match(/(\d)\1+/g) || []).join('').length;
    const bRepeats = (bDigits.match(/(\d)\1+/g) || []).join('').length;
    return bRepeats - aRepeats;
  });
}

// ============================================
// PURCHASE - Order and configure a number
// ============================================
async function handlePurchase(request: PurchaseRequest, supabase: any): Promise<Response> {
  const { phoneNumber, locationId, tenantId, setAsDefault = false, label } = request;

  console.log('💳 Purchasing number:', { phoneNumber, locationId, tenantId, setAsDefault });

  // Step 1: Build order payload - messaging_profile_id omitted (can be configured after purchase)
  const orderPayload: Record<string, any> = {
    phone_numbers: [{ phone_number: phoneNumber }],
    customer_reference: `loc_${locationId}_tenant_${tenantId}`
  };

  // Only include connection_id if set and valid
  if (TELNYX_CONNECTION_ID && TELNYX_CONNECTION_ID.length > 5) {
    orderPayload.connection_id = TELNYX_CONNECTION_ID;
  }

  // NOTE: messaging_profile_id intentionally omitted - Telnyx rejects invalid IDs
  // SMS messaging can be configured separately after the number is purchased

  console.log('📦 Order payload:', JSON.stringify(orderPayload, null, 2));

  const orderResponse = await fetch('https://api.telnyx.com/v2/number_orders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(orderPayload)
  });

  if (!orderResponse.ok) {
    const errorText = await orderResponse.text();
    console.error('Telnyx order failed:', orderResponse.status, errorText);
    throw new Error(`Failed to order number: ${errorText}`);
  }

  const orderData = await orderResponse.json();
  console.log('📋 Order created:', orderData.data?.id);

  // Step 2: Wait briefly for order to process
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 3: Configure the number with webhooks
  const configResult = await configureNumber(phoneNumber);
  console.log('⚙️ Number configured:', configResult);

  // Step 4: Update the location in database
  const { data: locationData, error: locationError } = await supabase
    .from('locations')
    .update({
      telnyx_phone_number: phoneNumber,
      phone_porting_status: 'active',
      updated_at: new Date().toISOString()
    })
    .eq('id', locationId)
    .select()
    .single();

  if (locationError) {
    console.error('Failed to update location:', locationError);
    throw new Error(`Number purchased but failed to update location: ${locationError.message}`);
  }

  console.log('✅ Location updated:', locationData.name);

  // Step 5: Optionally set as default
  if (setAsDefault) {
    const { error: prefError } = await supabase
      .from('communication_preferences')
      .upsert({
        tenant_id: tenantId,
        sms_from_number: phoneNumber,
        updated_at: new Date().toISOString()
      }, { onConflict: 'tenant_id' });

    if (prefError) {
      console.warn('Failed to set as default:', prefError);
    } else {
      console.log('📌 Set as default tenant number');
    }
  }

  // Step 6: Log the activity
  await supabase.from('call_activity_log').insert({
    tenant_id: tenantId,
    location_id: locationId,
    from_number: phoneNumber,
    to_number: phoneNumber,
    activity: 'phone_number_provisioned',
    status: 'completed',
    metadata: {
      order_id: orderData.data?.id,
      set_as_default: setAsDefault,
      label: label || null,
      configured: configResult.success
    }
  });

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Phone number purchased and configured successfully',
      phoneNumber,
      formatted: formatPhoneNumber(phoneNumber),
      orderId: orderData.data?.id,
      location: {
        id: locationId,
        name: locationData.name
      },
      setAsDefault,
      configResult
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================
// CONFIGURE - Set up webhooks and profiles
// ============================================
async function handleConfigure(request: ConfigureRequest, supabase: any): Promise<Response> {
  const { phoneNumber, locationId, tenantId } = request;

  console.log('⚙️ Configuring number:', phoneNumber);

  const configResult = await configureNumber(phoneNumber);

  if (locationId) {
    await supabase
      .from('locations')
      .update({ 
        phone_porting_status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', locationId);
  }

  // Log the activity
  await supabase.from('call_activity_log').insert({
    tenant_id: tenantId,
    location_id: locationId || null,
    from_number: phoneNumber,
    to_number: phoneNumber,
    activity: 'phone_number_configured',
    status: configResult.success ? 'completed' : 'failed',
    metadata: configResult
  });

  return new Response(
    JSON.stringify({
      success: configResult.success,
      message: configResult.success ? 'Number configured successfully' : 'Configuration failed',
      phoneNumber,
      details: configResult
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================
// RELEASE - Remove a number from account
// ============================================
async function handleRelease(request: ReleaseRequest, supabase: any): Promise<Response> {
  const { phoneNumber, tenantId } = request;

  console.log('🗑️ Releasing number:', phoneNumber);

  // First, get the phone number ID from Telnyx
  const listResponse = await fetch(
    `https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}`,
    {
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!listResponse.ok) {
    throw new Error('Failed to find number in Telnyx account');
  }

  const listData = await listResponse.json();
  const numberRecord = listData.data?.[0];

  if (!numberRecord) {
    throw new Error('Number not found in Telnyx account');
  }

  // Delete the number
  const deleteResponse = await fetch(
    `https://api.telnyx.com/v2/phone_numbers/${numberRecord.id}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!deleteResponse.ok) {
    const errorText = await deleteResponse.text();
    throw new Error(`Failed to release number: ${errorText}`);
  }

  // Clear the number from any locations
  await supabase
    .from('locations')
    .update({ 
      telnyx_phone_number: null,
      phone_porting_status: null,
      updated_at: new Date().toISOString()
    })
    .eq('telnyx_phone_number', phoneNumber);

  // Log the activity
  await supabase.from('call_activity_log').insert({
    tenant_id: tenantId,
    from_number: phoneNumber,
    to_number: phoneNumber,
    activity: 'phone_number_released',
    status: 'completed',
    metadata: { telnyx_id: numberRecord.id }
  });

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Phone number released successfully',
      phoneNumber
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================
// HELPER: Configure a number with Telnyx
// ============================================
async function configureNumber(phoneNumber: string): Promise<{ success: boolean; error?: string; details?: any }> {
  try {
    // Get the phone number record from Telnyx
    const listResponse = await fetch(
      `https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}`,
      {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      return { success: false, error: `Failed to find number: ${errorText}` };
    }

    const listData = await listResponse.json();
    const numberRecord = listData.data?.[0];

    if (!numberRecord) {
      return { success: false, error: 'Number not found in account' };
    }

    console.log('Found number record:', numberRecord.id);

    // Update the number configuration
    const updatePayload: any = {
      connection_id: TELNYX_CONNECTION_ID,
      tags: ['pitch-crm', 'auto-provisioned']
    };

    // Only add messaging_profile_id if we have one
    if (TELNYX_SMS_PROFILE_ID) {
      updatePayload.messaging_profile_id = TELNYX_SMS_PROFILE_ID;
    }

    const updateResponse = await fetch(
      `https://api.telnyx.com/v2/phone_numbers/${numberRecord.id}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      return { success: false, error: `Failed to update number: ${errorText}` };
    }

    const updateData = await updateResponse.json();
    console.log('✅ Number updated:', updateData.data?.id);

    return { 
      success: true, 
      details: {
        id: updateData.data?.id,
        phoneNumber: updateData.data?.phone_number,
        connectionId: updateData.data?.connection_id,
        messagingProfileId: updateData.data?.messaging_profile_id,
        status: updateData.data?.status
      }
    };
  } catch (error: any) {
    console.error('Configuration error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// HELPER: Format phone number for display
// ============================================
function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10) {
    return `+1 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}
