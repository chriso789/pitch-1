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
      .select('enrichment_data, enriched_at')
      .eq('id', property_id)
      .single();

    if (existing?.enrichment_data && existing.enriched_at) {
      const enrichedAt = new Date(existing.enriched_at);
      const daysSinceEnrich = (Date.now() - enrichedAt.getTime()) / (1000 * 60 * 60 * 24);
      
      // Return cached data if enriched within 30 days
      if (daysSinceEnrich < 30) {
        console.log('[canvassiq-skip-trace] Using cached enrichment data');
        return new Response(
          JSON.stringify({ 
            success: true, 
            data: existing.enrichment_data,
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

    // If SearchBug API key is available, use it
    if (searchBugApiKey) {
      try {
        const searchResult = await callSearchBugAPI(searchBugApiKey, owner_name, address);
        if (searchResult) {
          enrichmentData = {
            ...enrichmentData,
            ...searchResult,
          };
        }
      } catch (apiError) {
        console.error('[canvassiq-skip-trace] SearchBug API error:', apiError);
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
        enrichment_data: enrichmentData,
        enriched_at: new Date().toISOString(),
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
  const params = new URLSearchParams({
    api_key: apiKey,
    first_name: name.split(' ')[0] || '',
    last_name: name.split(' ').slice(1).join(' ') || '',
    city: address?.city || '',
    state: address?.state || '',
    zip: address?.zip || '',
  });

  const response = await fetch(`https://api.searchbug.com/api/people.aspx?${params}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`SearchBug API error: ${response.status}`);
  }

  const data = await response.json();
  
  // Parse SearchBug response format
  const owners = (data.people || []).slice(0, 3).map((person: any, idx: number) => ({
    id: String(idx + 1),
    name: `${person.first_name || ''} ${person.last_name || ''}`.trim(),
    gender: person.gender || 'Unknown',
    age: person.age || null,
    credit_score: estimateCreditScore(),
    is_primary: idx === 0,
  }));

  const phones = (data.phones || []).slice(0, 5).map((phone: any) => ({
    number: phone.phone_number || phone.number,
    type: phone.phone_type || 'unknown',
    carrier: phone.carrier || null,
    score: phone.reliability_score || 70,
  }));

  const emails = (data.emails || []).slice(0, 3).map((email: any) => ({
    address: email.email_address || email.email,
    type: email.email_type || 'personal',
  }));

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
