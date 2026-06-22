// Vendor-free evidence-source helpers for PITCH Measure.
//
// This module records raw provider evidence used by the AI measurement system.
// Vendor report rows/PDFs are intentionally not supported here: live confidence
// must come from raw evidence only (parcel, footprint, DSM, RGB, LiDAR, mask,
// oblique/street-view checks) and internal self-consistency gates.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Position = [number, number]; // [lng, lat]
export type LinearRing = Position[];
export type PolygonGeometry = { type: "Polygon"; coordinates: LinearRing[] };
export type MultiPolygonGeometry = { type: "MultiPolygon"; coordinates: LinearRing[][] };
export type GeoJsonGeometry = PolygonGeometry | MultiPolygonGeometry | { type: string; coordinates?: unknown };

export interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties?: Record<string, unknown> | null;
  id?: string | number | null;
}

export interface EvidenceCandidate {
  evidence_kind: string;
  provider_key: string;
  geometry_geojson: GeoJsonGeometry;
  source_url?: string | null;
  external_id?: string | null;
  confidence: number;
  source_rank?: number | null;
  contains_target?: boolean | null;
  distance_m?: number | null;
  area_sqft?: number | null;
  metadata?: Record<string, unknown>;
}

export interface EvidenceContext {
  tenant_id: string;
  mskill_request_id: string;
  mskill_job_id: string;
  mskill_run_id?: string | null;
  request_hash: string;
}

export function clampConfidence(value: unknown, fallback = 0.5): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

export function round(value: number | null | undefined, digits = 3): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

export function featuresFromGeoJson(input: unknown): GeoJsonFeature[] {
  const obj = input as any;
  if (!obj) return [];
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return obj.features.filter((f: any) => f?.type === "Feature" && f.geometry);
  }
  if (obj.type === "Feature" && obj.geometry) return [obj as GeoJsonFeature];
  if (typeof obj.type === "string" && obj.coordinates) {
    return [{ type: "Feature", geometry: obj as GeoJsonGeometry, properties: {} }];
  }
  return [];
}

export function polygonAreaSqft(geometry: unknown): number | null {
  const g = geometry as GeoJsonGeometry | null;
  if (!g) return null;
  if (g.type === "Polygon") return Math.abs(areaRingSqft((g as PolygonGeometry).coordinates?.[0] ?? []));
  if (g.type === "MultiPolygon") {
    let total = 0;
    for (const poly of (g as MultiPolygonGeometry).coordinates ?? []) {
      total += Math.abs(areaRingSqft(poly?.[0] ?? []));
    }
    return total > 0 ? total : null;
  }
  return null;
}

