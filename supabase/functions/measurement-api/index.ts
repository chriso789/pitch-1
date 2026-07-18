// measurement-api — routed Edge Function.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serviceClient, serveRouter } from "../_shared/router.ts";
import { classifySurface } from "../_shared/measurement-mapping/classifier.ts";
import { mapMeasurementsToTemplate } from "../_shared/measurement-mapping/mapper.ts";
import type { SurfaceClass, FeatureType } from "../_shared/measurement-mapping/types.ts";
import { runMeasurementSkill, getMeasurementSkillPipeline } from "../_shared/mskill/runner.ts";
import { computeRequestHash } from "../_shared/mskill/artifacts.ts";
import { MSKILL_REGISTRY } from "../_shared/mskill/registry.ts";
import { bridgeSkillReportToRoofMeasurements } from "../_shared/mskill/bridge.ts";
import { createSession as rtCreateSession, getSession as rtGetSession, runPerimeter as rtRunPerimeter, approveSession as rtApproveSession } from "../_shared/roof-trace/handlers.ts";

const app = createRouter("measurement-api");

app.get("/__health", (c) => jsonOk(c, { fn: "measurement-api", ok: true }));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

// Legacy 501 stubs (kept for compatibility with prior scaffold).
for (const r of ["/measure","/ai/start","/ai/analyze","/start","/calculate","/enhanced","/corrections/calculate","/override/recalculate","/validate","/validate/perimeter","/calibration","/compare/vendor","/accuracy/compare","/accuracy/score","/accuracy/track","/visualization/generate"]) {
  app.post(r, (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
}

// --- Section-aware measurement mapping (Phase 1) ---

/**
 * POST /measurement-imports/normalize
 * body: { roof_measurement_id: string, provider?: string, job_id?: string }
 * Creates a measurement_imports row plus segments derived from the existing
 * roof_measurements record. Never invents a flat/sloped split — aggregate-only
 * inputs produce ONE 'unknown' segment with pitch_scope='global'.
 */
app.post("/measurement-imports/normalize", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({}));
  const roofMeasurementId = body.roof_measurement_id as string | undefined;
  if (!roofMeasurementId) return jsonErr(c, "bad_request", "roof_measurement_id required", 400);

  const svc = serviceClient();
  const { data: rm, error: rmErr } = await svc
    .from("roof_measurements")
    .select("id, total_area_adjusted_sqft, total_area_flat_sqft, predominant_pitch, pitch_degrees, total_eave_length, total_rake_length, total_ridge_length, total_hip_length, total_valley_length, total_wall_flashing_length")
    .eq("id", roofMeasurementId)
    .maybeSingle();
  if (rmErr || !rm) return jsonErr(c, "not_found", "roof_measurement not found", 404);

  const { data: imp, error: impErr } = await svc
    .from("measurement_imports")
    .insert({
      tenant_id: tenantId,
      roof_measurement_id: rm.id,
      job_id: body.job_id ?? null,
      provider: body.provider ?? "roof_measurements",
      import_status: "normalized",
      raw_payload: { source_row: rm },
    })
    .select("id")
    .single();
  if (impErr || !imp) return jsonErr(c, "insert_failed", impErr?.message ?? "insert failed", 500);

  // Parse pitch like "6/12" -> 6
  const pitchStr = String(rm.predominant_pitch ?? "");
  const pitchMatch = pitchStr.match(/(\d+(?:\.\d+)?)\s*\/\s*12/);
  const pitchVal = pitchMatch ? Number(pitchMatch[1]) : null;

  const totalArea = Number(rm.total_area_adjusted_sqft ?? 0);
  const flatArea = Number(rm.total_area_flat_sqft ?? 0);

  const segmentsToInsert: any[] = [];
  if (totalArea > 0 && flatArea > 0 && flatArea < totalArea) {
    // Explicit flat breakout from provider — create flat + sloped residual.
    segmentsToInsert.push({
      tenant_id: tenantId,
      measurement_import_id: imp.id,
      name: "Flat (provider)",
      area_sqft: flatArea,
      pitch_rise_over_12: 0,
      pitch_scope: "segment",
      surface_class: "flat",
      classification_confidence: 0.97,
      classification_reason: "provider_explicit_flat",
    });
    const slopedArea = totalArea - flatArea;
    const cls = classifySurface({ pitch_rise_over_12: pitchVal, pitch_scope: "global" });
    segmentsToInsert.push({
      tenant_id: tenantId,
      measurement_import_id: imp.id,
      name: "Sloped (residual)",
      area_sqft: slopedArea,
      pitch_rise_over_12: pitchVal,
      pitch_scope: "global",
      surface_class: cls.surface_class,
      classification_confidence: Math.max(0.45, cls.confidence - 0.15),
      classification_reason: `${cls.reason}+split_residual`,
      is_split_residual: true,
    });
  } else if (totalArea > 0) {
    // Aggregate-only — never guess. One segment, class derived from pitch if present, else unknown.
    const cls = classifySurface({ pitch_rise_over_12: pitchVal, pitch_scope: "global" });
    segmentsToInsert.push({
      tenant_id: tenantId,
      measurement_import_id: imp.id,
      name: "Whole roof (aggregate)",
      area_sqft: totalArea,
      pitch_rise_over_12: pitchVal,
      pitch_scope: pitchVal == null ? "none" : "global",
      surface_class: cls.surface_class,
      classification_confidence: cls.confidence,
      classification_reason: cls.reason,
    });
  }

  if (segmentsToInsert.length) {
    await svc.from("measurement_segments").insert(segmentsToInsert);
  }

  const featuresToInsert: any[] = [];
  const featureMap: Array<[FeatureType, number | null]> = [
    ["eave", Number(rm.total_eave_length ?? 0)],
    ["rake", Number(rm.total_rake_length ?? 0)],
    ["ridge", Number(rm.total_ridge_length ?? 0)],
    ["hip", Number(rm.total_hip_length ?? 0)],
    ["valley", Number(rm.total_valley_length ?? 0)],
    ["wall_flashing", Number(rm.total_wall_flashing_length ?? 0)],
  ];
  for (const [type, len] of featureMap) {
    if (len && len > 0) {
      featuresToInsert.push({
        tenant_id: tenantId,
        measurement_import_id: imp.id,
        feature_type: type,
        length_ft: len,
        confidence: 0.8,
      });
    }
  }
  if (featuresToInsert.length) {
    await svc.from("measurement_features").insert(featuresToInsert);
  }

  return jsonOk(c, { measurement_import_id: imp.id, segments: segmentsToInsert.length, features: featuresToInsert.length });
});

