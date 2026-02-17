/**
 * canvassiq-skip-trace — Clean 3-step enrichment:
 * 1. Check cache (canvass_property_contacts, < 30 days)
 * 2. Call BatchData Skip Trace API
 * 3. Cache result + update canvassiq_properties
 *
 * No Firecrawl. No SearchBug. No scraping. No fake data.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { batchDataSkipTrace } from "../_shared/public_data/sources/batchdata/skipTrace.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  property_id: string;
  owner_name?: string;
  address: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    formatted?: string;
  };
  tenant_id: string;
}

function parseFormattedAddress(formatted: string | undefined): { street: string; city: string; state: string; zip: string } {
  if (!formatted) return { street: '', city: '', state: '', zip: '' };
  const parts = formatted.split(',').map(p => p.trim());
  if (parts.length >= 3) {
    const stateZipParts = (parts[2] || '').split(' ').filter(Boolean);
    return { street: parts[0] || '', city: parts[1] || '', state: stateZipParts[0] || '', zip: stateZipParts[1] || '' };
  }
  if (parts.length === 2) {
    const stateZipParts = (parts[1] || '').split(' ').filter(Boolean);
    return { street: parts[0] || '', city: '', state: stateZipParts[0] || '', zip: stateZipParts[1] || '' };
  }
  return { street: formatted, city: '', state: '', zip: '' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body: RequestBody = await req.json();
    const { property_id, owner_name, address, tenant_id } = body;

    if (!property_id || !tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: property_id, tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[skip-trace] Property: ${property_id}`);

    // =============================================
    // STEP 1: Check cache (< 30 days)
    // =============================================
    const { data: cached } = await supabase
      .from('canvass_property_contacts')
      .select('*')
      .eq('property_id', property_id)
      .maybeSingle();

    if (cached?.enriched_at) {
      const age = Date.now() - new Date(cached.enriched_at).getTime();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (age < thirtyDays) {
        console.log(`[skip-trace] Cache hit (${Math.round(age / 86400000)}d old)`);
        return new Response(
          JSON.stringify({
            success: true,
            cached: true,
            data: {
              owners: [{
                id: '1',
                name: [cached.first_name, cached.last_name].filter(Boolean).join(' ') || owner_name || 'Unknown Owner',
                first_name: cached.first_name,
                last_name: cached.last_name,
                age: cached.age,
                is_primary: true,
              }],
              phones: cached.phone_numbers || [],
              emails: (cached.emails || []).map((e: string) => ({ address: e, type: 'personal' })),
              relatives: cached.relatives || [],
              enriched_at: cached.enriched_at,
              source: 'batchdata_cached',
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // =============================================
    // STEP 2: Call BatchData Skip Trace
    // =============================================
    const parsed = parseFormattedAddress(address?.formatted);
    const street = address?.street || parsed.street;
    const city = address?.city || parsed.city;
    const state = address?.state || parsed.state;
    const zip = address?.zip || parsed.zip;

    if (!street) {
      console.warn('[skip-trace] No street address available');
      return new Response(
        JSON.stringify({
          success: true,
          cached: false,
          data: {
            owners: [{ id: '1', name: owner_name || 'Unknown Owner', is_primary: true }],
            phones: [],
            emails: [],
            enriched_at: new Date().toISOString(),
            source: 'none',
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[skip-trace] Calling BatchData: ${street}, ${city} ${state} ${zip}`);

    const result = await batchDataSkipTrace({ street, city, state, zip, timeoutMs: 15000 });

    const firstName = result?.firstName || null;
    const lastName = result?.lastName || null;
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || owner_name || 'Unknown Owner';
    const phones = result?.phones || [];
    const emails = result?.emails || [];
    const age = result?.age || null;
    const relatives = result?.relatives || [];

    // =============================================
    // STEP 3: DNC scrubbing — cache BatchData dnc flags
    // =============================================
    for (const phone of phones) {
      if (phone.number) {
        try {
          await supabase.from('dnc_scrub_results').upsert({
            tenant_id,
            phone_e164: phone.number,
            is_dnc: phone.dnc === true,
            is_wireless: (phone.type || '').toLowerCase() === 'mobile',
            source: 'batchdata',
            scrubbed_at: new Date().toISOString(),
          }, { onConflict: 'tenant_id,phone_e164' });
        } catch { /* best-effort */ }
      }
    }

    // Build callable phone list
    const phonesWithCallable = phones.map(p => ({
      number: p.number,
      type: p.type,
      dnc: p.dnc === true,
      callable: p.dnc !== true,
    }));

    // =============================================
    // STEP 4: Cache result
    // =============================================
    const contactRow = {
      property_id,
      first_name: firstName,
      last_name: lastName,
      primary_phone: phones[0]?.number || null,
      secondary_phone: phones[1]?.number || null,
      phone_numbers: phones,
      emails,
      age,
      relatives,
      batchdata_raw: result?.raw || null,
      enriched_at: new Date().toISOString(),
    };

    await supabase
      .from('canvass_property_contacts')
      .upsert(contactRow, { onConflict: 'property_id' });

    // Update canvassiq_properties with enriched data
    const updatePayload: Record<string, any> = {
      enrichment_last_at: new Date().toISOString(),
      enrichment_source: ['batchdata'],
    };
    if (fullName !== 'Unknown Owner') updatePayload.owner_name = fullName;
    if (phones.length > 0) updatePayload.phone_numbers = phones.map(p => p.number);
    if (emails.length > 0) updatePayload.emails = emails;

    await supabase.from('canvassiq_properties').update(updatePayload).eq('id', property_id);

    // Log enrichment
    try {
      await supabase.from('canvassiq_enrichment_logs').insert({
        property_id,
        tenant_id,
        provider: 'batchdata',
        cost_cents: result ? 15 : 0,
        success: !!result,
        created_at: new Date().toISOString(),
      });
    } catch { /* table may not exist */ }

    console.log(`[skip-trace] Done: ${fullName}, ${phones.length} phones, ${emails.length} emails`);

    return new Response(
      JSON.stringify({
        success: true,
        cached: false,
        data: {
          owners: [{
            id: '1',
            name: fullName,
            first_name: firstName,
            last_name: lastName,
            age,
            is_primary: true,
          }],
          phones: phonesWithCallable,
          emails: emails.map(e => ({ address: e, type: 'personal' })),
          relatives,
          enriched_at: new Date().toISOString(),
          source: result ? 'batchdata' : 'none',
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('[skip-trace] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
