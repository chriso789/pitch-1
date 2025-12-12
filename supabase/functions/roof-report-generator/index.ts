// PITCH-CRM — Roof report generator (Roofr/EagleView-style JSON payload)
// - Produces: measurements summary + pitch breakdown + waste table + materials table
// - Fixes known issues: Ice & Water + Underlayment roll math, ridge cap & valley/drip-edge lengths
//
// NOTE: This function does NOT "measure" roofs from imagery.
// It formats a measurement object into a full report payload.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type PitchBreakdownRow = {
  pitch: string; // e.g. "6/12"
  area_sqft: number;
  percent?: number; // optional, can be computed later
};

type RoofMeasurements = {
  // Areas
  total_area_sqft: number;       // total roof area (use pitched if flat excluded)
  pitched_area_sqft?: number;    // optional; if omitted, total_area_sqft is used
  flat_area_sqft?: number;       // optional

  // Counts
  facet_count?: number;

  // Pitches
  predominant_pitch?: string;    // e.g. "10/12"
  pitches?: PitchBreakdownRow[];

  // Linear features (feet)
  ridges_ft?: number;
  hips_ft?: number;
  valleys_ft?: number;
  rakes_ft?: number;
  eaves_ft?: number;

  parapet_walls_ft?: number;
  flashing_ft?: number;
  step_flashing_ft?: number;

  // Roofr-style extras (optional)
  wall_flashing_ft?: number;
  transitions_ft?: number;
  unspecified_ft?: number;
};