/**
 * POST /measurement-imports/:id/manual-split
 * body: { flat?: { area_sqft }, sloped?: { area_sqft }, low_slope?: { area_sqft } }
 * Archives existing auto-classified segments and inserts synthetic reviewed ones.
 */
app.post("/measurement-imports/:id/manual-split", async (c) => {
  const tenantId = c.get("tenantId")!;
  const importId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const svc = serviceClient();

  const { data: imp } = await svc.from("measurement_imports").select("id, tenant_id").eq("id", importId).maybeSingle();
  if (!imp || imp.tenant_id !== tenantId) return jsonErr(c, "not_found", "import not found", 404);

  await svc
    .from("measurement_segments")
    .update({ archived_at: new Date().toISOString() })
    .eq("measurement_import_id", importId)
    .eq("tenant_id", tenantId)
    .is("archived_at", null);

  const rows: any[] = [];
  for (const cls of ["flat", "low_slope", "sloped"] as SurfaceClass[]) {
    const v = body?.[cls];
    if (v && Number(v.area_sqft) > 0) {
      rows.push({
        tenant_id: tenantId,
        measurement_import_id: importId,
        name: `${cls} (manual split)`,
        area_sqft: Number(v.area_sqft),
        pitch_rise_over_12: cls === "flat" ? 0 : cls === "low_slope" ? 3 : 6,
        pitch_scope: "segment",
        surface_class: cls,
        classification_confidence: 1,
        classification_reason: "manual_split",
        is_synthetic_split: true,
        reviewed: true,
      });
    }
  }
  if (rows.length) await svc.from("measurement_segments").insert(rows);
  await svc.from("measurement_imports").update({ import_status: "manual_split" }).eq("id", importId).eq("tenant_id", tenantId);
  return jsonOk(c, { measurement_import_id: importId, created: rows.length });
});

