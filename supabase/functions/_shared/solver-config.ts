/**
 * Centralized solver configuration constants.
 *
 * ALL tunable thresholds for the planar-roof-solver and autonomous-graph-solver
 * live here. No magic numbers scattered through solver code.
 *
 * Change values here → both solvers pick them up automatically.
 */

// ── PLANAR GRAPH SOLVER ───────────────────────────────────────────
/** Max distance to snap interior endpoints to footprint vertices or each other */
export const ENDPOINT_SNAP_TOL_PX = 12;
/** Max distance for a point to be considered "touching" the footprint boundary */
export const FOOTPRINT_TOUCH_TOL_PX = 10;
/** Minimum segment length in px; shorter segments are discarded */
export const MIN_SEGMENT_LENGTH_PX = 5;
/** Angle threshold (degrees) for collinear merge — segments within this angle are merged */
export const COLLINEAR_ANGLE_DEG = 5;
/** Minimum crossing angle (degrees) for intersection splitting — prevents over-fragmentation */
export const INTERSECTION_MIN_ANGLE_DEG = 20;
/** Minimum distance (px) from an endpoint to accept an intersection split */
export const INTERSECTION_MIN_DISTANCE_PX = 6;
/** Douglas-Peucker simplification tolerance for output polygons */
export const SIMPLIFY_TOLERANCE_PX = 2;
/** Grid snap resolution in px */
export const GRID_SNAP_PX = 2;

// ── AUTONOMOUS GRAPH SOLVER ───────────────────────────────────────
/** Minimum edge score to survive initial filtering */
export const EDGE_SCORE_THRESHOLD = 0.15;
/** Maximum snap distance in meters (~5px at 0.3m/px) */
export const SNAP_DISTANCE_METERS = 1.5;
/** Max angular difference for snap pairing (radians) */
export const SNAP_ANGLE_RAD = 10 * Math.PI / 180;
/** Edges shorter than this (ft) are discarded */
export const MIN_EDGE_LENGTH_FT = 3;
/** Edges with more than this many forced intersection splits are dropped */
export const MAX_INTERSECTIONS_PER_EDGE = 2;
/** Max RMS (meters) for a valid planar facet fit */
export const PLANE_FIT_ERROR_THRESHOLD = 0.5;
/** Facets smaller than this (sqft) are discarded */
export const MIN_FACET_AREA_SQFT = 15;
/** Maximum interior edges passed to planar solver (ranked by score × length).
 * Roofr/EagleView-grade topology needs enough short local ridges/valleys to
 * survive into polygonization; low caps collapse upper roof assemblies. */
export const MAX_INTERIOR_EDGES_FOR_SOLVER = 24;
/** Minimum edge score to be considered for solver input */
export const MIN_EDGE_SCORE_FOR_SOLVER = 0.25;
/** Clustering: max midpoint distance between near-parallel edges */
export const CLUSTER_MIDPOINT_DIST_PX = 25;
/** Clustering: max angle difference between near-parallel edges */
export const CLUSTER_ANGLE_DEG = 10;

// ── ADAPTIVE LOCALITY (replaces hard MAX_STRUCTURAL_SPAN_RATIO / MAX_STRUCTURAL_EXTENSION_PX) ──
/** Soft penalty threshold: span ratio above this gets locality penalty */
export const LOCALITY_SPAN_RATIO_SOFT = 0.40;
/** Hard cap: span ratio above this is only allowed if edge contributes to face closure */
export const LOCALITY_SPAN_RATIO_HARD = 0.75;
/** Soft penalty threshold: extra extension px above this gets penalty */
export const LOCALITY_EXTENSION_SOFT_PX = 20;
/** Hard cap: extension px above this is only allowed if edge contributes to face closure */
export const LOCALITY_EXTENSION_HARD_PX = 60;
/** Locality guard: max gap allowed when merging collinear structural fragments */
export const MAX_STRUCTURAL_MERGE_GAP_PX = 4;

// Legacy exports for backward compatibility (used by autonomous-graph-solver)
export const MAX_STRUCTURAL_SPAN_RATIO = LOCALITY_SPAN_RATIO_HARD;
export const MAX_STRUCTURAL_EXTENSION_PX = LOCALITY_EXTENSION_HARD_PX;

// ── FACE MERGE / POST-MERGE QA ───────────────────────────────────
/** Max RMS (meters) to allow adjacent face merge */
export const FACE_MERGE_RMS_MAX_M = 0.6;
/** Minimum face area as fraction of footprint area */
export const MIN_FACE_AREA_RATIO = 0.001;
/** Absolute minimum face area in px² */
export const MIN_FACE_AREA_ABS_PX = 30;

// ── PUBLISH GATES ─────────────────────────────────────────────────
/** Minimum coverage ratio for a validated measurement */
export const COVERAGE_RATIO_MIN = 0.85;
/** Overlay: max root-mean-square residual in raster pixels */
export const OVERLAY_RMS_PX_MAX = 4;
/** Overlay: max single-point residual in raster pixels */
export const OVERLAY_MAX_ERROR_PX = 8;
/** Overlay: minimum mask intersection-over-union */
export const MASK_IOU_MIN = 0.85;
/** Minimum facet count for a validated roof */
export const MIN_FACET_COUNT = 2;
/** Minimum coverage ratio for footprint selection */
export const MIN_FOOTPRINT_COVERAGE_RATIO = 0.20;
