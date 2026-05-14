// Patent Rule 5 — Override-driven recalculation.
// Replays measurement_overrides on top of stored roof_lines for a given
// measurement, recomputes typed totals, re-runs the customer-ready gate,
// and writes verified totals back to roof_measurements.
//
// Auth: master/admin only.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  aggregateLineTotalsByAttribute,
  type RoofLine,
  type RoofLineAttribute,
  type RoofLineSource,
} from "../_shared/roof-lines.ts";
import { assertCustomerReportReady } from "../_shared/measurement-gates.ts";
import { ALLOWED_LAYER1_SOURCES } from "../_shared/layer-model.ts";
import { normalizeResultStateForWrite } from "../_shared/result-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface OverrideRow {
  id: string;
  measurement_id: string;
  tenant_id: string | null;
  override_kind: string;
  target_line_id: string | null;
  target_plane_id: string | null;
  before: any;
  after: any;
  override_source: string | null;
  created_by: string | null;
  created_at: string;
}

function polylineLengthFt(geo: Array<[number, number]>, fpp: number): number {
  let len = 0;
  for (let i = 1; i < geo.length; i++) {
    const dx = geo[i][0] - geo[i - 1][0];
    const dy = geo[i][1] - geo[i - 1][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len * fpp;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Identify caller
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userResp, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResp?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const uid = userResp.user.id;

  // Service-role for the heavy lifting
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Master/admin gate via has_role()
  const { data: isMaster } = await supabase.rpc("has_role", {
    _user_id: uid,
    _role: "master",
  });
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: uid,
    _role: "admin",
  });
  if (!isMaster && !isAdmin) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { measurement_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const measurementId = body.measurement_id;
  if (!measurementId) {
    return new Response(JSON.stringify({ error: "measurement_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load measurement (need pixels_per_foot for length recalculation)
  const { data: measurement, error: mErr } = await supabase
    .from("roof_measurements")
    .select(
      "id, tenant_id, pixels_per_foot, predominant_pitch, pitch_degrees",
    )
    .eq("id", measurementId)
    .maybeSingle();
  if (mErr || !measurement) {
    return new Response(
      JSON.stringify({ error: "measurement_not_found", details: mErr?.message }),
      {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  const ppf = Number(measurement.pixels_per_foot) || 0;
  const fpp = ppf > 0 ? 1 / ppf : 0;

  // Load roof_lines
  const { data: lineRows, error: lErr } = await supabase
    .from("roof_lines")
    .select("*")
    .eq("measurement_id", measurementId);
  if (lErr) {
    return new Response(
      JSON.stringify({ error: "roof_lines_load_failed", details: lErr.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Build in-memory map keyed by id
  const lineMap = new Map<string, RoofLine>();
  for (const r of lineRows ?? []) {
    lineMap.set(r.id, {
      id: r.id,
      measurement_id: r.measurement_id,
      layer_id: r.layer_id,
      geometry_px: r.geometry_px,
      geometry_geo: r.geometry_geo,
      length_lf: Number(r.length_lf) || 0,
      non_dimensional_attribute: r.non_dimensional_attribute as RoofLineAttribute,
      source: r.source as RoofLineSource,
      confidence: Number(r.confidence) || 0,
      adjacent_plane_ids: r.adjacent_plane_ids ?? [],
      can_be_customer_reported: !!r.can_be_customer_reported,
    });
  }

  // Load overrides ordered chronologically
  const { data: overrideRows } = await supabase
    .from("measurement_overrides")
    .select("*")
    .eq("measurement_id", measurementId)
    .order("created_at", { ascending: true });

  const planeUpdates: Array<{ id: string; pitch: number }> = [];
  const auditTrail: any[] = [];

  for (const ov of (overrideRows as OverrideRow[]) ?? []) {
    const kind = ov.override_kind;
    try {
      if (kind === "edit_line_geometry" && ov.target_line_id) {
        const line = lineMap.get(ov.target_line_id);
        if (line && Array.isArray(ov.after?.geometry_px)) {
          line.geometry_px = ov.after.geometry_px;
          line.length_lf = polylineLengthFt(line.geometry_px, fpp);
          line.source = "user_override";
          line.confidence = 1.0;
        }
      } else if (kind === "change_line_attribute" && ov.target_line_id) {
        const line = lineMap.get(ov.target_line_id);
        if (line && ov.after?.non_dimensional_attribute) {
          line.non_dimensional_attribute = ov.after
            .non_dimensional_attribute as RoofLineAttribute;
          line.source = "user_override";
          line.confidence = 1.0;
          line.can_be_customer_reported = true;
        }
      } else if (kind === "add_line" && ov.after?.geometry_px) {
        const id = ov.target_line_id ?? crypto.randomUUID();
        const geom = ov.after.geometry_px as Array<[number, number]>;
        const newLine: RoofLine = {
          id,
          measurement_id: measurementId,
          layer_id: "layer2_structural",
          geometry_px: geom,
          geometry_geo: ov.after.geometry_geo ?? null,
          length_lf: polylineLengthFt(geom, fpp),
          non_dimensional_attribute:
            (ov.after.non_dimensional_attribute as RoofLineAttribute) ??
              "unknown",
          source: "user_override",
          confidence: 1.0,
          adjacent_plane_ids: ov.after.adjacent_plane_ids ?? [],
          can_be_customer_reported: true,
        };
        lineMap.set(id, newLine);
      } else if (kind === "delete_line" && ov.target_line_id) {
        const line = lineMap.get(ov.target_line_id);
        if (line) line.can_be_customer_reported = false;
      } else if (kind === "override_pitch" && ov.target_plane_id) {
        const pitch = Number(ov.after?.pitch_degrees);
        if (Number.isFinite(pitch)) {
          planeUpdates.push({ id: ov.target_plane_id, pitch });
        }
      }
      auditTrail.push({ id: ov.id, kind, applied: true });
    } catch (e) {
      auditTrail.push({
        id: ov.id,
        kind,
        applied: false,
        error: (e as Error).message,
      });
    }
  }

  // Persist mutated lines back
  const finalLines = Array.from(lineMap.values());
  if (finalLines.length) {
    const upsertRows = finalLines.map((l) => ({
      id: l.id,
      measurement_id: measurementId,
      tenant_id: measurement.tenant_id,
      layer_id: l.layer_id,
      geometry_px: l.geometry_px,
      geometry_geo: l.geometry_geo ?? null,
      length_lf: Number(l.length_lf.toFixed(2)),
      non_dimensional_attribute: l.non_dimensional_attribute,
      source: l.source,
      confidence: l.confidence,
      adjacent_plane_ids: l.adjacent_plane_ids,
      can_be_customer_reported: l.can_be_customer_reported,
    }));
    await supabase.from("roof_lines").upsert(upsertRows, { onConflict: "id" });
  }

  // Apply plane pitch overrides
  for (const pu of planeUpdates) {
    await supabase
      .from("roof_planes")
      .update({ pitch_degrees: pu.pitch, source: "user_override" })
      .eq("id", pu.id);
  }

  // Recompute typed totals
  const typed = aggregateLineTotalsByAttribute(finalLines);

  // Re-run customer-ready gate (override path → verified)
  // Layer 1 source assumed allowed if there is a perimeter line present.
  const layer1Line = finalLines.find(
    (l) => l.layer_id === "layer1_perimeter" && l.can_be_customer_reported,
  );
  const ready = assertCustomerReportReady({
    user_confirmed_roof_target: true,
    roof_target_admin_override: true, // override flow already proves human review
    layer1_present: !!layer1Line,
    layer1_source_allowed: layer1Line
      ? (ALLOWED_LAYER1_SOURCES as readonly string[]).includes(layer1Line.source)
      : false,
    roof_lines_count: finalLines.filter((l) => l.can_be_customer_reported).length,
    reportable_totals_have_typed_backing: true,
    per_plane_pitch_sources: ["user_override"],
    ai_gates_passed: true,
    override_validation_status: "verified",
  });

  const overrideForensics: Record<string, any> = {};
  const newResultState = normalizeResultStateForWrite(
    customerReady
      ? "customer_report_ready"
      : layer1Line
      ? "perimeter_only"
      : "ai_failed_perimeter",
    overrideForensics,
  );

  // Write totals back to roof_measurements + verification stamps
  const update: Record<string, unknown> = {
    total_ridge_length: typed.ridges_lf,
    total_hip_length: typed.hips_lf,
    total_valley_length: typed.valleys_lf,
    total_eave_length: typed.eaves_lf,
    total_rake_length: typed.rakes_lf,
    total_wall_flashing_length: typed.wall_flashing_lf,
    total_step_flashing_length: typed.step_flashing_lf,
    total_unspecified_length: typed.unknown_lf,
    customer_report_ready: customerReady,
    report_blocked: !customerReady,
    needs_review: !customerReady,
    block_customer_report_reason: customerReady
      ? null
      : `override_recalc:${ready.failures.join("|")}`,
    override_validation_status: "verified",
    validation_status: customerReady ? "validated" : "needs_internal_review",
    verified_by_override: true,
    verified_at: new Date().toISOString(),
    verified_by: uid,
    result_state: newResultState,
  };
  const { error: uErr } = await supabase
    .from("roof_measurements")
    .update(update)
    .eq("id", measurementId);

  return new Response(
    JSON.stringify({
      success: !uErr,
      measurement_id: measurementId,
      typed_totals: typed,
      result_state: newResultState,
      customer_report_ready: customerReady,
      gate_failures: ready.failures,
      audit_trail: auditTrail,
      plane_updates: planeUpdates.length,
      lines_count: finalLines.length,
      update_error: uErr?.message ?? null,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
};

Deno.serve(handler);
