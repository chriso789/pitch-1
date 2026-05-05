import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Parse Roof Report — accepts structured measurement data from
 * Roofr / EagleView reports and feeds it into the estimate engine.
 *
 * Accepts either:
 *   1. Pre-extracted measurements JSON (from manual entry or client-side parsing)
 *   2. A pipeline_entry_id to pull existing roof_measurements from DB
 *
 * Returns structured measurement data ready for generate-estimate-from-measurement.
 */

interface ParsedReport {
  roof_area: number;
  squares: number;
  pitch: number;
  facets: number;
  eaves: number;
  rakes: number;
  valleys: number;
  hips: number;
  ridges: number;
  step_flashing: number;
  pipe_boots?: number;
  stories?: number;
  source: string;
  complexity: string;
  waste_factor: number;
}

function calculateComplexity(data: {
  facets: number;
  valleys: number;
  pitch: number;
  hips: number;
}): { complexity: string; waste_factor: number } {
  let score = 0;

  if (data.facets > 20) score += 3;
  else if (data.facets > 10) score += 2;
  else if (data.facets > 4) score += 1;

  if (data.valleys > 80) score += 2;
  else if (data.valleys > 40) score += 1;

  if (data.pitch >= 10) score += 2;
  else if (data.pitch >= 7) score += 1;

  if (data.hips > 150) score += 1;

  if (score <= 1) return { complexity: "simple", waste_factor: 1.10 };
  if (score <= 3) return { complexity: "medium", waste_factor: 1.15 };
  if (score <= 5) return { complexity: "medium-high", waste_factor: 1.15 };
  return { complexity: "complex", waste_factor: 1.18 };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { measurements, pipeline_entry_id, scope_project_id } = body;

    let parsed: ParsedReport;

    if (measurements) {
      // Direct structured input from frontend manual entry or client-side PDF parse
      const m = measurements;
      const area = m.roof_area || m.total_area_sqft || 0;
      const squares = m.squares || m.total_squares || area / 100;
      const pitch = m.pitch || 4;
      const facets = m.facets || m.facet_count || 1;
      const eaves = m.eaves || m.eaves_ft || 0;
      const rakes = m.rakes || m.rakes_ft || 0;
      const valleys = m.valleys || m.valleys_ft || 0;
      const hips = m.hips || m.hips_ft || 0;
      const ridges = m.ridges || m.ridges_ft || 0;
      const stepFlashing = m.step_flashing || m.step_flashing_ft || 0;

      const { complexity, waste_factor } = calculateComplexity({
        facets,
        valleys,
        pitch,
        hips,
      });

      parsed = {
        roof_area: area,
        squares: Math.round(squares * 10) / 10,
        pitch,
        facets,
        eaves,
        rakes,
        valleys,
        hips,
        ridges,
        step_flashing: stepFlashing,
        pipe_boots: m.pipe_boots || m.pipe_boot_count,
        stories: m.stories,
        source: m.source || "manual_entry",
        complexity,
        waste_factor,
      };
    } else if (pipeline_entry_id) {
      // Pull from roof_measurements table
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, serviceKey);

      const { data: mRow, error } = await sb
        .from("roof_measurements")
        .select(
          "total_area_adjusted_sqft, total_squares, total_eave_length, total_rake_length, total_valley_length, total_hip_length, total_ridge_length, total_step_flashing_length, predominant_pitch, facet_count"
        )
        .eq("pipeline_entry_id", pipeline_entry_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(`Measurement lookup failed: ${error.message}`);
      if (!mRow) throw new Error("No measurement found for this pipeline entry");

      let pitchVal = 4;
      if (mRow.predominant_pitch) {
        const match = String(mRow.predominant_pitch).match(/(\d+(?:\.\d+)?)/);
        if (match) pitchVal = parseFloat(match[1]);
      }

      const area = mRow.total_area_adjusted_sqft || 0;
      const facets = mRow.facet_count || 1;
      const valleys = mRow.total_valley_length || 0;
      const hips = mRow.total_hip_length || 0;

      const { complexity, waste_factor } = calculateComplexity({
        facets,
        valleys,
        pitch: pitchVal,
        hips,
      });

      parsed = {
        roof_area: area,
        squares: Math.round((mRow.total_squares || area / 100) * 10) / 10,
        pitch: pitchVal,
        facets,
        eaves: mRow.total_eave_length || 0,
        rakes: mRow.total_rake_length || 0,
        valleys,
        hips,
        ridges: mRow.total_ridge_length || 0,
        step_flashing: mRow.total_step_flashing_length || 0,
        source: "roof_measurement_db",
        complexity,
        waste_factor,
      };
    } else {
      throw new Error(
        'Provide either "measurements" object or "pipeline_entry_id"'
      );
    }

    // If scope_project_id provided, chain into estimate generation
    if (scope_project_id) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, serviceKey);

      // Call generate-estimate-from-measurement internally
      const { data: genResult, error: genError } = await sb.functions.invoke(
        "generate-estimate-from-measurement",
        {
          body: {
            measurements: {
              total_area_sqft: parsed.roof_area,
              total_squares: parsed.squares,
              eaves_ft: parsed.eaves,
              rakes_ft: parsed.rakes,
              valleys_ft: parsed.valleys,
              hips_ft: parsed.hips,
              ridges_ft: parsed.ridges,
              step_flashing_ft: parsed.step_flashing,
              pitch: parsed.pitch,
              facet_count: parsed.facets,
              pipe_boot_count: parsed.pipe_boots,
              stories: parsed.stories,
            },
            scope_project_id,
          },
        }
      );

      if (genError) throw new Error(`Estimate generation failed: ${genError.message}`);

      return new Response(
        JSON.stringify({
          success: true,
          parsed,
          estimate: genResult,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        parsed,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err: any) {
    console.error("parse-roof-report error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
