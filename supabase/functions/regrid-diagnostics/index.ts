import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DiagnosticResult {
  endpoint: string;
  status: number;
  success: boolean;
  responseTime: number;
  error?: string;
  data?: any;
}

interface RegridDiagnostics {
  apiKey: {
    present: boolean;
    prefix: string;
  };
  endpoints: DiagnosticResult[];
  accountInfo?: {
    tier?: string;
    hasNationwideAccess?: boolean;
    hasBuildingFootprints?: boolean;
  };
  recommendations: string[];
}

// Test addresses for nationwide coverage check
const TEST_ADDRESSES = [
  { name: "Texas", lat: 29.7604, lng: -95.3698, address: "1600 Smith St, Houston, TX" },
  { name: "California", lat: 34.0522, lng: -118.2437, address: "200 N Spring St, Los Angeles, CA" },
  { name: "New York", lat: 40.7128, lng: -74.0060, address: "1 Centre St, New York, NY" },
  { name: "Florida", lat: 25.7617, lng: -80.1918, address: "111 NW 1st St, Miami, FL" },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const REGRID_API_KEY = Deno.env.get('REGRID_API_KEY');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Verify authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Missing authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log('[Regrid Diagnostics] Running diagnostics...');

  const diagnostics: RegridDiagnostics = {
    apiKey: {
      present: !!REGRID_API_KEY,
      prefix: REGRID_API_KEY ? `${REGRID_API_KEY.substring(0, 8)}...` : 'NOT SET',
    },
    endpoints: [],
    recommendations: [],
  };

  if (!REGRID_API_KEY) {
    diagnostics.recommendations.push('CRITICAL: REGRID_API_KEY is not set in environment variables');
    return new Response(
      JSON.stringify({ success: true, diagnostics }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Test API endpoints with first test address
  const testLat = TEST_ADDRESSES[0].lat;
  const testLng = TEST_ADDRESSES[0].lng;
  const testAddress = TEST_ADDRESSES[0].address;

  // Test 1: v2 API point lookup
  const v2PointResult = await testEndpoint(
    `https://app.regrid.com/api/v2/parcels/point?lat=${testLat}&lon=${testLng}&return_geometry=true`,
    REGRID_API_KEY,
    'v2 Point Lookup'
  );
  diagnostics.endpoints.push(v2PointResult);

  // Test 2: v1 API point lookup
  const v1PointResult = await testEndpoint(
    `https://app.regrid.com/api/v1/parcel/point/${testLng}/${testLat}`,
    REGRID_API_KEY,
    'v1 Point Lookup'
  );
  diagnostics.endpoints.push(v1PointResult);

  // Test 3: v2 address search
  const encodedAddress = encodeURIComponent(testAddress);
  const addressResult = await testEndpoint(
    `https://app.regrid.com/api/v2/parcels/address?query=${encodedAddress}&return_geometry=true`,
    REGRID_API_KEY,
    'v2 Address Search'
  );
  diagnostics.endpoints.push(addressResult);

  // Test 4: Account info endpoint
  const accountResult = await testEndpoint(
    'https://app.regrid.com/api/v2/account',
    REGRID_API_KEY,
    'Account Info'
  );
  diagnostics.endpoints.push(accountResult);

  // Parse account info if available
  if (accountResult.success && accountResult.data) {
    diagnostics.accountInfo = {
      tier: accountResult.data.tier || accountResult.data.plan || 'unknown',
      hasNationwideAccess: accountResult.data.nationwide_access || accountResult.data.coverage === 'nationwide',
      hasBuildingFootprints: accountResult.data.add_ons?.includes('building_footprints') || false,
    };
  }

  // Test nationwide coverage
  console.log('[Regrid Diagnostics] Testing nationwide coverage...');
  let successfulStates = 0;
  for (const addr of TEST_ADDRESSES) {
    const result = await testEndpoint(
      `https://app.regrid.com/api/v2/parcels/point?lat=${addr.lat}&lon=${addr.lng}&return_geometry=true`,
      REGRID_API_KEY,
      `Coverage: ${addr.name}`
    );
    diagnostics.endpoints.push(result);
    if (result.success) successfulStates++;
  }

  // Generate recommendations
  if (!v2PointResult.success && !v1PointResult.success) {
    diagnostics.recommendations.push('ERROR: Both v1 and v2 API endpoints are failing. Check API key validity.');
  }

  if (v2PointResult.status === 403 || v1PointResult.status === 403) {
    diagnostics.recommendations.push('API key may have insufficient permissions. Contact Regrid to verify account tier.');
  }

  if (successfulStates < TEST_ADDRESSES.length) {
    diagnostics.recommendations.push(
      `Limited coverage detected: Only ${successfulStates}/${TEST_ADDRESSES.length} test locations returned data. ` +
      'Your Regrid account may be limited to specific regions. Consider upgrading to nationwide access.'
    );
  }

  if (!diagnostics.accountInfo?.hasBuildingFootprints) {
    diagnostics.recommendations.push(
      'Building Footprints add-on may not be enabled. This provides higher-quality building outlines. ' +
      'Contact Regrid to inquire about adding this feature.'
    );
  }

  if (diagnostics.recommendations.length === 0) {
    diagnostics.recommendations.push('✅ Regrid API appears to be working correctly with nationwide coverage.');
  }

  console.log('[Regrid Diagnostics] Complete:', JSON.stringify(diagnostics.recommendations));

  return new Response(
    JSON.stringify({ success: true, diagnostics }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});

async function testEndpoint(url: string, apiKey: string, name: string): Promise<DiagnosticResult> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    const responseTime = Date.now() - startTime;
    
    let data = null;
    try {
      const text = await response.text();
      data = JSON.parse(text);
    } catch {
      // Response may not be JSON
    }

    console.log(`[Regrid] ${name}: ${response.status} (${responseTime}ms)`);

    return {
      endpoint: name,
      status: response.status,
      success: response.ok,
      responseTime,
      data: response.ok ? data : undefined,
      error: !response.ok ? `HTTP ${response.status}` : undefined,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`[Regrid] ${name} error:`, error);
    
    return {
      endpoint: name,
      status: 0,
      success: false,
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