function areaRingSqft(ring: LinearRing): number {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  const midLat = ring.reduce((s, p) => s + Number(p[1] ?? 0), 0) / ring.length;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((midLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const x1 = Number(ring[i][0]) * metersPerDegLng;
    const y1 = Number(ring[i][1]) * metersPerDegLat;
    const x2 = Number(ring[j][0]) * metersPerDegLng;
    const y2 = Number(ring[j][1]) * metersPerDegLat;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2) * 10.7639;
}

export function pointInGeoJson(lng: number, lat: number, geometry: unknown): boolean {
  const g = geometry as GeoJsonGeometry | null;
  if (!g) return false;
  if (g.type === "Polygon") return pointInPolygon([lng, lat], (g as PolygonGeometry).coordinates ?? []);
  if (g.type === "MultiPolygon") {
    return ((g as MultiPolygonGeometry).coordinates ?? []).some((poly) => pointInPolygon([lng, lat], poly));
  }
  return false;
}

function pointInPolygon(point: Position, rings: LinearRing[]): boolean {
  const outer = rings?.[0];
  if (!outer || outer.length < 4) return false;
  let inside = false;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const xi = outer[i][0], yi = outer[i][1];
    const xj = outer[j][0], yj = outer[j][1];
    const intersects = ((yi > point[1]) !== (yj > point[1])) &&
      (point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function centroidOfGeometry(geometry: unknown): Position | null {
  const g = geometry as GeoJsonGeometry | null;
  const points: Position[] = [];
  if (g?.type === "Polygon") points.push(...(((g as PolygonGeometry).coordinates?.[0] ?? []) as Position[]));
  else if (g?.type === "MultiPolygon") {
    for (const poly of (g as MultiPolygonGeometry).coordinates ?? []) points.push(...((poly?.[0] ?? []) as Position[]));
  }
  if (!points.length) return null;
  return [
    points.reduce((s, p) => s + Number(p[0] ?? 0), 0) / points.length,
    points.reduce((s, p) => s + Number(p[1] ?? 0), 0) / points.length,
  ];
}

export function distanceMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function enrichCandidateWithTarget(
  candidate: Omit<EvidenceCandidate, "contains_target" | "distance_m" | "area_sqft">,
  target: { lat: number; lon: number },
): EvidenceCandidate {
  const contains = pointInGeoJson(target.lon, target.lat, candidate.geometry_geojson);
  const centroid = centroidOfGeometry(candidate.geometry_geojson);
  const distance = centroid ? distanceMeters(target.lon, target.lat, centroid[0], centroid[1]) : null;
  const area = polygonAreaSqft(candidate.geometry_geojson);
  return {
    ...candidate,
    contains_target: contains,
    distance_m: distance,
    area_sqft: area,
    confidence: scoreConfidence(candidate.confidence, contains, distance, area),
  };
}

function scoreConfidence(base: number, contains: boolean, distance: number | null, areaSqft: number | null): number {
  let c = clampConfidence(base);
  if (contains) c += 0.05;
  else c -= 0.12;
  if (distance != null && distance > 30) c -= 0.08;
  if (distance != null && distance > 75) c -= 0.10;
  if (areaSqft != null && (areaSqft < 250 || areaSqft > 25_000)) c -= 0.12;
  return clampConfidence(c);
}

export function sortEvidenceCandidates(candidates: EvidenceCandidate[]): EvidenceCandidate[] {
  return [...candidates].sort((a, b) => {
    if ((a.contains_target ?? false) !== (b.contains_target ?? false)) return a.contains_target ? -1 : 1;
    const conf = b.confidence - a.confidence;
    if (Math.abs(conf) > 0.001) return conf;
    return (a.distance_m ?? Number.POSITIVE_INFINITY) - (b.distance_m ?? Number.POSITIVE_INFINITY);
  }).map((c, idx) => ({ ...c, source_rank: idx + 1 }));
}

export async function persistEvidenceSource(
  svc: SupabaseClient,
  ctx: EvidenceContext,
  candidate: EvidenceCandidate,
  selected: boolean,
): Promise<string | null> {
  const { data, error } = await svc.from("measurement_evidence_sources").insert({
    tenant_id: ctx.tenant_id,
    mskill_request_id: ctx.mskill_request_id,
    mskill_job_id: ctx.mskill_job_id,
    mskill_run_id: ctx.mskill_run_id ?? null,
    request_hash: ctx.request_hash,
    evidence_kind: candidate.evidence_kind,
    provider_key: candidate.provider_key,
    source_rank: candidate.source_rank ?? null,
    selected,
    confidence: round(candidate.confidence, 4),
    geometry_geojson: candidate.geometry_geojson,
    source_url: candidate.source_url ?? null,
    external_id: candidate.external_id ?? null,
    metadata: {
      ...(candidate.metadata ?? {}),
      contains_target: candidate.contains_target ?? null,
      distance_m: round(candidate.distance_m, 2),
      area_sqft: round(candidate.area_sqft, 2),
    },
  }).select("id").single();

  if (error) throw new Error(`persistEvidenceSource failed: ${error.message}`);
  return data?.id ?? null;
}

export function evidenceSummary(candidate: EvidenceCandidate | null): Record<string, unknown> | null {
  if (!candidate) return null;
  return {
    evidence_kind: candidate.evidence_kind,
    provider_key: candidate.provider_key,
    source_rank: candidate.source_rank ?? null,
    confidence: round(candidate.confidence, 4),
    contains_target: candidate.contains_target ?? null,
    distance_m: round(candidate.distance_m, 2),
    area_sqft: round(candidate.area_sqft, 2),
    external_id: candidate.external_id ?? null,
  };
}
