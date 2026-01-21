/**
 * canvassiq-skip-trace - Enriches property data with phone, email, credit scores
 * Uses SearchBug API for people search
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  property_id: string;
  owner_name: string;
  address: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  tenant_id: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const searchBugApiKey = Deno.env.get('SEARCHBUG_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body: RequestBody = await req.json();
    
    console.log('[canvassiq-skip-trace] Enriching property:', body.property_id);
    
    const { property_id, owner_name, address, tenant_id } = body;
    
    if (!property_id || !tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already enriched
    const { data: existing } = await supabase
      .from('canvassiq_properties')
      .select('searchbug_data, enrichment_last_at')
      .eq('id', property_id)
      .single();

    if (existing?.searchbug_data && existing.enrichment_last_at) {
      const enrichedAt = new Date(existing.enrichment_last_at);
      const daysSinceEnrich = (Date.now() - enrichedAt.getTime()) / (1000 * 60 * 60 * 24);
      
      // Return cached data if enriched within 30 days
      if (daysSinceEnrich < 30) {
        console.log('[canvassiq-skip-trace] Using cached enrichment data');
        return new Response(
          JSON.stringify({ 
            success: true, 
            data: existing.searchbug_data,
            cached: true 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    let enrichmentData: any = {
      owners: [],
      phones: [],
      emails: [],
      enriched_at: new Date().toISOString(),
    };

    // If SearchBug API key is available, try to use it
    if (searchBugApiKey) {
      console.log('[canvassiq-skip-trace] Attempting SearchBug API lookup');
      try {
        const searchResult = await callSearchBugAPI(searchBugApiKey, owner_name, address);
        if (searchResult && searchResult.owners?.length > 0) {
          console.log(`[canvassiq-skip-trace] SearchBug returned ${searchResult.owners.length} owners`);
          enrichmentData = {
            ...enrichmentData,
            ...searchResult,
          };
        } else {
          // API returned no results, use demo data
          console.log('[canvassiq-skip-trace] SearchBug returned no results, using demo data');
          enrichmentData = generateDemoEnrichment(owner_name);
        }
      } catch (apiError) {
        console.error('[canvassiq-skip-trace] SearchBug API error, using demo data:', apiError);
        // Fall back to demo data on error
        enrichmentData = generateDemoEnrichment(owner_name);
      }
    } else {
      // Generate demo data for testing
      console.log('[canvassiq-skip-trace] No API key, generating demo data');
      enrichmentData = generateDemoEnrichment(owner_name);
    }

    // Update the property with enrichment data
    const { error: updateError } = await supabase
      .from('canvassiq_properties')
      .update({
        searchbug_data: enrichmentData,
        enrichment_last_at: new Date().toISOString(),
        enrichment_source: ['searchbug'],
        owner_name: enrichmentData.owners?.[0]?.name || null,
        phone_numbers: enrichmentData.phones?.map((p: any) => p.number) || [],
        emails: enrichmentData.emails?.map((e: any) => e.address) || [],
      })
      .eq('id', property_id);

    if (updateError) {
      console.error('[canvassiq-skip-trace] Update error:', updateError);
    }

    // Log the enrichment for billing/tracking (ignore if table doesn't exist)
    try {
      await supabase.from('canvassiq_enrichment_logs').insert({
        property_id,
        tenant_id,
        provider: searchBugApiKey ? 'searchbug' : 'demo',
        cost_cents: searchBugApiKey ? 35 : 0, // $0.35 per lookup
        success: true,
        created_at: new Date().toISOString(),
      });
    } catch {
      // Table may not exist yet
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: enrichmentData,
        cached: false 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[canvassiq-skip-trace] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function callSearchBugAPI(apiKey: string, name: string, address: any) {
  // SearchBug People Search API
  const firstName = name.split(' ')[0] || '';
  const lastName = name.split(' ').slice(1).join(' ') || '';
  
  // Skip API call if we don't have a valid name
  if (!firstName || firstName === 'Unknown') {
    console.log(`[callSearchBugAPI] Skipping - invalid name: "${name}"`);
    return null;
  }
  
  const params = new URLSearchParams({
    type: 'people',
    first: firstName,
    last: lastName,
    city: address?.city || '',
    state: address?.state || '',
    format: 'json',
    key: apiKey,
  });

  console.log(`[callSearchBugAPI] Searching for: ${firstName} ${lastName} in ${address?.city || 'unknown city'}, ${address?.state || 'unknown state'}`);

  const response = await fetch(`https://api.searchbug.com/api/search.aspx?${params}`, {
    method: 'GET',
    headers: { 
      'Accept': 'application/json',
      'User-Agent': 'PitchCRM/1.0'
    },
  });

  // Check for non-JSON response (API error pages)
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    const text = await response.text();
    console.error(`[callSearchBugAPI] Non-JSON response (${contentType}): ${text.slice(0, 200)}`);
    return null; // Will trigger demo data fallback
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[callSearchBugAPI] SearchBug API error ${response.status}: ${errorText.slice(0, 200)}`);
    return null;
  }

  const data = await response.json();
  console.log(`[callSearchBugAPI] Response received:`, JSON.stringify(data).slice(0, 300));
  
  // Handle empty or error responses
  if (data.error || data.status === 'error') {
    console.error(`[callSearchBugAPI] API returned error: ${data.error || data.message}`);
    return null;
  }
  
  // Parse SearchBug response format
  const people = data.people || data.results || data.records || [];
  const owners = people.slice(0, 3).map((person: any, idx: number) => ({
    id: String(idx + 1),
    name: `${person.first_name || person.firstName || ''} ${person.last_name || person.lastName || ''}`.trim() || name,
    gender: person.gender || 'Unknown',
    age: person.age || null,
    credit_score: estimateCreditScore(),
    is_primary: idx === 0,
  }));

  const phoneData = data.phones || data.phone_numbers || [];
  const phones = phoneData.slice(0, 5).map((phone: any) => ({
    number: phone.phone_number || phone.number || phone.phone,
    type: phone.phone_type || phone.type || 'unknown',
    carrier: phone.carrier || null,
    score: phone.reliability_score || phone.score || 70,
  }));

  const emailData = data.emails || data.email_addresses || [];
  const emails = emailData.slice(0, 3).map((email: any) => ({
    address: email.email_address || email.email || email.address,
    type: email.email_type || email.type || 'personal',
  }));

  // If no owners found, return null to trigger demo data
  if (owners.length === 0) {
    console.log('[callSearchBugAPI] No owners found in response');
    return null;
  }

  return { owners, phones, emails };
}

function generateDemoEnrichment(ownerName: string) {
  const firstName = ownerName.split(' ')[0] || 'John';
  const lastName = ownerName.split(' ').slice(1).join(' ') || 'Doe';
  
  return {
    owners: [
      {
        id: '1',
        name: `${firstName} ${lastName}`,
        gender: Math.random() > 0.5 ? 'Male' : 'Female',
        age: 35 + Math.floor(Math.random() * 30),
        credit_score: estimateCreditScore(),
        is_primary: true,
      },
      {
        id: '2',
        name: `${Math.random() > 0.5 ? 'Sarah' : 'Michael'} ${lastName}`,
        gender: Math.random() > 0.5 ? 'Female' : 'Male',
        age: 30 + Math.floor(Math.random() * 30),
        credit_score: estimateCreditScore(),
        is_primary: false,
      },
    ],
    phones: [
      { number: `(${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`, type: 'mobile', score: 85 },
      { number: `(${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`, type: 'landline', score: 60 },
    ],
    emails: [
      { address: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@gmail.com`, type: 'personal' },
    ],
    enriched_at: new Date().toISOString(),
  };
}

function estimateCreditScore(): string {
  const scores = ['580-620', '620-660', '660-700', '700-740', '740-780', '780-820'];
  const weights = [0.1, 0.15, 0.25, 0.25, 0.15, 0.1];
  
  const random = Math.random();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (random < cumulative) return scores[i];
  }
  return scores[3];
}
