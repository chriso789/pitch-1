// Evidence acquisition shared types — PR #4 Evidence Hardening
// Vendor-free: no input from EagleView/Roofr/Hover reports.

export type FootprintSourceTier =
  | "tier1_osm"
  | "tier1_ms_footprints"
  | "tier2_parcel"
  | "tier3_solar_mask"
  | "tier4_unet"
  | "none";

export type EvidenceLayer =
  | "footprint"
  | "dsm"
  | "mask"
  | "orthophoto"
  | "solar_segments";

export interface EvidenceSourceRecord {
  source: string;            // e.g. "ms_building_footprints", "osm_overpass", "google_solar"
  confidence: number | null; // 0..1; null when not assessable
  fetched_at: string;        // ISO timestamp
  resolution_m_per_px?: number | null;
  meta?: Record<string, unknown>;
}

export type EvidenceSourcesUsed = Partial<Record<EvidenceLayer, EvidenceSourceRecord>>;

export interface AcquisitionAttempt {
  layer: EvidenceLayer;
  source: string;
  status: "ok" | "empty" | "error" | "skipped" | "unauthorized" | "quota_exceeded";
  latency_ms: number;
  error?: string;
  http_status?: number;
  attempted_at: string;
  notes?: string;
}

export interface AcquireEvidenceInput {
  lat: number;
  lng: number;
  tenantId?: string | null;
  searchRadiusMeters?: number; // default 30
  // pass through to allow tests to inject mocks
  fetchImpl?: typeof fetch;
}

export interface AcquireEvidenceResult {
  footprint: Array<[number, number]> | null;     // [lng,lat] polygon ring
  footprint_source_tier: FootprintSourceTier;
  footprint_candidates: Array<{
    source: string;
    polygon: Array<[number, number]>;
    distance_m: number;
    area_sqm: number;
    confidence: number;
  }>;
  evidence_sources_used: EvidenceSourcesUsed;
  evidence_acquisition_log: AcquisitionAttempt[];
  solar_status: "ok" | "unavailable" | "unauthorized" | "quota_exceeded" | "not_attempted";
}
