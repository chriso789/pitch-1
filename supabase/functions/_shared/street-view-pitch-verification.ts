// Street-facing pitch cross-checks for PR #5.
//
// This helper never treats Street View as ground truth. It only records whether
// a street-facing edge-angle read agrees with DSM/geometry pitch inside the
// self-consistency tolerance.

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
  copyright?: string | null;
  raw?: Record<string, unknown>;
}

export interface StreetViewEdgeObservation {
  facet_id: string | number;
  edge_angle_deg: number;
  horizon_angle_deg?: number | null;
  camera_pitch_deg?: number | null;
  confidence?: number | null;
  metadata?: StreetViewMetadataResult | null;
}

export interface StreetViewPitchCheckResult {
  facet_id: string | number;
  available: boolean;
  pitch_rise_over_12: number | null;
  delta_vs_reference_rise_over_12: number | null;
  confidence: number;
  status: "passed" | "needs_review" | "unavailable";
  reason: string | null;
  source: "street_view";
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
  const url = buildStreetViewMetadataUrl(req);
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  const body = await res.json().catch(() => ({}));
  return {
    status: String(body.status ?? `HTTP_${res.status}`),
    pano_id: body.pano_id ?? null,
    date: body.date ?? null,
    location: body.location ?? null,
    copyright: body.copyright ?? null,
    raw: body,
  };
}

export function estimatePitchFromStreetViewEdgeAngle(
  observation: Pick<StreetViewEdgeObservation, "edge_angle_deg" | "horizon_angle_deg" | "camera_pitch_deg">,
): number | null {
  const edge = Number(observation.edge_angle_deg);
  if (!Number.isFinite(edge)) return null;
  const horizon = Number(observation.horizon_angle_deg ?? 0);
  const cameraPitch = Number(observation.camera_pitch_deg ?? 0);
  const correctedDeg = Math.abs(edge - horizon - cameraPitch);
  if (!Number.isFinite(correctedDeg) || correctedDeg < 0 || correctedDeg > 65) return null;
  const riseOverRun = Math.tan((correctedDeg * Math.PI) / 180);
  return round(riseOverRun * 12, 3);
}

export function checkStreetViewPitchAgainstReference(
  observation: StreetViewEdgeObservation,
  reference_pitch_rise_over_12: number | null,
  max_delta_rise_over_12 = 1.0,
): StreetViewPitchCheckResult {
  const metadataStatus = observation.metadata?.status ?? "UNKNOWN";
  if (observation.metadata && metadataStatus !== "OK") {
    return {
      facet_id: observation.facet_id,
      available: false,
      pitch_rise_over_12: null,
      delta_vs_reference_rise_over_12: null,
      confidence: 0,
      status: "unavailable",
      reason: `street_view_metadata_${metadataStatus}`,
      source: "street_view",
    };
  }

  const estimated = estimatePitchFromStreetViewEdgeAngle(observation);
  if (estimated == null || reference_pitch_rise_over_12 == null) {
    return {
      facet_id: observation.facet_id,
      available: estimated != null,
      pitch_rise_over_12: estimated,
      delta_vs_reference_rise_over_12: null,
      confidence: clamp01(Number(observation.confidence ?? 0.55)),
      status: "needs_review",
      reason: estimated == null ? "street_view_pitch_unavailable" : "reference_pitch_unavailable",
      source: "street_view",
    };
  }

  const delta = Math.abs(estimated - reference_pitch_rise_over_12);
  const confidence = clamp01(Number(observation.confidence ?? 0.65)) * Math.max(0.15, 1 - delta / (max_delta_rise_over_12 * 2));
  return {
    facet_id: observation.facet_id,
    available: true,
    pitch_rise_over_12: estimated,
    delta_vs_reference_rise_over_12: round(delta, 3),
    confidence: round(confidence, 4)!,
    status: delta <= max_delta_rise_over_12 ? "passed" : "needs_review",
    reason: delta <= max_delta_rise_over_12 ? null : "street_view_pitch_delta_high",
    source: "street_view",
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number | null | undefined, digits = 3): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}
