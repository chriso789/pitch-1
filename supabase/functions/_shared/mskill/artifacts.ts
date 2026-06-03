// Artifact persistence with request_hash stamping. Refuses stale writes.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

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
