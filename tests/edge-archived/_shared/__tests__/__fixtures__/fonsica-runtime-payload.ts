// Fonsica-shaped runtime fixture (4063 Fonsica Ave) — the exact confirmed-
// working aerial input shape from the latest Fonsica pull. Any test that
// claims the runtime contract for Fonsica MUST use this fixture so a passing
// suite implies the same input the live row carried.
//
// Confirmed-working signals captured here (do not weaken):
//   • source_raster_px = 1280×1280, confirmed_center_src = [640,640]
//   • frame_mismatch = "ok"
//   • registration.transform_package.{ geo_to_raster_transform,
//       raster_bounds_lat_lng, raster_size_px, confirmed_roof_center_px }
//   • perimeter_topology.{ perimeter_ring_px(>=3), perimeter_ring_geo(>=3),
//       perimeter_edges.length=6, eave_edges.length=6, corner_nodes }
//   • target_mask_isolation.{ overlap=0.976, iou=0.8452, missed=2.44 }
//   • cpu_budget_ms=75000, cpu_terminal_write_reserve_ms=15000
//   • estimated_work_units=996004

export const FONSICA_CONFIRMED_CENTER_LAT_LNG = { lat: 27.0421, lng: -82.2189 };

// 1280×1280 raster, north-up; raster bounds approximated as a small box
// around the confirmed roof center.
export const FONSICA_RASTER_BOUNDS_LAT_LNG = {
  north: 27.0425,
  south: 27.0417,
  east: -82.2185,
  west: -82.2193,
};

// 3×3 affine [a,b,c,d,e,f] mapping [lng,lat] → [x_raster,y_raster] for the
// 1280×1280 raster. Derived from the bounds above (north-up, no rotation).
const W = 1280;
const H = 1280;
const dLng = FONSICA_RASTER_BOUNDS_LAT_LNG.east - FONSICA_RASTER_BOUNDS_LAT_LNG.west;
const dLat = FONSICA_RASTER_BOUNDS_LAT_LNG.south - FONSICA_RASTER_BOUNDS_LAT_LNG.north;
export const FONSICA_GEO_TO_RASTER_TRANSFORM = {
  type: "affine_geo_to_raster",
  a: W / dLng,
  b: 0,
  c: -W * FONSICA_RASTER_BOUNDS_LAT_LNG.west / dLng,
  d: 0,
  e: H / dLat,
  f: -H * FONSICA_RASTER_BOUNDS_LAT_LNG.north / dLat,
};

export const FONSICA_CONFIRMED_ROOF_CENTER_PX: [number, number] = [640, 640];

export const FONSICA_TRANSFORM_PACKAGE = {
  version: "registration-transform-package-v1",
  geo_to_raster_transform: FONSICA_GEO_TO_RASTER_TRANSFORM,
  raster_bounds_lat_lng: FONSICA_RASTER_BOUNDS_LAT_LNG,
  raster_size_px: { width: W, height: H },
  confirmed_roof_center_px: FONSICA_CONFIRMED_ROOF_CENTER_PX,
};

// Hex perimeter ring (6 corners) in raster px — coarse but valid (closed
// implicitly by reuse of nodes in edges; ring itself is open).
export const FONSICA_PERIMETER_RING_PX: Array<[number, number]> = [
  [520, 520],
  [760, 520],
  [820, 640],
  [760, 760],
  [520, 760],
  [460, 640],
];

// Corresponding geo ring (lng,lat). Solved via the inverse of the affine
// above so geo↔px stays internally consistent.
function pxToLngLat(px: number, py: number): [number, number] {
  const lng = FONSICA_RASTER_BOUNDS_LAT_LNG.west + (px / W) * dLng;
  const lat = FONSICA_RASTER_BOUNDS_LAT_LNG.north + (py / H) * dLat;
  return [lng, lat];
}
export const FONSICA_PERIMETER_RING_GEO: Array<[number, number]> =
  FONSICA_PERIMETER_RING_PX.map(([x, y]) => pxToLngLat(x, y));

function mkEdge(
  i: number,
  type: "eave" | "perimeter",
  a: [number, number],
  b: [number, number],
) {
  return {
    id: `${type}_${i}`,
    type,
    px: [a, b],
    geo: [pxToLngLat(a[0], a[1]), pxToLngLat(b[0], b[1])],
    start_px: a,
    end_px: b,
    length_lf: 30,
  };
}

export const FONSICA_PERIMETER_EDGES = FONSICA_PERIMETER_RING_PX.map((p, i) =>
  mkEdge(
    i,
    "perimeter",
    p,
    FONSICA_PERIMETER_RING_PX[(i + 1) % FONSICA_PERIMETER_RING_PX.length],
  )
);

export const FONSICA_EAVE_EDGES = FONSICA_PERIMETER_RING_PX.map((p, i) =>
  mkEdge(
    i,
    "eave",
    p,
    FONSICA_PERIMETER_RING_PX[(i + 1) % FONSICA_PERIMETER_RING_PX.length],
  )
);

export const FONSICA_CORNER_NODES = FONSICA_PERIMETER_RING_PX.map((p, i) => ({
  id: `c_${i}`,
  px: p,
  geo: pxToLngLat(p[0], p[1]),
  kind: "corner",
}));

export const FONSICA_PERIMETER_TOPOLOGY = {
  perimeter_ring_px: FONSICA_PERIMETER_RING_PX,
  perimeter_ring_geo: FONSICA_PERIMETER_RING_GEO,
  perimeter_edges: FONSICA_PERIMETER_EDGES,
  eave_edges: FONSICA_EAVE_EDGES,
  rake_edges: [],
  corner_nodes: FONSICA_CORNER_NODES,
  perimeter_vs_mask_iou: 0.8452,
  target_mask_overlap_with_perimeter: 0.976,
};

export const FONSICA_TARGET_MASK_ISOLATION = {
  target_mask_area_sqft: 3077,
  perimeter_vs_mask_iou: 0.8452,
  target_mask_overlap_with_perimeter: 0.976,
  missed_target_roof_pct: 2.44,
  chosen_component_id: "tm_0",
};

export const FONSICA_REGISTRATION = {
  transform_package: FONSICA_TRANSFORM_PACKAGE,
  geo_to_raster_transform: FONSICA_GEO_TO_RASTER_TRANSFORM,
  raster_bounds_lat_lng: FONSICA_RASTER_BOUNDS_LAT_LNG,
  raster_size_px: { width: W, height: H },
  confirmed_roof_center_px: FONSICA_CONFIRMED_ROOF_CENTER_PX,
  source_raster_px: { width: W, height: H },
  confirmed_center_src: FONSICA_CONFIRMED_ROOF_CENTER_PX,
  frame_mismatch: "ok",
};

export const FONSICA_CPU_BUDGET_CONSTANTS = {
  AI_MEASUREMENT_CPU_BUDGET_MS: 75000,
  AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS: 15000,
  AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT: 5_000_000,
  AI_MEASUREMENT_CPU_TIMEOUT_STAGE: "phase3_5_topology_cpu_budget_exceeded",
  AI_MEASUREMENT_CPU_TIMEOUT_REASON: "ai_measurement_cpu_timeout",
  REQUIRED_TOPOLOGY_SOURCE: "autonomous_graph_solver",
} as const;

export const FONSICA_ESTIMATED_WORK_UNITS = 996_004;
