// PR #5 — Street-facing visual edge-angle pitch cross-check.
// This is a cross-check stream only; it never replaces DSM/Solar consensus alone.

import { degreesToRiseOver12 } from "./consensus.ts";

export interface StreetViewMetadataRequest {
  lat: number;
  lng: number;
  heading_deg?: number | null;
  api_key: string;
}

export interface StreetViewMetadataResult {
  status: string;
  pano_id?: string | null;
  date?: string | null;
  location?: { lat: number; lng: number } | null;
  raw?: Record<string, unknown> | null;
}

export interface StreetViewEdgeAngleInput {
  facet_id: string | number;
  edge_angle_deg: number | null;
  horizon_angle_deg?: number | null;
  camera_pitch_deg?: number | null;
  reference_pitch_rise_over_12?: number | null;
  metadata?: StreetViewMetadataResult | null;
  confidence?: number | null;
}

export interface StreetViewPitchEvidenceResult {
  facet_id: string | number;
  status: "matched" | "unavailable" | "needs_review";
  pitch_degrees: number | null;
  pitch_rise_over_12: number | null;
  delta_vs_reference_rise_over_12: number | null;
  confidence: number;
  reason: string | null;
  metadata: Record<string, unknown>;
}

export function buildStreetViewMetadataUrl(req: StreetViewMetadataRequest): string {
  const url = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
  url.searchParams.set("location", `${req.lat},${req.lng}`);
  if (req.heading_deg != null && Number.isFinite(req.heading_deg)) {
    url.searchParams.set("heading", String(req.heading_deg));
  }
  url.searchParams.set("key", req.api_key);
  return url.toString();
}

export async function fetchStreetViewMetadata(req: StreetViewMetadataRequest): Promise<StreetViewMetadataResult> {
  if (!req.api_key) return { status: "NOT_CONFIGURED" };
  const res = await fetch(buildStreetViewMetadataUrl(req), { signal: AbortSignal.timeout(8_000) });
  const body = await res.json().catch(() => ({}));
  return {
    status: String(body.status ?? `HTTP_${res.status}`),
    pano_id: body.pano_id ?? null,
    date: body.date ?? null,
    location: body.location ?? null,
    raw: body,
  };
}

export function projectStreetViewEdgeAngleToPitch(input: Pick<StreetViewEdgeAngleInput, "edge_angle_deg" | "horizon_angle_deg" | "camera_pitch_deg">): {
  pitch_degrees: number | null;
  pitch_rise_over_12: number | null;
} {
  const edge = Number(input.edge_angle_deg);
  if (!Number.isFinite(edge)) return { pitch_degrees: null, pitch_rise_over_12: null };
  const horizon = Number(input.horizon_angle_deg ?? 0);
  const cameraPitch = Number(input.camera_pitch_deg ?? 0);
  const corrected = Math.abs(edge - horizon - cameraPitch);
  if (!Number.isFinite(corrected) || corrected < 0 || corrected > 75) {
    return { pitch_degrees: null, pitch_rise_over_12: null };
  }
  return {
    pitch_degrees: round(corrected, 3),
    pitch_rise_over_12: round(degreesToRiseOver12(corrected), 3),
  };
}

export function buildStreetViewPitchEvidence(input: StreetViewEdgeAngleInput): StreetViewPitchEvidenceResult {
  const metaStatus = input.metadata?.status ?? null;
  if (metaStatus && metaStatus !== "OK") {
    return unavailable(input, `streetview_metadata_${metaStatus}`);
  }

  const projected = projectStreetViewEdgeAngleToPitch(input);
  if (projected.pitch_rise_over_12 == null) return unavailable(input, "streetview_edge_angle_unavailable");

  const reference = input.reference_pitch_rise_over_12;
  const delta = reference == null || !Number.isFinite(reference)
    ? null
    : Math.abs(projected.pitch_rise_over_12 - reference);
  const confidence = clamp01(Number(input.confidence ?? 0.65)) * (delta == null ? 1 : Math.max(0.20, 1 - delta / 2));

  return {
    facet_id: input.facet_id,
    status: delta != null && delta > 1.0 ? "needs_review" : "matched",
    pitch_degrees: projected.pitch_degrees,
    pitch_rise_over_12: projected.pitch_rise_over_12,
    delta_vs_reference_rise_over_12: round(delta, 3),
    confidence: round(confidence, 4) ?? 0,
    reason: delta != null && delta > 1.0 ? "streetview_pitch_delta_high" : null,
    metadata: {
      source: "streetview_edge_angle",
      pano_status: metaStatus,
      pano_id: input.metadata?.pano_id ?? null,
      pano_date: input.metadata?.date ?? null,
      edge_angle_deg: input.edge_angle_deg,
      horizon_angle_deg: input.horizon_angle_deg ?? 0,
      camera_pitch_deg: input.camera_pitch_deg ?? 0,
    },
  };
}

function unavailable(input: StreetViewEdgeAngleInput, reason: string): StreetViewPitchEvidenceResult {
  return {
    facet_id: input.facet_id,
    status: "unavailable",
    pitch_degrees: null,
    pitch_rise_over_12: null,
    delta_vs_reference_rise_over_12: null,
    confidence: 0,
    reason,
    metadata: {
      source: "streetview_edge_angle",
      pano_status: input.metadata?.status ?? null,
      reason,
    },
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number | null | undefined, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}