/**
 * POST /estimate-templates/:id/map-measurements
 * body: { measurement_import_id, estimate_id?, dry_run?: boolean }
 * Runs the mapping engine and returns { assignments, unresolved, conflicts }.
 * Persists rows to estimate_measurement_assignments with is_dry_run flag.
 */
app.post("/estimate-templates/:id/map-measurements", async (c) => {
  const tenantId = c.get("tenantId")!;
  const calcTemplateId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const importId = body.measurement_import_id as string | undefined;
  const estimateId = (body.estimate_id as string | undefined) ?? null;
  const dryRun = body.dry_run !== false;
  if (!importId) return jsonErr(c, "bad_request", "measurement_import_id required", 400);

  const svc = serviceClient();

  const [segRes, featRes, grpRes, itemRes, secRulesRes, itemRulesRes] = await Promise.all([
    svc.from("measurement_segments").select("*").eq("measurement_import_id", importId).eq("tenant_id", tenantId).is("archived_at", null),
    svc.from("measurement_features").select("*").eq("measurement_import_id", importId).eq("tenant_id", tenantId).is("archived_at", null),
    svc.from("estimate_calc_template_groups").select("id, name, group_type, sort_order").eq("calc_template_id", calcTemplateId).eq("tenant_id", tenantId),
    svc.from("estimate_calc_template_items").select("id, group_id, item_name, unit, qty_formula, measurement_type").eq("calc_template_id", calcTemplateId).eq("tenant_id", tenantId).eq("active", true),
    svc.from("template_section_rules").select("*").eq("tenant_id", tenantId),
    svc.from("template_item_rules").select("*").eq("tenant_id", tenantId),
  ]);

  if (grpRes.error || itemRes.error) return jsonErr(c, "template_fetch_failed", grpRes.error?.message ?? itemRes.error?.message ?? "fetch failed", 500);

  const groupIds = new Set((grpRes.data ?? []).map((g: any) => g.id));
  const itemIds = new Set((itemRes.data ?? []).map((i: any) => i.id));
  const sectionRules = (secRulesRes.data ?? []).filter((r: any) => groupIds.has(r.group_id));
  const itemRules = (itemRulesRes.data ?? []).filter((r: any) => itemIds.has(r.item_id));

  const result = mapMeasurementsToTemplate({
    measurement_import_id: importId,
    calc_template_id: calcTemplateId,
    segments: (segRes.data ?? []) as any,
    features: (featRes.data ?? []) as any,
    groups: (grpRes.data ?? []) as any,
    items: (itemRes.data ?? []) as any,
    section_rules: sectionRules as any,
    item_rules: itemRules as any,
  });

  // Idempotency contract:
  //   - dry_run=true  -> NEVER touches estimate_measurement_assignments. Pure preview.
  //   - dry_run=false -> Supersedes any prior active rows for (import,template,estimate)
  //                      then inserts a fresh batch under a new mapping_run_id.
  let mappingRunId: string | null = null;
  if (!dryRun) {
    mappingRunId = crypto.randomUUID();

    const supersedeQuery = svc
      .from("estimate_measurement_assignments")
      .update({ superseded_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("measurement_import_id", importId)
      .eq("calc_template_id", calcTemplateId)
      .eq("is_dry_run", false)
      .is("superseded_at", null);
    if (estimateId) supersedeQuery.eq("estimate_id", estimateId);
    else supersedeQuery.is("estimate_id", null);
    await supersedeQuery;

    const allAssignments = [...result.assignments, ...result.unresolved, ...result.conflicts];
    if (allAssignments.length) {
      const rows = allAssignments.map((a) => ({
        tenant_id: tenantId,
        estimate_id: estimateId,
        measurement_import_id: importId,
        calc_template_id: calcTemplateId,
        template_group_id: a.template_group_id,
        template_item_id: a.template_item_id,
        segment_ids: a.segment_ids,
        feature_ids: a.feature_ids,
        quantity: a.quantity,
        unit: a.unit,
        formula_evaluated: a.formula_evaluated,
        confidence: a.confidence,
        status: a.status,
        reason_code: a.reason_code,
        matched_by: a.matched_by,
        is_dry_run: false,
        mapping_run_id: mappingRunId,
      }));
      await svc.from("estimate_measurement_assignments").insert(rows);
    }
  }

  return jsonOk(c, { ...result, dry_run: dryRun, mapping_run_id: mappingRunId });
});

// ============================================================================
// PITCH Measure — Internal Skill Pipeline routes
// ============================================================================

app.post("/mskill/skills/list", (c) => {
  return jsonOk(c, { skills: MSKILL_REGISTRY });
});
app.get("/mskill/skills/list", (c) => {
  return jsonOk(c, { skills: MSKILL_REGISTRY });
});

app.post("/mskill/jobs/create", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const body = await c.req.json().catch(() => ({}));
  const inputAddress = String(body.input_address ?? "").trim();
  if (!inputAddress) return jsonErr(c, "bad_request", "input_address required", 400);
  const svc = serviceClient();

  const initialHash = await computeRequestHash({ input_address: inputAddress });
  const { data: request, error: reqErr } = await svc.from("mskill_requests").insert({
    tenant_id: tenantId,
    created_by: userId,
    input_address: inputAddress,
    request_hash: initialHash,
    status: "pending",
    contact_id: body.contact_id ?? null,
    lead_id: body.lead_id ?? null,
  }).select("id, request_hash").single();
  if (reqErr || !request) return jsonErr(c, "insert_failed", reqErr?.message ?? "request insert failed", 500);

  const { data: job, error: jobErr } = await svc.from("mskill_jobs").insert({
    tenant_id: tenantId,
    mskill_request_id: request.id,
    request_hash: request.request_hash,
    status: "pending",
    created_by: userId,
  }).select("id").single();
  if (jobErr || !job) return jsonErr(c, "insert_failed", jobErr?.message ?? "job insert failed", 500);

  return jsonOk(c, { mskill_request_id: request.id, mskill_job_id: job.id, request_hash: request.request_hash });
});

app.post("/mskill/jobs/get", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({}));
  const jobId = String(body.mskill_job_id ?? body.jobId ?? c.req.query("jobId") ?? "");
  if (!jobId) return jsonErr(c, "bad_request", "mskill_job_id required", 400);
  const svc = serviceClient();
  const { data: job } = await svc.from("mskill_jobs").select("*").eq("id", jobId).eq("tenant_id", tenantId).maybeSingle();
  if (!job) return jsonErr(c, "not_found", "job not found", 404);
  const { data: request } = await svc.from("mskill_requests").select("*").eq("id", job.mskill_request_id).maybeSingle();
  const { data: geo } = await svc.from("mskill_geometry_status").select("*").eq("mskill_job_id", jobId).maybeSingle();
  const { data: bridge } = await svc.from("mskill_pipeline_bridges").select("*").eq("mskill_job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return jsonOk(c, { job, request, geometry_status: geo, bridge });
});

