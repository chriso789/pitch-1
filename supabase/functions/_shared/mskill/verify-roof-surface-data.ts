/**
 * verifyRoofSurfaceDataAvailability
 *
 * Phase-1 gate. Given an AOI / address, returns the best available roof-surface
 * data source for the property AND a hard boolean `roof_geometry_possible`.
 *
 * Hard rules:
 *   - DEM/DTM ONLY cannot produce roof geometry → roof_geometry_possible=false,
 *     blocking_reason="dem_only_not_sufficient".
 *   - A LiDAR coverage record without a real source_url is NOT usable →
 *     blocking_reason="coverage_without_source_url".
 *   - DSM raster OR raw point cloud is required for roof_geometry_possible=true.
 *   - Nothing is marked usable based on a vendor name alone — must include a
 *     concrete `source_url` OR `asset_reference`.
 *
 * No Nearmap. Any provider_key starting with "nearmap" is filtered out at the
 * source query — this is intentional and enforced.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type RoofSurfaceSourceType =
  | "point_cloud"     // raw LAS/LAZ/COPC/EPT
  | "dsm"             // published DSM raster
  | "dtm"             // bare-earth raster
  | "dem";            // generic elevation, lowest tier

export interface RoofSurfaceSource {
  provider_key: string;
  source_type: RoofSurfaceSourceType;
  source_url: string | null;
  asset_reference: string | null;
  asset_type: "las" | "laz" | "copc" | "ept" | "geotiff" | null;
  data_year: number | null;
  resolution_m: number | null;
  point_density_per_m2: number | null;
  coverage_polygon: unknown | null;
}

export interface RoofSurfaceAvailability {
  best_point_cloud_source: RoofSurfaceSource | null;
  best_dsm_source: RoofSurfaceSource | null;
  best_dem_dtm_source: RoofSurfaceSource | null;
  data_year: number | null;
  resolution_m: number | null;
  point_density_per_m2: number | null;
  source_url: string | null;
  source_type: RoofSurfaceSourceType | null;
  roof_geometry_possible: boolean;
  blocking_reason: string | null;
  notes: string[];
}

const NEARMAP_FORBIDDEN_PREFIX = "nearmap";

function isUsable(s: Partial<RoofSurfaceSource> | undefined | null): s is RoofSurfaceSource {
  if (!s) return false;
  if (!s.provider_key) return false;
  if (s.provider_key.toLowerCase().startsWith(NEARMAP_FORBIDDEN_PREFIX)) return false;
  // Must reference a real downloadable asset OR a concrete asset reference.
  return Boolean(s.source_url || s.asset_reference);
}

function rankPointCloud(s: RoofSurfaceSource): number {
  // Prefer newer + higher density.
  const yearScore = (s.data_year ?? 2000) - 2000;
  const densityScore = (s.point_density_per_m2 ?? 0) * 10;
  // Provider-specific bumps: NOAA / USGS / LABINS / county.
  const provider = s.provider_key.toLowerCase();
  let providerScore = 0;
  if (provider.includes("noaa")) providerScore = 4;
  else if (provider.includes("usgs") || provider.includes("3dep")) providerScore = 3;
  else if (provider.includes("labins") || provider.includes("county")) providerScore = 2;
  return yearScore + densityScore + providerScore;
}

function rankRaster(s: RoofSurfaceSource): number {
  const yearScore = (s.data_year ?? 2000) - 2000;
  // Higher resolution (smaller meters/pixel) is better.
  const resScore = s.resolution_m ? Math.max(0, 5 - s.resolution_m) * 5 : 0;
  return yearScore + resScore;
}

export interface VerifyArgs {
  svc: SupabaseClient;
  tenant_id: string;
  lidar_window_id?: string | null;
  lat: number;
  lon: number;
  county?: string | null;
  state?: string | null;
}

export async function verifyRoofSurfaceDataAvailability(
  args: VerifyArgs,
): Promise<RoofSurfaceAvailability> {
  const notes: string[] = [];

  // 1. Pull provider catalog rows scoped to lidar / elevation / dsm / point_cloud.
  const { data: providers, error: pErr } = await args.svc
    .from("mskill_provider_sources")
    .select("provider_key, display_name, category, scope, metadata")
    .in("category", ["lidar", "elevation", "dsm", "point_cloud"])
    .eq("is_enabled", true);
  if (pErr) notes.push(`provider_query_error:${pErr.message}`);

  // 2. Pull coverage rows for this county/state if known.
  let coverage: any[] = [];
  if (args.county || args.state) {
    const filters: string[] = [];
    if (args.county) filters.push(`county.eq.${args.county}`);
    if (args.state) filters.push(`state.eq.${args.state}`);
    const { data: cov } = await args.svc
      .from("mskill_provider_coverage")
      .select("provider_key, source_url, asset_reference, asset_type, source_type, data_year, resolution_m, point_density_per_m2, coverage_polygon")
      .or(filters.join(","));
    coverage = cov ?? [];
  }

  // 3. Build candidate list by joining catalog ↔ coverage. Filter out Nearmap.
  const candidates: RoofSurfaceSource[] = [];
  for (const c of coverage) {
    if (!c.provider_key) continue;
    if (String(c.provider_key).toLowerCase().startsWith(NEARMAP_FORBIDDEN_PREFIX)) continue;
    candidates.push({
      provider_key: c.provider_key,
      source_type: (c.source_type ?? "dem") as RoofSurfaceSourceType,
      source_url: c.source_url ?? null,
      asset_reference: c.asset_reference ?? null,
      asset_type: c.asset_type ?? null,
      data_year: c.data_year ?? null,
      resolution_m: c.resolution_m ?? null,
      point_density_per_m2: c.point_density_per_m2 ?? null,
      coverage_polygon: c.coverage_polygon ?? null,
    });
  }

  // 4. If a lidar_window was previously discovered, pull whatever asset it
  //    pinned (real source_url only — coverage metadata without URL doesn't count).
  if (args.lidar_window_id) {
    const { data: lwin } = await args.svc
      .from("mskill_lidar_windows")
      .select("provider_key, source_url, asset_type, data_year, point_density_per_m2, resolution_m, has_coverage, coverage_metadata")
      .eq("id", args.lidar_window_id)
      .maybeSingle();
    if (lwin?.source_url && !String(lwin.provider_key ?? "").toLowerCase().startsWith(NEARMAP_FORBIDDEN_PREFIX)) {
      candidates.push({
        provider_key: lwin.provider_key ?? "lidar_window",
        source_type: "point_cloud",
        source_url: lwin.source_url,
        asset_reference: null,
        asset_type: (lwin.asset_type as any) ?? null,
        data_year: lwin.data_year ?? null,
        resolution_m: lwin.resolution_m ?? null,
        point_density_per_m2: lwin.point_density_per_m2 ?? null,
        coverage_polygon: null,
      });
    } else if (lwin?.has_coverage && !lwin?.source_url) {
      notes.push("lidar_window_has_coverage_but_no_source_url");
    }
  }

  // 5. Bucket by tier.
  const usable = candidates.filter(isUsable);
  const pointClouds = usable.filter((s) => s.source_type === "point_cloud");
  const dsms = usable.filter((s) => s.source_type === "dsm");
  const demDtms = usable.filter((s) => s.source_type === "dtm" || s.source_type === "dem");

  pointClouds.sort((a, b) => rankPointCloud(b) - rankPointCloud(a));
  dsms.sort((a, b) => rankRaster(b) - rankRaster(a));
  demDtms.sort((a, b) => rankRaster(b) - rankRaster(a));

  const best_point_cloud_source = pointClouds[0] ?? null;
  const best_dsm_source = dsms[0] ?? null;
  const best_dem_dtm_source = demDtms[0] ?? null;

  // 6. Hard rule: roof_geometry_possible requires point cloud OR dsm.
  let roof_geometry_possible = false;
  let blocking_reason: string | null = null;
  let chosen: RoofSurfaceSource | null = null;

  if (best_point_cloud_source) {
    roof_geometry_possible = true;
    chosen = best_point_cloud_source;
  } else if (best_dsm_source) {
    roof_geometry_possible = true;
    chosen = best_dsm_source;
  } else if (best_dem_dtm_source) {
    blocking_reason = "dem_only_not_sufficient";
    notes.push("DEM/DTM only — roof surface cannot be derived. Need DSM or point cloud.");
  } else if (candidates.length > 0 && usable.length === 0) {
    blocking_reason = "coverage_without_source_url";
    notes.push("Provider coverage rows exist but none have a downloadable source_url or asset_reference.");
  } else {
    blocking_reason = "no_surface_source_found";
  }

  return {
    best_point_cloud_source,
    best_dsm_source,
    best_dem_dtm_source,
    data_year: chosen?.data_year ?? null,
    resolution_m: chosen?.resolution_m ?? null,
    point_density_per_m2: chosen?.point_density_per_m2 ?? null,
    source_url: chosen?.source_url ?? null,
    source_type: chosen?.source_type ?? null,
    roof_geometry_possible,
    blocking_reason,
    notes,
  };
}
