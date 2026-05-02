/**
 * compare-ai-measurement-to-vendor
 *
 * Offline benchmarking / training tool.
 * Compares a completed AI measurement against a vendor ground-truth report
 * (Roofr, EagleView, etc.) stored in `measurement_ground_truth`.
 *
 * ⚠️  This function is NEVER called from the live AI Measurement pipeline.
 *     It exists solely for QA dashboards, accuracy tracking, and model training.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function pctDelta(ai: number | null, vendor: number | null): number | null {
  if (ai == null || vendor == null || vendor === 0) return null;
  return Math.round(Math.abs(ai - vendor) / vendor * 1000) / 10; // one decimal
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { roof_measurement_id, vendor_report_id, address, tenant_id } =
      await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ---------- Load AI measurement ----------
    let aiData: any = null;
    if (roof_measurement_id) {
      const { data, error } = await supabase
        .from("roof_measurements")
        .select("*")
        .eq("id", roof_measurement_id)
        .single();
      if (error) throw new Error(`AI measurement not found: ${error.message}`);
      aiData = data;
    }

    // ---------- Load vendor ground truth ----------
    let vendorData: any = null;

    if (vendor_report_id) {
      const { data, error } = await supabase
        .from("measurement_ground_truth")
        .select("*")
        .eq("id", vendor_report_id)
        .single();
      if (error)
        throw new Error(`Vendor report not found: ${error.message}`);
      vendorData = data;
    } else if (address && tenant_id) {
      // Fuzzy address match
      const normalised = address.toLowerCase().replace(/[^a-z0-9]/g, "");
      const { data: candidates } = await supabase
        .from("measurement_ground_truth")
        .select("*")
        .eq("tenant_id", tenant_id);

      vendorData = (candidates || []).find((c: any) => {
        const cAddr = (c.address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return cAddr.includes(normalised.slice(0, 20));
      });
    }

    if (!aiData) {
      return new Response(
        JSON.stringify({ error: "roof_measurement_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!vendorData) {
      return new Response(
        JSON.stringify({
          ok: true,
          comparison: null,
          message: "No vendor ground truth found for this address/tenant.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---------- Extract metrics ----------
    const aiMeasurements = aiData.measurements || {};
    const aiLengths = aiMeasurements.lengths_ft || {};
    const aiFacets = aiMeasurements.facets_count ?? aiMeasurements.facet_count ?? null;
    const aiArea = aiMeasurements.area_sqft ?? null;
    const aiPitch = aiMeasurements.predominant_pitch ?? null;

    const v = vendorData.parsed || vendorData;
    const vendorArea = v.total_area_sqft ?? v.area_sqft ?? null;
    const vendorPitch = v.predominant_pitch ?? v.pitch ?? null;
    const vendorFacets = v.facets ?? v.facet_count ?? null;
    const vendorRidge = v.ridges_ft ?? v.ridge_length_ft ?? v.total_ridge_length ?? null;
    const vendorHip = v.hips_ft ?? v.hip_length_ft ?? v.total_hip_length ?? null;
    const vendorValley = v.valleys_ft ?? v.valley_length_ft ?? v.total_valley_length ?? null;
    const vendorEave = v.eaves_ft ?? v.eave_length_ft ?? v.total_eave_length ?? null;
    const vendorRake = v.rakes_ft ?? v.rake_length_ft ?? v.total_rake_length ?? null;

    const comparison = {
      ai_measurement_id: aiData.id,
      vendor_report_id: vendorData.id,
      vendor_provider: vendorData.provider || "unknown",

      area: { ai: aiArea, vendor: vendorArea, delta_pct: pctDelta(aiArea, vendorArea) },
      pitch: { ai: aiPitch, vendor: vendorPitch, delta_deg: aiPitch != null && vendorPitch != null ? Math.abs(aiPitch - vendorPitch) : null },
      facets: { ai: aiFacets, vendor: vendorFacets, delta: aiFacets != null && vendorFacets != null ? Math.abs(aiFacets - vendorFacets) : null },
      ridge: { ai: aiLengths.ridge ?? null, vendor: vendorRidge, delta_pct: pctDelta(aiLengths.ridge, vendorRidge) },
      hip: { ai: aiLengths.hip ?? null, vendor: vendorHip, delta_pct: pctDelta(aiLengths.hip, vendorHip) },
      valley: { ai: aiLengths.valley ?? null, vendor: vendorValley, delta_pct: pctDelta(aiLengths.valley, vendorValley) },
      eave: { ai: aiLengths.eave ?? null, vendor: vendorEave, delta_pct: pctDelta(aiLengths.eave, vendorEave) },
      rake: { ai: aiLengths.rake ?? null, vendor: vendorRake, delta_pct: pctDelta(aiLengths.rake, vendorRake) },

      needs_review: false,
      blocked_reasons: [] as string[],
    };

    // Flag structural mismatches
    if (comparison.facets.delta != null && comparison.facets.delta > 4) {
      comparison.needs_review = true;
      comparison.blocked_reasons.push("facet_count_mismatch");
    }
    if (comparison.area.delta_pct != null && comparison.area.delta_pct > 10) {
      comparison.needs_review = true;
      comparison.blocked_reasons.push("area_delta_exceeds_10pct");
    }
    if (vendorFacets != null && vendorFacets >= 8 && aiFacets != null && aiFacets <= 4) {
      comparison.needs_review = true;
      comparison.blocked_reasons.push("synthetic_template_undersegmented_complex_roof");
    }

    console.log("[VENDOR_TRUTH_COMPARISON]", JSON.stringify(comparison));

    return new Response(
      JSON.stringify({ ok: true, comparison }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[compare-ai-measurement-to-vendor] Error:", (e as Error).message);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
