// supabase/functions/storm-intel-score/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { scoreDamage } from "../_shared/intel/damage.ts";
import { scoreEquity } from "../_shared/intel/equity.ts";
import { scoreClaimLikelihood } from "../_shared/intel/claim.ts";
import { computePriority } from "../_shared/intel/priority.ts";

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
    const { tenant_id, storm_event_id, normalized_address_key } = body;

    if (!tenant_id || !storm_event_id || !normalized_address_key) {
      return new Response(
        JSON.stringify({ error: "tenant_id, storm_event_id, normalized_address_key required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch storm + property + tenant config + county config in parallel
    const [stormRes, propRes, tenantCfgRes] = await Promise.all([
      supabase.from("storm_events").select("*").eq("id", storm_event_id).eq("tenant_id", tenant_id).single(),
      supabase.from("storm_properties_public").select("*").eq("tenant_id", tenant_id).eq("normalized_address_key", normalized_address_key).single(),
      supabase.from("storm_intel_tenant_config").select("*").eq("tenant_id", tenant_id).maybeSingle(),
    ]);

    if (!stormRes.data || !propRes.data) {
      return new Response(
        JSON.stringify({ error: "storm or property not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const storm = stormRes.data;
    const prop = propRes.data;
    const tc = tenantCfgRes.data; // may be null

    // Try county config (zip-level first, then county-level)
    let countyConfig: any = null;
    if (prop.county && prop.state) {
      const { data: zipCfg } = await supabase
        .from("storm_intel_county_config")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("state", prop.state)
        .eq("county", prop.county)
        .eq("zip", prop.zip_code ?? "")
        .maybeSingle();

      if (zipCfg) {
        countyConfig = zipCfg;
      } else {
        const { data: countyCfg } = await supabase
          .from("storm_intel_county_config")
          .select("*")
          .eq("tenant_id", tenant_id)
          .eq("state", prop.state)
          .eq("county", prop.county)
          .is("zip", null)
          .maybeSingle();
        countyConfig = countyCfg;
      }
    }

    const propertySnapshot = {
      property_address: prop.property_address,
      owner_name: prop.owner_name,
      owner_mailing_address: prop.owner_mailing_address,
      homestead: prop.homestead,
      year_built: prop.year_built,
      living_sqft: prop.living_sqft,
      lot_size: prop.lot_size,
      land_use: prop.land_use,
      last_sale_date: prop.last_sale_date,
      last_sale_amount: prop.last_sale_amount,
      mortgage_lender: prop.mortgage_lender,
      confidence_score: prop.confidence_score,
      lat: prop.lat,
      lng: prop.lng,
    };

    // Build config objects from tenant + county configs
    const damageConfig = tc ? {
      hail_points_per_inch: Number(tc.hail_points_per_inch),
      hail_cap: tc.hail_cap,
      wind_points_per_3mph: Number(tc.wind_points_per_3mph),
      wind_cap: tc.wind_cap,
      age_points_per_2yrs: Number(tc.age_points_per_2yrs),
      age_cap: tc.age_cap,
    } : undefined;

    const equityConfig = {
      ppsf: countyConfig ? Number(countyConfig.ppsf) : (tc ? Number(tc.default_ppsf) : undefined),
      ltv_recent: countyConfig ? Number(countyConfig.ltv_recent) : undefined,
      ltv_5yr: countyConfig ? Number(countyConfig.ltv_5yr) : undefined,
      ltv_10yr: countyConfig ? Number(countyConfig.ltv_10yr) : undefined,
      ltv_older: countyConfig ? Number(countyConfig.ltv_older) : undefined,
    };

    const claimConfig = tc ? {
      claim_w_damage: Number(tc.claim_w_damage),
      claim_w_equity: Number(tc.claim_w_equity),
      claim_absentee_bonus: tc.claim_absentee_bonus,
      claim_homestead_low_damage_penalty: tc.claim_homestead_low_damage_penalty,
      claim_homestead_high_damage_bonus: tc.claim_homestead_high_damage_bonus,
    } : undefined;

    const priorityConfig = tc ? {
      w_damage: Number(tc.w_damage),
      w_equity: Number(tc.w_equity),
      w_claim: Number(tc.w_claim),
    } : undefined;

    const damage = scoreDamage({ storm, prop: propertySnapshot, config: damageConfig });
    const equity = scoreEquity({ prop: propertySnapshot, config: equityConfig });
    const claim = scoreClaimLikelihood({ prop: propertySnapshot, damage, equity, config: claimConfig });
    const priority = computePriority({ damage, equity, claim, config: priorityConfig });

    const row = {
      tenant_id,
      storm_event_id,
      property_id: prop.id ?? null,
      normalized_address_key,
      property_snapshot: propertySnapshot,
      damage_score: damage.score,
      equity_score: equity.score,
      claim_likelihood_score: claim.score,
      damage_factors: damage.factors,
      equity_factors: equity.factors,
      claim_factors: claim.factors,
      priority_score: priority,
    };

    const { data: saved } = await supabase
      .from("storm_property_intel")
      .upsert(row, { onConflict: "tenant_id,storm_event_id,normalized_address_key" })
      .select()
      .single();

    return new Response(
      JSON.stringify({ success: true, intel: saved ?? row }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[storm-intel-score] error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
