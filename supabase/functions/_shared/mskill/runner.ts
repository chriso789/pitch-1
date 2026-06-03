// runMeasurementSkill — single chokepoint that creates mskill_runs rows,
// validates dependencies, dispatches by execution_target, persists outputs,
// and unblocks (or blocks) downstream skills.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSkill, allDownstreamOf, SKILL_KEYS_ORDERED } from "./registry.ts";
import { runGeocodeAddress } from "./executors/geocode_address.ts";
import { runResolveParcel } from "./executors/resolve_parcel.ts";
import { runResolveBuildingFootprint } from "./executors/resolve_building_footprint.ts";
import { runCreateRoofEdgeCandidates } from "./executors/create_roof_edge_candidates.ts";
import { runDiscoverLidarCoverage } from "./executors/discover_lidar_coverage.ts";
import { runDiscoverElevationAssets } from "./executors/discover_elevation_assets.ts";
import { runAcquireDemDtm } from "./executors/acquire_dem_dtm.ts";
import { runAcquireRoofSurfaceAsset } from "./executors/acquire_roof_surface_asset.ts";
import { runValidateGeometry } from "./executors/validate_geometry.ts";
import { runExportGeoJson } from "./executors/export_geojson.ts";
import { runExportReport } from "./executors/export_report.ts";
import { dispatchInternalWorkerJob } from "./worker_dispatch.ts";

export interface RunSkillInput {
  mskill_job_id: string;
  skill_key: string;
}

export interface RunSkillContext {
  svc: SupabaseClient;
  tenant_id: string;
  user_id: string | null;
}

export interface RunSkillResult {
  ok: boolean;
  status: string;
  skill_run_id?: string;
  output?: Record<string, unknown>;
  error?: string;
  blocking_reason?: string;
}

export interface ExecutorContext {
  svc: SupabaseClient;
  tenant_id: string;
  mskill_request_id: string;
  mskill_job_id: string;
  mskill_run_id: string;
  request_hash: string;
  request: Record<string, unknown>;
  job: Record<string, unknown>;
}

export interface ExecutorResult {
  output: Record<string, unknown>;
  artifacts?: Array<{ artifact_type: string; storage_path?: string | null; source_url?: string | null; metadata?: Record<string, unknown> }>;
  geometry_status_patch?: Record<string, unknown>;
}

type Executor = (ctx: ExecutorContext) => Promise<ExecutorResult>;

const CONTROL_PLANE_EXECUTORS: Record<string, Executor> = {
  geocode_address: runGeocodeAddress,
  resolve_parcel: runResolveParcel,
  resolve_building_footprint: runResolveBuildingFootprint,
  create_roof_edge_candidates: runCreateRoofEdgeCandidates,
  discover_lidar_coverage: runDiscoverLidarCoverage,
  discover_elevation_assets: runDiscoverElevationAssets,
  acquire_dem_dtm: runAcquireDemDtm,
  acquire_roof_surface_asset: runAcquireRoofSurfaceAsset,
  validate_geometry: runValidateGeometry,
  export_geojson: runExportGeoJson,
  export_report: runExportReport,
};