app.post("/mskill/skills/pipeline", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({}));
  const jobId = String(body.mskill_job_id ?? body.jobId ?? c.req.query("jobId") ?? "");
  if (!jobId) return jsonErr(c, "bad_request", "mskill_job_id required", 400);
  const svc = serviceClient();
  const { data: job } = await svc.from("mskill_jobs").select("id, tenant_id").eq("id", jobId).maybeSingle();
  if (!job || job.tenant_id !== tenantId) return jsonErr(c, "not_found", "job not found", 404);
  const pipeline = await getMeasurementSkillPipeline(svc, jobId);
  return jsonOk(c, { pipeline });
});

app.post("/mskill/skills/run", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const body = await c.req.json().catch(() => ({}));
  const jobId = String(body.mskill_job_id ?? body.jobId ?? "");
  const skillKey = String(body.skill_key ?? "");
  if (!jobId || !skillKey) return jsonErr(c, "bad_request", "mskill_job_id + skill_key required", 400);
  const svc = serviceClient();
  const { data: job } = await svc.from("mskill_jobs").select("id, tenant_id").eq("id", jobId).maybeSingle();
  if (!job || job.tenant_id !== tenantId) return jsonErr(c, "not_found", "job not found", 404);
  const result = await runMeasurementSkill({ svc, tenant_id: tenantId, user_id: userId }, { mskill_job_id: jobId, skill_key: skillKey });
  return jsonOk(c, result);
});

