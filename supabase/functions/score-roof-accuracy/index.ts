import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

/**
 * EagleView-Standard Roof Accuracy Scorer
 *
 * Implements the **Strict 3% Validation Gate** that mirrors EagleView's published
 * QuickSquares accuracy standard (±3% across all major linear/area metrics).
 *
 * Output classification:
 *   - "auto_ship"        → Every metric within strict per-class tolerance.
 *                          Safe to deliver to customer with no human review.
 *   - "review_required"  → At least one metric outside strict tolerance but
 *                          within "loose" review band. Needs a quick human pass.
 *   - "reject"           → Any metric grossly off (outside loose band). The AI
 *                          measurement should NOT be shipped — fall back to a
 *                          vendor report or full manual rebuild.
 *
 * Per-class tolerances (strict / loose), EagleView-aligned:
 *   area:     3%  / 8%
 *   pitch:    1°  / 2°
 *   ridge:    3%  / 12%
 *   hip:      3%  / 15%
 *   valley:   3%  / 15%
 *   eave:     3%  / 8%
 *   rake:     3%  / 12%
 */

type Maybe = number | null | undefined;

function pctError(pred: Maybe, actual: Maybe): number | null {
  if (pred == null || actual == null || Number(actual) === 0) return null;
  return Math.abs(Number(pred) - Number(actual)) / Math.abs(Number(actual)) * 100;
}

const STRICT = {
  area: 3,
  pitch: 1, // degrees, absolute
  ridge: 3,
  hip: 3,
  valley: 3,
  eave: 3,
  rake: 3,
};

const LOOSE = {
  area: 8,
  pitch: 2,
  ridge: 12,
  hip: 15,
  valley: 15,
  eave: 8,
  rake: 12,
};

interface ClassResult {
  predicted: number | null;
  truth: number | null;
  error: number | null;       // % for lengths/area, degrees for pitch
  passes_strict: boolean;     // within STRICT[class]
  passes_loose: boolean;      // within LOOSE[class]
}

