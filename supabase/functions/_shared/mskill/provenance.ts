// supabase/functions/_shared/mskill/provenance.ts
//
// Source provenance stamping for the mskill measurement pipeline.
// See docs/measurement-conflict-lock.md §3.
//
// Every artifact written via mskill, and every roof_measurements row written
// by the mskill bridge, MUST carry the fields produced by buildRouteProvenance
// below. Missing required fields throws — the caller is expected to fail
// closed rather than silently writing untraceable rows.

export type RouteProvenanceInput = {
  source_module: string;
  source_function: string;
  measurement_request_id: string;
  request_hash: string;
  mskill_job_id: string;
  skill_run_id?: string | null;
  measurement_job_id?: string | null;
  provider_key?: string | null;
  legacy_artifact?: boolean;
  wrapped_by_skill?: boolean;
  canonical_measurement_route?: boolean;
  route_warning?: string | null;
};

export type RouteProvenance = {
  source_module: string;
  source_function: string;
  provider_key: string | null;
  measurement_request_id: string;
  request_hash: string;
  measurement_job_id: string | null;
  mskill_job_id: string;
  skill_run_id: string | null;
  legacy_artifact: boolean;
  wrapped_by_skill: boolean;
  canonical_measurement_route: boolean;
  route_warning: string | null;
  stamped_at: string;
  stamp_version: 1;
};

const REQUIRED: Array<keyof RouteProvenanceInput> = [
  "source_module",
  "source_function",
  "measurement_request_id",
  "request_hash",
  "mskill_job_id",
];

export function buildRouteProvenance(input: RouteProvenanceInput): RouteProvenance {
  for (const k of REQUIRED) {
    const v = input[k];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`[mskill/provenance] missing required field: ${k}`);
    }
  }
  const legacy = input.legacy_artifact === true;
  return {
    source_module: input.source_module,
    source_function: input.source_function,
    provider_key: input.provider_key ?? null,
    measurement_request_id: input.measurement_request_id,
    request_hash: input.request_hash,
    measurement_job_id: input.measurement_job_id ?? null,
    mskill_job_id: input.mskill_job_id,
    skill_run_id: input.skill_run_id ?? null,
    legacy_artifact: legacy,
    wrapped_by_skill: input.wrapped_by_skill ?? !legacy,
    canonical_measurement_route: input.canonical_measurement_route ?? !legacy,
    route_warning: legacy
      ? (input.route_warning ?? "legacy_noncanonical_measurement_path")
      : (input.route_warning ?? null),
    stamped_at: new Date().toISOString(),
    stamp_version: 1,
  };
}

/**
 * Returns a shallow copy of `artifact` with `.provenance` populated. Caller is
 * responsible for persisting; this is a pure helper so it can be unit-tested
 * without a Supabase client.
 */
export function stampArtifactProvenance<T extends Record<string, unknown>>(
  artifact: T,
  input: RouteProvenanceInput,
): T & { provenance: RouteProvenance } {
  return { ...artifact, provenance: buildRouteProvenance(input) };
}

export function isCanonicalProvenance(p: Partial<RouteProvenance> | null | undefined): boolean {
  if (!p) return false;
  return p.canonical_measurement_route === true
    && p.legacy_artifact === false
    && typeof p.mskill_job_id === "string"
    && typeof p.measurement_request_id === "string";
}
