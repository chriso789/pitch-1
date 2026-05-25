// DB-safe coercion for `roof_measurements.footprint_source`.
//
// The DB column is constrained by `roof_measurements_footprint_source_check`
// to the set in ALLOWED_FOOTPRINT_SOURCES. Diagnostic / failure-state labels
// (e.g. "blocked_by_registration_gate", "google_solar_roof_mask") must NEVER
// be written to the column — they collapse the insert with a 23514 CHECK
// constraint error, which falls into processJob_outer_catch and wipes every
// other diagnostic on the row.
//
// Always run payloads through `applyFootprintSourceDbSafeCoercion` before
// inserting/updating `roof_measurements`. The raw diagnostic label is
// preserved inside `geometry_report_json.footprint_source_diagnostic`.

export const ALLOWED_FOOTPRINT_SOURCES = new Set<string>([
  "mapbox_vector",
  "regrid_parcel",
  "osm_overpass",
  "microsoft_buildings",
  "solar_api_footprint",
  "solar_bbox_fallback",
  "manual_trace",
  "manual_entry",
  "imported",
  "user_drawn",
  "ai_detection",
  "esri_buildings",
  "google_solar_api",
  "osm",
  "google_maps",
  "satellite",
  "unknown",
  "google_solar_bbox",
  "google_solar_segments",
  "google_solar_segments_hull",
  "unet_mask",
  "alpha_hull",
  "convex_hull",
]);

export function normalizeRoofMeasurementFootprintSource(source: unknown) {
  const raw = String(source ?? "unknown").trim();
  const aliasMap: Record<string, string> = {
    osm_building: "osm_overpass",
    osm_buildings: "osm_overpass",
    unet_segmentation: "ai_detection",
    unet: "unet_mask",
    none: "unknown",
    "": "unknown",
    unified_pipeline: "ai_detection",
    topology_engine_v2: "ai_detection",
    topology_engine_v2_skeleton: "ai_detection",
    mapbox_static: "satellite",
    single_plane_fallback: "solar_bbox_fallback",
    google_solar_segments_convex_hull: "google_solar_segments_hull",
    google_solar_segments_union: "google_solar_segments_hull",
    // Diagnostic / failure-state labels — DB-safe coercion. Raw value is
    // preserved in geometry_report_json.footprint_source_diagnostic.
    blocked_by_registration_gate: "unknown",
    registration_blocked: "unknown",
    coordinate_registration_failed: "unknown",
    coordinate_registration_blocked: "unknown",
    runtime_preempted: "unknown",
    google_solar_roof_mask: "google_solar_api",
  };
  const remapped = aliasMap[raw] ?? raw;
  if (ALLOWED_FOOTPRINT_SOURCES.has(remapped)) return remapped;
  // Heuristic fallbacks for unrecognized values — keep insert valid.
  const lower = remapped.toLowerCase();
  if (lower.includes("solar")) return "google_solar_api";
  if (lower.includes("osm")) return "osm_overpass";
  if (lower.includes("hull")) return "convex_hull";
  if (lower.includes("unet") || lower.includes("ai")) return "ai_detection";
  if (lower.includes("manual")) return "manual_trace";
  console.warn(
    `[footprint_source] Unknown source '${raw}' — coercing to 'unknown'`,
  );
  return "unknown";
}

export interface FootprintCoercionResult {
  coerced: boolean;
  raw: string | null;
  normalized: string | null;
}

/**
 * Chokepoint: any payload bound for `roof_measurements` MUST pass through
 * this. Mutates `payload.footprint_source` + `geometry.footprint_source` to
 * a DB-whitelisted value, preserves the raw label inside
 * `geometry.footprint_source_diagnostic`.
 */
export function applyFootprintSourceDbSafeCoercion(
  payload: Record<string, unknown>,
  geometry: Record<string, unknown>,
): FootprintCoercionResult {
  const rawTop = payload.footprint_source;
  const rawGeo = (geometry as Record<string, unknown>).footprint_source;
  const raw = rawTop ?? rawGeo;
  if (raw === undefined || raw === null) {
    return { coerced: false, raw: null, normalized: null };
  }
  const rawStr = String(raw);
  const normalized = normalizeRoofMeasurementFootprintSource(rawStr);
  if (normalized !== rawStr) {
    if (!(geometry as Record<string, unknown>).footprint_source_diagnostic) {
      (geometry as Record<string, unknown>).footprint_source_diagnostic =
        rawStr;
    }
    (geometry as Record<string, unknown>).footprint_source_normalized_from =
      rawStr;
    (geometry as Record<string, unknown>).footprint_source_normalized_to =
      normalized;
  }
  payload.footprint_source = normalized;
  (geometry as Record<string, unknown>).footprint_source = normalized;
  return { coerced: normalized !== rawStr, raw: rawStr, normalized };
}
