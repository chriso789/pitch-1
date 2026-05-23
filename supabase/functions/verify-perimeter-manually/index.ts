// ============================================================================
// VERIFY-PERIMETER-MANUALLY
// ----------------------------------------------------------------------------
// Human visual-QA approval for a measurement perimeter overlay (v1.4).
//
// After visually inspecting the Phase 3A.5 debug overlay (raw=gray,
// refined=green, selected=blue, target mask translucent), an authorized user
// can lock the selected perimeter as `user_verified_perimeter`. This bypasses
// the visual-review gate on the NEXT measurement run but still keeps
// customer_report_ready=false until downstream topology gates pass.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Authenticate caller.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "missing_authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const aiJobId: string | null = body.ai_measurement_job_id ?? body.aiMeasurementJobId ?? null;
    const approved: boolean = body.approved !== false;
    const editedPerimeterPx: Array<[number, number]> | null = Array.isArray(body.edited_perimeter_px)
      ? body.edited_perimeter_px
          .map((p: unknown) =>
            Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number"
              ? [p[0], p[1]] as [number, number]
              : null,
          )
          .filter((p: [number, number] | null): p is [number, number] => p !== null)
      : null;
    const editedPerimeterGeo: Array<[number, number]> | null = Array.isArray(body.edited_perimeter_geo)
      ? body.edited_perimeter_geo
          .map((p: unknown) =>
            Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number"
              ? [p[0], p[1]] as [number, number]
              : null,
          )
          .filter((p: [number, number] | null): p is [number, number] => p !== null)
      : null;

    if (!aiJobId) {
      return new Response(JSON.stringify({ error: "ai_measurement_job_id_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load the job to ensure caller has access and to merge into source_context.
    const { data: job, error: jobErr } = await supabase
      .from("ai_measurement_jobs")
      .select("id, tenant_id, lead_id, project_id, perimeter_visual_review_required, source_context")
      .eq("id", aiJobId)
      .single();
    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "job_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build source_context merge — keep edits in JSONB (schema-drift safe).
    const existingCtx = (job.source_context && typeof job.source_context === "object")
      ? job.source_context as Record<string, unknown>
      : {};
    const userEditedPerimeter = approved && (editedPerimeterPx?.length || editedPerimeterGeo?.length)
      ? {
          perimeter_px: editedPerimeterPx ?? null,
          perimeter_geo: editedPerimeterGeo ?? null,
          point_count: (editedPerimeterPx ?? editedPerimeterGeo ?? []).length,
          saved_at: new Date().toISOString(),
          saved_by: userId,
        }
      : null;

    const nextCtx: Record<string, unknown> = { ...existingCtx };
    if (userEditedPerimeter) {
      nextCtx.user_edited_perimeter = userEditedPerimeter;
    } else if (!approved) {
      // Rejection clears any prior edit so a rerun starts fresh.
      delete nextCtx.user_edited_perimeter;
    }

    const updates: Record<string, unknown> = approved
      ? {
        user_verified_perimeter: true,
        user_verified_perimeter_at: new Date().toISOString(),
        user_verified_perimeter_by: userId,
        perimeter_source_locked: "user_verified_perimeter",
        source_context: nextCtx,
      }
      : {
        user_verified_perimeter: false,
        user_verified_perimeter_at: null,
        user_verified_perimeter_by: null,
        perimeter_source_locked: null,
        source_context: nextCtx,
      };

    const { error: updErr } = await supabase
      .from("ai_measurement_jobs")
      .update(updates)
      .eq("id", aiJobId);
    if (updErr) throw updErr;

    return new Response(JSON.stringify({
      success: true,
      ai_measurement_job_id: aiJobId,
      user_verified_perimeter: approved,
      edited_perimeter_persisted: !!userEditedPerimeter,
      next_step: approved
        ? "Re-run AI Measurement with user_verified_perimeter=true to lock the perimeter and skip the visual-review gate. customer_report_ready remains false until downstream topology/pitch/benchmark gates pass."
        : "Verification cleared.",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("verify-perimeter-manually error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