app.get("/mskill/skills/run-status", async (c) => {
  const tenantId = c.get("tenantId")!;
  const runId = c.req.query("runId");
  if (!runId) return jsonErr(c, "bad_request", "runId required", 400);
  const svc = serviceClient();
  const { data: run } = await svc.from("mskill_runs").select("*").eq("id", runId).eq("tenant_id", tenantId).maybeSingle();
  if (!run) return jsonErr(c, "not_found", "run not found", 404);
  const { data: artifacts } = await svc.from("mskill_artifacts").select("*").eq("mskill_run_id", runId);
  return jsonOk(c, { run, artifacts });
});

app.post("/mskill/skills/retry", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const body = await c.req.json().catch(() => ({}));
  const runId = String(body.runId ?? body.skill_run_id ?? "");
  if (!runId) return jsonErr(c, "bad_request", "runId required", 400);
  const svc = serviceClient();
  const { data: run } = await svc.from("mskill_runs").select("*").eq("id", runId).eq("tenant_id", tenantId).maybeSingle();
  if (!run) return jsonErr(c, "not_found", "run not found", 404);
  const result = await runMeasurementSkill({ svc, tenant_id: tenantId, user_id: userId }, { mskill_job_id: run.mskill_job_id, skill_key: run.skill_key });
  return jsonOk(c, result);
});

app.post("/mskill/jobs/bridge", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({}));
  const jobId = String(body.mskill_job_id ?? body.jobId ?? "");
  if (!jobId) return jsonErr(c, "bad_request", "mskill_job_id required", 400);
  const svc = serviceClient();
  const result = await bridgeSkillReportToRoofMeasurements(svc, { tenant_id: tenantId, mskill_job_id: jobId });
  return jsonOk(c, result);
});


// ============================================================================
// PITCH Measure — Provider Source Inventory
// ============================================================================

const CATEGORY_ORDER = [
  "geocode","parcel","footprint","lidar","elevation","dem","dtm","dsm","point_cloud","roof_surface","worker_compute",
] as const;

function envFlagForProvider(key: string): string | null {
  const k = key.toLowerCase();
  if (k.includes("google")) return "GOOGLE_MAPS_API_KEY";
  if (k.includes("mapbox")) return "MAPBOX_ACCESS_TOKEN";
  if (k.includes("eagleview")) return "EAGLEVIEW_API_KEY";
  if (k.includes("hover")) return "HOVER_API_KEY";
  if (k.includes("nearmap")) return "NEARMAP_API_KEY";
  return null;
}

function outputTableForCategory(cat: string): string | null {
  switch (cat) {
    case "geocode": return "mskill_requests";
    case "parcel": return "mskill_parcels";
    case "footprint": return "mskill_building_footprints";
    case "lidar": return "mskill_lidar_windows";
    case "elevation": return "mskill_elevation_assets";
    case "roof_surface": return "mskill_roof_surface_assets";
    default: return null;
  }
}
function outputArtifactForCategory(cat: string): string | null {
  switch (cat) {
    case "geocode": return "geocode_result";
    case "parcel": return "parcel_geometry";
    case "footprint": return "building_footprint_geometry";
    case "lidar": return "lidar_window_metadata";
    case "elevation": return "elevation_asset";
    case "roof_surface": return "roof_surface_asset";
    default: return null;
  }
}

function computeNextBlocker(jobScope: any, registry: any[]): string | null {
  if (!jobScope) return null;
  const runs = jobScope.runs ?? [];
  const ordered = [...registry].sort((a, b) => a.pipeline_order - b.pipeline_order);
  for (const skill of ordered) {
    const r = runs.find((x: any) => x.skill_key === skill.skill_key);
    if (!r || r.status !== "completed") {
      return `${skill.skill_key} (#${skill.pipeline_order}, ${skill.execution_target}) — ${r?.status ?? "not_run"}`;
    }
  }
  return null;
}

