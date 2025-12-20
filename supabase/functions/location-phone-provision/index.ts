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
// SEARCH - Find available phone numbers
// ============================================
async function handleSearch(request: SearchRequest): Promise<Response> {
  const { areaCode, country = 'US', limit = 10, features = ['sms', 'voice'] } = request;

  console.log('🔍 Searching for numbers:', { areaCode, country, limit, features });

  if (!areaCode || areaCode.length !== 3) {
    throw new Error('Area code must be exactly 3 digits');
  }

  // Build Telnyx search URL
  const params = new URLSearchParams({
    'filter[phone_number][starts_with]': `1${areaCode}`,
    'filter[country_code]': country,
    'filter[features]': features.join(','),
    'filter[limit]': limit.toString(),
    'filter[best_effort]': 'true'
  });

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
    console.error('Telnyx search failed:', response.status, errorText);
    throw new Error(`Telnyx search failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('✅ Found', data.data?.length || 0, 'available numbers');

  // Format the results nicely
  const numbers = (data.data || []).map((num: any) => ({
    phoneNumber: num.phone_number,
    formatted: formatPhoneNumber(num.phone_number),
    region: num.region_information?.[0]?.region_name || 'Unknown',
    city: num.region_information?.[0]?.rate_center || 'Unknown',
    features: num.features || [],
    monthlyRate: num.cost_information?.monthly_cost || 'N/A',
    upfrontCost: num.cost_information?.upfront_cost || 'N/A',
    reservable: num.reservable || false
  }));

  return new Response(
    JSON.stringify({ 
      success: true, 
      areaCode,
      count: numbers.length,
      numbers 
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================
// PURCHASE - Order and configure a number
// ============================================
async function handlePurchase(request: PurchaseRequest, supabase: any): Promise<Response> {
  const { phoneNumber, locationId, tenantId, setAsDefault = false, label } = request;

  console.log('💳 Purchasing number:', { phoneNumber, locationId, tenantId, setAsDefault });

  // Step 1: Order the number
  const orderResponse = await fetch('https://api.telnyx.com/v2/number_orders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      phone_numbers: [{ phone_number: phoneNumber }],
      connection_id: TELNYX_CONNECTION_ID,
      messaging_profile_id: TELNYX_SMS_PROFILE_ID,
      customer_reference: `loc_${locationId}_tenant_${tenantId}`
    })
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
