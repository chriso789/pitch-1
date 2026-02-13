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

    // Fetch storm + property
    const [stormRes, propRes] = await Promise.all([
      supabase.from("storm_events").select("*").eq("id", storm_event_id).eq("tenant_id", tenant_id).single(),
      supabase.from("storm_properties_public").select("*").eq("tenant_id", tenant_id).eq("normalized_address_key", normalized_address_key).single(),
    ]);

    if (!stormRes.data || !propRes.data) {
      return new Response(
        JSON.stringify({ error: "storm or property not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const storm = stormRes.data;
    const prop = propRes.data;

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

    const damage = scoreDamage({ storm, prop: propertySnapshot });
    const equity = scoreEquity({ prop: propertySnapshot });
    const claim = scoreClaimLikelihood({ prop: propertySnapshot, damage, equity });
    const priority = computePriority({ damage, equity, claim });

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
