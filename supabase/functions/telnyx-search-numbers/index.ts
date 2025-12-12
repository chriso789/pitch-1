import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
    if (!TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY not configured');
    }

    const { areaCode, country = 'US', limit = 10 } = await req.json();

    if (!areaCode || areaCode.length !== 3) {
      throw new Error('Valid 3-digit area code required');
    }

    console.log(`Searching for numbers in area code ${areaCode}`);

    // Search for available phone numbers via Telnyx API
    const searchParams = new URLSearchParams({
      'filter[phone_number][starts_with]': `+1${areaCode}`,
      'filter[country_code]': country,
      'filter[features]': 'sms,voice',
      'filter[limit]': limit.toString(),
    });

    const response = await fetch(
      `https://api.telnyx.com/v2/available_phone_numbers?${searchParams}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telnyx API error:', response.status, errorText);
      throw new Error(`Telnyx API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Format the response for easier consumption
    const availableNumbers = data.data?.map((num: any) => ({
      phoneNumber: num.phone_number,
      formatted: formatPhoneNumber(num.phone_number),
      locality: num.locality || '',
      region: num.region_information?.[0]?.region_name || '',
      features: num.features || [],
      monthlyRate: num.cost_information?.monthly_cost || 'N/A',
      upfrontCost: num.cost_information?.upfront_cost || 0,
    })) || [];

    console.log(`Found ${availableNumbers.length} available numbers`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        numbers: availableNumbers,
        areaCode,
        totalFound: availableNumbers.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Search numbers error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function formatPhoneNumber(phone: string): string {
  // Convert +15551234567 to (555) 123-4567
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    const areaCode = cleaned.slice(1, 4);
    const middle = cleaned.slice(4, 7);
    const last = cleaned.slice(7);
    return `(${areaCode}) ${middle}-${last}`;
  }
  return phone;
}