export async function runMeasurementSkill(
  ctx: RunSkillContext,
  input: RunSkillInput,
): Promise<RunSkillResult> {
  const skill = getSkill(input.skill_key);
  if (!skill) return { ok: false, status: "failed", error: `unknown skill: ${input.skill_key}` };

  // Load job + request
  const { data: job, error: jobErr } = await ctx.svc
    .from("mskill_jobs")
    .select("*")
    .eq("id", input.mskill_job_id)
    .eq("tenant_id", ctx.tenant_id)
    .maybeSingle();
  if (jobErr || !job) return { ok: false, status: "failed", error: "job not found" };

  const { data: request, error: reqErr } = await ctx.svc
    .from("mskill_requests")
    .select("*")
    .eq("id", job.mskill_request_id)
    .maybeSingle();
  if (reqErr || !request) return { ok: false, status: "failed", error: "request not found" };

  // Validate dependencies
  const depCheck = await validateSkillDependencies(ctx.svc, input.mskill_job_id, skill.skill_key);
  if (!depCheck.ok) {
    return await markSkillRun(ctx.svc, {
      ctx, job, request, skill,
      status: "blocked",
      blocking_reason: `missing_dependency: ${depCheck.missing.join(", ")}`,
    });
  }

  // Create skill_run row
  const { data: run, error: runErr } = await ctx.svc.from("mskill_runs").insert({
    tenant_id: ctx.tenant_id,
    mskill_request_id: request.id,
    mskill_job_id: job.id,
    request_hash: request.request_hash,
    skill_key: skill.skill_key,
    skill_version: skill.version,
    execution_target: skill.execution_target,
    status: "running",
    started_at: new Date().toISOString(),
    input_payload: { skill_key: skill.skill_key },
  }).select("*").single();
  if (runErr || !run) return { ok: false, status: "failed", error: runErr?.message ?? "run insert failed" };

  const startMs = Date.now();
  const execCtx: ExecutorContext = {
    svc: ctx.svc,
    tenant_id: ctx.tenant_id,
    mskill_request_id: request.id,
    mskill_job_id: job.id,
    mskill_run_id: run.id,
    request_hash: request.request_hash,
    request,
    job,
  };

  try {
    // Control-plane: execute in-process. Worker: dispatch.
    if (skill.execution_target === "internal_worker") {
      const dispatch = await dispatchInternalWorkerJob(ctx.svc, execCtx, skill);
      const finalStatus = dispatch.dispatched ? "queued" : "requires_internal_worker";
      await ctx.svc.from("mskill_runs").update({
        status: finalStatus,
        worker_id: dispatch.worker_id ?? null,
        worker_job_ref: dispatch.worker_job_ref ?? null,
        blocking_reason: dispatch.blocking_reason ?? null,
        output_payload: dispatch as unknown as Record<string, unknown>,
        duration_ms: Date.now() - startMs,
      }).eq("id", run.id);

      if (!dispatch.dispatched) {
        // Block downstream because worker is offline
        await blockDownstreamSkills(ctx.svc, job.id, skill.skill_key, `upstream_${skill.skill_key}_requires_internal_worker`);
      }
      return { ok: dispatch.dispatched, status: finalStatus, skill_run_id: run.id, output: dispatch as unknown as Record<string, unknown>, blocking_reason: dispatch.blocking_reason };
    }

    const executor = CONTROL_PLANE_EXECUTORS[skill.skill_key];
    if (!executor) {
      // hybrid skills without a local executor must defer to worker
      const dispatch = await dispatchInternalWorkerJob(ctx.svc, execCtx, skill);
      const finalStatus = dispatch.dispatched ? "queued" : "requires_internal_worker";
      await ctx.svc.from("mskill_runs").update({
        status: finalStatus,
        worker_id: dispatch.worker_id ?? null,
        worker_job_ref: dispatch.worker_job_ref ?? null,
        blocking_reason: dispatch.blocking_reason ?? null,
        output_payload: dispatch as unknown as Record<string, unknown>,
        duration_ms: Date.now() - startMs,
      }).eq("id", run.id);
      if (!dispatch.dispatched) {
        await blockDownstreamSkills(ctx.svc, job.id, skill.skill_key, `upstream_${skill.skill_key}_requires_internal_worker`);
      }
      return { ok: dispatch.dispatched, status: finalStatus, skill_run_id: run.id, output: dispatch as unknown as Record<string, unknown>, blocking_reason: dispatch.blocking_reason };
    }

    const result = await executor(execCtx);
    await ctx.svc.from("mskill_runs").update({
      status: "completed",
      output_payload: result.output,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startMs,
    }).eq("id", run.id);

    if (result.geometry_status_patch) {
      await upsertGeometryStatus(ctx.svc, ctx.tenant_id, job.id, request.request_hash, result.geometry_status_patch);
    }

    return { ok: true, status: "completed", skill_run_id: run.id, output: result.output };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.svc.from("mskill_runs").update({
      status: "failed",
      error_message: msg,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startMs,
    }).eq("id", run.id);
    await blockDownstreamSkills(ctx.svc, job.id, skill.skill_key, `upstream_${skill.skill_key}_failed`);
    return { ok: false, status: "failed", skill_run_id: run.id, error: msg };
  }
}

async function markSkillRun(
  svc: SupabaseClient,
  args: {
    ctx: RunSkillContext;
    job: Record<string, unknown>;
    request: Record<string, unknown>;
    skill: { skill_key: string; execution_target: string; version: string };
    status: string;
    blocking_reason?: string;
  },
): Promise<RunSkillResult> {
  const { data: run } = await svc.from("mskill_runs").insert({
    tenant_id: args.ctx.tenant_id,
    mskill_request_id: args.request.id,
    mskill_job_id: args.job.id,
    request_hash: args.request.request_hash,
    skill_key: args.skill.skill_key,
    skill_version: args.skill.version,
    execution_target: args.skill.execution_target,
    status: args.status,
    blocking_reason: args.blocking_reason ?? null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  }).select("id").single();
  return { ok: false, status: args.status, skill_run_id: run?.id, blocking_reason: args.blocking_reason };
}

