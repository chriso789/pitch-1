import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      throw new Error('Unauthorized');
    }

    const { contact_id, search_params } = await req.json();
    
    if (!contact_id) {
      throw new Error('Contact ID is required');
    }

    console.log('Skip trace lookup for contact:', contact_id);

    // Get contact details
    const { data: contact, error: contactError } = await supabaseClient
      .from('contacts')
      .select('*')
      .eq('id', contact_id)
      .single();

    if (contactError) throw contactError;

    // Prepare SearchBug API request
    const searchBugApiKey = Deno.env.get('SEARCHBUG_API_KEY');
    if (!searchBugApiKey) {
      throw new Error('SearchBug API key not configured');
    }

    // Build search query from contact data
    const searchQuery: any = {
      name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
    };

    if (search_params?.phone || contact.phone) {
      searchQuery.phone = search_params?.phone || contact.phone;
    }
    if (search_params?.email || contact.email) {
      searchQuery.email = search_params?.email || contact.email;
    }
    if (search_params?.address || contact.address_street) {
      searchQuery.address = search_params?.address || contact.address_street;
      searchQuery.city = contact.address_city;
      searchQuery.state = contact.address_state;
      searchQuery.zip = contact.address_zip;
    }

    console.log('SearchBug API request:', searchQuery);

    // Call SearchBug API
    const searchBugResponse = await fetch('https://api.searchbug.com/api/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${searchBugApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchQuery),
    });

    if (!searchBugResponse.ok) {
      const errorText = await searchBugResponse.text();
      console.error('SearchBug API error:', errorText);
      throw new Error(`SearchBug API error: ${searchBugResponse.status}`);
    }

    const searchBugData = await searchBugResponse.json();
    console.log('SearchBug API response:', searchBugData);

    // Calculate cost (estimate $0.35 per lookup)
    const estimatedCost = 0.35;

    // Parse and structure the results
    const enrichedData = {
      phones: searchBugData.phones || [],
      emails: searchBugData.emails || [],
      addresses: searchBugData.addresses || [],
      relatives: searchBugData.relatives || [],
      demographics: searchBugData.demographics || {},
      confidence_score: searchBugData.confidence || 0,
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
    
    if (enrichedData.emails.length > 0 && !contact.email) {
      suggestions.push({
        field: 'email',
        value: enrichedData.emails[0],
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
        message: `Found ${enrichedData.phones.length} phone(s), ${enrichedData.emails.length} email(s), ${enrichedData.addresses.length} address(es)`,
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
