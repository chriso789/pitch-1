/**
 * canvassiq-skip-trace - Enriches property data with phone, email, credit scores
 * Now checks storm_properties_public for verified owner data before fallback
 * Uses SearchBug API for people search, with demo data fallback for phones/emails only
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
    formatted?: string;
  };
  tenant_id: string;
}

function parseFormattedAddress(formatted: string | undefined): { city: string; state: string; zip: string } {
  if (!formatted) return { city: '', state: '', zip: '' };
  const parts = formatted.split(',').map(p => p.trim());
  let city = '', state = '', zip = '';
  if (parts.length >= 3) {
    city = parts[1] || '';
    const stateZip = parts[2] || '';
    const stateZipParts = stateZip.split(' ').filter(Boolean);
    state = stateZipParts[0] || '';
    zip = stateZipParts[1] || '';
  } else if (parts.length === 2) {
    city = parts[0] || '';
    const stateZip = parts[1] || '';
    const stateZipParts = stateZip.split(' ').filter(Boolean);
    state = stateZipParts[0] || '';
    zip = stateZipParts[1] || '';
  }
  return { city, state, zip };
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
    console.log('[canvassiq-skip-trace] Owner name:', body.owner_name);
    
    const { property_id, owner_name, address, tenant_id } = body;
    
    if (!property_id || !tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ensure we have city/state/zip
    let enrichedAddress = { ...address };
    if (!address?.city || !address?.state) {
      const parsed = parseFormattedAddress(address?.formatted);
      enrichedAddress = {
        ...address,
        city: address?.city || parsed.city,
        state: address?.state || parsed.state,
        zip: address?.zip || parsed.zip,
      };
    }

    // Check if already enriched with valid owner data
    const { data: existing } = await supabase
      .from('canvassiq_properties')
      .select('searchbug_data, enrichment_last_at, owner_name, lat, lng')
      .eq('id', property_id)
      .single();

    const hasValidOwner = existing?.owner_name && existing.owner_name !== 'Unknown' && existing.owner_name !== 'Unknown Owner';
    if (existing?.searchbug_data && existing.enrichment_last_at && hasValidOwner) {
      const enrichedAt = new Date(existing.enrichment_last_at);
      const daysSinceEnrich = (Date.now() - enrichedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceEnrich < 30) {
        console.log('[canvassiq-skip-trace] Using cached enrichment data');
        return new Response(
          JSON.stringify({ success: true, data: existing.searchbug_data, cached: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ================================================================
    // STEP 1: Check storm_properties_public for verified owner
    // ================================================================
    let effectiveOwnerName = (owner_name && owner_name !== 'Unknown' && owner_name !== 'Unknown Owner') 
      ? owner_name : null;

    if (!effectiveOwnerName && existing?.lat && existing?.lng) {
      console.log('[canvassiq-skip-trace] Owner unknown, checking storm_properties_public...');
      
      const { data: publicData } = await supabase
        .from('storm_properties_public')
        .select('owner_name, confidence_score')
        .eq('tenant_id', tenant_id)
        .gte('lat', existing.lat - 0.0001)
        .lte('lat', existing.lat + 0.0001)
        .gte('lng', existing.lng - 0.0001)
        .lte('lng', existing.lng + 0.0001)
        .maybeSingle();

      if (publicData?.owner_name && publicData.confidence_score >= 40) {
        effectiveOwnerName = publicData.owner_name;
        console.log(`[canvassiq-skip-trace] Found verified owner from public data: "${effectiveOwnerName}" (confidence=${publicData.confidence_score})`);
        
        // Update canvassiq_properties with verified owner
        await supabase.from('canvassiq_properties').update({
          owner_name: effectiveOwnerName,
        }).eq('id', property_id);
      }
    }

    // ================================================================
    // STEP 2: If still no owner, trigger storm-public-lookup
    // ================================================================
    if (!effectiveOwnerName && existing?.lat && existing?.lng) {
      console.log('[canvassiq-skip-trace] Triggering storm-public-lookup for owner resolution...');
      try {
        const lookupResponse = await fetch(`${supabaseUrl}/functions/v1/storm-public-lookup`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lat: existing.lat,
            lng: existing.lng,
            address: enrichedAddress.formatted || enrichedAddress.street || '',
            tenant_id,
            property_id,
          }),
        });

        if (lookupResponse.ok) {
          const lookupData = await lookupResponse.json();
          if (lookupData?.result?.owner_name) {
            effectiveOwnerName = lookupData.result.owner_name;
            console.log(`[canvassiq-skip-trace] Public lookup found owner: "${effectiveOwnerName}"`);
          }
        }
      } catch (lookupErr) {
        console.error('[canvassiq-skip-trace] Public lookup error:', lookupErr);
      }
    }

    // ================================================================
    // STEP 3: SearchBug for phone/email enrichment
    // ================================================================
    let enrichmentData: any = {
      owners: [],
      phones: [],
      emails: [],
      enriched_at: new Date().toISOString(),
    };

    // Check if storm-public-lookup already populated contact data
    const { data: publicRecord } = await supabase
      .from('storm_properties_public')
      .select('*')
      .eq('tenant_id', tenant_id)
      .gte('lat', existing?.lat ? existing.lat - 0.0001 : 0)
      .lte('lat', existing?.lat ? existing.lat + 0.0001 : 0)
      .gte('lng', existing?.lng ? existing.lng - 0.0001 : 0)
      .lte('lng', existing?.lng ? existing.lng + 0.0001 : 0)
      .maybeSingle();

    const publicPhones = publicRecord?.raw_data?.people_search?.phones || publicRecord?.raw_data?.people_search_by_address?.phones || [];
    const publicEmails = publicRecord?.raw_data?.people_search?.emails || publicRecord?.raw_data?.people_search_by_address?.emails || [];
    const publicAge = publicRecord?.raw_data?.people_search?.age || publicRecord?.raw_data?.people_search_by_address?.age || null;
    // Extract person name from people search if available (resolved from scraped page)
    const peopleSearchName = publicRecord?.raw_data?.people_search?.name || publicRecord?.raw_data?.people_search_by_address?.name || null;
    if (!effectiveOwnerName && peopleSearchName) {
      effectiveOwnerName = peopleSearchName;
      console.log(`[canvassiq-skip-trace] Resolved owner from people search name: "${effectiveOwnerName}"`);
    }

    if (publicPhones.length > 0 || publicEmails.length > 0) {
      console.log(`[canvassiq-skip-trace] Using free public data: ${publicPhones.length} phones, ${publicEmails.length} emails`);
      enrichmentData = {
        owners: [{ id: '1', name: effectiveOwnerName || publicRecord?.owner_name || 'Unknown Owner', age: publicAge, is_primary: true }],
        phones: publicPhones,
        emails: publicEmails,
        relatives: publicRecord?.raw_data?.people_search?.relatives || [],
        source: 'firecrawl_people_search',
        enriched_at: new Date().toISOString(),
      };
    } else if (searchBugApiKey && effectiveOwnerName) {
      // Premium SearchBug path (optional)
      console.log('[canvassiq-skip-trace] Attempting SearchBug API lookup for:', effectiveOwnerName);
      try {
        const searchResult = await callSearchBugAPI(searchBugApiKey, effectiveOwnerName, enrichedAddress);
        if (searchResult && searchResult.owners?.length > 0) {
          console.log(`[canvassiq-skip-trace] SearchBug returned ${searchResult.owners.length} owners`);
          enrichmentData = { ...enrichmentData, ...searchResult };
        }
      } catch (apiError) {
        console.error('[canvassiq-skip-trace] SearchBug API error:', apiError);
      }
    } else if (effectiveOwnerName) {
      // No public data and no SearchBug — return owner with empty contacts (no fake data)
      console.log('[canvassiq-skip-trace] No contact data available — returning owner only (no fake data)');
      enrichmentData = {
        owners: [{ id: '1', name: effectiveOwnerName, is_primary: true }],
        phones: [],
        emails: [],
        enriched_at: new Date().toISOString(),
      };
    } else {
      console.log('[canvassiq-skip-trace] No owner found from any source');
      enrichmentData = {
        owners: [{ id: '1', name: 'Unknown Owner', is_primary: true }],
        phones: [],
        emails: [],
        enriched_at: new Date().toISOString(),
      };
    }

    // Update the property with enrichment data
    const { error: updateError } = await supabase
      .from('canvassiq_properties')
      .update({
        searchbug_data: enrichmentData,
        enrichment_last_at: new Date().toISOString(),
        enrichment_source: ['public_data', searchBugApiKey ? 'searchbug' : 'demo'],
        owner_name: enrichmentData.owners?.[0]?.name || effectiveOwnerName || null,
        phone_numbers: enrichmentData.phones?.map((p: any) => p.number) || [],
        emails: enrichmentData.emails?.map((e: any) => e.address) || [],
      })
      .eq('id', property_id);

    if (updateError) {
      console.error('[canvassiq-skip-trace] Update error:', updateError);
    }

    // Log enrichment
    try {
      await supabase.from('canvassiq_enrichment_logs').insert({
        property_id,
        tenant_id,
        provider: searchBugApiKey ? 'searchbug' : 'public_data',
        cost_cents: searchBugApiKey && effectiveOwnerName ? 35 : 0,
        success: true,
        created_at: new Date().toISOString(),
      });
    } catch { /* table may not exist */ }

    return new Response(
      JSON.stringify({ success: true, data: enrichmentData, cached: false }),
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
  const firstName = name.split(' ')[0] || '';
  const lastName = name.split(' ').slice(1).join(' ') || '';
  
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

  console.log(`[callSearchBugAPI] Searching for: ${firstName} ${lastName} in ${address?.city || ''}, ${address?.state || ''}`);

  const response = await fetch(`https://api.searchbug.com/api/search.aspx?${params}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json', 'User-Agent': 'PitchCRM/1.0' },
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    const text = await response.text();
    console.error(`[callSearchBugAPI] Non-JSON response: ${text.slice(0, 200)}`);
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[callSearchBugAPI] Error ${response.status}: ${errorText.slice(0, 200)}`);
    return null;
  }

  const data = await response.json();
  
  if (data.error || data.status === 'error') {
    console.error(`[callSearchBugAPI] API error: ${data.error || data.message}`);
    return null;
  }
  
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

  if (owners.length === 0) return null;
  return { owners, phones, emails };
}

// generateDemoContactData removed — no more fake phones/emails
