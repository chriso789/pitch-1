// Evidence acquisition orchestrator — PR #4
//
// Cascade order (vendor-free):
//   Tier 1a: OSM Overpass building polygons
//   Tier 1b: Microsoft Building Footprints
//   Tier 2 : County parcel (Regrid)
//   Tier 3 : Google Solar mask contour (handled by existing pipeline downstream)
//   Tier 4 : UNet mask (handled by existing pipeline downstream)
//
// This orchestrator is intentionally non-destructive: it returns the
// best Tier 1/2 footprint candidate plus a full evidence record. The
// existing `start-ai-measurement` pipeline still owns Tier 3/4 mask
// derivation and the final footprint selection; this helper guarantees
// every job persists `evidence_sources_used`, `footprint_source_tier`,
// and `evidence_acquisition_log` so downstream gates can reason about
// evidence quality.

import { fetchBuildingInsights } from "./solar-api-client.ts";
import { fetchMsBuildingFootprints } from "./fetch-ms-footprints.ts";
import { fetchParcel } from "./fetch-parcel.ts";
import type {
  AcquireEvidenceInput,
  AcquireEvidenceResult,
  AcquisitionAttempt,
  EvidenceSourcesUsed,
  FootprintSourceTier,
} from "./types.ts";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export async function acquireEvidence(
  input: AcquireEvidenceInput,
): Promise<AcquireEvidenceResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const radius = input.searchRadiusMeters ?? 30;
  const log: AcquisitionAttempt[] = [];
  const sources: EvidenceSourcesUsed = {};
  const candidates: AcquireEvidenceResult["footprint_candidates"] = [];

  // ---- Tier 1a: OSM ----
  const osm = await fetchOsmBuildings(input.lat, input.lng, radius, fetchImpl);
  log.push(osm.attempt);
  for (const c of osm.candidates) {
    candidates.push({ ...c, source: "osm_overpass", confidence: confidenceFromDistance(c.distance_m, radius) });
  }

  // ---- Tier 1b: MS Building Footprints ----
  const ms = await fetchMsBuildingFootprints(input.lat, input.lng, radius, fetchImpl);
  log.push({
    layer: "footprint",
    source: "ms_building_footprints",
    status: ms.error ? "error" : ms.candidates.length ? "ok" : "empty",
    latency_ms: ms.latency_ms,
    http_status: ms.http_status,
    error: ms.error,
    attempted_at: new Date().toISOString(),
  });
  for (const c of ms.candidates) {
    candidates.push({
      source: "ms_building_footprints",
      polygon: c.polygon,
      distance_m: c.distance_m,
      area_sqm: c.area_sqm,
      confidence: confidenceFromDistance(c.distance_m, radius),
    });
  }

  // ---- Tier 2: Parcel (only when Tier-1 has nothing inside radius) ----
  const tier1Hit = candidates.some((c) => c.distance_m <= radius);
  if (!tier1Hit) {
    const parcel = await fetchParcel(input.lat, input.lng, fetchImpl);
    log.push({
      layer: "footprint",
      source: parcel.source === "none" ? "parcel_unavailable" : "regrid_parcel",
      status: parcel.error
        ? (parcel.source === "none" ? "skipped" : "error")
        : parcel.candidates.length ? "ok" : "empty",
      latency_ms: parcel.latency_ms,
      http_status: parcel.http_status,
      error: parcel.error,
      attempted_at: new Date().toISOString(),
    });
    for (const c of parcel.candidates) {
      candidates.push({
        source: "regrid_parcel",
        polygon: c.polygon,
        distance_m: c.distance_m,
        area_sqm: c.area_sqm,
        confidence: Math.min(0.6, confidenceFromDistance(c.distance_m, radius * 2)),
      });
    }
  } else {
    log.push({
      layer: "footprint",
      source: "regrid_parcel",
      status: "skipped",
      latency_ms: 0,
      attempted_at: new Date().toISOString(),
      notes: "tier1_hit",
    });
  }

  // ---- Solar Building Insights (status only — segment data consumed downstream) ----
  const solar = await fetchBuildingInsights(input.lat, input.lng, fetchImpl);
  log.push({
    layer: "solar_segments",
    source: "google_solar_building_insights",
    status:
      solar.status === "ok" ? "ok" :
      solar.status === "unauthorized" ? "unauthorized" :
      solar.status === "quota_exceeded" ? "quota_exceeded" :
      solar.status === "no_data" ? "empty" :
      "error",
    latency_ms: solar.latency_ms,
    http_status: solar.http_status,
    error: solar.error,
    attempted_at: new Date().toISOString(),
  });
  if (solar.status === "ok") {
    sources.solar_segments = {
      source: "google_solar_building_insights",
      confidence: 0.9,
      fetched_at: new Date().toISOString(),
      meta: { imagery_quality: solar.data?.imageryQuality ?? null },
    };
  }
  const solarStatus: AcquireEvidenceResult["solar_status"] =
    solar.status === "ok" ? "ok" :
    solar.status === "unauthorized" ? "unauthorized" :
    solar.status === "quota_exceeded" ? "quota_exceeded" :
    solar.status === "missing_key" || solar.status === "no_data" || solar.status === "server_error" || solar.status === "network_error"
      ? "unavailable" : "not_attempted";

  // ---- Pick winning footprint candidate ----
  candidates.sort((a, b) => (b.confidence - a.confidence) || (a.distance_m - b.distance_m));
  const winner = candidates.find((c) => c.distance_m <= radius) ?? candidates[0] ?? null;

  let tier: FootprintSourceTier = "none";
  let footprint: Array<[number, number]> | null = null;
  if (winner) {
    footprint = winner.polygon;
    tier = winner.source === "osm_overpass" ? "tier1_osm"
      : winner.source === "ms_building_footprints" ? "tier1_ms_footprints"
      : winner.source === "regrid_parcel" ? "tier2_parcel"
      : "none";
    sources.footprint = {
      source: winner.source,
      confidence: winner.confidence,
      fetched_at: new Date().toISOString(),
      meta: { distance_m: winner.distance_m, area_sqm: winner.area_sqm },
    };
  }

  return {
    footprint,
    footprint_source_tier: tier,
    footprint_candidates: candidates,
    evidence_sources_used: sources,
    evidence_acquisition_log: log,
    solar_status: solarStatus,
  };
}

