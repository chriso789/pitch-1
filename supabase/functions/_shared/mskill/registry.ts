// PITCH Measure — internal skill registry (in-code mirror of mskill_registry DB seed).
// Source of truth is the DB; this gives executors and runner type-safe access.

export type ExecutionTarget = "control_plane" | "internal_worker" | "hybrid";

export interface SkillDef {
  skill_key: string;
  display_name: string;
  category: string;
  execution_target: ExecutionTarget;
  pipeline_order: number;
  dependencies: string[];
  worker_endpoint: string | null;
  version: string;
}

export const MSKILL_REGISTRY: SkillDef[] = [
  { skill_key: "geocode_address",              display_name: "Geocode Address",              category: "address",    execution_target: "control_plane",   pipeline_order: 1,  dependencies: [],                                                                                              worker_endpoint: null, version: "v1" },
  { skill_key: "resolve_parcel",               display_name: "Resolve Parcel",               category: "parcel",     execution_target: "control_plane",   pipeline_order: 2,  dependencies: ["geocode_address"],                                                                            worker_endpoint: null, version: "v1" },
  { skill_key: "resolve_building_footprint",   display_name: "Resolve Building Footprint",   category: "footprint",  execution_target: "control_plane",   pipeline_order: 3,  dependencies: ["resolve_parcel"],                                                                             worker_endpoint: null, version: "v1" },
  { skill_key: "create_roof_edge_candidates",  display_name: "Create Roof Edge Candidates",  category: "footprint",  execution_target: "control_plane",   pipeline_order: 4,  dependencies: ["resolve_building_footprint"],                                                                 worker_endpoint: null, version: "v1" },
  { skill_key: "discover_lidar_coverage",      display_name: "Discover LiDAR Coverage",      category: "lidar",      execution_target: "control_plane",   pipeline_order: 5,  dependencies: ["create_roof_edge_candidates"],                                                                worker_endpoint: null, version: "v1" },
  { skill_key: "discover_elevation_assets",    display_name: "Discover Elevation Assets",    category: "lidar",      execution_target: "control_plane",   pipeline_order: 6,  dependencies: ["discover_lidar_coverage"],                                                                    worker_endpoint: null, version: "v1" },
  { skill_key: "acquire_dem_dtm",              display_name: "Acquire DEM/DTM",              category: "elevation",  execution_target: "hybrid",          pipeline_order: 7,  dependencies: ["discover_elevation_assets"],                                                                  worker_endpoint: null, version: "v1" },
  { skill_key: "acquire_roof_surface_asset",   display_name: "Acquire Roof Surface Asset",   category: "elevation",  execution_target: "control_plane",   pipeline_order: 8,  dependencies: ["discover_elevation_assets"],                                                                  worker_endpoint: null, version: "v1" },
  { skill_key: "clip_point_cloud",             display_name: "Clip Point Cloud",             category: "compute",    execution_target: "internal_worker", pipeline_order: 9,  dependencies: ["acquire_roof_surface_asset"],                                                                 worker_endpoint: "/skills/clip-point-cloud",  version: "v1" },
  { skill_key: "generate_dsm",                 display_name: "Generate DSM",                 category: "compute",    execution_target: "internal_worker", pipeline_order: 10, dependencies: ["clip_point_cloud"],                                                                            worker_endpoint: "/skills/generate-dsm",      version: "v1" },
  { skill_key: "generate_dtm",                 display_name: "Generate DTM",                 category: "compute",    execution_target: "internal_worker", pipeline_order: 11, dependencies: ["clip_point_cloud"],                                                                            worker_endpoint: "/skills/generate-dtm",      version: "v1" },
  { skill_key: "generate_chm",                 display_name: "Generate CHM",                 category: "compute",    execution_target: "internal_worker", pipeline_order: 12, dependencies: ["generate_dsm","generate_dtm"],                                                                worker_endpoint: "/skills/generate-chm",      version: "v1" },
  { skill_key: "isolate_roof_points",          display_name: "Isolate Roof Points",          category: "compute",    execution_target: "internal_worker", pipeline_order: 13, dependencies: ["generate_chm","create_roof_edge_candidates"],                                                 worker_endpoint: "/skills/isolate-roof-points", version: "v1" },
  { skill_key: "fit_roof_planes",              display_name: "Fit Roof Planes",              category: "geometry",   execution_target: "internal_worker", pipeline_order: 14, dependencies: ["isolate_roof_points"],                                                                         worker_endpoint: "/skills/fit-roof-planes",   version: "v1" },
  { skill_key: "detect_ridges",                display_name: "Detect Ridges",                category: "geometry",   execution_target: "internal_worker", pipeline_order: 15, dependencies: ["fit_roof_planes"],                                                                             worker_endpoint: "/skills/detect-ridges",     version: "v1" },
  { skill_key: "detect_hips",                  display_name: "Detect Hips",                  category: "geometry",   execution_target: "internal_worker", pipeline_order: 16, dependencies: ["fit_roof_planes"],                                                                             worker_endpoint: "/skills/detect-hips",       version: "v1" },
  { skill_key: "detect_valleys",               display_name: "Detect Valleys",               category: "geometry",   execution_target: "internal_worker", pipeline_order: 17, dependencies: ["fit_roof_planes"],                                                                             worker_endpoint: "/skills/detect-valleys",    version: "v1" },
  { skill_key: "detect_eaves",                 display_name: "Detect Eaves",                 category: "geometry",   execution_target: "hybrid",          pipeline_order: 18, dependencies: ["fit_roof_planes","create_roof_edge_candidates"],                                              worker_endpoint: "/skills/detect-eaves",      version: "v1" },
  { skill_key: "detect_rakes",                 display_name: "Detect Rakes",                 category: "geometry",   execution_target: "hybrid",          pipeline_order: 19, dependencies: ["fit_roof_planes","create_roof_edge_candidates"],                                              worker_endpoint: "/skills/detect-rakes",      version: "v1" },
  { skill_key: "calculate_pitch",              display_name: "Calculate Pitch",              category: "geometry",   execution_target: "internal_worker", pipeline_order: 20, dependencies: ["fit_roof_planes"],                                                                             worker_endpoint: "/skills/calculate-pitch",   version: "v1" },
  { skill_key: "calculate_roof_area",          display_name: "Calculate Roof Area",          category: "geometry",   execution_target: "hybrid",          pipeline_order: 21, dependencies: ["fit_roof_planes","calculate_pitch"],                                                          worker_endpoint: "/skills/calculate-roof-area", version: "v1" },
  { skill_key: "validate_geometry",            display_name: "Validate Geometry",            category: "validation", execution_target: "hybrid",          pipeline_order: 22, dependencies: ["calculate_roof_area","detect_ridges","detect_hips","detect_valleys","detect_eaves","detect_rakes"], worker_endpoint: null, version: "v1" },
  { skill_key: "export_geojson",               display_name: "Export GeoJSON",               category: "export",     execution_target: "control_plane",   pipeline_order: 23, dependencies: ["validate_geometry"],                                                                          worker_endpoint: null, version: "v1" },
  { skill_key: "export_report",                display_name: "Export Report",                category: "export",     execution_target: "hybrid",          pipeline_order: 24, dependencies: ["validate_geometry","export_geojson"],                                                         worker_endpoint: null, version: "v1" },
];

export const SKILL_BY_KEY = new Map(MSKILL_REGISTRY.map((s) => [s.skill_key, s]));
export const SKILL_KEYS_ORDERED = MSKILL_REGISTRY.map((s) => s.skill_key);

export function getSkill(key: string): SkillDef | undefined {
  return SKILL_BY_KEY.get(key);
}

export function downstreamOf(skillKey: string): string[] {
  return MSKILL_REGISTRY.filter((s) => s.dependencies.includes(skillKey)).map((s) => s.skill_key);
}

/** Recursive downstream — all skills that transitively depend on this one. */
export function allDownstreamOf(skillKey: string): string[] {
  const out = new Set<string>();
  const queue = [skillKey];
  while (queue.length) {
    const k = queue.shift()!;
    for (const d of downstreamOf(k)) {
      if (!out.has(d)) { out.add(d); queue.push(d); }
    }
  }
  return [...out];
}
