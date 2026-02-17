// supabase/functions/storm-public-lookup/index.ts
// Slim orchestrator — delegates to shared modular pipeline

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveLocation } from "../_shared/public_data/locationResolver.ts";
import { getCountyContext } from "../_shared/public_data/countyResolver.ts";
import { lookupPropertyPublic } from "../_shared/public_data/publicLookupPipeline.ts";
import { equityScore } from "../_shared/scoring/equity.ts";
import { absenteeScore } from "../_shared/scoring/absentee.ts";
import { roofAgeLikelihood } from "../_shared/scoring/roofAge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { lat, lng, address, tenant_id, property_id, storm_event_id, polygon_id, force } = body;

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Validate tenant_id is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenant_id)) {
      return new Response(JSON.stringify({ error: "tenant_id must be a valid UUID" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!lat && !lng && !address) {
      return new Response(JSON.stringify({ error: "Provide lat/lng or address" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sanitize owner name — strip literal "null"/"unknown" strings
    const cleanOwner = (v: any) => {
      if (!v) return null;
      const s = String(v).trim().toLowerCase();
      return (s === 'null' || s === 'undefined' || s === 'unknown' || s === 'unknown owner') ? null : String(v).trim();
    };

    const timeoutMs = body.timeout_ms ?? 15000;

    // 1) Resolve location
    const loc = await resolveLocation({ lat, lng, address, timeoutMs });

    // 2) Check cache (skip if force=true)
    if (!force) {
    const { data: cached } = await supabase
      .from("storm_properties_public")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("normalized_address_key", loc.normalized_address_key)
      .maybeSingle();

    if (cached && cached.confidence_score >= 40) {
      const age = Date.now() - new Date(cached.updated_at).getTime();
      // BatchLeads-enriched records use shorter 7-day TTL; public-only get 30 days
      const maxAgeMs = cached.used_batchleads
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
      if (age < maxAgeMs) {
        // Sync cached data to canvassiq_properties before returning
        if (property_id && cleanOwner(cached.owner_name)) {
          const cachedRaw = cached.raw_data || {};
          const cachedPhones = cachedRaw.contact_phones || [];
          const cachedEmails = cachedRaw.contact_emails || [];
          const syncPayload: Record<string, any> = {
            enrichment_last_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          if (cleanOwner(cached.owner_name)) syncPayload.owner_name = cleanOwner(cached.owner_name);
          if (cachedPhones.length > 0) syncPayload.phone_numbers = cachedPhones.map((p: any) => p.number || p);
          if (cachedEmails.length > 0) syncPayload.emails = cachedEmails.map((e: any) => e.address || e);
          await supabase.from("canvassiq_properties").update(syncPayload).eq("id", property_id);
        }
        return new Response(JSON.stringify({ success: true, result: cached, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    } // end if (!force)

    // 3) Resolve county
    const county = await getCountyContext({
      lat: loc.lat, lng: loc.lng, state: loc.state,
      county_hint: loc.county_hint, timeoutMs,
    });

    // 4) Run pipeline (appraiser + tax + clerk + batchleads fallback)
    const result = await lookupPropertyPublic({
      loc, county,
      includeTax: body.include_tax ?? true,
      includeClerk: body.include_clerk ?? true,
      timeoutMs,
      stormEventId: storm_event_id,
      polygonId: polygon_id,
      tenantId: tenant_id,
    });

    // 5) Compute intelligence scores
    const scores = {
      equity: equityScore({
        assessedValue: result.assessed_value,
        lastSaleAmount: result.last_sale_amount,
        lastSaleDate: result.last_sale_date,
        homestead: result.homestead,
      }),
      absentee: absenteeScore({
        propertyAddress: result.property_address,
        mailingAddress: result.owner_mailing_address,
        homestead: result.homestead,
        ownerName: result.owner_name,
      }),
      roof_age: roofAgeLikelihood({
        yearBuilt: result.year_built,
        lastSaleDate: result.last_sale_date,
        homestead: result.homestead,
      }),
    };

    // 6) Upsert to storm_properties_public
    // Sanitize date fields - scrapers sometimes return "Not provided" or other non-date strings
    const sanitizeDate = (v: any) => (v && !isNaN(Date.parse(v)) ? v : null);

    const row = {
      tenant_id,
      storm_event_id: storm_event_id ?? null,
      polygon_id: polygon_id ?? null,
      property_address: result.property_address,
      county: county.county_name,
      county_fips: county.county_fips ?? null,
      state: loc.state,
      parcel_id: result.parcel_id ?? null,
      owner_name: result.owner_name ?? null,
      owner_mailing_address: result.owner_mailing_address ?? null,
      living_sqft: result.living_sqft ?? null,
      year_built: result.year_built ?? null,
      lot_size: result.lot_size ?? null,
      land_use: result.land_use ?? null,
      last_sale_date: sanitizeDate(result.last_sale_date),
      last_sale_amount: result.last_sale_amount ?? null,
      homestead: result.homestead ?? false,
      mortgage_lender: result.mortgage_lender ?? null,
      assessed_value: result.assessed_value ?? null,
      confidence_score: result.confidence_score,
      source_appraiser: result.sources.appraiser ?? null,
      source_tax: result.sources.tax ?? null,
      source_clerk: result.sources.clerk ?? null,
      source_esri: false,
      source_osm: false,
      lat: loc.lat,
      lng: loc.lng,
      normalized_address_key: loc.normalized_address_key,
      used_batchleads: result.sources.used_batchleads ?? false,
      batchleads_payload: result.raw.batchleads ?? null,
      raw_data: result.raw,
      scores,
      updated_at: new Date().toISOString(),
    };

    // Only cache results with confidence >= 10; skip caching junk results
    let saved = row;
    if (result.confidence_score >= 10) {
      const { data: upserted, error: upsertErr } = await supabase
        .from("storm_properties_public")
        .upsert(row, { onConflict: "tenant_id,normalized_address_key" })
        .select()
        .single();

      if (upsertErr) console.error("[storm-public-lookup] upsert error", upsertErr);
      if (upserted) saved = upserted;
    } else {
      console.log(`[storm-public-lookup] skipping cache for low-confidence result (${result.confidence_score})`);
    }

    // 6) Update canvassiq_properties if property_id provided (no owner_name gate)

    if (property_id) {
      const contactPhones = result.contact_phones || [];
      const contactEmails = result.contact_emails || [];

      const updatePayload: Record<string, any> = {
        enrichment_last_at: new Date().toISOString(),
        enrichment_source: ["public_data", "firecrawl_people_search"],
        updated_at: new Date().toISOString(),
        searchbug_data: {
          owners: result.owner_name
            ? [{ id: "1", name: result.owner_name, age: result.contact_age, is_primary: true }]
            : [],
          phones: contactPhones,
          emails: contactEmails,
          relatives: result.contact_relatives || [],
          source: "firecrawl_people_search",
          enriched_at: new Date().toISOString(),
        },
        property_data: {
          source: "public_data_engine",
          confidence_score: result.confidence_score,
          parcel_id: result.parcel_id,
          year_built: result.year_built,
          living_sqft: result.living_sqft,
          homestead: result.homestead,
          county: county.county_name,
          sources: Object.keys(result.sources).filter(k => result.sources[k]),
          enriched_at: new Date().toISOString(),
        },
      };

      // Only write non-null/non-junk values to avoid clobbering existing data
      if (cleanOwner(result.owner_name)) updatePayload.owner_name = cleanOwner(result.owner_name);
      if (contactPhones.length > 0) updatePayload.phone_numbers = contactPhones.map((p: any) => p.number);
      if (contactEmails.length > 0) updatePayload.emails = contactEmails.map((e: any) => e.address);

      await supabase.from("canvassiq_properties").update(updatePayload).eq("id", property_id);
    }

    return new Response(
      JSON.stringify({ success: true, result: saved ?? row, cached: false, pipeline: result, scores }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[storm-public-lookup] error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
