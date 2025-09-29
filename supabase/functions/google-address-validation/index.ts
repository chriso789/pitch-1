import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from '../_shared/cors.ts';

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');

interface AddressValidationRequest {
  address: string;
  previousResponseId?: string;
  enableUspsCass?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!GOOGLE_MAPS_API_KEY) {
      throw new Error('Google Maps API key not configured');
    }

    const { address, previousResponseId, enableUspsCass = false }: AddressValidationRequest = await req.json();

    if (!address) {
      return new Response(
        JSON.stringify({ error: 'Address is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Call Google Address Validation API
    const validationUrl = 'https://addressvalidation.googleapis.com/v1:validateAddress';
    
    const requestBody = {
      address: {
        regionCode: 'US',
        locality: '',
        administrativeArea: '',
        postalCode: '',
        addressLines: [address]
      },
      previousResponseId,
      enableUspsCass
    };

    const response = await fetch(`${validationUrl}?key=${GOOGLE_MAPS_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Google API Error:', errorData);
      throw new Error(`Google API error: ${response.status}`);
    }

    const data = await response.json();

    // Parse and structure the validation result
    const result = {
      result: data.result || {},
      responseId: data.responseId || null,
      validation: {
        isValid: data.result?.verdict?.addressComplete || false,
        hasUnconfirmedComponents: data.result?.verdict?.hasUnconfirmedComponents || false,
        hasInferredComponents: data.result?.verdict?.hasInferredComponents || false,
        hasReplacedComponents: data.result?.verdict?.hasReplacedComponents || false,
        geocodeGranularity: data.result?.verdict?.geocodeGranularity || 'UNKNOWN',
        validationGranularity: data.result?.verdict?.validationGranularity || 'UNKNOWN',
      },
      address: data.result?.address || {},
      geocode: data.result?.geocode || {},
      metadata: data.result?.metadata || {},
      uspsData: data.result?.uspsData || null
    };

    return new Response(
      JSON.stringify(result),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Address validation error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Address validation failed',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});