async function buildProviderInventory(svc: ReturnType<typeof serviceClient>, tenantId: string, jobId?: string | null) {
  const [providersRes, coverageRes, logsRes, workersRes, registryRes] = await Promise.all([
    svc.from("mskill_provider_sources").select("*").order("category").order("provider_key"),
    svc.from("mskill_provider_coverage").select("*"),
    svc.from("mskill_provider_sync_logs").select("*").order("created_at", { ascending: false }).limit(500),
    svc.from("mskill_workers").select("*"),
    svc.from("mskill_registry").select("*").order("pipeline_order"),
  ]);

  let jobScope: any = null;
  if (jobId) {
    const { data: job } = await svc.from("mskill_jobs").select("id, tenant_id, mskill_request_id, request_hash").eq("id", jobId).maybeSingle();
    if (job && job.tenant_id === tenantId) {
      const [req, parcel, footprint, lidarWin, elevAssets, surfaceAssets, runs] = await Promise.all([
        svc.from("mskill_requests").select("*").eq("id", job.mskill_request_id).maybeSingle(),
        svc.from("mskill_parcels").select("*").eq("mskill_job_id", jobId).maybeSingle(),
        svc.from("mskill_building_footprints").select("*").eq("mskill_job_id", jobId).maybeSingle(),
        svc.from("mskill_lidar_windows").select("*").eq("mskill_job_id", jobId).maybeSingle(),
        svc.from("mskill_elevation_assets").select("*").eq("mskill_job_id", jobId),
        svc.from("mskill_roof_surface_assets").select("*").eq("mskill_job_id", jobId),
        svc.from("mskill_runs").select("id, skill_key, status, error_reason, started_at, completed_at").eq("mskill_job_id", jobId).order("created_at", { ascending: false }),
      ]);
      jobScope = {
        job, request: req.data ?? null,
        parcel: parcel.data ?? null,
        building_footprint: footprint.data ?? null,
        lidar_window: lidarWin.data ?? null,
        elevation_assets: elevAssets.data ?? [],
        roof_surface_assets: surfaceAssets.data ?? [],
        runs: runs.data ?? [],
      };
    }
  }

  const lastLogByKey: Record<string, any> = {};
  for (const log of logsRes.data ?? []) {
    if (!lastLogByKey[log.provider_key]) lastLogByKey[log.provider_key] = log;
  }
  const runsByKey: Record<string, any[]> = {};
  for (const r of jobScope?.runs ?? []) {
    (runsByKey[r.skill_key] ??= []).push(r);
  }

  const providerRows = (providersRes.data ?? []).map((p: any) => {
    const counties = (coverageRes.data ?? []).filter((c: any) => c.provider_key === p.provider_key);
    const log = lastLogByKey[p.provider_key];
    const envVar = envFlagForProvider(p.provider_key);
    return {
      provider_key: p.provider_key,
      provider_name: p.display_name,
      provider_type: "external_api",
      data_category: p.category,
      enabled: !!p.is_enabled,
      priority: p.metadata?.priority ?? null,
      jurisdiction: p.scope,
      query_url: p.base_url ?? p.metadata?.query_url ?? null,
      metadata_url: p.metadata?.metadata_url ?? null,
      download_url_template: p.metadata?.download_url_template ?? null,
      auth_required: !!envVar || !!p.metadata?.auth_required || !!p.requires_paid_toggle,
      required_env_var: envVar,
      requires_paid_toggle: !!p.requires_paid_toggle,
      coverage_records: counties.map((c: any) => ({
        county: c.county, state: c.state, data_year: c.data_year,
        resolution_m: c.resolution_m, asset_type: c.asset_type, source_url: c.source_url,
      })),
      last_test_status: log?.sync_status ?? null,
      last_http_status: log?.metadata?.http_status ?? null,
      last_success_at: log?.sync_status === "ok" ? log?.created_at : null,
      last_error: log?.sync_status && log.sync_status !== "ok" ? log.message : null,
      output_table: outputTableForCategory(p.category),
      output_artifact_type: outputArtifactForCategory(p.category),
      supports_roof_geometry: ["lidar","elevation","roof_surface","point_cloud","dsm"].includes(p.category),
      notes: p.metadata?.notes ?? null,
    };
  });

  const worker = (workersRes.data ?? [])[0] ?? null;
  const computeRows = (registryRes.data ?? [])
    .filter((s: any) => s.execution_target === "internal_worker" || s.execution_target === "hybrid")
    .map((s: any) => {
      const latest = (runsByKey[s.skill_key] ?? [])[0] ?? null;
      const capImpl = worker?.capabilities?.[s.skill_key]?.implemented ?? null;
      return {
        provider_key: `worker:${s.skill_key}`,
        provider_name: s.display_name,
        provider_type: "internal_worker",
        data_category: "worker_compute",
        enabled: !!s.is_active,
        priority: s.pipeline_order,
        jurisdiction: "internal",
        query_url: s.worker_endpoint,
        metadata_url: worker?.base_url ? `${worker.base_url}/capabilities` : null,
        download_url_template: null,
        auth_required: true,
        required_env_var: "INTERNAL_WORKER_API_KEY",
        requires_paid_toggle: false,
        worker_implemented: capImpl,
        worker_online: !!worker?.is_online,
        worker_last_health_check: worker?.last_health_check ?? null,
        last_test_status: latest?.status ?? null,
        last_http_status: null,
        last_success_at: latest?.status === "completed" ? latest.completed_at : null,
        last_error: latest && latest.status !== "completed" ? latest.error_reason : null,
        output_table: "mskill_artifacts",
        output_artifact_type: (s.produced_outputs ?? [])[0] ?? null,
        supports_roof_geometry: ["compute","geometry"].includes(s.category),
        notes: `pipeline order ${s.pipeline_order} · ${s.execution_target}`,
      };
    });

  const allRows = [...providerRows, ...computeRows];
  const grouped: Record<string, any[]> = {};
  for (const cat of CATEGORY_ORDER) grouped[cat] = [];
  for (const row of allRows) {
    const cat = (CATEGORY_ORDER as readonly string[]).includes(row.data_category) ? row.data_category : "geocode";
    (grouped[cat] ??= []).push(row);
  }

  return {
    generated_at: new Date().toISOString(),
    tenant_id: tenantId,
    job_scope: jobScope,
    groups: CATEGORY_ORDER.map((cat) => ({ category: cat, sources: grouped[cat] ?? [] })),
    flat: allRows,
    worker_summary: worker
      ? { worker_key: worker.worker_key, display_name: worker.display_name, base_url: worker.base_url, is_online: worker.is_online, last_health_check: worker.last_health_check }
      : null,
    next_blocker: computeNextBlocker(jobScope, registryRes.data ?? []),
  };
}

