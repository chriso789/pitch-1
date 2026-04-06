import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth client to verify user
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      throw new Error('Unauthorized');
    }

    // Service role client for data access (bypasses RLS)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { contact_id, search_params } = await req.json();
    
    if (!contact_id) {
      throw new Error('Contact ID is required');
    }

    console.log('Skip trace lookup for contact:', contact_id);

    // Get contact details using service role
    const { data: contact, error: contactError } = await supabaseClient
      .from('contacts')
      .select('*')
      .eq('id', contact_id)
      .single();

    if (contactError) {
      console.error('Contact fetch error:', contactError);
      throw new Error(`Contact not found: ${contactError.message}`);
    }

    // Prepare SearchBug API request
    const searchBugApiKey = Deno.env.get('SEARCHBUG_API_KEY');
    const searchBugCoCode = Deno.env.get('SEARCHBUG_CO_CODE');
    if (!searchBugApiKey || !searchBugCoCode) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Skip trace is not configured. Please add your SearchBug API Key and CO_CODE in Settings > Integrations.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build form data per SearchBug People Trace API docs
    // Endpoint: https://data.searchbug.com/api/search.aspx
    const formData = new FormData();
    formData.append('CO_CODE', searchBugCoCode);
    formData.append('PASS', searchBugApiKey);
    formData.append('TYPE', 'api_trace');
    formData.append('FORMAT', 'JSON');

    if (contact.first_name) formData.append('FNAME', contact.first_name);
    if (contact.last_name) formData.append('LNAME', contact.last_name);
    
    // Use search_params overrides or contact data
    const address = search_params?.address || contact.address_street;
    const city = contact.address_city;
    const state = contact.address_state;

    if (address) formData.append('ADDRESS', address);
    if (city) formData.append('CITY', city);
    if (state) formData.append('STATE', state);

    console.log('SearchBug API request - FNAME:', contact.first_name, 'LNAME:', contact.last_name, 'ADDRESS:', address, 'CITY:', city, 'STATE:', state);

    // Call SearchBug People Trace API
    const searchBugResponse = await fetch('https://data.searchbug.com/api/search.aspx', {
      method: 'POST',
      body: formData,
    });

    if (!searchBugResponse.ok) {
      const errorText = await searchBugResponse.text();
      console.error('SearchBug API error:', errorText);
      throw new Error(`SearchBug API error: ${searchBugResponse.status}`);
    }

    const searchBugData = await searchBugResponse.json();
    console.log('SearchBug API response:', JSON.stringify(searchBugData));

    // Calculate cost (estimate $0.35 per lookup)
    const estimatedCost = 0.35;

    // Parse SearchBug People Trace response format
    // Response contains: RESULTS.response.record[] with fields like
    // name-first, name-last, phone_phone10, street-number, street-name, etc.
    const records = searchBugData?.RESULTS?.response?.record || searchBugData?.response?.record || [];
    const recordList = Array.isArray(records) ? records : records ? [records] : [];

    const phones: string[] = [];
    const addresses: any[] = [];
    
    for (const rec of recordList) {
      if (rec['phone_phone10']) {
        const phone = rec['phone_phone10'];
        if (!phones.includes(phone)) phones.push(phone);
      }
      const street = [rec['street-number'], rec['street-name'], rec['street-suffix']].filter(Boolean).join(' ');
      if (street) {
        addresses.push({
          street,
          unit: rec['unit-number'] || '',
          city: rec['City'] || rec['city'] || '',
          state: rec['state'] || rec['State'] || '',
          zip: rec['zip'] || '',
        });
      }
    }

    const enrichedData = {
      phones,
      emails: [] as string[],
      addresses,
      relatives: [] as string[],
      demographics: {},
      confidence_score: recordList.length > 0 ? 85 : 0,
      raw_records: recordList,
    };

    // Store results in skip_trace_results table
    const { data: skipTraceResult, error: insertError } = await supabaseClient
      .from('skip_trace_results')
      .insert({
        contact_id: contact_id,
        tenant_id: contact.tenant_id,
        requested_by: user.id,
        search_parameters: search_params || {},
        raw_results: searchBugData,
        enriched_data: enrichedData,
        confidence_score: enrichedData.confidence_score,
        cost: estimatedCost,
        provider: 'searchbug',
        status: 'completed',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error storing skip trace result:', insertError);
      throw insertError;
    }

    // Prepare suggestions for data enrichment
    const suggestions = [];
    
    if (enrichedData.phones.length > 0 && !contact.phone) {
      suggestions.push({
        field: 'phone',
        value: enrichedData.phones[0],
        confidence: enrichedData.confidence_score,
      });
    }
    
    if (enrichedData.addresses.length > 0 && !contact.address_street) {
      const primaryAddress = enrichedData.addresses[0];
      suggestions.push({
        field: 'address',
        value: primaryAddress,
        confidence: enrichedData.confidence_score,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        skip_trace_id: skipTraceResult.id,
        enriched_data: enrichedData,
        suggestions: suggestions,
        cost: estimatedCost,
        message: `Found ${enrichedData.phones.length} phone(s), ${enrichedData.addresses.length} address(es)`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in skip-trace-lookup:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
