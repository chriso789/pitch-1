/**
 * canvassiq-skip-trace — Clean 3-step enrichment:
 * 1. Check cache (canvass_property_contacts, < 30 days)
 * 2. Call BatchData Skip Trace API
 * 3. Cache result + update canvassiq_properties
 *
 * Falls back to Firecrawl people-search when BatchData returns nothing.
 */

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { batchDataSkipTrace } from "../_shared/public_data/sources/batchdata/skipTrace.ts";
import { peopleSearch } from "../_shared/public_data/sources/universal/peopleSearch.ts";
import { authorizeLookup } from './access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pitch-tenant',
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

export const handle = async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !serviceKey || !anonKey) throw new Error('Service configuration unavailable');
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return new Response(JSON.stringify({ code: 'unauthorized', error: 'Sign in to look up contacts.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });

    const body: RequestBody = await req.json();
    const { property_id } = body;

    if (!property_id) {
      return new Response(
        JSON.stringify({ error: 'Missing property', code: 'invalid_request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const access = await authorizeLookup(userClient, supabase, req.headers.get('x-pitch-tenant') || req.headers.get('x-tenant-id'), property_id);
    if (access.status !== 200 || !access.tenantId || !access.property) return new Response(JSON.stringify({ code: access.code, error: 'Contact lookup is not permitted for this property.' }), { status: access.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const tenant_id = access.tenantId;
    const owner_name = access.property.owner_name;
    let address: RequestBody['address'];
    try { address = typeof access.property.address === 'string' ? JSON.parse(access.property.address) : access.property.address; }
    catch { address = { formatted: access.property.address }; }
    address = address || {};

    // =============================================
    // STEP 1: Check cache (< 30 days)
    // =============================================
    const { data: cached } = await userClient
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

    // Resolve owner name from the property row when the client did not send one
    let resolvedOwnerName = owner_name || '';
    if (!resolvedOwnerName) {
      const { data: propRow } = await supabase
        .from('canvassiq_properties')
        .select('owner_name')
        .eq('id', property_id)
        .eq('tenant_id', tenant_id)
        .maybeSingle();
      resolvedOwnerName = propRow?.owner_name || '';
    }

    console.log('[skip-trace] Calling contact provider');

    let result = null as Awaited<ReturnType<typeof batchDataSkipTrace>>;
    try {
      result = await batchDataSkipTrace({ street, city, state, zip, timeoutMs: 15000 });
    } catch (bdErr) {
      console.warn('[skip-trace] BatchData failed, will try Firecrawl:', bdErr);
    }

    let firstName = result?.firstName || null;
    let lastName = result?.lastName || null;
    let phones = result?.phones || [];
    let emails = result?.emails || [];
    let age = result?.age || null;
    let relatives = result?.relatives || [];
    let sourceName = result ? 'batchdata' : 'none';

    // ---- Firecrawl fallback (free people-search) ----
    if (phones.length === 0 && emails.length === 0) {
      const searchName = [firstName, lastName].filter(Boolean).join(' ') || resolvedOwnerName || '';
      if (searchName) {
        console.log('[skip-trace] Trying fallback provider');
        const fc = await peopleSearch({ ownerName: searchName, city, state, street });
        if (fc) {
          phones = (fc.phones || []).map((p) => ({ number: p.number, type: p.type }));
          emails = (fc.emails || []).map((e) => e.address);
          age = age || fc.age;
          relatives = relatives.length ? relatives : (fc.relatives || []);
          if (!firstName && !lastName && fc.name) {
            const parts = fc.name.trim().split(/\s+/);
            firstName = parts[0] || null;
            lastName = parts.slice(1).join(' ') || null;
          }
          sourceName = result ? 'batchdata+firecrawl' : 'firecrawl';
        }
      }
    }

    const fullName = [firstName, lastName].filter(Boolean).join(' ') || resolvedOwnerName || 'Unknown Owner';


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

    await userClient
      .from('canvass_property_contacts')
      .upsert(contactRow, { onConflict: 'property_id' });

    // Update canvassiq_properties with enriched data
    const updatePayload: Record<string, any> = {
      enrichment_last_at: new Date().toISOString(),
      enrichment_source: [sourceName],
    };
    if (fullName !== 'Unknown Owner') updatePayload.owner_name = fullName;
    if (phones.length > 0) updatePayload.phone_numbers = phones.map(p => p.number);
    if (emails.length > 0) updatePayload.emails = emails;

    await supabase.from('canvassiq_properties').update(updatePayload).eq('id', property_id).eq('tenant_id', tenant_id);

    // Log enrichment
    try {
      await supabase.from('canvassiq_enrichment_logs').insert({
        property_id,
        tenant_id,
        provider: sourceName,
        cost_cents: result ? 15 : 0,
        success: phones.length > 0 || emails.length > 0 || !!result,
        created_at: new Date().toISOString(),
      });
    } catch { /* table may not exist */ }

    console.log(`[skip-trace] Done: ${phones.length} phones, ${emails.length} emails`);

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
          source: sourceName,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('[skip-trace] Request failed');
    return new Response(
      JSON.stringify({ code: 'lookup_failed', error: 'Contact lookup failed. Please retry.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
};
