// ============================================================================
// Candidate Polygon Hoist v1
// ----------------------------------------------------------------------------
// Selects the canonical "selected" candidate polygon from autonomous-debug
// (perimeter_phase0.perimeter_candidate_table → perimeter_topology.perimeter_ring_px
// → raw footprint) and reports its coordinate space + centroid for the
// registration block.
// ============================================================================

export type Px = [number, number];
export type LatLng = { lat: number; lng: number };

export interface CandidateHoistInput {
  /** autonomousDebug.perimeter_phase0?.perimeter_candidate_table (post-solver). */
  perimeter_candidate_table?: Array<{
    id?: string;
    selected?: boolean;
    source?: string | null;
    ring_px?: Px[] | null;
    ring_geo?: LatLng[] | null;
    area_sqft?: number | null;
    centroid_px?: Px | null;
    coordinate_space?: "dsm_px" | "raster_px" | null;
  }> | null;
  /** autonomousDebug.perimeter_topology fallback. */
  perimeter_topology?: {
    perimeter_ring_px?: Px[] | null;
    perimeter_ring_geo?: LatLng[] | null;
    perimeter_area_sqft?: number | null;
    perimeter_source?: string | null;
  } | null;
  /** Pre-solver fallback (raw footprint). */
  fallback_footprint_px?: Px[] | null;
  fallback_footprint_source?: string | null;
  fallback_area_sqft?: number | null;
  /** Default coordinate space when source doesn't declare one. */
  default_coordinate_space?: "dsm_px" | "raster_px";
}

export interface CandidateHoistResult {
  selected_candidate_polygon_px: Px[] | null;
  selected_candidate_polygon_geo: LatLng[] | null;
  selected_candidate_polygon_point_count: number;
  candidate_coordinate_space: "dsm_px" | "raster_px" | null;
  candidate_source: string | null;
  candidate_area_sqft: number | null;
  candidate_centroid_px: Px | null;
  candidate_hoist_origin: "perimeter_candidate_table" | "perimeter_topology" | "fallback_footprint" | "none";
  failure_tokens: string[];
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function centroid(poly: Px[] | null | undefined): Px | null {
  if (!Array.isArray(poly) || poly.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const p of poly) {
    if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) continue;
    sx += p[0]; sy += p[1]; n++;
  }
  return n > 0 ? [sx / n, sy / n] : null;
}

export function hoistSelectedCandidatePolygon(input: CandidateHoistInput): CandidateHoistResult {
  const failure_tokens: string[] = [];
  const defaultSpace = input.default_coordinate_space ?? "dsm_px";

  // 1. perimeter_candidate_table.selected=true
  if (Array.isArray(input.perimeter_candidate_table)) {
    const sel = input.perimeter_candidate_table.find(r => r?.selected === true && Array.isArray(r.ring_px) && r.ring_px.length >= 3);
    if (sel && Array.isArray(sel.ring_px)) {
      return {
        selected_candidate_polygon_px: sel.ring_px,
        selected_candidate_polygon_geo: Array.isArray(sel.ring_geo) ? sel.ring_geo : null,
        selected_candidate_polygon_point_count: sel.ring_px.length,
        candidate_coordinate_space: sel.coordinate_space ?? defaultSpace,
        candidate_source: sel.source ?? "perimeter_candidate_table",
        candidate_area_sqft: isNum(sel.area_sqft) ? sel.area_sqft : null,
        candidate_centroid_px: sel.centroid_px ?? centroid(sel.ring_px),
        candidate_hoist_origin: "perimeter_candidate_table",
        failure_tokens,
      };
    }
  }

  // 2. perimeter_topology.perimeter_ring_px
  const topoRing = input.perimeter_topology?.perimeter_ring_px;
  if (Array.isArray(topoRing) && topoRing.length >= 3) {
    return {
      selected_candidate_polygon_px: topoRing,
      selected_candidate_polygon_geo: Array.isArray(input.perimeter_topology?.perimeter_ring_geo)
        ? input.perimeter_topology!.perimeter_ring_geo!
        : null,
      selected_candidate_polygon_point_count: topoRing.length,
      candidate_coordinate_space: defaultSpace,
      candidate_source: input.perimeter_topology?.perimeter_source ?? "perimeter_topology",
      candidate_area_sqft: isNum(input.perimeter_topology?.perimeter_area_sqft ?? NaN)
        ? input.perimeter_topology!.perimeter_area_sqft!
        : null,
      candidate_centroid_px: centroid(topoRing),
      candidate_hoist_origin: "perimeter_topology",
      failure_tokens,
    };
  }

  // 3. Pre-solver raw footprint fallback
  if (Array.isArray(input.fallback_footprint_px) && input.fallback_footprint_px.length >= 3) {
    return {
      selected_candidate_polygon_px: input.fallback_footprint_px,
      selected_candidate_polygon_geo: null,
      selected_candidate_polygon_point_count: input.fallback_footprint_px.length,
      candidate_coordinate_space: defaultSpace,
      candidate_source: input.fallback_footprint_source ?? "raw_footprint",
      candidate_area_sqft: isNum(input.fallback_area_sqft ?? NaN) ? input.fallback_area_sqft! : null,
      candidate_centroid_px: centroid(input.fallback_footprint_px),
      candidate_hoist_origin: "fallback_footprint",
      failure_tokens,
    };
  }

  failure_tokens.push("selected_candidate_polygon_missing");
  return {
    selected_candidate_polygon_px: null,
    selected_candidate_polygon_geo: null,
    selected_candidate_polygon_point_count: 0,
    candidate_coordinate_space: null,
    candidate_source: null,
    candidate_area_sqft: null,
    candidate_centroid_px: null,
    candidate_hoist_origin: "none",
    failure_tokens,
  };
}