export async function validateSkillDependencies(
  svc: SupabaseClient,
  mskill_job_id: string,
  skill_key: string,
): Promise<{ ok: boolean; missing: string[] }> {
  const skill = getSkill(skill_key);
  if (!skill || skill.dependencies.length === 0) return { ok: true, missing: [] };
  const { data: runs } = await svc
    .from("mskill_runs")
    .select("skill_key, status")
    .eq("mskill_job_id", mskill_job_id)
    .in("skill_key", skill.dependencies);
  const completed = new Set((runs ?? []).filter((r) => r.status === "completed").map((r) => r.skill_key));
  const missing = skill.dependencies.filter((d) => !completed.has(d));
  return { ok: missing.length === 0, missing };
}

export async function blockDownstreamSkills(
  svc: SupabaseClient,
  mskill_job_id: string,
  upstream_skill_key: string,
  blocking_reason: string,
) {
  const downstream = allDownstreamOf(upstream_skill_key);
  if (downstream.length === 0) return;
  // Mark any *new* runs needed; for simplicity we update existing pending/queued ones to blocked.
  await svc.from("mskill_runs")
    .update({ status: "blocked", blocking_reason })
    .eq("mskill_job_id", mskill_job_id)
    .in("skill_key", downstream)
    .in("status", ["pending", "queued"]);
  await svc.from("mskill_jobs")
    .update({ status: "blocked", blocked_reason: blocking_reason })
    .eq("id", mskill_job_id);
}

async function upsertGeometryStatus(
  svc: SupabaseClient,
  tenant_id: string,
  mskill_job_id: string,
  request_hash: string,
  patch: Record<string, unknown>,
) {
  const { data: existing } = await svc.from("mskill_geometry_status")
    .select("id")
    .eq("mskill_job_id", mskill_job_id)
    .maybeSingle();
  if (existing) {
    await svc.from("mskill_geometry_status").update(patch).eq("id", existing.id);
  } else {
    await svc.from("mskill_geometry_status").insert({
      tenant_id, mskill_job_id, request_hash, ...patch,
    });
  }
}

/** Returns one row per skill with most-recent run status. */
export async function getMeasurementSkillPipeline(
  svc: SupabaseClient,
  mskill_job_id: string,
) {
  const { data: runs } = await svc
    .from("mskill_runs")
    .select("id, skill_key, status, error_message, blocking_reason, started_at, finished_at, output_payload, worker_job_ref")
    .eq("mskill_job_id", mskill_job_id)
    .order("created_at", { ascending: false });
  const latestBySkill = new Map<string, typeof runs extends (infer T)[] ? T : never>();
  for (const r of runs ?? []) {
    if (!latestBySkill.has(r.skill_key)) latestBySkill.set(r.skill_key, r);
  }
  const { data: artifacts } = await svc
    .from("mskill_artifacts")
    .select("id, mskill_run_id, artifact_type, storage_path, source_url, byte_size")
    .eq("mskill_job_id", mskill_job_id);
  const artifactsByRun = new Map<string, typeof artifacts extends (infer T)[] ? T[] : never[]>();
  for (const a of artifacts ?? []) {
    const arr = (artifactsByRun.get(a.mskill_run_id) as any[]) ?? [];
    arr.push(a);
    artifactsByRun.set(a.mskill_run_id, arr as any);
  }
  return SKILL_KEYS_ORDERED.map((key) => {
    const skill = getSkill(key)!;
    const run = latestBySkill.get(key) ?? null;
    const arts = run ? (artifactsByRun.get(run.id) ?? []) : [];
    const status: string = run?.status ?? "pending";
    const cannotCompleteFromStub = (status === "completed") && arts.length === 0 && needsArtifact(key);
    return {
      skill_key: key,
      display_name: skill.display_name,
      category: skill.category,
      execution_target: skill.execution_target,
      pipeline_order: skill.pipeline_order,
      dependencies: skill.dependencies,
      worker_endpoint: skill.worker_endpoint,
      version: skill.version,
      status,
      blocking_reason: run?.blocking_reason ?? null,
      error_message: run?.error_message ?? null,
      started_at: run?.started_at ?? null,
      finished_at: run?.finished_at ?? null,
      worker_job_ref: run?.worker_job_ref ?? null,
      artifacts: arts,
      cannot_complete_from_stub: cannotCompleteFromStub,
      skill_run_id: run?.id ?? null,
    };
  });
}

function needsArtifact(skill_key: string): boolean {
  // Skills that MUST produce a real artifact to be considered "completed for real".
  return [
    "clip_point_cloud","generate_dsm","generate_dtm","generate_chm",
    "isolate_roof_points","fit_roof_planes","detect_ridges","detect_hips",
    "detect_valleys","detect_eaves","detect_rakes","calculate_pitch",
    "calculate_roof_area","export_geojson","export_report",
  ].includes(skill_key);
}
