import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await authClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { contact_id, search_params } = await req.json();
    if (!contact_id) throw new Error('Contact ID is required');

    console.log('Skip trace lookup for contact:', contact_id);

    const { data: contact, error: contactError } = await supabaseClient
      .from('contacts')
      .select('*')
      .eq('id', contact_id)
      .single();

    if (contactError) throw new Error(`Contact not found: ${contactError.message}`);

    // Determine provider: use BatchData by default, SearchBug only if configured and BatchData is not
    const batchDataApiKey = Deno.env.get('BATCHDATA_API_KEY');
    const searchBugApiKey = Deno.env.get('SEARCHBUG_API_KEY');
    const searchBugCoCode = Deno.env.get('SEARCHBUG_CO_CODE');

    let enrichedData: any;
    let rawResults: any;
    let provider: string;
    let estimatedCost: number;

    if (batchDataApiKey) {
      // ── BatchData (primary) ──
      provider = 'batchdata';
      estimatedCost = 0.02;

      const address = search_params?.address || contact.address_street || '';
      const city = contact.address_city || '';
      const state = contact.address_state || '';
      const zip = contact.address_zip || '';

      const propertyPayload: any = {};
      if (contact.first_name) propertyPayload.first_name = contact.first_name;
      if (contact.last_name) propertyPayload.last_name = contact.last_name;
      if (address) propertyPayload.address = address;
      if (city) propertyPayload.city = city;
      if (state) propertyPayload.state = state;
      if (zip) propertyPayload.zip_code = zip;

      console.log('BatchData request:', JSON.stringify(propertyPayload));

      const bdResponse = await fetch('https://api.batchdata.com/api/v1/property/skip-trace', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${batchDataApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests: [propertyPayload] }),
      });

      if (!bdResponse.ok) {
        const errorText = await bdResponse.text();
        console.error('BatchData API error:', errorText);
        throw new Error(`BatchData API error: ${bdResponse.status}`);
      }

      rawResults = await bdResponse.json();
      console.log('BatchData response:', JSON.stringify(rawResults));

      // Parse BatchData response
      const results = rawResults?.results?.persons || rawResults?.results || [];
      const resultList = Array.isArray(results) ? results : results ? [results] : [];

      const phones: string[] = [];
      const emails: string[] = [];
      const addresses: any[] = [];

      for (const person of resultList) {
        // Phones
        const personPhones = person.phones || person.phoneNumbers || [];
        for (const p of personPhones) {
          const num = p.phone_number || p.number || p.phone || '';
          if (num && !phones.includes(num)) phones.push(num);
        }
        // Emails
        const personEmails = person.emails || person.emailAddresses || [];
        for (const e of personEmails) {
          const addr = e.email_address || e.address || e.email || '';
          if (addr && !emails.includes(addr)) emails.push(addr);
        }
        // Addresses
        const personAddresses = person.addresses || [];
        for (const a of personAddresses) {
          addresses.push({
            street: a.street || a.address || '',
            unit: a.unit || '',
            city: a.city || '',
            state: a.state || '',
            zip: a.zip || a.zip_code || '',
          });
        }
      }

      enrichedData = {
        phones,
        emails,
        addresses,
        relatives: [],
        demographics: {},
        confidence_score: resultList.length > 0 ? 85 : 0,
        raw_records: resultList,
      };

    } else if (searchBugApiKey && searchBugCoCode) {
      // ── SearchBug (fallback) ──
      provider = 'searchbug';
      estimatedCost = 0.35;

      const formData = new FormData();
      formData.append('CO_CODE', searchBugCoCode);
      formData.append('PASS', searchBugApiKey);
      formData.append('TYPE', 'api_trace');
      formData.append('FORMAT', 'JSON');

      if (contact.first_name) formData.append('FNAME', contact.first_name);
      if (contact.last_name) formData.append('LNAME', contact.last_name);

      const address = search_params?.address || contact.address_street;
      if (address) formData.append('ADDRESS', address);
      if (contact.address_city) formData.append('CITY', contact.address_city);
      if (contact.address_state) formData.append('STATE', contact.address_state);

      console.log('SearchBug request - FNAME:', contact.first_name, 'LNAME:', contact.last_name);

      const sbResponse = await fetch('https://data.searchbug.com/api/search.aspx', {
        method: 'POST',
        body: formData,
      });

      if (!sbResponse.ok) {
        const errorText = await sbResponse.text();
        console.error('SearchBug API error:', errorText);
        throw new Error(`SearchBug API error: ${sbResponse.status}`);
      }

      rawResults = await sbResponse.json();
      console.log('SearchBug response:', JSON.stringify(rawResults));

      const records = rawResults?.RESULTS?.response?.record || rawResults?.response?.record || [];
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

      enrichedData = {
        phones,
        emails: [],
        addresses,
        relatives: [],
        demographics: {},
        confidence_score: recordList.length > 0 ? 85 : 0,
        raw_records: recordList,
      };

    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Skip trace is not configured. Please add your BatchData API Key (or SearchBug credentials) in Settings > Integrations.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Store results
    const { data: skipTraceResult, error: insertError } = await supabaseClient
      .from('skip_trace_results')
      .insert({
        contact_id,
        tenant_id: contact.tenant_id,
        requested_by: user.id,
        search_parameters: search_params || {},
        raw_results: rawResults,
        enriched_data: enrichedData,
        confidence_score: enrichedData.confidence_score,
        cost: estimatedCost,
        provider,
        status: 'completed',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error storing skip trace result:', insertError);
      throw insertError;
    }

    // Suggestions
    const suggestions = [];
    if (enrichedData.phones.length > 0 && !contact.phone) {
      suggestions.push({ field: 'phone', value: enrichedData.phones[0], confidence: enrichedData.confidence_score });
    }
    if (enrichedData.emails.length > 0 && !contact.email) {
      suggestions.push({ field: 'email', value: enrichedData.emails[0], confidence: enrichedData.confidence_score });
    }
    if (enrichedData.addresses.length > 0 && !contact.address_street) {
      suggestions.push({ field: 'address', value: enrichedData.addresses[0], confidence: enrichedData.confidence_score });
    }

    return new Response(
      JSON.stringify({
        success: true,
        skip_trace_id: skipTraceResult.id,
        enriched_data: enrichedData,
        suggestions,
        cost: estimatedCost,
        provider,
        message: `Found ${enrichedData.phones.length} phone(s), ${enrichedData.emails.length} email(s), ${enrichedData.addresses.length} address(es) via ${provider}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in skip-trace-lookup:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