app.get("/mskill/providers/inventory", async (c) => {
  const tenantId = c.get("tenantId")!;
  const jobId = c.req.query("jobId") ?? null;
  const inv = await buildProviderInventory(serviceClient(), tenantId, jobId);
  return jsonOk(c, inv);
});
app.post("/mskill/providers/inventory", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({}));
  const jobId = (body.jobId as string | undefined) ?? null;
  const inv = await buildProviderInventory(serviceClient(), tenantId, jobId);
  return jsonOk(c, inv);
});

// Per-source connectivity probe. Read-only HEAD/GET. Logs to mskill_provider_sync_logs.
app.post("/mskill/providers/test", async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({}));
  const providerKey = String(body.provider_key ?? "");
  const mode = String(body.mode ?? "connection");
  if (!providerKey) return jsonErr(c, "bad_request", "provider_key required", 400);
  const svc = serviceClient();

  if (providerKey.startsWith("worker:")) {
    const { data: worker } = await svc.from("mskill_workers").select("*").limit(1).maybeSingle();
    if (!worker?.base_url) return jsonOk(c, { ok: false, status: "no_worker_configured" });
    try {
      const r = await fetch(`${worker.base_url}/health`, { headers: { "x-api-key": Deno.env.get("INTERNAL_WORKER_API_KEY") ?? "" } });
      const text = await r.text();
      await svc.from("mskill_provider_sync_logs").insert({ provider_key: providerKey, sync_status: r.ok ? "ok" : "fail", message: text.slice(0, 500), metadata: { http_status: r.status, tested_by: tenantId, mode } });
      return jsonOk(c, { ok: r.ok, http_status: r.status, body_preview: text.slice(0, 200) });
    } catch (e: any) {
      await svc.from("mskill_provider_sync_logs").insert({ provider_key: providerKey, sync_status: "fail", message: String(e?.message ?? e), metadata: { tested_by: tenantId, mode } });
      return jsonOk(c, { ok: false, error: String(e?.message ?? e) });
    }
  }

  const { data: prov } = await svc.from("mskill_provider_sources").select("*").eq("provider_key", providerKey).maybeSingle();
  if (!prov) return jsonErr(c, "not_found", "provider not found", 404);

  const url: string | null = prov.base_url ?? prov.metadata?.query_url ?? prov.metadata?.metadata_url ?? null;
  if (!url) {
    await svc.from("mskill_provider_sync_logs").insert({ provider_key: providerKey, sync_status: "skipped", message: "no testable URL configured", metadata: { mode } });
    return jsonOk(c, { ok: false, status: "no_url_configured", note: "Provider has no base_url/metadata_url to probe." });
  }
  try {
    const r = await fetch(url, { method: "GET", headers: { "User-Agent": "PITCH-ProviderInventory/1.0" } });
    const text = await r.text();
    await svc.from("mskill_provider_sync_logs").insert({ provider_key: providerKey, sync_status: r.ok ? "ok" : "fail", message: text.slice(0, 500), metadata: { http_status: r.status, mode, url } });
    return jsonOk(c, { ok: r.ok, http_status: r.status, url, body_preview: text.slice(0, 200) });
  } catch (e: any) {
    await svc.from("mskill_provider_sync_logs").insert({ provider_key: providerKey, sync_status: "fail", message: String(e?.message ?? e), metadata: { mode, url } });
    return jsonOk(c, { ok: false, error: String(e?.message ?? e), url });
  }
});