function confidenceFromDistance(distance_m: number, radius_m: number): number {
  if (distance_m <= 1) return 0.98;
  if (distance_m <= radius_m / 3) return 0.92;
  if (distance_m <= radius_m) return 0.8;
  if (distance_m <= radius_m * 2) return 0.55;
  return 0.3;
}

async function fetchOsmBuildings(
  lat: number,
  lng: number,
  radius: number,
  fetchImpl: typeof fetch,
): Promise<{ attempt: AcquisitionAttempt; candidates: Array<{ polygon: Array<[number,number]>; distance_m: number; area_sqm: number }> }> {
  const started = performance.now();
  const query = `[out:json][timeout:10];(way["building"](around:${radius},${lat},${lng});relation["building"](around:${radius},${lat},${lng}););out geom;`;
  try {
    const resp = await fetchImpl(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    const latency_ms = Math.round(performance.now() - started);
    if (!resp.ok) {
      return {
        attempt: {
          layer: "footprint", source: "osm_overpass", status: "error",
          latency_ms, http_status: resp.status, attempted_at: new Date().toISOString(),
          error: `HTTP ${resp.status}`,
        },
        candidates: [],
      };
    }
    const json = await resp.json();
    const elements: any[] = json?.elements ?? [];
    const candidates: Array<{ polygon: Array<[number,number]>; distance_m: number; area_sqm: number }> = [];
    for (const el of elements) {
      const geom = el?.geometry;
      if (!Array.isArray(geom) || geom.length < 4) continue;
      const ring: Array<[number, number]> = geom.map((p: any) => [p.lon, p.lat]);
      const c = ringCentroid(ring);
      candidates.push({
        polygon: ring,
        distance_m: haversine(lat, lng, c[1], c[0]),
        area_sqm: ringAreaSqm(ring),
      });
    }
    candidates.sort((a, b) => a.distance_m - b.distance_m);
    return {
      attempt: {
        layer: "footprint", source: "osm_overpass",
        status: candidates.length ? "ok" : "empty",
        latency_ms, http_status: resp.status, attempted_at: new Date().toISOString(),
      },
      candidates,
    };
  } catch (e) {
    return {
      attempt: {
        layer: "footprint", source: "osm_overpass", status: "error",
        latency_ms: Math.round(performance.now() - started),
        attempted_at: new Date().toISOString(),
        error: (e as Error).message,
      },
      candidates: [],
    };
  }
}

function ringCentroid(ring: Array<[number, number]>): [number, number] {
  let x = 0, y = 0;
  for (const [lng, lat] of ring) { x += lng; y += lat; }
  const n = Math.max(1, ring.length);
  return [x / n, y / n];
}
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function ringAreaSqm(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    a += (lng1 * mLng) * (lat2 * mLat) - (lng2 * mLng) * (lat1 * mLat);
  }
  return Math.abs(a) / 2;
}
