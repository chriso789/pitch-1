// Artifact persistence with request_hash stamping. Refuses stale writes.
//
// Two write paths coexist:
//   - writeSkillArtifact()              — legacy minimal write (backward compatible)
//   - writeMeasurementArtifactEnvelope() — Phase 3 canonical envelope write
//
// Live worker endpoints have NOT been migrated to the envelope writer yet.
// Adoption happens in a later phase per the contract.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  MeasurementArtifactEnvelope,
  MeasurementArtifactIssue,
} from "./artifact-envelope.ts";
import { validateMeasurementArtifactEnvelope } from "./artifact-envelope.ts";

export interface ArtifactInput {
  artifact_type: string;
  storage_path?: string | null;
  source_url?: string | null;
  byte_size?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ArtifactContext {
  tenant_id: string;
  mskill_request_id: string;
  mskill_job_id: string;
  mskill_run_id: string;
  request_hash: string;
}

export async function writeSkillArtifact(
  svc: SupabaseClient,
  ctx: ArtifactContext,
  artifact: ArtifactInput,
) {
  if (!ctx.request_hash) throw new Error("writeSkillArtifact: missing request_hash");
  if (!artifact.storage_path && !artifact.source_url) {
    throw new Error("writeSkillArtifact: artifact must include storage_path or source_url");
  }
  const { data, error } = await svc.from("mskill_artifacts").insert({
    tenant_id: ctx.tenant_id,
    mskill_request_id: ctx.mskill_request_id,
    mskill_job_id: ctx.mskill_job_id,
    mskill_run_id: ctx.mskill_run_id,
    request_hash: ctx.request_hash,
    artifact_type: artifact.artifact_type,
    storage_path: artifact.storage_path ?? null,
    source_url: artifact.source_url ?? null,
    byte_size: artifact.byte_size ?? null,
    metadata: artifact.metadata ?? {},
  }).select("id").single();
  if (error) throw new Error(`writeSkillArtifact failed: ${error.message}`);
  return data?.id as string;
}

/** Build a deterministic request_hash from address + place_id + lat/lon. */
export async function computeRequestHash(input: {
  input_address: string;
  normalized_address?: string | null;
  google_place_id?: string | null;
  lat?: number | null;
  lon?: number | null;
}): Promise<string> {
  const parts = [
    (input.input_address ?? "").trim().toLowerCase(),
    (input.normalized_address ?? "").trim().toLowerCase(),
    input.google_place_id ?? "",
    input.lat != null ? input.lat.toFixed(6) : "",
    input.lon != null ? input.lon.toFixed(6) : "",
  ].join("|");
  const buf = new TextEncoder().encode(parts);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Phase 3: canonical measurement artifact envelope persistence.
// ---------------------------------------------------------------------------

export interface WriteEnvelopeResult {
  mskill_artifact_id: string;
  artifact_id: string;
  issue_ids: string[];
}

/**
 * Persist a MeasurementArtifactEnvelope into mskill_artifacts (envelope-native
 * columns + full JSONB) and write any warnings/errors into
 * mskill_artifact_issues. Backward compatible with writeSkillArtifact —
 * legacy fields (storage_path/source_url/byte_size/metadata) are derived from
 * the envelope.storage block when present.
 *
 * This function does NOT mark validation as passed. validation_status is
 * mirrored from envelope.validation.validation_status as-is, and
 * export_allowed/report_allowed are mirrored from envelope.status only:
 *   - export_allowed = status in {"exportable","reportable"}
 *   - report_allowed = status === "reportable"
 */
export async function writeMeasurementArtifactEnvelope(
  svc: SupabaseClient,
  ctx: ArtifactContext,
  envelope: MeasurementArtifactEnvelope,
): Promise<WriteEnvelopeResult> {
  if (!ctx.request_hash) throw new Error("writeMeasurementArtifactEnvelope: missing request_hash");
  if (!ctx.tenant_id || !ctx.mskill_job_id || !ctx.mskill_run_id || !ctx.mskill_request_id) {
    throw new Error("writeMeasurementArtifactEnvelope: missing ctx ids");
  }
  const structuralErrors = validateMeasurementArtifactEnvelope(envelope);
  if (structuralErrors.length > 0) {
    throw new Error(
      `writeMeasurementArtifactEnvelope: invalid envelope — ${structuralErrors.join("; ")}`,
    );
  }

  const status = envelope.status;
  const exportAllowed = status === "exportable" || status === "reportable";
  const reportAllowed = status === "reportable";
  const storage = envelope.storage ?? null;

  const insertRow = {
    tenant_id: ctx.tenant_id,
    mskill_request_id: ctx.mskill_request_id,
    mskill_job_id: ctx.mskill_job_id,
    mskill_run_id: ctx.mskill_run_id,
    request_hash: ctx.request_hash,
    artifact_type: envelope.artifact_type,
    // legacy convenience mirrors (best effort)
    storage_path: (storage as { path?: string } | null)?.path ?? null,
    source_url: (storage as { url?: string } | null)?.url ?? null,
    byte_size: (storage as { byte_size?: number } | null)?.byte_size ?? null,
    metadata: {},
    // envelope-native columns
    artifact_id: envelope.artifact_id,
    schema_version: envelope.schema_version,
    envelope_version: envelope.envelope_version,
    parent_artifact_ids: envelope.parent_artifact_ids ?? [],
    stage: envelope.stage,
    source_skill: envelope.source_skill,
    producer_kind: envelope.producer?.kind ?? null,
    producer: envelope.producer ?? null,
    status: envelope.status,
    coordinate_frame: envelope.coordinate_frame ?? null,
    units: envelope.units ?? null,
    geometry: envelope.geometry ?? null,
    data: envelope.data ?? null,
    quality: envelope.quality ?? null,
    validation: envelope.validation ?? null,
    lineage: envelope.lineage ?? null,
    display: envelope.display ?? null,
    storage_block: storage,
    validation_status: envelope.validation?.validation_status ?? null,
    validation_confidence: (envelope.validation as { confidence?: number } | null)?.confidence ??
      null,
    export_allowed: exportAllowed,
    report_allowed: reportAllowed,
    envelope,
  };

  const { data: artifactRow, error } = await svc
    .from("mskill_artifacts")
    .insert(insertRow)
    .select("id")
    .single();
  if (error) throw new Error(`writeMeasurementArtifactEnvelope insert failed: ${error.message}`);

  const mskillArtifactId = artifactRow!.id as string;

  const issues: MeasurementArtifactIssue[] = [
    ...(envelope.warnings ?? []),
    ...(envelope.errors ?? []),
  ];

  let issueIds: string[] = [];
  if (issues.length > 0) {
    const issueRows = issues.map((iss) => ({
      tenant_id: ctx.tenant_id,
      mskill_request_id: ctx.mskill_request_id,
      mskill_job_id: ctx.mskill_job_id,
      mskill_run_id: ctx.mskill_run_id,
      artifact_id: envelope.artifact_id,
      mskill_artifact_id: mskillArtifactId,
      severity: iss.severity,
      code: iss.code,
      message: iss.message,
      object_type: (iss as { object_type?: string }).object_type ?? null,
      object_id: (iss as { object_id?: string }).object_id ?? null,
      source_skill: (iss as { source_skill?: string }).source_skill ?? envelope.source_skill,
      blocking: (iss as { blocking?: boolean }).blocking ?? (iss.severity === "blocker"),
      suggested_fix: (iss as { suggested_fix?: string }).suggested_fix ?? null,
      metadata: (iss as { metadata?: Record<string, unknown> }).metadata ?? {},
    }));
    const { data: issueData, error: issueErr } = await svc
      .from("mskill_artifact_issues")
      .insert(issueRows)
      .select("id");
    if (issueErr) {
      throw new Error(`writeMeasurementArtifactEnvelope issues failed: ${issueErr.message}`);
    }
    issueIds = (issueData ?? []).map((r: { id: string }) => r.id);
  }

  return {
    mskill_artifact_id: mskillArtifactId,
    artifact_id: envelope.artifact_id,
    issue_ids: issueIds,
  };
}
