// supabase/functions/storm-public-lookup/index.ts
// Slim orchestrator — delegates to shared modular pipeline

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveLocation } from "../_shared/public_data/locationResolver.ts";
import { getCountyContext } from "../_shared/public_data/countyResolver.ts";
import { lookupPropertyPublic } from "../_shared/public_data/publicLookupPipeline.ts";

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
    const { lat, lng, address, tenant_id, property_id, storm_event_id, polygon_id } = body;

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!lat && !lng && !address) {
      return new Response(JSON.stringify({ error: "Provide lat/lng or address" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const timeoutMs = body.timeout_ms ?? 15000;

    // 1) Resolve location
    const loc = await resolveLocation({ lat, lng, address, timeoutMs });

    // 2) Check cache
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
        return new Response(JSON.stringify({ success: true, result: cached, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

    // 5) Upsert to storm_properties_public
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
      last_sale_date: result.last_sale_date ?? null,
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
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: upsertErr } = await supabase
      .from("storm_properties_public")
      .upsert(row, { onConflict: "tenant_id,normalized_address_key" })
      .select()
      .single();

    if (upsertErr) console.error("[storm-public-lookup] upsert error", upsertErr);

    // 6) Update canvassiq_properties if property_id provided
    if (property_id && result.owner_name) {
      await supabase.from("canvassiq_properties").update({
        owner_name: result.owner_name,
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
        updated_at: new Date().toISOString(),
      }).eq("id", property_id);
    }

    return new Response(
      JSON.stringify({ success: true, result: saved ?? row, cached: false, pipeline: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[storm-public-lookup] error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