type PropertyMeta = {
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  imagery_source?: string; // e.g. "Nearmap Nov 27, 2024"
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function n(v: unknown, fallback = 0): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// Roofr reports "Squares" as "rounded up to the nearest decimal".
// Implement as ceil to 1 decimal.
function ceil1(x: number): number {
  return Math.ceil(x * 10) / 10;
}

function ceilInt(x: number): number {
  return Math.ceil(x);
}

function safePitch(predominant: string | undefined, pitches: PitchBreakdownRow[] | undefined): string | null {
  if (predominant && predominant.includes("/")) return predominant;
  if (!pitches?.length) return null;
  const best = [...pitches].sort((a, b) => n(b.area_sqft) - n(a.area_sqft))[0];
  return best?.pitch ?? null;
}

const DEFAULT_WASTE_PCTS = [0, 10, 12, 15, 17, 20, 22] as const;
const MATERIAL_WASTE_PCTS = [0, 10, 12, 15] as const;

// These are calibrated to match the *example Roofr report you uploaded*.
// (They can be made configurable per catalog/product later.)
const MATERIAL_CATALOG = {
  shingles: [
    { key: "iko_cambridge", label: "IKO - Cambridge", unit: "bundle", coverage_sqft_per_bundle: 33.3 },
    { key: "ct_landmark", label: "CertainTeed - Landmark", unit: "bundle", coverage_sqft_per_bundle: 32.8 },
    { key: "gaf_timberline", label: "GAF - Timberline", unit: "bundle", coverage_sqft_per_bundle: 32.8 },
    { key: "oc_duration", label: "Owens Corning - Duration", unit: "bundle", coverage_sqft_per_bundle: 32.8 },
    { key: "atlas_pristine", label: "Atlas - Pristine", unit: "bundle", coverage_sqft_per_bundle: 32.9 },
  ],
  starters: [
    { key: "iko_leading_edge_plus", label: "IKO - Leading Edge Plus", unit: "bundle", coverage_lf_per_bundle: 100 },
    { key: "ct_swiftstart", label: "CertainTeed - SwiftStart", unit: "bundle", coverage_lf_per_bundle: 100 },
    { key: "gaf_pro_start", label: "GAF - Pro-Start", unit: "bundle", coverage_lf_per_bundle: 100 },
    { key: "oc_starter_strip", label: "Owens Corning - Starter Strip", unit: "bundle", coverage_lf_per_bundle: 100 },
    // Atlas Pro-Cut appears to cover ~130 lf (so 2 bundles at 264 lf in your sample)
    { key: "atlas_pro_cut", label: "Atlas - Pro-Cut", unit: "bundle", coverage_lf_per_bundle: 130 },
  ],
  ice_and_water: [
    { key: "iko_stormshield", label: "IKO - StormShield", unit: "roll", coverage_lf_per_roll: 65 },
    { key: "ct_winterguard", label: "CertainTeed - WinterGuard", unit: "roll", coverage_lf_per_roll: 65 },
    { key: "gaf_weatherwatch", label: "GAF - WeatherWatch", unit: "roll", coverage_lf_per_roll: 65 },
    // WeatherLock behaves like a longer roll in your sample (5 rolls for 335 ft)
    { key: "oc_weatherlock", label: "Owens Corning - WeatherLock", unit: "roll", coverage_lf_per_roll: 75 },
    { key: "atlas_weathermaster", label: "Atlas - Weathermaster", unit: "roll", coverage_lf_per_roll: 65 },
  ],
  synthetics: [
    { key: "iko_stormtite", label: "IKO - Stormtite", unit: "roll", coverage_sqft_per_roll: 1000 },
    { key: "ct_roofrunner", label: "CertainTeed - RoofRunner", unit: "roll", coverage_sqft_per_roll: 1000 },
    { key: "gaf_deck_armor", label: "GAF - Deck-Armor", unit: "roll", coverage_sqft_per_roll: 1000 },
    { key: "oc_rhinoroof", label: "Owens Corning - RhinoRoof", unit: "roll", coverage_sqft_per_roll: 1000 },
    { key: "atlas_summit", label: "Atlas - Summit", unit: "roll", coverage_sqft_per_roll: 1000 },
  ],
  ridge_caps: [
    { key: "iko_hip_and_ridge", label: "IKO - Hip and Ridge", unit: "bundle", coverage_lf_per_bundle: 39 },
    { key: "ct_shadow_ridge", label: "CertainTeed - Shadow Ridge", unit: "bundle", coverage_lf_per_bundle: 29 },
    { key: "gaf_seal_a_ridge", label: "GAF - Seal-A-Ridge", unit: "bundle", coverage_lf_per_bundle: 25 },
    { key: "oc_decoridge", label: "Owens Corning - DecoRidge", unit: "bundle", coverage_lf_per_bundle: 20 },
    { key: "atlas_pro_cut_hr", label: "Atlas - Pro-Cut H&R", unit: "bundle", coverage_lf_per_bundle: 29 },
  ],
};

function buildWasteTable(base_area_sqft: number) {
  const base = n(base_area_sqft);
  const rows = DEFAULT_WASTE_PCTS.map((pct) => {
    const area = ceilInt(base * (1 + pct / 100));
    return {
      waste_pct: pct,
      area_sqft: area,
      squares: ceil1(area / 100),
    };
  });
  return rows;
}

function deriveLinears(m: RoofMeasurements) {
  const ridges = n(m.ridges_ft);
  const hips = n(m.hips_ft);
  const valleys = n(m.valleys_ft);
  const rakes = n(m.rakes_ft);
  const eaves = n(m.eaves_ft);

  const ridge_plus_hip = ridges + hips;
  const eaves_plus_rakes = eaves + rakes;

  const step = n(m.step_flashing_ft);
  const wall = n(m.wall_flashing_ft);
  const transitions = n(m.transitions_ft);

  // Roofr material calc label: "Ice and Water (eaves + valleys + flashings)"
  // Your sample matches: eaves + valleys + step flashing (and wall flashing if present).
  const ice_water_lf_base = eaves + valleys + step + wall + transitions;

  return {
    ridges_ft: ridges,
    hips_ft: hips,
    valleys_ft: valleys,
    rakes_ft: rakes,
    eaves_ft: eaves,
    ridge_plus_hip_ft: ridge_plus_hip,
    eaves_plus_rakes_ft: eaves_plus_rakes,
    drip_edge_ft: eaves_plus_rakes,
    ice_and_water_lf_base,
  };
}

function materialsForWaste(measurements: RoofMeasurements, wastePct: number) {
  const pitchedArea = n(measurements.pitched_area_sqft ?? measurements.total_area_sqft);
  const l = deriveLinears(measurements);

  const areaSqft = ceilInt(pitchedArea * (1 + wastePct / 100));
  const starterLf = ceilInt(l.eaves_plus_rakes_ft * (1 + wastePct / 100));
  const iceWaterLf = ceilInt(l.ice_and_water_lf_base * (1 + wastePct / 100));
  const cappingLf = ceilInt(l.ridge_plus_hip_ft * (1 + wastePct / 100));

  const valleySheets8ft = Math.ceil((l.valleys_ft * (1 + wastePct / 100)) / 8);
  const dripEdge10ft = Math.ceil((l.eaves_plus_rakes_ft * (1 + wastePct / 100)) / 10);

  const shingles = MATERIAL_CATALOG.shingles.map((p) => ({
    key: p.key,
    label: p.label,
    unit: p.unit,
    count: Math.ceil(areaSqft / p.coverage_sqft_per_bundle),
  }));

  const starters = MATERIAL_CATALOG.starters.map((p) => ({
    key: p.key,
    label: p.label,
    unit: p.unit,
    count: Math.ceil(starterLf / p.coverage_lf_per_bundle),
  }));

  const iceAndWater = MATERIAL_CATALOG.ice_and_water.map((p) => ({
    key: p.key,
    label: p.label,
    unit: p.unit,
    count: Math.ceil(iceWaterLf / p.coverage_lf_per_roll),
  }));

  const synthetics = MATERIAL_CATALOG.synthetics.map((p) => ({
    key: p.key,
    label: p.label,
    unit: p.unit,
    count: Math.ceil(areaSqft / p.coverage_sqft_per_roll),
  }));

  const ridgeCaps = MATERIAL_CATALOG.ridge_caps.map((p) => ({
    key: p.key,
    label: p.label,
    unit: p.unit,
    count: Math.ceil(cappingLf / p.coverage_lf_per_bundle),
  }));

  return {
    waste_pct: wastePct,
    shingle_area_sqft: areaSqft,
    starter_lf: starterLf,
    ice_and_water_lf: iceWaterLf,
    capping_lf: cappingLf,
    other: {
      valley_8ft_sheets: valleySheets8ft,
      drip_edge_10ft_sheets: dripEdge10ft,
    },
    products: {
      shingles,
      starters,
      ice_and_water: iceAndWater,
      synthetics,
      ridge_caps: ridgeCaps,
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();

    const property: PropertyMeta = body.property ?? {};
    const m: RoofMeasurements = body.measurements ?? body; // allow either {measurements:{...}} or direct payload

    const pitchedArea = n(m.pitched_area_sqft ?? m.total_area_sqft);
    const flatArea = n(m.flat_area_sqft);
    const totalArea = n(m.total_area_sqft);

    const pitches: PitchBreakdownRow[] = Array.isArray(m.pitches) ? m.pitches.map((p) => ({
      pitch: String(p.pitch ?? ""),
      area_sqft: n(p.area_sqft),
      percent: p.percent !== undefined ? n(p.percent) : undefined,
    })) : [];

    // If percentages not provided, compute from pitched area.
    const pitchRows = pitches.length
      ? pitches.map((p) => ({
          ...p,
          percent: p.percent ?? (pitchedArea > 0 ? round1((p.area_sqft / pitchedArea) * 100) : undefined),
        }))
      : [];

    const predominantPitch = safePitch(m.predominant_pitch, pitchRows);

    const wasteTable = buildWasteTable(pitchedArea);

    // Roofr-style: show materials table only up to 15% by default.
    const materialsTable = MATERIAL_WASTE_PCTS.map((pct) => materialsForWaste(m, pct));

    // Recommended waste (Roofr highlights 12% in your sample)
    const recommendedWastePct = n(body.recommended_waste_pct ?? 12);

    const recommendedMaterials = materialsForWaste(m, recommendedWastePct);

    const linear = deriveLinears(m);

    const report = {
      generated_at: new Date().toISOString(),
      provider: "PITCH",
      format_version: "2025-12-11",
      property,
      measurements: {
        total_area_sqft: totalArea,
        pitched_area_sqft: pitchedArea,
        flat_area_sqft: flatArea,
        facet_count: m.facet_count ?? null,
        predominant_pitch: predominantPitch,
        // linears
        ridges_ft: linear.ridges_ft,
        hips_ft: linear.hips_ft,
        valleys_ft: linear.valleys_ft,
        rakes_ft: linear.rakes_ft,
        eaves_ft: linear.eaves_ft,
        drip_edge_ft: linear.drip_edge_ft,
        ridge_plus_hip_ft: linear.ridge_plus_hip_ft,
        eaves_plus_rakes_ft: linear.eaves_plus_rakes_ft,
        parapet_walls_ft: n(m.parapet_walls_ft),
        flashing_ft: n(m.flashing_ft),
        step_flashing_ft: n(m.step_flashing_ft),
        wall_flashing_ft: n(m.wall_flashing_ft),
        transitions_ft: n(m.transitions_ft),
        unspecified_ft: n(m.unspecified_ft),
      },
      pitch_breakdown: pitchRows,
      waste_table: wasteTable,
      recommended: {
        waste_pct: recommendedWastePct,
        materials: recommendedMaterials,
      },
      materials_table: materialsTable,
    };

    console.log("roof-report-generator: Generated report for", property.address || "unknown address");

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("roof-report-generator error:", err);
    return new Response(
      JSON.stringify({
        error: "roof-report-generator_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
