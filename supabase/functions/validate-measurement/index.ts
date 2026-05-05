import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Missing measurement result id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Read the measurement result
    const { data: result, error: readError } = await supabase
      .from("ai_measurement_results")
      .select("id, total_area_2d_sqft, total_area_pitch_adjusted_sqft, coverage, validated_face_count, total_face_count, footprint_confidence")
      .eq("id", id)
      .single();

    if (readError || !result) {
      return new Response(
        JSON.stringify({ error: `Measurement not found: ${readError?.message || "no record"}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call the validate_measurement SQL function
    const { data: validation, error: rpcError } = await supabase.rpc("validate_measurement", {
      p_coverage: result.coverage ?? 0,
      p_validated_faces: result.validated_face_count ?? 0,
      p_total_faces: result.total_face_count ?? 0,
      p_footprint_confidence: result.footprint_confidence ?? 0,
      p_area_flat: result.total_area_2d_sqft ?? 0,
      p_area_adjusted: result.total_area_pitch_adjusted_sqft ?? 0,
    });

    if (rpcError) {
      console.error("[VALIDATE_MEASUREMENT] RPC error:", rpcError);
      return new Response(
        JSON.stringify({ error: `Validation RPC failed: ${rpcError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isValid = validation?.is_valid ?? false;
    const failReasons: string[] = validation?.fail_reasons ?? [];
    const areaRatio = validation?.area_ratio ?? null;

    // Update the record
    const { error: updateError } = await supabase
      .from("ai_measurement_results")
      .update({
        is_valid: isValid,
        fail_reasons: failReasons.length > 0 ? failReasons : null,
        area_ratio: areaRatio,
        report_blocked: !isValid,
        blocked_reason: isValid ? null : failReasons.join("|"),
        needs_review: !isValid,
      })
      .eq("id", id);

    if (updateError) {
      console.error("[VALIDATE_MEASUREMENT] Update error:", updateError);
      return new Response(
        JSON.stringify({ error: `Failed to update record: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // CRITICAL: block bad output with 400
    if (!isValid) {
      return new Response(
        JSON.stringify({
          status: "FAILED",
          reasons: failReasons,
          area_ratio: areaRatio,
          message: "Measurement rejected due to invalid geometry",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: "ACCEPTED",
        area_ratio: areaRatio,
        message: "Measurement validated successfully",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[VALIDATE_MEASUREMENT] Unexpected error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
