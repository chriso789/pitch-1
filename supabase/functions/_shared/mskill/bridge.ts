// bridgeSkillReportToRoofMeasurements — writes the validated mskill report into
// the existing roof_measurements table. Refuses to bridge stub/deferred results.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const REQUIRED_ARTIFACT_TYPES = [
  "roof_planes","ridge_segments","hip_segments","valley_segments",
  "eave_segments","rake_segments","pitch_results","roof_area_results",
  "export_geojson","export_report",
];

export interface BridgeResult {
  ok: boolean;
  bridge_status: "written" | "failed" | "blocked";
  target_record_id?: string;
  error?: string;
  missing?: string[];
}

export async function bridgeSkillReportToRoofMeasurements(
  svc: SupabaseClient,
  args: { tenant_id: string; mskill_job_id: string },
): Promise<BridgeResult> {
  const { data: job } = await svc.from("mskill_jobs").select("*").eq("id", args.mskill_job_id).eq("tenant_id", args.tenant_id).maybeSingle();
  if (!job) return { ok: false, bridge_status: "failed", error: "job not found" };

  const { data: request } = await svc.from("mskill_requests").select("*").eq("id", job.mskill_request_id).maybeSingle();
  if (!request) return { ok: false, bridge_status: "failed", error: "request not found" };
  if (request.request_hash !== job.request_hash) {
    return { ok: false, bridge_status: "blocked", error: "request_hash mismatch — stale job" };
  }

  // Require validate_geometry + export_report completed
  const { data: runs } = await svc.from("mskill_runs")
    .select("skill_key, status")
    .eq("mskill_job_id", job.id)
    .in("skill_key", ["validate_geometry","export_report","export_geojson"]);
  const completed = new Set((runs ?? []).filter((r) => r.status === "completed").map((r) => r.skill_key));
  const skillMissing = ["validate_geometry","export_report","export_geojson"].filter((k) => !completed.has(k));
  if (skillMissing.length) {
    return { ok: false, bridge_status: "blocked", error: `required skills not completed: ${skillMissing.join(", ")}`, missing: skillMissing };
  }

  // Require real artifacts
  const { data: arts } = await svc.from("mskill_artifacts")
    .select("artifact_type")
    .eq("mskill_job_id", job.id)
    .eq("request_hash", job.request_hash);
  const have = new Set((arts ?? []).map((a) => a.artifact_type));
  const missing = REQUIRED_ARTIFACT_TYPES.filter((t) => !have.has(t));
  if (missing.length) {
    return { ok: false, bridge_status: "blocked", error: `missing required artifacts: ${missing.join(", ")}`, missing };
  }

  // Pull final report JSON
  const { data: reportArt } = await svc.from("mskill_report_artifacts")
    .select("metadata")
    .eq("mskill_job_id", job.id)
    .eq("artifact_type", "report_json")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const report = (reportArt?.metadata as any)?.report_json;
  if (!report?.totals) {
    return { ok: false, bridge_status: "blocked", error: "report_json artifact missing totals" };
  }

  // Build compatibility payload. Only known-safe columns.
  const payload: Record<string, unknown> = {
    address: request.normalized_address ?? request.input_address,
    lat: request.lat,
    lng: request.lon,
    total_area_adjusted_sqft: report.totals["roof.total_sqft"] ?? null,
    total_area_flat_sqft: report.totals["roof.plan_sqft"] ?? null,
    total_ridge_length: report.totals["lf.ridge"] ?? null,
    total_hip_length: report.totals["lf.hip"] ?? null,
    total_valley_length: report.totals["lf.valley"] ?? null,
    total_eave_length: report.totals["lf.eave"] ?? null,
    total_rake_length: report.totals["lf.rake"] ?? null,
    source_pipeline: "mskill_runs",
    geometry_report_json: {
      source_pipeline: "mskill_runs",
      mskill_request_id: request.id,
      mskill_job_id: job.id,
      request_hash: request.request_hash,
      report,
    },
  };

  // Insert with safe strip-and-retry for unknown columns
  let writeRes = await svc.from("roof_measurements").insert(payload).select("id").single();
  let stripped: Record<string, unknown> = {};
  while (writeRes.error && /Could not find the .+ column/.test(writeRes.error.message ?? "")) {
    const match = writeRes.error.message.match(/Could not find the '([^']+)' column/);
    const badCol = match?.[1];
    if (!badCol || !(badCol in payload)) break;
    stripped[badCol] = (payload as any)[badCol];
    delete (payload as any)[badCol];
    (payload.geometry_report_json as any).schema_drift_stripped_columns = stripped;
    writeRes = await svc.from("roof_measurements").insert(payload).select("id").single();
  }
  if (writeRes.error || !writeRes.data) {
    const bridgeId = await persistBridge(svc, request, job, "failed", null, writeRes.error?.message);
    return { ok: false, bridge_status: "failed", error: writeRes.error?.message ?? "insert failed" };
  }

  const targetId = writeRes.data.id;
  await persistBridge(svc, request, job, "written", targetId);
  await svc.from("mskill_jobs").update({
    bridge_status: "written",
    target_roof_measurement_id: targetId,
    status: "completed",
  }).eq("id", job.id);

  return { ok: true, bridge_status: "written", target_record_id: targetId };
}

async function persistBridge(
  svc: SupabaseClient,
  request: any,
  job: any,
  status: "written" | "failed" | "blocked",
  targetId: string | null,
  errorMessage?: string,
): Promise<string> {
  const { data } = await svc.from("mskill_pipeline_bridges").insert({
    tenant_id: job.tenant_id,
    mskill_request_id: request.id,
    mskill_job_id: job.id,
    request_hash: request.request_hash,
    source_pipeline: "mskill_runs",
    target_table: "roof_measurements",
    target_record_id: targetId,
    bridge_status: status,
    error_message: errorMessage ?? null,
  }).select("id").single();
  return data?.id ?? "";
}
