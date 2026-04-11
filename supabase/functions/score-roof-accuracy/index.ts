import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function pctError(pred: number | null | undefined, actual: number | null | undefined): number | null {
  if (pred == null || actual == null || actual === 0) return null;
  return Math.abs(pred - actual) / Math.abs(actual) * 100;
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

    const truth = {
      ridge: vendor_report?.ridge_length_ft ?? vendor_report?.total_ridge_length ?? vendor_report?.ridge_ft ?? null,
      hip: vendor_report?.hip_length_ft ?? vendor_report?.total_hip_length ?? vendor_report?.hip_ft ?? null,
      valley: vendor_report?.valley_length_ft ?? vendor_report?.total_valley_length ?? vendor_report?.valley_ft ?? null,
      eave: vendor_report?.eave_length_ft ?? vendor_report?.total_eave_length ?? vendor_report?.eave_ft ?? null,
      rake: vendor_report?.rake_length_ft ?? vendor_report?.total_rake_length ?? vendor_report?.rake_ft ?? null,
      area: vendor_report?.total_area_sqft ?? vendor_report?.area_sqft ?? null,
      pitch: vendor_report?.predominant_pitch ?? vendor_report?.pitch ?? null,
    };

    const area_error_pct = pctError(predArea, truth.area);
    const ridge_error_pct = pctError(pred.ridge, truth.ridge);
    const hip_error_pct = pctError(pred.hip, truth.hip);
    const valley_error_pct = pctError(pred.valley, truth.valley);
    const eave_error_pct = pctError(pred.eave, truth.eave);
    const rake_error_pct = pctError(pred.rake, truth.rake);
    const pitch_error = predPitch != null && truth.pitch != null ? Math.abs(predPitch - truth.pitch) : null;

    const weights = { area: 30, pitch: 15, ridge: 15, hip: 10, valley: 10, eave: 10, rake: 10 };

    const penalties: number[] = [];
    if (area_error_pct != null) penalties.push(area_error_pct * (weights.area / 100));
    if (pitch_error != null) penalties.push((pitch_error * 8) * (weights.pitch / 100));
    if (ridge_error_pct != null) penalties.push(ridge_error_pct * (weights.ridge / 100));
    if (hip_error_pct != null) penalties.push(hip_error_pct * (weights.hip / 100));
    if (valley_error_pct != null) penalties.push(valley_error_pct * (weights.valley / 100));
    if (eave_error_pct != null) penalties.push(eave_error_pct * (weights.eave / 100));
    if (rake_error_pct != null) penalties.push(rake_error_pct * (weights.rake / 100));

    const totalPenalty = penalties.reduce((sum, p) => sum + p, 0);
    const weighted_accuracy_score = Math.max(0, 100 - totalPenalty);

    const review_required =
      (area_error_pct != null && area_error_pct > 12) ||
      (pitch_error != null && pitch_error > 2) ||
      [ridge_error_pct, hip_error_pct, valley_error_pct, eave_error_pct, rake_error_pct].some(
        (v) => v != null && v > 25
      );

    return new Response(
      JSON.stringify({
        area_error_pct,
        pitch_error,
        ridge_error_pct,
        hip_error_pct,
        valley_error_pct,
        eave_error_pct,
        rake_error_pct,
        weighted_accuracy_score,
        review_required,
        vendor_report_id: vendor_report?.id ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