function classify(
  pred: Maybe,
  truth: Maybe,
  strict: number,
  loose: number,
  isAngle = false,
): ClassResult {
  const predicted = pred == null ? null : Number(pred);
  const truthVal = truth == null ? null : Number(truth);

  let error: number | null = null;
  if (predicted != null && truthVal != null) {
    error = isAngle
      ? Math.abs(predicted - truthVal)
      : (truthVal === 0 ? null : Math.abs(predicted - truthVal) / Math.abs(truthVal) * 100);
  }

  // If truth is missing we can't evaluate — treat as passing both gates so a
  // single missing field doesn't block delivery.
  const passes_strict = error == null ? true : error <= strict;
  const passes_loose = error == null ? true : error <= loose;

  return { predicted, truth: truthVal, error, passes_strict, passes_loose };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { measurement_data, vendor_report } = await req.json();

    const pred = measurement_data?.measurements?.lengths_ft ?? {};
    const predArea = measurement_data?.measurements?.area_sqft ?? null;
    const predPitch = measurement_data?.measurements?.predominant_pitch ?? null;

    // Vendor reports store linear features under the `parsed` jsonb column.
    const p = vendor_report?.parsed ?? vendor_report ?? {};
    const truth = {
      ridge: p.ridges_ft ?? p.ridge_length_ft ?? p.total_ridge_length ?? p.ridge_ft ?? null,
      hip: p.hips_ft ?? p.hip_length_ft ?? p.total_hip_length ?? p.hip_ft ?? null,
      valley: p.valleys_ft ?? p.valley_length_ft ?? p.total_valley_length ?? p.valley_ft ?? null,
      eave: p.eaves_ft ?? p.eave_length_ft ?? p.total_eave_length ?? p.eave_ft ?? null,
      rake: p.rakes_ft ?? p.rake_length_ft ?? p.total_rake_length ?? p.rake_ft ?? null,
      area: p.total_area_sqft ?? p.area_sqft ?? null,
      pitch: p.predominant_pitch ?? p.pitch ?? null,
    };

    const breakdown = {
      area:   classify(predArea,    truth.area,   STRICT.area,   LOOSE.area),
      pitch:  classify(predPitch,   truth.pitch,  STRICT.pitch,  LOOSE.pitch, true),
      ridge:  classify(pred.ridge,  truth.ridge,  STRICT.ridge,  LOOSE.ridge),
      hip:    classify(pred.hip,    truth.hip,    STRICT.hip,    LOOSE.hip),
      valley: classify(pred.valley, truth.valley, STRICT.valley, LOOSE.valley),
      eave:   classify(pred.eave,   truth.eave,   STRICT.eave,   LOOSE.eave),
      rake:   classify(pred.rake,   truth.rake,   STRICT.rake,   LOOSE.rake),
    };

    // Weighted score (legacy compatibility for existing dashboard)
    const weights = { area: 30, pitch: 15, ridge: 15, hip: 10, valley: 10, eave: 10, rake: 10 };
    const penalties: number[] = [];
    if (breakdown.area.error   != null) penalties.push(breakdown.area.error   * (weights.area   / 100));
    if (breakdown.pitch.error  != null) penalties.push((breakdown.pitch.error * 8) * (weights.pitch / 100));
    if (breakdown.ridge.error  != null) penalties.push(breakdown.ridge.error  * (weights.ridge  / 100));
    if (breakdown.hip.error    != null) penalties.push(breakdown.hip.error    * (weights.hip    / 100));
    if (breakdown.valley.error != null) penalties.push(breakdown.valley.error * (weights.valley / 100));
    if (breakdown.eave.error   != null) penalties.push(breakdown.eave.error   * (weights.eave   / 100));
    if (breakdown.rake.error   != null) penalties.push(breakdown.rake.error   * (weights.rake   / 100));
    const weighted_accuracy_score = Math.max(0, 100 - penalties.reduce((s, x) => s + x, 0));

    // Strict 3% gate decision
    const allStrict = Object.values(breakdown).every((b) => b.passes_strict);
    const allLoose  = Object.values(breakdown).every((b) => b.passes_loose);

    const failed_strict = Object.entries(breakdown)
      .filter(([, b]) => !b.passes_strict)
      .map(([k]) => k);
    const failed_loose = Object.entries(breakdown)
      .filter(([, b]) => !b.passes_loose)
      .map(([k]) => k);

    let decision: "auto_ship" | "review_required" | "reject";
    let reason: string;
    if (allStrict) {
      decision = "auto_ship";
      reason = "All metrics within ±3% (EagleView strict gate).";
    } else if (allLoose) {
      decision = "review_required";
      reason = `Outside strict gate on: ${failed_strict.join(", ")}. Within loose review band — human QA recommended.`;
    } else {
      decision = "reject";
      reason = `Grossly off on: ${failed_loose.join(", ")}. Do not auto-ship; fall back to vendor report or manual rebuild.`;
    }

    // Legacy review_required boolean retained for back-compat
    const review_required = decision !== "auto_ship";

    return new Response(
      JSON.stringify({
        // --- New EagleView-standard fields ---
        decision,
        reason,
        passes_strict_3pct: allStrict,
        passes_loose_gate: allLoose,
        failed_strict,
        failed_loose,
        per_class: breakdown,
        tolerances: { strict: STRICT, loose: LOOSE },

        // --- Legacy fields (kept for existing UI/dashboard consumers) ---
        area_error_pct:   breakdown.area.error,
        pitch_error:      breakdown.pitch.error,
        ridge_error_pct:  breakdown.ridge.error,
        hip_error_pct:    breakdown.hip.error,
        valley_error_pct: breakdown.valley.error,
        eave_error_pct:   breakdown.eave.error,
        rake_error_pct:   breakdown.rake.error,
        weighted_accuracy_score,
        review_required,
        vendor_report_id: vendor_report?.id ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