// ============================================================================
// RoofTrace AI — perimeter-first tracing workflow
// ============================================================================

app.post("/roof-trace/sessions", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const requestId = c.get("requestId")!;
  const body = await c.req.json().catch(() => ({}));
  try {
    const session = await rtCreateSession(
      { tenantId, userId, requestId },
      {
        address: body.address,
        lat: typeof body.lat === "number" ? body.lat : Number(body.lat),
        lng: typeof body.lng === "number" ? body.lng : Number(body.lng),
        job_id: body.job_id ?? null,
      },
    );
    return jsonOk(c, { session });
  } catch (e: any) {
    return jsonErr(c, "roof_trace_create_failed", String(e?.message ?? e), 400);
  }
});

app.get("/roof-trace/sessions/:id", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const requestId = c.get("requestId")!;
  const id = c.req.param("id");
  try {
    const result = await rtGetSession({ tenantId, userId, requestId }, id);
    return jsonOk(c, result);
  } catch (e: any) {
    return jsonErr(c, "roof_trace_get_failed", String(e?.message ?? e), 404);
  }
});

// Body-routed variant (edgeApi with __route uses POST /)
app.post("/roof-trace/sessions/get", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const requestId = c.get("requestId")!;
  const { session_id } = await c.req.json().catch(() => ({}));
  try {
    const result = await rtGetSession({ tenantId, userId, requestId }, session_id);
    return jsonOk(c, result);
  } catch (e: any) {
    return jsonErr(c, "roof_trace_get_failed", String(e?.message ?? e), 404);
  }
});

app.post("/roof-trace/sessions/run", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const requestId = c.get("requestId")!;
  const { session_id } = await c.req.json().catch(() => ({}));
  try {
    const result = await rtRunPerimeter({ tenantId, userId, requestId }, session_id);
    return jsonOk(c, result);
  } catch (e: any) {
    return jsonErr(c, "roof_trace_run_failed", String(e?.message ?? e), 500);
  }
});

app.post("/roof-trace/sessions/approve", async (c) => {
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const requestId = c.get("requestId")!;
  const { session_id } = await c.req.json().catch(() => ({}));
  try {
    const result = await rtApproveSession({ tenantId, userId, requestId }, session_id);
    return jsonOk(c, result);
  } catch (e: any) {
    return jsonErr(c, "roof_trace_approve_failed", String(e?.message ?? e), 400);
  }
});

serveRouter(app);



