// supabase/functions/start-ai-measurement/index.ts
// Geometry-first v2 — full replacement.
// Canonical AI Measurement entrypoint. Accepts both legacy
// (pipelineEntryId/lat/lng/tenantId/userId/pitchOverride/address)
// and new (lead_id/project_id/property_address/...) payload shapes.
import { Buffer } from "node:buffer";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { computeStraightSkeleton } from "../_shared/straight-skeleton.ts";
import { buildTopology } from "../_shared/topology-engine.ts";
import { fetchOSMBuildingFootprint, fetchOSMBuildingCandidates } from "../_shared/osm-footprint-extractor.ts";
import { generateRoofDiagrams } from "../_shared/roof-diagram-renderer.ts";
import { detectRidgesInPolygon } from "../_shared/image-ridge-detector.ts";
import { splitPlanesFromRidges, type Line as RidgeLine } from "../_shared/ridge-plane-splitter.ts";
import {
  filterRidges,
  consolidatePlanes,
  type RidgeLine as FilterRidgeLine,
} from "../_shared/ridge-filter-and-plane-consolidate.ts";
import { splitPlanesByRidgeClusters } from "../_shared/ridge-cluster-region-split.ts";
import { lineWithinBBox, mergeClusterAwarePlanes } from "../_shared/cluster-aware-plane-merge.ts";
import {
  solvePlanesFromFootprint,
  rebuildPlanesFromSkeletonSegments,
  planeAdjacencyStats,
} from "../_shared/footprint-plane-solver.ts";
import { classifyPlaneEdges } from "../_shared/plane-edge-classifier.ts";
import { snapFootprintToEaves } from "../_shared/footprint-eave-snap.ts";
import { computeOverlayTransform, transformOverlayPoint } from "../_shared/overlay-transform.ts";
import { validateFootprintConstraints } from "../_shared/footprint-constraint-validator.ts";
import { normalizeAdjacentPlanes } from "../_shared/polygon-normalize.ts";

type Point = { x: number; y: number };
type GeoPoint = { lat: number; lng: number };

type RoofPlane = {
  plane_index: number;
  polygon_px: Point[];
  confidence: number;
  pitch?: number | null;
  pitch_degrees?: number | null;
  azimuth?: number | null;
  source: string;
  cluster_id?: string | number | null;
  ridge_group_id?: string | number | null;
  region_bbox?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  source_ridge_ids?: Array<string | number>;
  multi_part_px?: Point[][];
};

type RoofEdge = {
  edge_type: "ridge" | "hip" | "valley" | "eave" | "rake" | "unknown";
  line_px: Point[];
  confidence: number;
  source: string;
  cluster_id?: string | number | null;
  ridge_group_id?: string | number | null;
  region_bbox?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  source_ridge_ids?: Array<string | number>;
};

type DecodedRaster = { width: number; height: number; data: Uint8Array };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAPBOX_TOKEN =
  Deno.env.get("MAPBOX_PUBLIC_TOKEN") ||
  Deno.env.get("MAPBOX_ACCESS_TOKEN") ||
  Deno.env.get("MAPBOX_TOKEN") ||
  "";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const GOOGLE_SOLAR_API_KEY = Deno.env.get("GOOGLE_SOLAR_API_KEY") || GOOGLE_MAPS_API_KEY;
const UNET_ENDPOINT = Deno.env.get("PITCH_UNET_ENDPOINT") || Deno.env.get("INTERNAL_UNET_URL") || "";
const UNET_API_KEY = Deno.env.get("PITCH_UNET_API_KEY") || Deno.env.get("INTERNAL_UNET_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const body = await req.json();

    // Normalize: accept both new and legacy field names.
    const lead_id: string | null =
      body.lead_id ?? body.pipelineEntryId ?? body.pipeline_entry_id ?? null;
    const project_id: string | null = body.project_id ?? null;
    const property_address: string | null = body.property_address ?? body.address ?? null;
    const latitude: number | null = body.latitude ?? body.lat ?? null;
    const longitude: number | null = body.longitude ?? body.lng ?? null;
    const source_button: string = body.source_button ?? "AI Measurement";
    const pitch_override: string | null = body.pitch_override ?? body.pitchOverride ?? null;
    const waste_factor_percent: number = Number(body.waste_factor_percent ?? 10);
    const zoom: number = Number(body.zoom ?? 20);
    const logical_image_width: number = Number(body.logical_image_width ?? 640);
    const logical_image_height: number = Number(body.logical_image_height ?? 640);
    const raster_scale: number = Number(body.raster_scale ?? 2);
    const user_id: string | null = body.user_id ?? body.userId ?? null;
    const tenant_id_hint: string | null = body.tenantId ?? body.tenant_id ?? null;

    if (!lead_id && !project_id) {
      return json({ error: "lead_id (or pipelineEntryId) or project_id is required." }, 400);
    }
    if (!property_address && (latitude == null || longitude == null)) {
      return json({ error: "Property address or latitude/longitude is required." }, 400);
    }

    const sourceRecord = await resolveSourceRecord({ lead_id, project_id });
    const tenant_id: string | null = sourceRecord?.tenant_id ?? tenant_id_hint;
    const company_id: string | null = sourceRecord?.company_id ?? null;
    const resolved_address: string | null =
      property_address || sourceRecord?.address || sourceRecord?.property_address || null;

    if (!tenant_id) return json({ error: "Unable to resolve tenant for this measurement." }, 400);

    const { data: measurementJob, error: measurementJobError } = await supabase
      .from("measurement_jobs")
      .insert({
        tenant_id,
        user_id,
        pipeline_entry_id: lead_id, // legacy column required by existing UI poll
        lead_id,
        project_id,
        source_record_type: lead_id ? "lead" : "project",
        source_record_id: lead_id || project_id,
        source_button,
        status: "queued",
        progress_message: "Queued for AI measurement",
        address: resolved_address,
        lat: latitude,
        lng: longitude,
        pitch_override,
        engine_version: "geometry_first_v2",
      })
      .select("id")
      .single();

    if (measurementJobError) throw measurementJobError;

    const actualW = logical_image_width * raster_scale;
    const actualH = logical_image_height * raster_scale;

    const { data: aiJob, error: aiJobError } = await supabase
      .from("ai_measurement_jobs")
      .insert({
        legacy_measurement_job_id: measurementJob.id,
        tenant_id,
        company_id,
        user_id,
        lead_id,
        project_id,
        source_record_type: lead_id ? "lead" : "project",
        source_record_id: lead_id || project_id,
        source_button,
        property_address: resolved_address ?? "Unknown Address",
        latitude,
        longitude,
        waste_factor_percent,
        status: "queued",
        status_message: "Queued from AI Measurement (geometry_first_v2)",
        logical_image_width,
        logical_image_height,
        actual_image_width: actualW,
        actual_image_height: actualH,
        raster_scale,
        engine_version: "geometry_first_v2",
        entrypoint: "start-ai-measurement",
      })
      .select("id")
      .single();

    if (aiJobError) throw aiJobError;

    await supabase
      .from("measurement_jobs")
      .update({ ai_measurement_job_id: aiJob.id })
      .eq("id", measurementJob.id);

    const work = processJob({
      measurement_job_id: measurementJob.id,
      ai_measurement_job_id: aiJob.id,
      lead_id,
      project_id,
      tenant_id,
      company_id,
      property_address: resolved_address ?? "Unknown Address",
      latitude,
      longitude,
      source_record_type: lead_id ? "lead" : "project",
      source_record_id: lead_id || project_id,
      source_button,
      pitch_override,
      waste_factor_percent,
      zoom,
      logical_image_width,
      logical_image_height,
      raster_scale,
    });

    if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
      (globalThis as any).EdgeRuntime.waitUntil(work);
    } else {
      work.catch((e) => console.error("processJob failed", e));
    }

    return json({
      success: true,
      jobId: measurementJob.id,
      job_id: measurementJob.id,
      aiMeasurementJobId: aiJob.id,
      status: "queued",
    });
  } catch (error) {
    console.error("start-ai-measurement error:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

async function processJob(input: any) {
  try {
    await setMeasurementJobStatus(input.measurement_job_id, "processing", "Resolving location");
    await setAiJobStatus(input.ai_measurement_job_id, "running", "Resolving location");

    const coords = (input.latitude != null && input.longitude != null)
      ? { lat: Number(input.latitude), lng: Number(input.longitude), geocode_location_type: "STORED" }
      : await geocodeAddress(input.property_address);

    if (!coords) throw new Error("Unable to geocode property address.");

    const logicalMpp = metersPerPixel(coords.lat, Number(input.zoom));
    const actualMpp = logicalMpp / Number(input.raster_scale);
    const actualFpp = actualMpp * 3.280839895;

    if (!MAPBOX_TOKEN && !GOOGLE_MAPS_API_KEY) {
      throw new Error("No imagery provider configured: set GOOGLE_MAPS_API_KEY and/or MAPBOX_PUBLIC_TOKEN.");
    }

    await setAiJobStatus(input.ai_measurement_job_id, "running", "Fetching aerial imagery");
    const imageryResult = await fetchAerialImagery({
      lng: coords.lng,
      lat: coords.lat,
      zoom: Number(input.zoom),
      width: Number(input.logical_image_width),
      height: Number(input.logical_image_height),
    });
    const imageUrl = imageryResult.url;
    const imageryProvider = imageryResult.provider;
    const imageryDecisionLog = imageryResult.decisionLog;
    const raster = await decodeRaster(imageryResult.buffer, imageryResult.contentType, imageryProvider);



    // ───────── GEOMETRY-FIRST PIPELINE ─────────
    // U-Net is OPTIONAL. Solar bbox is allowed as a CANDIDATE footprint
    // (validated against coverage rules) — never auto-trusted.
    // The deterministic topology engine is the geometry source of truth.

    // Helper geometry utilities (used during candidate scoring + sanity gate).
    function bboxOf(points: Point[]) {
      if (!points.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, area: Math.max(0, (maxX - minX) * (maxY - minY)) };
    }
    function polygonAreaPx(points: Point[]) {
      let a = 0;
      for (let i = 0, n = points.length; i < n; i++) {
        const j = (i + 1) % n;
        a += points[i].x * points[j].y - points[j].x * points[i].y;
      }
      return Math.abs(a) / 2;
    }
    function bboxIntersect(a: any, b: any) {
      if (!a || !b) return 0;
      const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
      const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
      return ix * iy;
    }
    // Sutherland-Hodgman polygon clipping against an axis-aligned rect.
    // Used for true polygon∩solar_bbox area (fixes the 0-overlap-with-60%-coverage bug
    // where bbox-vs-bbox overlap ignored polygon shape).
    function clipPolygonToRect(poly: Point[], rect: { minX: number; minY: number; maxX: number; maxY: number }) {
      if (!poly || poly.length < 3 || !rect) return [] as Point[];
      const edges: Array<(p: Point) => boolean> = [
        (p) => p.x >= rect.minX,
        (p) => p.x <= rect.maxX,
        (p) => p.y >= rect.minY,
        (p) => p.y <= rect.maxY,
      ];
      const intersect = (a: Point, b: Point, side: number): Point => {
        // side: 0=left,1=right,2=top,3=bottom
        if (side === 0) {
          const t = (rect.minX - a.x) / (b.x - a.x); return { x: rect.minX, y: a.y + t * (b.y - a.y) };
        } else if (side === 1) {
          const t = (rect.maxX - a.x) / (b.x - a.x); return { x: rect.maxX, y: a.y + t * (b.y - a.y) };
        } else if (side === 2) {
          const t = (rect.minY - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: rect.minY };
        } else {
          const t = (rect.maxY - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: rect.maxY };
        }
      };
      let out = poly.slice();
      for (let s = 0; s < 4; s++) {
        const inside = edges[s];
        const input = out;
        out = [];
        if (input.length === 0) break;
        let prev = input[input.length - 1];
        for (const cur of input) {
          const curIn = inside(cur), prevIn = inside(prev);
          if (curIn) {
            if (!prevIn) out.push(intersect(prev, cur, s));
            out.push(cur);
          } else if (prevIn) {
            out.push(intersect(prev, cur, s));
          }
          prev = cur;
        }
      }
      return out;
    }
    // Convex hull (Andrew's monotone chain).
    function convexHull(points: Point[]): Point[] {
      const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        .slice().sort((a, b) => a.x - b.x || a.y - b.y);
      if (pts.length < 3) return pts;
      const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
      const lower: Point[] = [];
      for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      }
      const upper: Point[] = [];
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }
      lower.pop(); upper.pop();
      return lower.concat(upper);
    }

    // Rasterize the union of axis-aligned rectangles into a small bitmap, then
    // trace its outer boundary as a rectilinear polygon. Preserves L/T/cross
    // concavity (unlike convex hull) so the topology engine can split planes.
    function rectilinearUnionPolygon(
      rects: Array<{ minX: number; maxX: number; minY: number; maxY: number }>,
    ): Point[] {
      if (!rects.length) return [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const r of rects) {
        if (r.minX < minX) minX = r.minX; if (r.minY < minY) minY = r.minY;
        if (r.maxX > maxX) maxX = r.maxX; if (r.maxY > maxY) maxY = r.maxY;
      }
      const W = Math.max(1, Math.round(maxX - minX));
      const H = Math.max(1, Math.round(maxY - minY));
      const target = 256;
      const s = Math.min(1, target / Math.max(W, H));
      const gw = Math.max(8, Math.ceil(W * s));
      const gh = Math.max(8, Math.ceil(H * s));
      const grid = new Uint8Array(gw * gh);
      for (const r of rects) {
        const x0 = Math.max(0, Math.floor((r.minX - minX) * s));
        const x1 = Math.min(gw, Math.ceil((r.maxX - minX) * s));
        const y0 = Math.max(0, Math.floor((r.minY - minY) * s));
        const y1 = Math.min(gh, Math.ceil((r.maxY - minY) * s));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) grid[y * gw + x] = 1;
        }
      }
      const filled = (x: number, y: number) =>
        x >= 0 && y >= 0 && x < gw && y < gh && grid[y * gw + x] === 1;
      const key = (x: number, y: number) => `${x},${y}`;
      const adj = new Map<string, Array<{ to: string; x: number; y: number }>>();
      const addEdge = (ax: number, ay: number, bx: number, by: number) => {
        const k = key(ax, ay);
        if (!adj.has(k)) adj.set(k, []);
        adj.get(k)!.push({ to: key(bx, by), x: bx, y: by });
      };
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          if (!filled(x, y)) continue;
          if (!filled(x, y - 1)) { addEdge(x, y, x + 1, y); addEdge(x + 1, y, x, y); }
          if (!filled(x, y + 1)) { addEdge(x, y + 1, x + 1, y + 1); addEdge(x + 1, y + 1, x, y + 1); }
          if (!filled(x - 1, y)) { addEdge(x, y, x, y + 1); addEdge(x, y + 1, x, y); }
          if (!filled(x + 1, y)) { addEdge(x + 1, y, x + 1, y + 1); addEdge(x + 1, y + 1, x + 1, y); }
        }
      }
      if (adj.size === 0) return [];
      const visited = new Set<string>();
      let bestLoop: Array<{ x: number; y: number }> = [];
      for (const startKey of adj.keys()) {
        if (visited.has(startKey)) continue;
        const [sxs, sys] = startKey.split(",").map(Number);
        const loop: Array<{ x: number; y: number }> = [{ x: sxs, y: sys }];
        let curKey = startKey;
        let prevKey = "";
        let safety = adj.size * 4;
        while (safety-- > 0) {
          visited.add(curKey);
          const nbrs = adj.get(curKey) || [];
          const next = nbrs.find((n) => n.to !== prevKey && !visited.has(n.to))
            || nbrs.find((n) => n.to !== prevKey);
          if (!next) break;
          if (next.to === startKey) break;
          loop.push({ x: next.x, y: next.y });
          prevKey = curKey;
          curKey = next.to;
        }
        if (loop.length > bestLoop.length) bestLoop = loop;
      }
      if (bestLoop.length < 4) return [];
      const simplified: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < bestLoop.length; i++) {
        const prev = bestLoop[(i - 1 + bestLoop.length) % bestLoop.length];
        const cur = bestLoop[i];
        const next = bestLoop[(i + 1) % bestLoop.length];
        const collinear =
          (prev.x === cur.x && cur.x === next.x) ||
          (prev.y === cur.y && cur.y === next.y);
        if (!collinear) simplified.push(cur);
      }
      return simplified.map((p) => ({ x: minX + p.x / s, y: minY + p.y / s }));
    }

    // Compute Solar bbox in pixel space — used as the coverage reference target.
    await setAiJobStatus(input.ai_measurement_job_id, "running", "Fetching Google Solar priors");
    const solarData = await fetchGoogleSolar(coords.lat, coords.lng);
    const solarBboxPx = (() => {
      const bb = solarData?.boundingBox;
      if (!bb?.sw || !bb?.ne) return null;
      const sw = lngLatToPx(bb.sw.latitude, bb.sw.longitude, { lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp);
      const ne = lngLatToPx(bb.ne.latitude, bb.ne.longitude, { lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp);
      const minX = Math.min(sw.x, ne.x), maxX = Math.max(sw.x, ne.x);
      const minY = Math.min(sw.y, ne.y), maxY = Math.max(sw.y, ne.y);
      return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, area: Math.max(0, (maxX - minX) * (maxY - minY)) };
    })();

    const geocodePx = { x: raster.width / 2, y: raster.height / 2 };
    const sqftPerPx2 = actualFpp * actualFpp;
    const RESIDENTIAL_MIN_SQFT = 800;
    const MIN_COVERAGE_RATIO = 0.45;

    type FootprintCandidate = {
      source: string;
      polygon: Point[];
      area_sqft: number;
      bbox_px: any;
      bbox_center_distance_from_geocode_px: number;
      overlap_with_solar_bbox: number; // px²
      coverage_ratio_vs_solar_bbox: number | null;
      vertex_count: number;
      validity_score: number;
      rejected_reason: string | null;
      area_score: number;
      solar_overlap_score: number;
      geocode_center_score: number;
      polygon_shape_score: number;
    };

    function scoreCandidate(source: string, polygon: Point[]): FootprintCandidate {
      const cleaned = cleanPolygon(polygon, raster.width, raster.height);
      const valid = cleaned.length >= 3;
      const bbox = valid ? bboxOf(cleaned) : null;
      const areaPx = valid ? polygonAreaPx(cleaned) : 0;
      const area_sqft = areaPx * sqftPerPx2;
      const bbox_center_distance_from_geocode_px = bbox
        ? Math.hypot((bbox.minX + bbox.maxX) / 2 - geocodePx.x, (bbox.minY + bbox.maxY) / 2 - geocodePx.y)
        : Number.POSITIVE_INFINITY;
      // FIX: real polygon ∩ solar_bbox area, not bbox ∩ bbox.
      // The previous bbox-vs-bbox version reported 0 overlap for OSM polygons that
      // visually covered 60–82% of the solar bbox.
      const overlapPolyPx = (solarBboxPx && valid)
        ? polygonAreaPx(clipPolygonToRect(cleaned, solarBboxPx))
        : 0;
      const overlap_with_solar_bbox = overlapPolyPx;
      const coverage_ratio_vs_solar_bbox = solarBboxPx && solarBboxPx.area > 0
        ? overlapPolyPx / solarBboxPx.area
        : null;
      const vertex_count = cleaned.length;

      // Sub-scores in [0,1]
      const area_score = Math.max(0, Math.min(1, area_sqft / 3000)); // saturate at 3000 sqft
      const solar_overlap_score = solarBboxPx && solarBboxPx.area > 0
        ? Math.max(0, Math.min(1, overlap_with_solar_bbox / solarBboxPx.area))
        : 0.5; // neutral if no solar bbox
      const maxDist = Math.hypot(raster.width, raster.height) / 2;
      const geocode_center_score = bbox
        ? Math.max(0, 1 - bbox_center_distance_from_geocode_px / maxDist)
        : 0;
      // Polygon-shape complexity: 4-corner rectangles get penalized when the building
      // is clearly more complex (multiple solar segments). 5+ vertex hulls get boosted.
      const segCount = (solarData?.solarPotential?.roofSegmentStats || []).length;
      let polygon_shape_score = vertex_count >= 4 ? Math.min(1, vertex_count / 8) : 0;
      if (vertex_count <= 4 && segCount > 1) polygon_shape_score *= 0.4;
      if (vertex_count >= 6) polygon_shape_score = Math.min(1, polygon_shape_score + 0.15);

      const validity_score =
        area_score * 0.35 +
        solar_overlap_score * 0.30 +
        geocode_center_score * 0.20 +
        polygon_shape_score * 0.15;

      // Rejection rules
      let rejected_reason: string | null = null;
      if (!valid) rejected_reason = "polygon_invalid_or_off_canvas";
      else if (vertex_count < 4) rejected_reason = "fewer_than_4_corners";
      else if (area_sqft > 0 && area_sqft < RESIDENTIAL_MIN_SQFT) rejected_reason = `area_too_small:${Math.round(area_sqft)}sqft`;
      else if (coverage_ratio_vs_solar_bbox != null && coverage_ratio_vs_solar_bbox < MIN_COVERAGE_RATIO)
        rejected_reason = `coverage_${Math.round((coverage_ratio_vs_solar_bbox || 0) * 100)}pct_lt_${Math.round(MIN_COVERAGE_RATIO * 100)}pct`;
      else if (solarBboxPx && solarBboxPx.area > 0 && overlap_with_solar_bbox <= 0)
        rejected_reason = "no_overlap_with_solar_bbox";
      else if (bbox && bbox_center_distance_from_geocode_px > Math.max(raster.width, raster.height) * 0.4)
        rejected_reason = "bbox_center_far_from_geocode";

      return {
        source,
        polygon: cleaned,
        area_sqft,
        bbox_px: bbox,
        bbox_center_distance_from_geocode_px,
        overlap_with_solar_bbox,
        coverage_ratio_vs_solar_bbox,
        vertex_count,
        validity_score,
        rejected_reason,
        area_score,
        solar_overlap_score,
        geocode_center_score,
        polygon_shape_score,
      };
    }

    // 1. Build OSM candidates (ALL nearby buildings, not just one).
    const candidates: FootprintCandidate[] = [];
    try {
      const osmRes = await fetchOSMBuildingCandidates(coords.lat, coords.lng, { searchRadius: 80 });
      for (const c of osmRes.candidates || []) {
        const polyPx = c.ring.map(([lng, lat]) =>
          lngLatToPx(lat, lng, { lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp),
        );
        // Drop trailing duplicate vertex.
        let pp = polyPx;
        if (pp.length > 3) {
          const f = pp[0], l = pp[pp.length - 1];
          if (Math.hypot(f.x - l.x, f.y - l.y) < 1) pp = pp.slice(0, -1);
        }
        const sc = scoreCandidate(`osm_overpass#${c.osmId}`, pp);
        candidates.push(sc);
      }
    } catch (e) {
      console.warn("[footprint-selection] OSM candidate scan failed:", (e as Error).message);
    }

    // 2. Optional U-Net segmentation pass — produces a candidate footprint AND
    //    optional plane/edge refinements (used later if topology yields nothing).
    await setAiJobStatus(input.ai_measurement_job_id, "running", "Optional segmentation pass");
    const segmentation = await runSegmentation({
      image_url: imageUrl,
      image_width: raster.width,
      image_height: raster.height,
      lat: coords.lat,
      lng: coords.lng,
      meters_per_pixel_actual: actualMpp,
      feet_per_pixel_actual: actualFpp,
    });
    const unetPlanes = (segmentation.planes || [])
      .map((p: any, i: number) => cleanPlane(p, i + 1, raster.width, raster.height))
      .filter(Boolean) as RoofPlane[];
    const unetEdges = (segmentation.edges || [])
      .map((e: any) => cleanEdge(e, raster.width, raster.height))
      .filter(Boolean) as RoofEdge[];
    const segFootprint = (segmentation.footprint_polygon_px || []) as Point[];
    if (segFootprint.length >= 3) {
      candidates.push(scoreCandidate("imagery_unet_mask", segFootprint));
    }

    // 3a. Solar roofSegmentStats hull — preferred over the plain bbox because
    // straight_skeleton/topology needs a real building shape, not a 4-corner rect.
    const solarSegments = (solarData?.solarPotential?.roofSegmentStats || []) as any[];
    let solarSegmentsDebug: any = { count: solarSegments.length, hull_px: null, hull_area_sqft: 0, bbox_area_sqft: 0, hull_vs_bbox_area_ratio: null };
    if (solarSegments.length >= 1) {
      const segPts: Point[] = [];
      const centersPx: Array<[number, number]> = [];
      const boundsPx: any[] = [];
      for (const seg of solarSegments) {
        const cLat = Number(seg?.center?.latitude);
        const cLng = Number(seg?.center?.longitude);
        if (Number.isFinite(cLat) && Number.isFinite(cLng)) {
          const c = lngLatToPx(cLat, cLng, { lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp);
          segPts.push(c);
          centersPx.push([Math.round(c.x), Math.round(c.y)]);
          // Buffer a square around the center sized by sqrt(groundAreaMeters2),
          // so the hull captures the true segment extent.
          const groundM2 = Number(seg?.stats?.groundAreaMeters2 || seg?.stats?.areaMeters2);
          if (Number.isFinite(groundM2) && groundM2 > 0) {
            const halfM = Math.sqrt(groundM2) / 2;
            const halfPx = halfM / actualMpp;
            segPts.push({ x: c.x - halfPx, y: c.y - halfPx });
            segPts.push({ x: c.x + halfPx, y: c.y - halfPx });
            segPts.push({ x: c.x + halfPx, y: c.y + halfPx });
            segPts.push({ x: c.x - halfPx, y: c.y + halfPx });
          }
        }
        const bb = seg?.boundingBox;
        if (bb?.sw && bb?.ne) {
          const sw = lngLatToPx(bb.sw.latitude, bb.sw.longitude, { lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp);
          const ne = lngLatToPx(bb.ne.latitude, bb.ne.longitude, { lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp);
          segPts.push(sw, ne, { x: sw.x, y: ne.y }, { x: ne.x, y: sw.y });
          boundsPx.push({ minX: Math.round(Math.min(sw.x, ne.x)), maxX: Math.round(Math.max(sw.x, ne.x)),
                          minY: Math.round(Math.min(sw.y, ne.y)), maxY: Math.round(Math.max(sw.y, ne.y)) });
        }
      }
      if (segPts.length >= 3) {
        const hull = convexHull(segPts);
        if (hull.length >= 4) {
          const hullCand = scoreCandidate("google_solar_segments_hull", hull);
          candidates.push(hullCand);
          solarSegmentsDebug = {
            count: solarSegments.length,
            centers_px: centersPx,
            bounds_px: boundsPx,
            hull_px: hull.map((p) => [Math.round(p.x), Math.round(p.y)]),
            hull_area_sqft: Math.round(hullCand.area_sqft),
            bbox_area_sqft: 0, // filled below
            hull_vs_bbox_area_ratio: null,
          };
        }
      }

      // 3a-bis. Solar roofSegmentStats UNION (rectilinear).
      // The convex hull above kills all concavity, so the topology engine sees a
      // single fan of triangles → 1 plane, no ridges. The union below preserves
      // L/T/cross shapes so straight-skeleton can emit real ridges/hips/valleys.
      if (boundsPx.length >= 1) {
        try {
          const unionPoly = rectilinearUnionPolygon(boundsPx);
          if (unionPoly.length >= 4) {
            const unionCand = scoreCandidate("google_solar_segments_union", unionPoly);
            // Boost shape score: union polygons preserve concavity that topology needs.
            // A convex hull can score slightly higher on area/coverage while still
            // collapsing to one roof plane, so prefer the topology-capable union.
            unionCand.polygon_shape_score = Math.min(1, unionCand.polygon_shape_score + 0.55);
            unionCand.validity_score =
              Math.min(1,
                unionCand.area_score * 0.35 +
                unionCand.solar_overlap_score * 0.30 +
                unionCand.geocode_center_score * 0.20 +
                unionCand.polygon_shape_score * 0.15 +
                0.08,
              );
            candidates.push(unionCand);
            solarSegmentsDebug.union_vertices = unionPoly.length;
            solarSegmentsDebug.union_area_sqft = Math.round(unionCand.area_sqft);
          }
        } catch (e) {
          console.warn("[SOLAR_SEGMENT_UNION] failed:", (e as Error).message);
        }
      }
    }

    // 3b. Solar building extent rectangle as a fallback candidate (NOT auto-promoted).
    const solarFp = footprintFromSolarBoundingBox(solarData, { lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp);
    if (solarFp && solarFp.length >= 3) {
      const bboxCand = scoreCandidate("google_solar_bbox", solarFp);
      candidates.push(bboxCand);
      solarSegmentsDebug.bbox_area_sqft = Math.round(bboxCand.area_sqft);
      if (solarSegmentsDebug.hull_area_sqft && bboxCand.area_sqft > 0) {
        solarSegmentsDebug.hull_vs_bbox_area_ratio = Number((solarSegmentsDebug.hull_area_sqft / bboxCand.area_sqft).toFixed(3));
      }
    }

    console.log("[SOLAR_SEGMENT_FOOTPRINT]", JSON.stringify({
      segment_count: solarSegments.length,
      hull_vertices: Array.isArray(solarSegmentsDebug.hull_px) ? solarSegmentsDebug.hull_px.length : 0,
      hull_area_sqft: solarSegmentsDebug.hull_area_sqft,
      bbox_area_sqft: solarSegmentsDebug.bbox_area_sqft,
    }));

    // 4. Pick best valid candidate.
    const validCandidates = candidates.filter((c) => c.rejected_reason === null);
    validCandidates.sort((a, b) => b.validity_score - a.validity_score);
    const selected = validCandidates[0] || null;

    let footprint: Point[] = selected?.polygon ?? [];
    let footprintSource: string = selected?.source ?? "none";
    let usedSolarBboxAsCropOnly = false;
    let usedSyntheticDebugRectangle = false;
    let footprintSelectionFailed = !selected;

    // ── EAVE SNAP — pull footprint vertices to the strongest nearby roof
    // perimeter edge so planes / overlay align to actual eaves rather than
    // Solar hull center mass. Conservative: 16 px max move, vegetation/shadow
    // pixels are skipped, and we record perimeter_off_eave_ratio for QA.
    let eaveSnapDebug: any = null;
    let snappedFootprintBboxPx: any = null;
    if (footprint.length >= 3 && raster?.data) {
      try {
        // Do NOT clamp to solarBboxPx — it may include non-roof area
        // (pool, yard). The Sobel edge detector + vegetation/shadow filter
        // is the real guard. Use a generous snap radius to reach actual eaves.
        const snap = snapFootprintToEaves(footprint, raster as any, {
          maxSnapPx: 24,
          clampBbox: null,
        });
        eaveSnapDebug = {
          moved_count: snap.moved_count,
          total_vertices: snap.total_vertices,
          avg_move_px: Number(snap.avg_move_px.toFixed(2)),
          perimeter_off_eave_ratio: Number(snap.perimeter_off_eave_ratio.toFixed(3)),
        };
        (globalThis as any).__eaveSnapDebug = eaveSnapDebug;
        // Coverage gate: reject snap if it pulled footprint inside <75% of solar building bbox.
        const snappedBb = bboxOf(snap.snapped);
        const buildingArea = solarBboxPx?.area || 0;
        const snappedArea = snappedBb ? snappedBb.width * snappedBb.height : 0;
        const coverageVsBuilding = buildingArea > 0 ? snappedArea / buildingArea : 1;
        if (buildingArea > 0 && coverageVsBuilding < 0.75) {
          console.warn("[EAVE_SNAP] rejected — snapped bbox covers", coverageVsBuilding.toFixed(2), "of solar building bbox (<0.75)");
          eaveSnapDebug.rejected_low_coverage = Number(coverageVsBuilding.toFixed(3));
        } else {
          footprint = snap.snapped;
          snappedFootprintBboxPx = snappedBb;
        }
        console.log("[EAVE_SNAP]", JSON.stringify({ ...eaveSnapDebug, coverage_vs_building: Number(coverageVsBuilding.toFixed(3)) }));
      } catch (e) {
        console.warn("[EAVE_SNAP] failed:", (e as Error).message);
      }
    }

    console.log("[FOOTPRINT_SOURCE_SELECTION]", JSON.stringify({
      candidates: candidates.map((c) => ({
        source: c.source,
        area_sqft: Math.round(c.area_sqft),
        coverage_ratio_vs_solar_bbox: c.coverage_ratio_vs_solar_bbox,
        overlap_with_solar_bbox: Math.round(c.overlap_with_solar_bbox),
        center_distance_px: Math.round(c.bbox_center_distance_from_geocode_px),
        vertex_count: c.vertex_count,
        validity_score: Number(c.validity_score.toFixed(3)),
        rejected_reason: c.rejected_reason,
      })),
      selected: selected
        ? { source: selected.source, area_sqft: Math.round(selected.area_sqft), validity_score: Number(selected.validity_score.toFixed(3)) }
        : null,
      rejected: candidates.filter((c) => c.rejected_reason).map((c) => ({ source: c.source, reason: c.rejected_reason })),
    }));

    // 5. Run deterministic topology on the selected footprint.
    let cleanPlanes: RoofPlane[] = [];
    let cleanEdges: RoofEdge[] = [];
    let topologySource = "none";
    let ridgeDetectionRan = false;
    let ridgeDetectedCount = 0;
    let ridgeSplitPlaneCount = 0;
    let planeMergeDebug: any = null;
    let footprintCoverageDebug: any = null;
    let planeEdgeClassifierDebug: any = null;

    const addSolarSegmentStructure = () => {
      const bb = bboxOf(footprint);
      if (!bb) return false;
      const rawSegments = (solarSegments || [])
        .map((seg: any, idx: number) => {
          const cLat = Number(seg?.center?.latitude);
          const cLng = Number(seg?.center?.longitude);
          if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) return null;
          const center = lngLatToPx(cLat, cLng, { lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp);
          const az = Number(seg?.azimuthDegrees);
          const pitchDeg = Number(seg?.pitchDegrees);
          return { idx, center, az, pitchDeg };
        })
        .filter(Boolean) as Array<{ idx: number; center: Point; az: number; pitchDeg: number }>;
      if (rawSegments.length < 2) return false;
      const xs = rawSegments.map((s) => s.center.x), ys = rawSegments.map((s) => s.center.y);
      const splitOnX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
      rawSegments.sort((a, b) => (splitOnX ? a.center.x - b.center.x : a.center.y - b.center.y));
      const cuts = rawSegments.slice(0, -1).map((s, i) =>
        ((splitOnX ? s.center.x : s.center.y) + (splitOnX ? rawSegments[i + 1].center.x : rawSegments[i + 1].center.y)) / 2,
      );
      const bounds = [splitOnX ? bb.minX : bb.minY, ...cuts, splitOnX ? bb.maxX : bb.maxY];
      const segments = rawSegments.map((seg, idx) => {
        const rect = splitOnX
          ? { minX: bounds[idx], maxX: bounds[idx + 1], minY: bb.minY, maxY: bb.maxY }
          : { minX: bb.minX, maxX: bb.maxX, minY: bounds[idx], maxY: bounds[idx + 1] };
        const clipped = cleanPolygon(clipPolygonToRect(footprint, rect), raster.width, raster.height);
        return clipped.length >= 3 ? { plane_index: idx + 1, polygon_px: clipped, confidence: 0.76, pitch_degrees: Number.isFinite(seg.pitchDeg) ? seg.pitchDeg : null, azimuth: Number.isFinite(seg.az) ? seg.az : null, source: "google_solar_segment_planes" } : null;
      }).filter(Boolean) as RoofPlane[];
      if (segments.length < 2) return false;
      cleanPlanes = segments;
      const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
      const n = Math.max(1, Math.min(3, segments.length));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI;
        const len = Math.min(bb.width, bb.height) * (0.35 - i * 0.04);
        cleanEdges.push({ edge_type: i === 0 ? "ridge" : i === 1 ? "hip" : "valley", line_px: [{ x: cx - Math.cos(a) * len, y: cy - Math.sin(a) * len }, { x: cx + Math.cos(a) * len, y: cy + Math.sin(a) * len }], confidence: 0.68, source: "google_solar_segment_structure" });
      }
      topologySource = "google_solar_segment_structure";
      return true;
    };

    const edgeKeyFor = (a: Point, b: Point) => {
      const sa = { x: Math.round(a.x / 2) * 2, y: Math.round(a.y / 2) * 2 };
      const sb = { x: Math.round(b.x / 2) * 2, y: Math.round(b.y / 2) * 2 };
      const ka = `${sa.x}:${sa.y}`;
      const kb = `${sb.x}:${sb.y}`;
      return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };

    const classifyFootprintEdge = (a: Point, b: Point): "eave" | "rake" => {
      const solarAz = dominantSolarAzimuth(solarData);
      if (solarAz === null) return "eave";
      const edgeAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      const edgeAngle180 = ((edgeAngle % 180) + 180) % 180;
      const downslopeAxis = ((solarAz % 180) + 180) % 180;
      const diff = Math.abs(edgeAngle180 - downslopeAxis);
      const angleDiff = Math.min(diff, 180 - diff);
      return angleDiff <= 30 ? "rake" : "eave";
    };

    const ensureExteriorFootprintEdges = (source = "footprint_perimeter_forced") => {
      const existingEdgeKeys = new Set(
        cleanEdges.map((e) => {
          const pts = e.line_px || [];
          if (pts.length < 2) return "";
          return edgeKeyFor(pts[0], pts[pts.length - 1]);
        }).filter(Boolean),
      );
      let created = 0;
      for (let fi = 0; fi < footprint.length; fi++) {
        const a = footprint[fi];
        const b = footprint[(fi + 1) % footprint.length];
        if (Math.hypot(b.x - a.x, b.y - a.y) < 4) continue;
        const edgeKey = edgeKeyFor(a, b);
        if (existingEdgeKeys.has(edgeKey)) continue;
        cleanEdges.push({
          edge_type: classifyFootprintEdge(a, b),
          line_px: [a, b],
          confidence: 0.70,
          source,
        });
        existingEdgeKeys.add(edgeKey);
        created++;
      }
      return created;
    };

    const applyFootprintCoverageGate = (stage: string) => {
      const selectedFootprintAreaPx = Math.max(0, polygonAreaPx(footprint));
      const solverPlaneAreaSumPx = cleanPlanes.reduce((sum, p) => {
        const poly = p.polygon_px || [];
        return sum + (poly.length >= 3 ? polygonAreaPx(poly) : 0);
      }, 0);
      const coverageRatio = selectedFootprintAreaPx > 0 ? solverPlaneAreaSumPx / selectedFootprintAreaPx : 0;
      const isSinglePlaneFallback = cleanPlanes.length === 1 && cleanPlanes[0]?.source === "single_plane_fallback";
      // Solar segment planes come from Google Solar API — trust them with a
      // relaxed coverage threshold (0.85) instead of the strict 0.95–1.05 band.
      const isSolarSegmentSource = cleanPlanes.length >= 2 && cleanPlanes.every(
        (p) => p.source === "google_solar_segment_planes" || p.source === "google_solar_segment_structure"
      );
      const coverageOk = isSolarSegmentSource
        ? coverageRatio >= 0.85 && coverageRatio <= 1.15
        : coverageRatio >= 0.95 && coverageRatio <= 1.05;
      const solverAccepted = cleanPlanes.length > 0 && !isSinglePlaneFallback && coverageOk;
      const fallbackRequired = footprint.length >= 3 && !solverAccepted;
      footprintCoverageDebug = {
        stage,
        selected_footprint_area: round(selectedFootprintAreaPx * actualFpp * actualFpp, 2),
        selected_footprint_area_px: round(selectedFootprintAreaPx, 2),
        solver_plane_area_sum: round(solverPlaneAreaSumPx * actualFpp * actualFpp, 2),
        solver_plane_area_sum_px: round(solverPlaneAreaSumPx, 2),
        coverage_ratio: round(coverageRatio, 3),
        input_plane_count: cleanPlanes.length,
        solver_accepted: solverAccepted,
        fallback_applied: fallbackRequired,
        solar_segment_exempt: isSolarSegmentSource,
      };
      if (fallbackRequired) {
        const prior = cleanPlanes[0] || null;
        cleanPlanes = [{
          plane_index: 1,
          polygon_px: footprint,
          confidence: coverageRatio < 0.75 ? 0.40 : 0.50,
          pitch: prior?.pitch ?? null,
          pitch_degrees: prior?.pitch_degrees ?? null,
          azimuth: prior?.azimuth ?? null,
          source: "single_plane_fallback",
        }];
        // CRITICAL: Do NOT wipe cleanEdges here — edge classification may have
        // already populated them. Only reset planes; edges will be rebuilt by
        // ensureExteriorFootprintEdges if needed.
        topologySource = "single_plane_fallback";
      }
      console.log("[FOOTPRINT_COVERAGE_SOLVER]", JSON.stringify({
        ...footprintCoverageDebug,
        plane_count: cleanPlanes.length,
        exterior_edges_created: 0,
        shared_edges_created: planeEdgeClassifierDebug?.shared_edges ?? 0,
      }));
      return fallbackRequired;
    };

    if (footprint.length >= 3) {
      await setAiJobStatus(input.ai_measurement_job_id, "running", "Running deterministic topology engine");

      // 5a. STRUCTURE EXTRACTION — image-based ridge detection + recursive plane split.
      // straight_skeleton alone only produces medial-axis lines; on a smoothed
      // hull it collapses to one plane. We must inject real structural ridges
      // BEFORE the skeleton step so the footprint is decomposed into facets.
      const splitRidgeEdges: RoofEdge[] = [];
      let topLevelFilteredRidges: any[] = [];
      try {
        const solarAzimuths: number[] = (solarSegments || [])
          .map((s: any) => Number(s?.azimuthDegrees))
          .filter((n: number) => Number.isFinite(n));

        const detect = (poly: Point[]): RidgeLine[] => {
          const r = detectRidgesInPolygon({
            raster,
            polygon: poly,
            solarAzimuthsDeg: solarAzimuths,
            maxRidges: 3,
          });
          return r.lines as RidgeLine[];
        };

        // Run a single top-level detection pass for logging/QA purposes.
        // NOTE: maxRidges raised from 4 → 12 — complex multi-wing roofs
        // (Montelluna-style) have multiple independent ridge systems and
        // need many ridges so the regional splitter can cluster them.
        const topLevel = detectRidgesInPolygon({
          raster,
          polygon: footprint,
          solarAzimuthsDeg: solarAzimuths,
          maxRidges: 12,
        });
        ridgeDetectionRan = true;
        ridgeDetectedCount = topLevel.lines.length;

        // RIDGE FILTERING — keep only top 1–3 structural ridges.
        const filtered = filterRidges(
          topLevel.lines as FilterRidgeLine[],
          footprint,
          solarAzimuths,
        );
        topLevelFilteredRidges = filtered.kept as any[];
        console.log("[RIDGE_FILTER]", JSON.stringify({
          detected: filtered.detected,
          kept: filtered.kept.length,
          discarded: filtered.discarded,
          reasons: filtered.reasons,
        }));
        console.log("[RIDGE_DETECTION]", JSON.stringify({
          ridge_count: topLevel.lines.length,
          ridge_scores: topLevel.debug.scores,
          azimuth_targets_deg: topLevel.debug.azimuth_targets_deg,
          raw_line_count: topLevel.debug.raw_line_count,
          filtered_line_count: topLevel.debug.filtered_line_count,
          roi: topLevel.debug.roi,
        }));

        if (filtered.kept.length > 0) {
          // Wrap detect to also pass through the filter on every recursion
          // (used as the inner-region fallback detector).
          const detectFiltered = (poly: Point[]): RidgeLine[] => {
            const sub = detectRidgesInPolygon({
              raster,
              polygon: poly,
              solarAzimuthsDeg: solarAzimuths,
              maxRidges: 3,
            });
            const f = filterRidges(sub.lines as FilterRidgeLine[], poly, solarAzimuths);
            return f.kept as RidgeLine[];
          };

          // ── REGIONAL RIDGE CLUSTERING + LOCAL SPLIT ──────────────────────
          // Replaces the previous global splitter, which split the ENTIRE
          // footprint along every ridge and produced giant rectangles on
          // multi-wing roofs. The regional splitter clusters ridges by angle
          // (≤20°) and midpoint proximity (≤50 px), assigns each cluster a
          // local region bbox (padded 25 px), and only splits geometry that
          // lies inside that region with that cluster's ridges.
          const clusterInput = (filtered.kept as any[]).map((r, idx) => {
            const ridgeId = String(r.ridge_id ?? r.id ?? `ridge-${idx}`);
            r.__cluster_ridge_id = ridgeId;
            return ({
            id: ridgeId,
            ridge_id: ridgeId,
            p1: r.p1,
            p2: r.p2,
            score: r.score ?? 0.5,
            angleDeg: typeof r.angleDeg === "number"
              ? r.angleDeg
              : Math.atan2(r.p2.y - r.p1.y, r.p2.x - r.p1.x) * 180 / Math.PI,
          });
          });

          const pitchFromSolar = dominantSolarPitchRise(solarData) ?? 6;
          const pitchDegFromSolar = risePer12ToDegrees(pitchFromSolar);
          const azimuthFromSolar = dominantSolarAzimuth(solarData) ?? null;

          const regional = splitPlanesByRidgeClusters({
            footprint,
            ridges: clusterInput,
            angleToleranceDeg: 20,
            midpointDistPx: 50,
            regionPadPx: 25,
            detectRidgesFn: detectFiltered,
            recursionMaxDepth: 3,
          });

          console.log("[RIDGE_CLUSTERING]", JSON.stringify({
            total_ridges: regional.debug.total_ridges,
            clusters: regional.debug.cluster_count,
            cluster_sizes: regional.debug.cluster_sizes,
            region_planes_per_cluster: regional.debug.region_planes_per_cluster,
            fallback_used: regional.debug.fallback_used,
            reason: regional.debug.reason,
          }));

          // Stash for debug payload.
          (globalThis as any).__ridgeClustersDebug = {
            total_ridges: regional.debug.total_ridges,
            cluster_count: regional.debug.cluster_count,
            cluster_sizes: regional.debug.cluster_sizes,
            region_planes_per_cluster: regional.debug.region_planes_per_cluster,
            fallback_used: regional.debug.fallback_used,
            clusters: regional.clusters.map((c) => ({
              cluster_index: c.cluster_index,
              angle_deg: Math.round(c.angle_deg * 10) / 10,
              ridge_count: c.ridge_count,
              region_bbox: c.region_bbox,
            })),
          };

          // ── FOOTPRINT-FIRST SOLVER (primary) ──
          // Footprint defines geometry; ridges are validators/hints only.
          const solverInput = clusterInput.map((r) => ({
            p1: r.p1,
            p2: r.p2,
            score: r.score,
          }));
          const solverResult = solvePlanesFromFootprint(footprint, solverInput);
          console.log("[FOOTPRINT_SOLVER]", JSON.stringify(solverResult.stats));
          (globalThis as any).__footprintSolverDebug = solverResult.stats;

          // Selection priority:
          //   1) footprint solver (≥2 planes, not rejected, full-footprint coverage)
          //   2) regional clustering ONLY when it covers the full footprint
          //   3) global recursive splitter — last-resort fallback, coverage-gated
          type PlaneAreaCandidate = { polygon?: Point[]; polygon_px?: Point[] };
          const planeAreaRatio = (planes: PlaneAreaCandidate[]) => {
            const footprintArea = Math.max(1, polygonAreaPx(footprint));
            const planeArea = planes.reduce((sum, p) => {
              const poly = p.polygon || p.polygon_px || [];
              return sum + (poly.length >= 3 ? polygonAreaPx(poly) : 0);
            }, 0);
            return planeArea / footprintArea;
          };
          let splitPlanes: PlaneAreaCandidate[];
          let solverMode: string;
          const solverPlanes = solverResult.planes
            .filter((p) => p.polygon.length >= 3)
            .map((p) => ({ polygon: p.polygon }));
          const solverCoverageRatio = solverPlanes.length >= 2 ? planeAreaRatio(solverPlanes) : 0;
          const regionalCoverageRatio = regional.planes.length >= 2 ? planeAreaRatio(regional.planes) : 0;
          if (solverPlanes.length >= 2 && !solverResult.stats.rejected && solverCoverageRatio >= 0.85) {
            splitPlanes = solverPlanes;
            solverMode = "footprint_solver";
          } else if (regional.planes.length >= 2 && regionalCoverageRatio >= 0.85) {
            splitPlanes = regional.planes;
            solverMode = "regional_clustered";
          } else {
            const fallbackPlanes = splitPlanesFromRidges(footprint, detectFiltered, 0, 3);
            const fallbackCoverageRatio = fallbackPlanes.length >= 2 ? planeAreaRatio(fallbackPlanes) : 0;
            if (fallbackPlanes.length >= 2 && fallbackCoverageRatio >= 0.85) {
              splitPlanes = fallbackPlanes;
              solverMode = "global_fallback";
            } else {
              splitPlanes = [];
              solverMode = "single_plane_coverage_fallback";
            }
          }
          ridgeSplitPlaneCount = splitPlanes.length;
          console.log("[RIDGE_SPLIT]", JSON.stringify({
            initial_planes: 1,
            final_planes: splitPlanes.length,
            split_success: splitPlanes.length >= 2,
            mode: solverMode,
            solver_coverage_ratio: Number(solverCoverageRatio.toFixed(3)),
            regional_coverage_ratio: Number(regionalCoverageRatio.toFixed(3)),
            max_depth: 3,
          }));

          if (splitPlanes.length >= 2) {
            cleanPlanes = splitPlanes.map((sp, i) => ({
              plane_index: i + 1,
              polygon_px: sp.polygon,
              confidence: 0.72,
              pitch: pitchFromSolar,
              pitch_degrees: pitchDegFromSolar,
              azimuth: azimuthFromSolar,
              source: solverMode === "footprint_solver" ? "footprint_solver" : "ridge_split_recursive",
              cluster_id: sp.cluster_id ?? (regional.planes.length >= 2 ? null : "global_fallback"),
              ridge_group_id: sp.ridge_group_id ?? (regional.planes.length >= 2 ? null : "global_fallback"),
              region_bbox: sp.region_bbox ?? null,
              source_ridge_ids: sp.source_ridge_ids ?? [],
            }));
            for (const r of filtered.kept as any[]) {
              const ridgeId = String(r.__cluster_ridge_id ?? r.ridge_id ?? r.id ?? "");
              const assignedCluster = regional.clusters.find((c) => c.ridges.some((cr: any) => String(cr.ridge_id ?? cr.id ?? "") === ridgeId));
              const ridgeIds = assignedCluster?.ridges.map((cr: any, idx: number) => String(cr.ridge_id ?? cr.id ?? `${assignedCluster.cluster_index}:${idx}`)) || [];
              if (assignedCluster && !lineWithinBBox([r.p1, r.p2], assignedCluster.region_bbox, 2)) {
                console.log("[RIDGE_REJECTED]", JSON.stringify({ reason: "ridge_outside_assigned_cluster_bbox", cluster_id: assignedCluster.cluster_index }));
                continue;
              }
              splitRidgeEdges.push({
                edge_type: "ridge",
                line_px: [r.p1, r.p2],
                confidence: Math.min(0.9, 0.55 + (r.score ?? 0.5) * 0.4),
                source: "image_ridge_detector",
                cluster_id: assignedCluster?.cluster_index ?? null,
                ridge_group_id: assignedCluster?.cluster_index ?? null,
                region_bbox: assignedCluster?.region_bbox ?? null,
                source_ridge_ids: ridgeIds,
              });
            }
            cleanEdges.push(...splitRidgeEdges);
            topologySource = solverMode === "footprint_solver" ? "footprint_solver" : "ridge_split_recursive";
          }
        }
      } catch (e) {
        console.warn("[RIDGE_SPLIT] failed:", (e as Error).message);
      }

      // ── CLUSTER-AWARE PLANE MERGE — Montelluna guardrail: never merge
      //    across independent ridge clusters/wings/valley boundaries.
      if (topologySource === "ridge_split_recursive" && cleanPlanes.length > 1) {
        try {
          const ridgeCatalog = (topLevelFilteredRidges ?? []).map((r: any, i: number) => ({
            id: String(r.__cluster_ridge_id ?? r.ridge_id ?? r.id ?? i),
            ridge_id: String(r.__cluster_ridge_id ?? r.ridge_id ?? r.id ?? i),
            p1: r.p1,
            p2: r.p2,
          }));
          const mergeResult = mergeClusterAwarePlanes({
            planes: cleanPlanes.map((p: any) => ({
              id: p.plane_index,
              plane_index: p.plane_index,
              polygon_px: p.polygon_px,
              pitch: p.pitch,
              pitch_degrees: p.pitch_degrees,
              azimuth: p.azimuth,
              source: p.source,
              cluster_id: p.cluster_id ?? null,
              ridge_group_id: p.ridge_group_id ?? null,
              region_bbox: p.region_bbox ?? null,
              source_ridge_ids: p.source_ridge_ids ?? [],
            })),
            blockingEdges: cleanEdges,
            ridges: ridgeCatalog,
            feetPerPixel: actualFpp,
          });
          planeMergeDebug = mergeResult.debug;
          cleanPlanes = mergeResult.planes.map((p: any, i: number) => ({
            plane_index: i + 1,
            polygon_px: p.polygon_px,
            confidence: 0.74,
            pitch: p.pitch ?? null,
            pitch_degrees: p.pitch_degrees ?? null,
            azimuth: p.azimuth ?? null,
            source: "cluster_aware_plane_merge_v1",
            cluster_id: p.cluster_id ?? null,
            ridge_group_id: p.ridge_group_id ?? null,
            region_bbox: p.region_bbox ?? null,
            source_ridge_ids: p.source_ridge_ids ?? [],
            multi_part_px: p.multi_part_px,
          })) as any;
        } catch (e) {
          console.warn("[CLUSTER_AWARE_PLANE_MERGE] failed:", (e as Error).message);
        }
      }

      try {
        // 5b. Skeleton — used as fallback OR to add minor interior structure.
        if (cleanPlanes.length < 2) {
          const skeletonEdges = computeStraightSkeleton(
            footprint.map((p) => [p.x, p.y] as [number, number]),
          );
          if (skeletonEdges && skeletonEdges.length > 0) {
            for (const se of skeletonEdges as any[]) {
              const a = se.a ?? se.p1 ?? se.start ?? se[0];
              const b = se.b ?? se.p2 ?? se.end ?? se[1];
              const ax = Array.isArray(a) ? a[0] : a?.x;
              const ay = Array.isArray(a) ? a[1] : a?.y;
              const bx = Array.isArray(b) ? b[0] : b?.x;
              const by = Array.isArray(b) ? b[1] : b?.y;
              if ([ax, ay, bx, by].every((n) => Number.isFinite(n))) {
                const t = String(se.type || "ridge").toLowerCase();
                cleanEdges.push({
                  edge_type: (t === "hip" || t === "valley" || t === "ridge") ? t as any : "ridge",
                  line_px: [{ x: ax, y: ay }, { x: bx, y: by }],
                  confidence: 0.7,
                  source: "topology_engine_v2_skeleton",
                });
              }
            }
            if (topologySource === "none") topologySource = "straight_skeleton";
          }
        }

        // 5c. Triangulation eaves/rakes — perimeter-only support.
        // Never use triangulation/topology_engine_v2 planes as final roof planes;
        // those internal triangles caused collapsed ~500 sqft reports.
        const topo = buildTopology(footprint);
        if (topo.planes.length > 0) {
          // Always pull in eave/rake perimeter edges from triangulation.
          for (const e of topo.edges) {
            if (e.type === "eave" || e.type === "rake") {
              cleanEdges.push({
                edge_type: e.type,
                line_px: [e.p1, e.p2],
                confidence: 0.65,
                source: "topology_engine_v2",
              });
            }
          }
        }
      } catch (e) {
        console.warn("[geometry-first] topology engine failed:", (e as Error).message);
      }

      if (cleanPlanes.length < 2 || !cleanEdges.some((e) => e.edge_type === "ridge" || e.edge_type === "hip" || e.edge_type === "valley")) {
        const solarStructured = addSolarSegmentStructure();
        if (solarStructured) {
          ridgeSplitPlaneCount = cleanPlanes.length;
          console.log("[SOLAR_SEGMENT_STRUCTURE]", JSON.stringify({ planes: cleanPlanes.length, edges: cleanEdges.length, topology_source: topologySource }));
        }
      }
    }

    // 6. Refine with U-Net output ONLY if topology produced nothing AND U-Net did.
    if (cleanPlanes.length === 0 && unetPlanes.length > 0) {
      cleanPlanes = unetPlanes;
      topologySource = "unet_planes";
    }
    if (cleanEdges.length === 0 && unetEdges.length > 0) {
      cleanEdges = unetEdges;
    }

    // ── PLANE CONSOLIDATION — drop tiny noise planes, merge near-duplicates,
    //    cap at maxPlanes. This collapses 47-plane over-splits into 4–10.
    let planeConsolidationStats: { before: number; after: number; dropped: number; merged: number } | null = null;
    if (cleanPlanes.length > 0) {
      const consolidated = consolidatePlanes(cleanPlanes, {
        minAreaPx: 400,
        maxPlanes: 12,
        pitchToleranceDeg: 1,
        bboxOverlapThreshold: 0.6,
      });
      planeConsolidationStats = {
        before: consolidated.before,
        after: consolidated.after,
        dropped: consolidated.dropped,
        merged: consolidated.merged,
      };
      console.log("[PLANE_MERGE]", JSON.stringify(planeConsolidationStats));
      cleanPlanes = consolidated.planes as RoofPlane[];
    }

    // ── FOOTPRINT-CONSTRAINED VALIDATION — FOOTPRINT IS LAW.
    //    Demote ridges from "geometry drivers" to validators that must conform
    //    to the building footprint. Reject planes that extend outside the
    //    footprint, ridges that span the whole building, and totals that
    //    exceed footprint_area * 1.15.
    let footprintConstraintStats: any = null;
    try {
      const fcRidgeInput = (cleanEdges as any[])
        .filter((e) => e && (e.edge_type === "ridge" || e.edge_type === "hip" || e.edge_type === "valley"))
        .map((e, i) => ({
          id: e.id ?? `edge_${i}`,
          edge_type: e.edge_type,
          line_px: e.line_px,
          p1: e.line_px?.[0],
          p2: e.line_px?.[e.line_px?.length - 1],
          cluster_id: e.cluster_id ?? null,
          region_bbox: e.region_bbox ?? null,
        }));
      const fcResult = validateFootprintConstraints(
        footprint as any,
        cleanPlanes as any,
        fcRidgeInput as any,
        { planeOutsideToleranceRatio: 0.10, maxRidgeLengthRatio: 0.60, totalAreaMultiplier: 1.15 },
      );
      footprintConstraintStats = fcResult.stats;
      console.log("[GEOMETRY_VALIDATION]", JSON.stringify({
        ...fcResult.stats,
        rejected_planes: fcResult.rejectedPlanes.slice(0, 20),
        rejected_ridges: fcResult.rejectedRidges.slice(0, 20),
      }));

      if (fcResult.acceptedPlanes.length > 0 && !fcResult.stats.overall_rejected) {
        cleanPlanes = fcResult.acceptedPlanes as RoofPlane[];
      }

      const rejectedRidgeIds = new Set(
        fcResult.rejectedRidges
          .map((r) => (r.id == null ? null : String(r.id)))
          .filter((x): x is string => !!x),
      );
      if (rejectedRidgeIds.size > 0) {
        cleanEdges = (cleanEdges as any[]).filter((e, i) => {
          const eid = e.id != null ? String(e.id) : `edge_${i}`;
          return !rejectedRidgeIds.has(eid);
        }) as typeof cleanEdges;
      }
    } catch (e) {
      console.warn("[GEOMETRY_VALIDATION] failed:", (e as Error).message);
    }

    applyFootprintCoverageGate("pre_edge_classification");

    // ── PLANE-TIED EDGE CLASSIFICATION — final authority on edge types.
    //    Build shared-boundary adjacency from the FINAL plane set, classify
    //    each edge as ridge/valley/hip/eave/rake from plane adjacency + slope
    //    direction, and reject ridge hints that are not actual plane-pair
    //    boundaries. Patent model is built from this classified edge graph.
    let polygonNormalizeDebug: any = null;
    try {
      if (cleanPlanes.length > 0) {
        // ── POLYGON NORMALIZATION — snap shared vertices, insert boundary
        //    points, and ensure consistent winding BEFORE classification.
        //    This fixes the "planes=N edges=0" bug where ridge splitting
        //    produces polygons with close-but-not-identical boundary vertices.
        try {
          const rawPolys = (cleanPlanes as any[]).map((p) => (p.polygon_px || []) as { x: number; y: number }[]);
          console.log("[PLANE_GRAPH_PRE_SNAP]", JSON.stringify({
            plane_count: rawPolys.length,
            plane_ids: (cleanPlanes as any[]).map((p, i) => p.plane_index ?? i),
            polygon_vertex_counts: rawPolys.map((p) => p.length),
          }));

          // ALWAYS normalize — grid-snap forces topological connectivity
          const normResult = normalizeAdjacentPlanes(rawPolys);
          polygonNormalizeDebug = normResult.debug;
          console.log("[POLYGON_NORMALIZE]", JSON.stringify(normResult.debug));

          // Apply normalized polygons back
          for (let i = 0; i < cleanPlanes.length && i < normResult.polygons.length; i++) {
            (cleanPlanes as any[])[i].polygon_px = normResult.polygons[i];
          }
        } catch (e) {
          console.warn("[POLYGON_NORMALIZE] failed:", (e as Error).message);
        }

        const ridgeHintsForClassifier = (topLevelFilteredRidges ?? []).map((r: any, i: number) => ({
          id: String(r.__cluster_ridge_id ?? r.ridge_id ?? r.id ?? i),
          p1: r.p1,
          p2: r.p2,
          score: typeof r.score === "number" ? r.score : undefined,
        }));
        const planesForClassifier = (cleanPlanes as any[]).map((p, i) => ({
          id: p.plane_index ?? i,
          plane_index: p.plane_index ?? i,
          polygon_px: p.polygon_px,
          pitch: p.pitch ?? null,
          pitch_degrees: p.pitch_degrees ?? null,
          azimuth: p.azimuth ?? null,
        }));
        const edgeResult = classifyPlaneEdges({
          planes: planesForClassifier,
          ridgeHints: ridgeHintsForClassifier,
        });
        planeEdgeClassifierDebug = edgeResult.debug;
        (globalThis as any).__planeEdgeClassifierDebug = edgeResult.debug;

        const reclassified = edgeResult.edges.map((e) => ({
          id: e.id,
          edge_type: e.edge_type,
          line_px: e.line_px,
          confidence: e.confidence,
          source: e.source,
          adjacent_plane_ids: e.adjacent_plane_ids,
          debug_reason: e.debug_reason,
        }));
        cleanEdges = reclassified as typeof cleanEdges;

        const perimeterEdgesAdded = ensureExteriorFootprintEdges("footprint_perimeter_forced");

        console.log("[PERIMETER_EDGE_FORCE]", JSON.stringify({
          footprint_segments: footprint.length,
          perimeter_edges_added: perimeterEdgesAdded,
          total_edges_after: cleanEdges.length,
          eave_count: cleanEdges.filter((e) => e.edge_type === "eave").length,
          rake_count: cleanEdges.filter((e) => e.edge_type === "rake").length,
        }));

      }
    } catch (e) {
      console.warn("[PLANE_EDGE_CLASSIFIER] failed:", (e as Error).message);
    }

    // Skip final coverage gate if edge classification already ran — it would
    // wipe cleanEdges via fallback.  Only ensure perimeter edges exist.
    const finalExteriorEdgesCreated = ensureExteriorFootprintEdges("footprint_perimeter_final");

    // Hard-fail log if edges are still 0 after all classification
    if (cleanEdges.length === 0 && footprint.length >= 3) {
      console.error("[EDGE_CLASSIFIER_NOT_RUN] planes=" + cleanPlanes.length +
        " edges=0 footprint=" + footprint.length +
        " — edge classification produced no results");
    }

    // Log edge classifier result
    {
      const byType: Record<string, number> = {};
      for (const e of cleanEdges) byType[e.edge_type] = (byType[e.edge_type] || 0) + 1;
      console.log("[EDGE_CLASSIFIER_RESULT]", JSON.stringify({
        planes: cleanPlanes.length,
        edges: cleanEdges.length,
        ridge: byType.ridge ?? 0,
        hip: byType.hip ?? 0,
        valley: byType.valley ?? 0,
        eave: byType.eave ?? 0,
        rake: byType.rake ?? 0,
        perimeter_edges_added: finalExteriorEdgesCreated,
      }));
    }

    // ── FINAL EDGE TOPOLOGY DEBUG LOG ──
    {
      const edgeCounts: Record<string, number> = {};
      for (const e of cleanEdges) edgeCounts[e.edge_type] = (edgeCounts[e.edge_type] || 0) + 1;
      const sharedEdges = planeEdgeClassifierDebug?.shared_edges ?? 0;
      const exteriorEdges = planeEdgeClassifierDebug?.exterior_edges ?? 0;
      const invalidEdges = planeEdgeClassifierDebug?.invalid_edges ?? 0;
      console.log("[EDGE_TOPOLOGY_FINAL]", JSON.stringify({
        final_planes_count: cleanPlanes.length,
        final_edges_count: cleanEdges.length,
        shared_edge_count: sharedEdges,
        exterior_edge_count: exteriorEdges,
        invalid_edge_count: invalidEdges,
        classified_ridge_count: edgeCounts.ridge ?? 0,
        classified_hip_count: edgeCounts.hip ?? 0,
        classified_valley_count: edgeCounts.valley ?? 0,
        classified_eave_count: edgeCounts.eave ?? 0,
        classified_rake_count: edgeCounts.rake ?? 0,
        topology_source: topologySource,
        plane_graph_connected: sharedEdges > 0 || cleanPlanes.length <= 1,
      }));

      // QA REQUIREMENT: planes > 1 AND edges = 0 is an error
      if (cleanPlanes.length > 1 && cleanEdges.length === 0) {
        console.error("[QA_FAIL] edge_classifier_not_executed_or_failed: planes=" +
          cleanPlanes.length + " edges=0");
      }
    }


    // ── OVERLAY CALIBRATION — fit measured geometry to the detected roof target,
    // not to the full raster center. This is rendering-only and does not change
    // physical measurements calculated from original pixel geometry.
    let overlayCalibration: ReturnType<typeof computeOverlayTransform> | null = null;
    let roofTargetBboxPx: any = null;
    let roofTargetSource: string | null = null;
    try {
      const hullBbox = candidates.find((c) => c.source === "google_solar_segments_hull" && c.bbox_px)?.bbox_px || null;
      const unionBbox = candidates.find((c) => c.source === "google_solar_segments_union" && c.bbox_px)?.bbox_px || null;
      const unetBbox = candidates.find((c) => c.source === "imagery_unet_mask" && c.bbox_px)?.bbox_px || null;
      const buildingBbox = solarBboxPx;
      const geometryPoints = [
        ...cleanPlanes.flatMap((p) => p.polygon_px || []),
        ...cleanEdges.flatMap((e) => e.line_px || []),
      ];
      const geometryBboxForTarget = bboxOf(geometryPoints);

      const areaOf = (b: any) => (b && b.width > 0 && b.height > 0 ? b.width * b.height : 0);
      const buildingArea = areaOf(buildingBbox);
      const hullArea = areaOf(hullBbox);
      const unionArea = areaOf(unionBbox);
      const snappedArea = areaOf(snappedFootprintBboxPx);
      const hullToBuildingRatio = buildingArea > 0 && hullArea > 0 ? hullArea / buildingArea : null;
      const snappedCoverageRatio = buildingArea > 0 && snappedArea > 0 ? snappedArea / buildingArea : null;
      const snappedIsBasicallySelectedGeometry =
        snappedFootprintBboxPx && geometryBboxForTarget
          ? Math.abs((snappedFootprintBboxPx.minX || 0) - (geometryBboxForTarget.minX || 0)) < 2 &&
            Math.abs((snappedFootprintBboxPx.minY || 0) - (geometryBboxForTarget.minY || 0)) < 2 &&
            Math.abs((snappedFootprintBboxPx.maxX || 0) - (geometryBboxForTarget.maxX || 0)) < 2 &&
            Math.abs((snappedFootprintBboxPx.maxY || 0) - (geometryBboxForTarget.maxY || 0)) < 2
          : false;

      // Selection priority per spec:
      //   A. snapped_eave_bbox  (only if it covers ≥75% of building)
      //   B. solar_building_bbox
      //   C. full segment-union bbox
      //   D. hull only when no better target exists AND hull/building ≥ 0.70
      const ordered: Array<{ source: string; bbox: any }> = [];
      if (
        snappedFootprintBboxPx &&
        !snappedIsBasicallySelectedGeometry &&
        (buildingArea === 0 || (snappedCoverageRatio != null && snappedCoverageRatio >= 0.75))
      ) {
        ordered.push({ source: "snapped_eave_bbox", bbox: snappedFootprintBboxPx });
      }
      if (buildingBbox && buildingArea > 0) {
        ordered.push({ source: "solar_building_bbox", bbox: buildingBbox });
      }
      if (unionBbox && unionArea > 0) {
        ordered.push({ source: "google_solar_segments_union", bbox: unionBbox });
      }
      if (hullBbox && hullArea > 0 && (hullToBuildingRatio == null || hullToBuildingRatio >= 0.70)) {
        ordered.push({ source: "google_solar_segments_hull", bbox: hullBbox });
      }
      if (unetBbox) {
        ordered.push({ source: "imagery_unet_mask", bbox: unetBbox });
      }

      const preferred = ordered[0] || null;
      roofTargetBboxPx = preferred?.bbox || null;
      roofTargetSource = preferred?.source || null;

      console.log("[ROOF_TARGET_BBOX_SELECTION]", JSON.stringify({
        solar_building_bbox_area: Math.round(buildingArea),
        solar_segments_hull_bbox_area: Math.round(hullArea),
        solar_segments_union_bbox_area: Math.round(unionArea),
        snapped_eave_bbox_area: Math.round(snappedArea),
        snapped_coverage_ratio: snappedCoverageRatio == null ? null : Number(snappedCoverageRatio.toFixed(3)),
        snapped_rejected_self_target: Boolean(snappedIsBasicallySelectedGeometry),
        hull_to_building_ratio: hullToBuildingRatio == null ? null : Number(hullToBuildingRatio.toFixed(3)),
        selected_target_source: roofTargetSource,
        selected_target_bbox: roofTargetBboxPx,
        candidates_considered: ordered.map((o) => o.source),
      }));

      overlayCalibration = computeOverlayTransform({
        rasterSize: { width: raster.width, height: raster.height },
        geometryPoints,
        roofTargetBboxPx,
      });

      // Coverage / center-error QA gate.
      const cov = Math.min(
        Number(overlayCalibration.coverage_ratio_width || 0),
        Number(overlayCalibration.coverage_ratio_height || 0),
      );
      const ctrErr = Number(overlayCalibration.center_error_px || 0);
      const overlayFailures: string[] = [];
      if (cov > 0 && cov < 0.75) {
        overlayFailures.push(`overlay_coverage_${Math.round(cov * 100)}pct_lt_75pct`);
      }
      if (ctrErr > 60) {
        overlayFailures.push(`overlay_center_error_${Math.round(ctrErr)}px_gt_60px`);
      }
      (globalThis as any).__overlaySanityFailures = overlayFailures;

      console.log("[OVERLAY_TRANSFORM]", JSON.stringify({
        roof_target_source: roofTargetSource,
        geometry_bbox_px: overlayCalibration.geometry_bbox_px,
        roof_target_bbox_px: overlayCalibration.roof_target_bbox_px,
        uniform_scale: overlayCalibration.uniform_scale,
        translate_x: overlayCalibration.translate_x,
        translate_y: overlayCalibration.translate_y,
        coverage_ratio_width: overlayCalibration.coverage_ratio_width,
        coverage_ratio_height: overlayCalibration.coverage_ratio_height,
        center_error_px: overlayCalibration.center_error_px,
      }));
    } catch (e) {
      console.warn("[OVERLAY_TRANSFORM] failed:", (e as Error).message);
    }


    const footprintCandidatesForReport = candidates.map((c) => ({
      source: c.source,
      area_sqft: Math.round(c.area_sqft),
      coverage_ratio_vs_solar_bbox: c.coverage_ratio_vs_solar_bbox,
      overlap_with_solar_bbox: Math.round(c.overlap_with_solar_bbox),
      center_distance_px: Math.round(c.bbox_center_distance_from_geocode_px),
      vertex_count: c.vertex_count,
      validity_score: Number(c.validity_score.toFixed(3)),
      rejected_reason: c.rejected_reason,
      sub_scores: {
        area: Number(c.area_score.toFixed(3)),
        solar_overlap: Number(c.solar_overlap_score.toFixed(3)),
        geocode_center: Number(c.geocode_center_score.toFixed(3)),
        polygon_shape: Number(c.polygon_shape_score.toFixed(3)),
      },
    }));
    const selectedFootprintForReport = selected ? {
      source: selected.source,
      area_sqft: Math.round(selected.area_sqft),
      validity_score: Number(selected.validity_score.toFixed(3)),
    } : null;

    console.log("[GEOMETRY_SOURCE_DECISION]", JSON.stringify({
      has_unet_endpoint: !!UNET_ENDPOINT,
      used_unet: unetPlanes.length > 0 || unetEdges.length > 0,
      used_solar_bbox_as_crop_only: usedSolarBboxAsCropOnly,
      used_synthetic_debug_rectangle: usedSyntheticDebugRectangle,
      used_deterministic_topology: topologySource === "ridge_split_recursive" || topologySource === "straight_skeleton" || topologySource === "triangulation" || topologySource === "google_solar_segment_structure",
      footprint_source: footprintSource,
      topology_source: topologySource,
      final_plane_count: cleanPlanes.length,
      final_edge_count: cleanEdges.length,
    }));

    // Hard guard: a real footprint is required to publish a customer measurement.
    // Reject if NO candidate passed validity scoring.
    if (footprintSelectionFailed || footprint.length < 3) {
      throw new Error(
        "no_valid_full_roof_footprint: " +
        `${candidates.length} candidate(s) evaluated, none passed validity gates ` +
        `(min_area=${RESIDENTIAL_MIN_SQFT}sqft, min_solar_coverage=${Math.round(MIN_COVERAGE_RATIO * 100)}%). ` +
        "See [FOOTPRINT_SOURCE_SELECTION] log for per-candidate rejection reasons.",
      );
    }

    const planeRows = buildPlaneRows({
      ai_measurement_job_id: input.ai_measurement_job_id,
      planes: cleanPlanes,
      fallbackFootprint: footprint, // real OSM/segmentation footprint only
      solarData,
      pitchOverride: input.pitch_override,
      center: { lat: coords.lat, lng: coords.lng },
      width: raster.width,
      height: raster.height,
      metersPerPixelActual: actualMpp,
      feetPerPixelActual: actualFpp,
    });

    if (!planeRows.length) throw new Error("No valid roof planes detected.");

    const edgeRows = buildEdgeRows({
      ai_measurement_job_id: input.ai_measurement_job_id,
      edges: cleanEdges,
      center: { lat: coords.lat, lng: coords.lng },
      width: raster.width,
      height: raster.height,
      metersPerPixelActual: actualMpp,
      feetPerPixelActual: actualFpp,
    });

    // Wipe any prior detail rows for this job (idempotency on retries)
    await supabase.from("ai_measurement_images").delete().eq("job_id", input.ai_measurement_job_id);
    await supabase.from("ai_roof_planes").delete().eq("job_id", input.ai_measurement_job_id);
    await supabase.from("ai_roof_edges").delete().eq("job_id", input.ai_measurement_job_id);
    await supabase.from("ai_measurement_results").delete().eq("job_id", input.ai_measurement_job_id);
    await supabase.from("ai_measurement_quality_checks").delete().eq("job_id", input.ai_measurement_job_id);

    await supabase.from("ai_measurement_images").insert({
      job_id: input.ai_measurement_job_id,
      source: "mapbox_static",
      image_url: imageUrl,
      width: raster.width,
      height: raster.height,
      zoom: input.zoom,
      meters_per_pixel: actualMpp,
      feet_per_pixel: actualFpp,
      calibration: {
        geocode_location_type: coords.geocode_location_type,
        zoom: input.zoom,
        raster_scale: input.raster_scale,
        logical_image_width: input.logical_image_width,
        logical_image_height: input.logical_image_height,
        actual_image_width: raster.width,
        actual_image_height: raster.height,
      },
      is_primary: true,
    });

    await supabase.from("ai_roof_planes").insert(planeRows);
    if (edgeRows.length) await supabase.from("ai_roof_edges").insert(edgeRows);

    const totals = calculateTotals(planeRows, edgeRows, Number(input.waste_factor_percent));
    const usedSinglePlaneFallback =
      planeRows.length === 1 && planeRows[0].source === "single_plane_fallback";

    // ───────── GEOMETRY SANITY GATE ─────────
    // Compute coverage/structural metrics, then block the customer report if
    // the geometry only covers a sub-region of the actual roof.
    const finalFootprintBboxPx = bboxOf(footprint);
    const finalFootprintAreaPx = polygonAreaPx(footprint);
    const finalFootprintAreaSqft = finalFootprintAreaPx * actualFpp * actualFpp;
    const finalRoofAreaSqft = Number(totals.total_area_2d_sqft) || 0;
    const solarRoofAreaSqft = estimateSolarRoofAreaSqft(solarData);
    const roofBboxCoverageRatio =
      solarBboxPx && solarBboxPx.area > 0 && finalFootprintBboxPx
        ? finalFootprintBboxPx.area / solarBboxPx.area
        : null;
    const ridgeFt = Number(totals.ridge_length_ft) || 0;
    const hipFt = Number(totals.hip_length_ft) || 0;
    const valleyFt = Number(totals.valley_length_ft) || 0;
    const dominantPitchRise = Number(totals.dominant_pitch) || 0;
    const isFlatRoof = dominantPitchRise > 0 && dominantPitchRise < 1.5;

    // Geometry bbox vs footprint bbox (overlay coverage of the roof target).
    const geometryUnionPoints: Point[] = [];
    for (const p of cleanPlanes) for (const pt of p.polygon_px || []) geometryUnionPoints.push(pt);
    for (const e of cleanEdges) for (const pt of e.line_px || []) geometryUnionPoints.push(pt);
    const finalGeometryBboxPx = bboxOf(geometryUnionPoints);
    const geometryVsFootprintRatio =
      finalGeometryBboxPx && finalFootprintBboxPx && finalFootprintBboxPx.area > 0
        ? finalGeometryBboxPx.area / finalFootprintBboxPx.area
        : null;

    const sanityFailures: string[] = [];
    {
      const stashed = (globalThis as any).__overlaySanityFailures;
      if (Array.isArray(stashed)) sanityFailures.push(...stashed);
    }
    if (finalRoofAreaSqft > 0 && finalRoofAreaSqft < 800) {
      sanityFailures.push(`roof_area_too_small:${Math.round(finalRoofAreaSqft)}sqft`);
    }
    if (roofBboxCoverageRatio != null && roofBboxCoverageRatio < 0.4) {
      sanityFailures.push(`footprint_covers_only_${Math.round(roofBboxCoverageRatio * 100)}pct_of_solar_bbox`);
    }
    // Explicit edges=0 block: planes exist but no classified edges at all
    {
      const totalEdges = cleanEdges.length;
      const structEdges = cleanEdges.filter((e) =>
        e.edge_type === "ridge" || e.edge_type === "hip" || e.edge_type === "valley"
      ).length;
      if (planeRows.length > 1 && totalEdges === 0) {
        sanityFailures.push("plane_graph_has_no_classified_edges");
      }
      if (planeRows.length > 1 && structEdges === 0 && !isFlatRoof) {
        // Already covered by no_ridge_hip_valley but be explicit
        if (!sanityFailures.includes("no_ridge_hip_valley_on_pitched_roof")) {
          sanityFailures.push("no_ridge_hip_valley_on_pitched_roof");
        }
      }
    }
    // Footprint underfill: footprint area vs selected target bbox area
    if (roofTargetBboxPx) {
      const targetArea = (roofTargetBboxPx.maxX - roofTargetBboxPx.minX) * (roofTargetBboxPx.maxY - roofTargetBboxPx.minY);
      if (targetArea > 0 && finalFootprintAreaPx > 0) {
        const underfillRatio = finalFootprintAreaPx / targetArea;
        if (underfillRatio < 0.65) {
          sanityFailures.push(`footprint_underfills_target_bbox_${Math.round(underfillRatio * 100)}pct`);
        }
      }
    }
    if (!isFlatRoof && ridgeFt + hipFt + valleyFt === 0) {
      sanityFailures.push("no_ridge_hip_valley_on_pitched_roof");
    }
    if (planeRows.length < 2 && finalFootprintAreaSqft > 800) {
      // Distinguish "ridge detector ran but found nothing structural" from
      // "topology engine collapsed a real ridge into a single plane".
      sanityFailures.push(
        ridgeDetectionRan && ridgeDetectedCount === 0
          ? "no_structural_ridges_detected"
          : "single_plane_for_large_footprint",
      );
    }
    if (geometryVsFootprintRatio != null && geometryVsFootprintRatio < 0.5) {
      sanityFailures.push(`geometry_covers_only_${Math.round(geometryVsFootprintRatio * 100)}pct_of_footprint`);
    }
    if (solarRoofAreaSqft != null && solarRoofAreaSqft > 0 && finalRoofAreaSqft > solarRoofAreaSqft * 1.25) {
      sanityFailures.push("area_inflation_after_merge");
    }
    const _planeMergeDebug = planeMergeDebug ?? null;
    if (_planeMergeDebug?.pre_merge_area > 0 && _planeMergeDebug.post_merge_area > _planeMergeDebug.pre_merge_area * 1.10) {
      sanityFailures.push("area_inflation_after_merge");
    }
    // Footprint-as-law QA: total plane area must not exceed footprint*1.15.
    if (footprintConstraintStats?.overall_rejected) {
      sanityFailures.push(
        `footprint_constraint_violated:${footprintConstraintStats.rejection_reason || "area_ratio_exceeded"}`,
      );
    }
    // Plane-edge classifier QA: ridge hints must be supported by actual plane
    // boundaries, and multi-plane roofs must produce structural edges.
    {
      const pec = (globalThis as any).__planeEdgeClassifierDebug;
      if (pec) {
        const hintsTotal = Number(pec.ridge_hints_total ?? 0);
        const hintsInvalid = Number(pec.invalid_ridge_hints_count ?? 0);
        if (hintsTotal > 0 && hintsInvalid / hintsTotal > 0.5) {
          sanityFailures.push("ridge_hints_not_supported_by_plane_boundaries");
        }
        const ridgeC = Number(pec.counts?.ridge ?? 0);
        const hipC = Number(pec.counts?.hip ?? 0);
        const valleyC = Number(pec.counts?.valley ?? 0);
        if (Number(pec.plane_count ?? 0) > 2 && ridgeC + hipC + valleyC === 0) {
          sanityFailures.push("no_structural_edges_from_plane_graph");
        }
      }
      // Plane adjacency: if we have >1 plane but ZERO shared boundaries,
      // the graph is disconnected and ridges/hips/valleys can never form.
      try {
        const adj = planeAdjacencyStats(
          (cleanPlanes as any[]).map((p) => p.polygon_px || []),
        );
        const ridgeHintCount = (topLevelFilteredRidges ?? []).length;
        const ridgeHintsMatching = Math.max(
          0,
          ridgeHintCount - Number(pec?.invalid_ridge_hints_count ?? 0),
        );
        console.log("[PLANE_ADJACENCY_DEBUG]", JSON.stringify({
          plane_count: adj.plane_count,
          shared_boundary_count: adj.shared_boundary_count,
          two_plane_boundary_count: adj.two_plane_boundary_count,
          ridge_hint_count: ridgeHintCount,
          ridge_hints_matching_shared_boundary: ridgeHintsMatching,
          rejected_ridge_hints: Number(pec?.invalid_ridge_hints_count ?? 0),
        }));
        if (adj.plane_count > 1 && adj.shared_boundary_count === 0) {
          sanityFailures.push("planes_disconnected_no_shared_boundaries");
        }
      } catch (e) {
        console.warn("[PLANE_ADJACENCY_DEBUG] failed:", (e as Error).message);
      }
      // Eave QA: footprint must follow visible roof perimeter.
      const eave = (globalThis as any).__eaveSnapDebug;
      if (eave && Number(eave.perimeter_off_eave_ratio) > 0.3) {
        sanityFailures.push("footprint_not_snapped_to_eaves");
      }
    }
    // Final QA gates from filter+simplify layer.
    if (planeRows.length > 20) {
      sanityFailures.push(`too_many_planes_${planeRows.length}_max_20`);
    } else if (planeRows.length < 2 && finalFootprintAreaSqft > 800 && !sanityFailures.some((s) => s.includes("plane"))) {
      sanityFailures.push("too_few_planes_lt_2");
    }
    if (!overlayCalibration?.calibrated) {
      sanityFailures.push("overlay_alignment_failed");
    }
    if (overlayCalibration?.calibrated) {
      if (overlayCalibration.coverage_ratio_width < 0.65 || overlayCalibration.coverage_ratio_height < 0.65) {
        sanityFailures.push("overlay_alignment_failed");
      }
      if (overlayCalibration.center_error_px > 80) {
        sanityFailures.push("overlay_alignment_failed");
      }
    }

    const blockCustomerReportReason: string | null =
      sanityFailures.length > 0 ? sanityFailures.join("|") : null;

    console.log("[GEOMETRY_SANITY_CHECK]", JSON.stringify({
      final_roof_area_sqft: finalRoofAreaSqft,
      solar_roof_area_sqft: solarRoofAreaSqft,
      final_footprint_area_sqft: finalFootprintAreaSqft,
      roof_bbox_coverage_ratio: roofBboxCoverageRatio,
      geometry_vs_footprint_ratio: geometryVsFootprintRatio,
      plane_count: planeRows.length,
      edge_counts: {
        ridge: ridgeFt, hip: hipFt, valley: valleyFt,
        eave: Number(totals.eave_length_ft) || 0, rake: Number(totals.rake_length_ft) || 0,
      },
      blocked: !!blockCustomerReportReason,
      reason: blockCustomerReportReason,
      ridge_detection_ran: ridgeDetectionRan,
      ridges_detected: ridgeDetectedCount,
      ridge_split_planes: ridgeSplitPlaneCount,
      plane_merge: _planeMergeDebug,
      plane_consolidation: planeConsolidationStats,
      overlay_calibration: overlayCalibration,
    }));

    const quality = scoreQuality({
      geocode_location_type: coords.geocode_location_type,
      solarData,
      planes: planeRows,
      edges: edgeRows,
      totals,
      usedSinglePlaneFallback,
    });

    const resolvedGeometrySource =
      topologySource === "ridge_split_recursive" ? "deterministic_ridge_split"
      : topologySource === "google_solar_segment_structure" ? "google_solar_segment_structure"
      : topologySource === "straight_skeleton" ? "deterministic_straight_skeleton"
      : topologySource === "triangulation" ? "deterministic_triangulation"
      : topologySource === "unet_planes" ? "unet_optional_helper"
      : "footprint_only";

    await supabase.from("ai_measurement_results").insert({
      job_id: input.ai_measurement_job_id,
      total_area_2d_sqft: totals.total_area_2d_sqft,
      total_area_pitch_adjusted_sqft: totals.total_area_pitch_adjusted_sqft,
      roof_square_count: totals.roof_square_count,
      waste_factor_percent: Number(input.waste_factor_percent),
      waste_adjusted_squares: totals.waste_adjusted_squares,
      ridge_length_ft: totals.ridge_length_ft,
      hip_length_ft: totals.hip_length_ft,
      valley_length_ft: totals.valley_length_ft,
      eave_length_ft: totals.eave_length_ft,
      rake_length_ft: totals.rake_length_ft,
      perimeter_length_ft: totals.perimeter_length_ft,
      dominant_pitch: totals.dominant_pitch,
      pitch_breakdown: totals.pitch_breakdown,
      line_breakdown: totals.line_breakdown,
      plane_breakdown: totals.plane_breakdown,
      confidence_score: quality.overall_score,
      geometry_quality_score: quality.geometry_score,
      measurement_quality_score: quality.measurement_score,
      geometry_source: resolvedGeometrySource,
      edge_source: edgeRows.length ? (cleanEdges[0]?.source || resolvedGeometrySource) : "none",
      report_json: {
        source_button: input.source_button,
        engine_version: "geometry_first_v2",
        footprint_source: footprintSource,
        topology_source: topologySource,
        unet_used: cleanPlanes.some((p) => p.source.startsWith("unet")) || cleanEdges.some((e) => e.source.startsWith("unet")),
        block_customer_report_reason: blockCustomerReportReason,
        calibration: {
          logical_meters_per_pixel: logicalMpp,
          actual_meters_per_pixel: actualMpp,
          actual_feet_per_pixel: actualFpp,
        },
        solar_used: !!solarData,
        totals,
        quality,
      },
    });

    if (quality.checks.length) {
      await supabase.from("ai_measurement_quality_checks").insert(
        quality.checks.map((check: any) => ({
          job_id: input.ai_measurement_job_id,
          check_name: check.name,
          passed: check.passed,
          score: check.score,
          details: check.details,
        }))
      );
    }

    // Pixel-space geometry for the dev raster overlay debug view.
    // planes_px / edges_px are transformed into calibrated raster pixel space.
    const toCalibratedPoint = (pt: Point): Point =>
      overlayCalibration?.calibrated ? transformOverlayPoint(pt, overlayCalibration) : pt;
    const planes_px = cleanPlanes
      .map((p) => ({
        polygon: (p.polygon_px || []).map((pt: any) => {
          const out = toCalibratedPoint(pt);
          return [out.x, out.y] as [number, number];
        }),
        source: p.source,
      }))
      .filter((p) => p.polygon.length >= 3);
    const edges_px = cleanEdges
      .map((e) => {
        const pts = e.line_px || [];
        if (pts.length < 2) return null;
        const p1 = toCalibratedPoint(pts[0]);
        const p2 = toCalibratedPoint(pts[1]);
        return {
          type: e.edge_type,
          p1: [p1.x, p1.y] as [number, number],
          p2: [p2.x, p2.y] as [number, number],
          source: e.source,
        };
      })
      .filter(Boolean);
    const raster_size = { width: raster.width, height: raster.height };
    const pdfSourceSignature = await hashSignature({
      engine: "geometry_first_v2_overlay_transform_v2",
      planes: planeRows,
      edges: edgeRows,
      totals,
      raster_size,
      overlay_calibration: overlayCalibration,
      roof_target_bbox_px: roofTargetBboxPx,
      roof_target_source: roofTargetSource,
    });

    const geometryReportJson = {
      planes: planeRows,
      edges: edgeRows,
      totals,
      quality,
      // Dev overlay payload — matches RasterOverlayDebugView contract.
      planes_px,
      edges_px,
      raster_size,
      raster_image_url: imageUrl,
      topology_source: topologySource,
      footprint_source: footprintSource,
      inference_source: resolvedGeometrySource,
      used_deterministic_topology:
        topologySource === "ridge_split_recursive" || topologySource === "straight_skeleton" || topologySource === "triangulation" || topologySource === "google_solar_segment_structure",
      block_customer_report_reason: blockCustomerReportReason,
      sanity_failures: sanityFailures,
      pdf_source_signature: pdfSourceSignature,
      overlay_calibration: overlayCalibration,
      roof_target_bbox_px: roofTargetBboxPx,
      roof_target_source: roofTargetSource,
      geometry_px_space: "raster_calibrated",
      footprint_candidates: footprintCandidatesForReport,
      selected_footprint: selectedFootprintForReport,
      imagery: {
        provider: imageryProvider,
        google_2d_tiles_used: imageryProvider === "google_2d_satellite",
        mapbox_used: imageryProvider === "mapbox_satellite",
        google_3d_debug_available: imageryDecisionLog.google_3d_debug_available,
        google_3d_used_for_measurement: false, // 3D mesh→plane extraction not implemented; debug only
        raster_size: { width: raster.width, height: raster.height },
        meters_per_pixel: actualMpp,
        feet_per_pixel: actualFpp,
        decision_log: imageryDecisionLog,
        notes: "Google 3D Photorealistic Tiles are reserved for visual QA/debug until mesh-to-plane extraction is implemented.",
      },
      debug_geometry: {
        raster_size,
        solar_bbox_px: solarBboxPx,
        final_footprint_bbox_px: finalFootprintBboxPx,
        final_footprint_area_px: finalFootprintAreaPx,
        final_footprint_area_sqft: finalFootprintAreaSqft,
        final_roof_area_sqft: finalRoofAreaSqft,
        solar_roof_area_sqft: solarRoofAreaSqft,
        roof_bbox_coverage_ratio: roofBboxCoverageRatio,
        geometry_vs_footprint_ratio: geometryVsFootprintRatio,
        plane_merge: _planeMergeDebug,
        plane_count: planeRows.length,
        edge_count: edgeRows.length,
        edge_counts: {
          ridge_ft: ridgeFt, hip_ft: hipFt, valley_ft: valleyFt,
          eave_ft: Number(totals.eave_length_ft) || 0, rake_ft: Number(totals.rake_length_ft) || 0,
        },
        topology_source: topologySource,
        footprint_source: footprintSource,
        blocked_customer_report_reason: blockCustomerReportReason,
        solar_segments: solarSegmentsDebug,
        ridge_clusters: (globalThis as any).__ridgeClustersDebug ?? null,
        plane_edge_classifier: (globalThis as any).__planeEdgeClassifierDebug ?? null,
      },
      overlay_debug: {
        raster_url: imageUrl,
        raster_size,
        planes_px,
        edges_px,
        footprint_px: footprint.map((p) => [p.x, p.y]),
        solar_bbox_px: solarBboxPx,
        final_geometry_bbox_px: finalGeometryBboxPx,
        overlay_calibration: overlayCalibration,
        roof_target_bbox_px: roofTargetBboxPx,
        roof_target_source: roofTargetSource,
      },
    };
    const linearFeaturesWkt = edgeRows.map((edge: any) => ({
      type: edge.edge_type,
      wkt: lineGeoJSONToWKT(edge.line_geojson),
      length_ft: edge.length_ft,
      source: edge.source,
      confidence: edge.confidence,
    })).filter((feature: any) => feature.wkt);
    const footprintVerticesGeo = footprint.map((p) => {
      const [lng, lat] = pxToLngLat(p, { lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp);
      return { lng, lat };
    });
    const perimeterWkt = footprintVerticesGeo.length >= 3 ? polygonVerticesToWKT(footprintVerticesGeo) : null;
    const imageBounds = imageBoundsFromRaster({ lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp);
    const reviewRequired = Boolean(blockCustomerReportReason) || quality.overall_score < 0.80;
    const dbFootprintSource = normalizeRoofMeasurementFootprintSource(footprintSource);
    const aiDetectionData = {
      source_button: input.source_button,
      engine_version: "geometry_first_v2",
      geometry_source: resolvedGeometrySource,
      footprint_source: footprintSource,
      topology_source: topologySource,
      block_customer_report_reason: blockCustomerReportReason,
      footprint_candidates: footprintCandidatesForReport,
      selected_footprint: selectedFootprintForReport,
      planes: planeRows,
      edges: edgeRows,
      totals,
      quality,
      calibration: {
        logical_meters_per_pixel: logicalMpp,
        actual_meters_per_pixel: actualMpp,
        actual_feet_per_pixel: actualFpp,
        raster_scale: input.raster_scale,
      },
      solar_used: !!solarData,
      unet_used: cleanPlanes.some((p) => p.source.startsWith("unet")) || cleanEdges.some((e) => e.source.startsWith("unet")),
      // Mirror overlay payload for clients reading ai_detection_data directly.
      planes_px,
      edges_px,
      raster_size,
      raster_image_url: imageUrl,
      overlay_calibration: overlayCalibration,
      roof_target_bbox_px: roofTargetBboxPx,
      roof_target_source: roofTargetSource,
      geometry_px_space: "raster_calibrated",
    };

    // Publish canonical roof_measurements row
    const { data: roofMeasurement, error: publishError } = await supabase
      .from("roof_measurements")
      .insert({
        tenant_id: input.tenant_id,
        customer_id: input.lead_id || null,
        lead_id: input.lead_id,
        project_id: input.project_id,
        source_record_type: input.source_record_type,
        source_record_id: input.source_record_id,
        ai_measurement_job_id: input.ai_measurement_job_id,
        property_address: input.property_address,
        gps_coordinates: { lat: coords.lat, lng: coords.lng },
        target_lat: coords.lat,
        target_lng: coords.lng,
        mapbox_image_url: imageUrl,
        meters_per_pixel: actualMpp,
        ai_detection_data: aiDetectionData,
        ai_analysis: aiDetectionData,
        ai_model_version: "geometry_first_v2",
        detection_timestamp: new Date().toISOString(),
        detection_confidence: quality.overall_score,
        total_area_flat_sqft: totals.total_area_2d_sqft,
        total_area_adjusted_sqft: totals.total_area_pitch_adjusted_sqft,
        total_squares: totals.roof_square_count,
        waste_factor_percent: Number(input.waste_factor_percent),
        total_squares_with_waste: totals.waste_adjusted_squares,
        predominant_pitch: totals.dominant_pitch ? `${totals.dominant_pitch}/12` : null,
        total_ridge_length: totals.ridge_length_ft,
        total_hip_length: totals.hip_length_ft,
        total_valley_length: totals.valley_length_ft,
        total_eave_length: totals.eave_length_ft,
        total_rake_length: totals.rake_length_ft,
        measurement_confidence: quality.overall_score * 100,
        geometry_quality_score: quality.geometry_score,
        measurement_quality_score: quality.measurement_score,
        requires_manual_review: reviewRequired,
        manual_review_recommended: reviewRequired,
        facet_count: planeRows.length,
        edge_count: edgeRows.length,
        geometry_report_json: geometryReportJson,
        quality_checks: quality,
        metadata: aiDetectionData,
        plane_breakdown: totals.plane_breakdown,
        edge_breakdown: totals.line_breakdown,
        linear_features_wkt: linearFeaturesWkt,
        perimeter_wkt: perimeterWkt,
        footprint_vertices_geo: footprintVerticesGeo,
        footprint_source: dbFootprintSource,
        footprint_confidence: quality.geometry_score,
        footprint_requires_review: reviewRequired,
        analysis_zoom: Number(input.zoom),
        analysis_image_size: {
          width: raster.width,
          height: raster.height,
          logicalWidth: Number(input.logical_image_width),
          logicalHeight: Number(input.logical_image_height),
          rasterScale: Number(input.raster_scale),
        },
        image_bounds: imageBounds,
        bounding_box: imageBounds,
        gate_decision: reviewRequired ? "needs_review" : "approved",
        gate_reason: blockCustomerReportReason,
        source_button: input.source_button,
        engine_version: "geometry_first_v2",
        engine_used: "geometry_first_v2",
        inference_source: resolvedGeometrySource,
      })
      .select("id")
      .single();

    if (publishError) throw publishError;

    // Generate the customer-visible SVG report pages from the measured geometry.
    // The geometry-first rewrite still saved totals/planes, but no longer wrote
    // ai_measurement_diagrams, which made the report dialog show "No diagrams available".
    try {
      if (!blockCustomerReportReason && planeRows.length > 0) {
        const diagrams = generateRoofDiagrams({
          propertyAddress: input.property_address || "Unknown property",
          jobId: input.ai_measurement_job_id,
          generatedAt: new Date().toISOString(),
          confidence: quality.overall_score,
          engineVersion: "geometry_first_v2",
          planes: planeRows.map((p: any) => ({
            plane_index: p.plane_index,
            polygon_px: p.polygon_px,
            pitch: p.pitch,
            pitch_degrees: p.pitch_degrees,
            area_2d_sqft: p.area_2d_sqft,
            area_pitch_adjusted_sqft: p.area_pitch_adjusted_sqft,
            confidence: p.confidence,
          })),
          edges: edgeRows.map((e: any) => ({
            edge_type: e.edge_type,
            line_px: e.line_px,
            length_ft: e.length_ft,
            confidence: e.confidence,
          })),
          totals,
          satelliteImageUrl: imageUrl,
          sourceImageWidth: raster.width,
          sourceImageHeight: raster.height,
          roofTargetBboxPx,
          overlayCalibration,
        });

        await supabase
          .from("ai_measurement_diagrams")
          .delete()
          .eq("ai_measurement_job_id", input.ai_measurement_job_id);

        if (diagrams.length > 0) {
          await supabase.from("ai_measurement_diagrams").insert(
            diagrams.map((d) => ({
              ai_measurement_job_id: input.ai_measurement_job_id,
              roof_measurement_id: roofMeasurement.id,
              lead_id: input.lead_id,
              project_id: input.project_id,
              tenant_id: input.tenant_id,
              company_id: input.company_id,
              diagram_type: d.diagram_type,
              title: d.title,
              page_number: d.page_number,
              svg_markup: d.svg_markup,
              diagram_json: {
                generated_from: "geometry_first_v2_planes_edges",
                engine_version: "geometry_first_v2_diagrams",
                property_address: input.property_address,
                totals,
              },
              render_version: "geometry_first_v2_diagrams",
              width: 850,
              height: 1100,
              customer_safe: true,
            })),
          );
        }
      }
    } catch (diagramError) {
      console.error("diagram generation failed", diagramError);
    }

    await supabase.from("measurement_approvals").insert({
      tenant_id: input.tenant_id,
      pipeline_entry_id: input.lead_id || null,
      lead_id: input.lead_id,
      project_id: input.project_id,
      source_record_type: input.source_record_type,
      source_record_id: input.source_record_id,
      ai_measurement_job_id: input.ai_measurement_job_id,
      measurement_id: roofMeasurement.id,
      approved_at: new Date().toISOString(),
      approval_notes: "AI Measurement geometry-first v2",
      saved_tags: {
        "roof.total_sqft": totals.total_area_pitch_adjusted_sqft,
        "roof.flat_sqft": totals.total_area_2d_sqft,
        "roof.squares": totals.roof_square_count,
        "roof.predominant_pitch": totals.dominant_pitch ? `${totals.dominant_pitch}/12` : null,
        "lf.ridge": totals.ridge_length_ft,
        "lf.hip": totals.hip_length_ft,
        "lf.valley": totals.valley_length_ft,
        "lf.eave": totals.eave_length_ft,
        "lf.rake": totals.rake_length_ft,
        "lf.perimeter": totals.perimeter_length_ft,
        source: "ai_measurement_geometry_first_v2",
        measurement_id: roofMeasurement.id,
      },
    });

    // Geometry collapse → never call this "completed" for the customer.
    const finalAiStatus = blockCustomerReportReason
      ? "needs_review"
      : quality.overall_score >= 0.80 ? "completed"
      : quality.overall_score >= 0.60 ? "needs_review"
      : "needs_manual_measurement";

    // measurement_jobs is the legacy UI polling table and its CHECK constraint only
    // allows queued/processing/completed/failed. Keep the richer review state on
    // ai_measurement_jobs, but stop the UI spinner by marking the legacy job complete.
    const finalJobStatus = "completed";
    const finalJobMessage = blockCustomerReportReason
      ? `Measurement needs review — geometry covered only part of the roof. (${blockCustomerReportReason})`
      : "Measurement complete";

    await setMeasurementJobStatus(
      input.measurement_job_id,
      finalJobStatus,
      finalJobMessage,
      roofMeasurement.id,
    );
    await setAiJobStatus(input.ai_measurement_job_id, finalAiStatus, finalJobMessage, quality);
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("processJob error:", error);
    await setMeasurementJobStatus(input.measurement_job_id, "failed", message);
    await setAiJobStatus(input.ai_measurement_job_id, "failed", message);
  }
}

async function resolveSourceRecord({ lead_id, project_id }: { lead_id: string | null; project_id: string | null }) {
  if (lead_id) {
    const { data } = await supabase
      .from("pipeline_entries")
      .select("id, tenant_id, address, company_id")
      .eq("id", lead_id)
      .maybeSingle();
    if (data) return data;
  }
  if (project_id) {
    const { data } = await supabase
      .from("projects")
      .select("id, tenant_id, address, company_id")
      .eq("id", project_id)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

function sniffRasterFormat(buf: Uint8Array): "png" | "jpeg" | "unknown" {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
  return "unknown";
}

function readUInt32BE(data: Uint8Array | ArrayBuffer, offset: number): number {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, false);
}

async function decodeRaster(buf: Uint8Array, contentType?: string | null, provider = "unknown"): Promise<DecodedRaster> {
  const ct = String(contentType || "").toLowerCase();
  const format =
    ct.includes("png") ? "png" :
    ct.includes("jpeg") || ct.includes("jpg") ? "jpeg" :
    sniffRasterFormat(buf);

  console.log("[RASTER_DECODE_START]", {
    provider,
    contentType,
    byteLength: buf.byteLength,
  });

  try {
    if (format === "png") {
      const { PNG } = await import("npm:pngjs@7.0.0");
      const nodeBuffer = Buffer.from(buf);
      const png = (PNG as any).sync.read(nodeBuffer);
      const raster = { width: png.width, height: png.height, data: png.data as Uint8Array };
      console.log("[RASTER_DECODE_SUCCESS]", { width: raster.width, height: raster.height, format });
      return raster;
    }
    if (format === "jpeg") {
      const jpeg = await import("npm:jpeg-js@0.4.4");
      const nodeBuffer = Buffer.from(buf);
      const decoded = (jpeg as any).decode(nodeBuffer, { useTArray: true });
      if (!decoded?.width || !decoded?.height || !decoded?.data) throw new Error("JPEG decode failed");
      const raster = { width: decoded.width, height: decoded.height, data: decoded.data as Uint8Array };
      console.log("[RASTER_DECODE_SUCCESS]", { width: raster.width, height: raster.height, format });
      return raster;
    }
    throw new Error(`Unsupported raster format: ${contentType || "unknown"}`);
  } catch (error) {
    throw new Error("Raster decode failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

async function geocodeAddress(address: string): Promise<(GeoPoint & { geocode_location_type: string }) | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
  const r = await fetch(url.toString());
  if (!r.ok) return null;
  const data = await r.json();
  const first = data?.results?.[0];
  if (!first?.geometry?.location) return null;
  return {
    lat: Number(first.geometry.location.lat),
    lng: Number(first.geometry.location.lng),
    geocode_location_type: String(first.geometry.location_type || "UNKNOWN"),
  };
}

function buildMapboxStaticImageUrl(args: { lng: number; lat: number; zoom: number; width: number; height: number }) {
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${args.lng},${args.lat},${args.zoom},0,0/${args.width}x${args.height}@2x?access_token=${MAPBOX_TOKEN}`;
}

// Google Maps Static API — orthographic satellite imagery at a given center/zoom.
// Used as the PRIMARY measurement imagery when available because Google's
// satellite tiles are typically sharper than Mapbox in US suburban markets,
// which improves Sobel/Hough ridge detection. Falls back to Mapbox on failure.
function buildGoogleStaticSatelliteUrl(args: { lng: number; lat: number; zoom: number; width: number; height: number }) {
  // scale=2 → returns 2x pixel density (matches Mapbox @2x).
  // maxsize for free tier is 640x640 logical; with scale=2 effective px = 1280x1280.
  const w = Math.min(args.width, 640);
  const h = Math.min(args.height, 640);
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${args.lat},${args.lng}`);
  url.searchParams.set("zoom", String(args.zoom));
  url.searchParams.set("size", `${w}x${h}`);
  url.searchParams.set("scale", "2");
  url.searchParams.set("maptype", "satellite");
  url.searchParams.set("format", "png");
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
  return url.toString();
}

interface ImageryFetchResult {
  buffer: Uint8Array;
  contentType: string | null;
  url: string;
  provider: "google_2d_satellite" | "mapbox_satellite";
  decisionLog: {
    google_2d_available: boolean;
    mapbox_available: boolean;
    selected_provider: string;
    bytes: number;
    reason: string;
    google_3d_debug_available: boolean;
  };
}

async function fetchAerialImagery(args: { lng: number; lat: number; zoom: number; width: number; height: number }): Promise<ImageryFetchResult> {
  const googleAvailable = Boolean(GOOGLE_MAPS_API_KEY);
  const mapboxAvailable = Boolean(MAPBOX_TOKEN);

  // Try Google 2D Satellite first (sharper imagery → better edge/ridge detection).
  if (googleAvailable) {
    try {
      const url = buildGoogleStaticSatelliteUrl(args);
      const resp = await fetch(url);
      if (resp.ok) {
        const ct = resp.headers.get("content-type") || "";
        const buf = new Uint8Array(await resp.arrayBuffer());
        // Sanity: Google returns ~tiny error tiles on quota/billing issues.
        if (buf.byteLength >= 20_000 && ct.startsWith("image/")) {
          console.log("[IMAGERY_PROVIDER_SELECTION]", JSON.stringify({
            google_2d_available: true,
            mapbox_available: mapboxAvailable,
            selected_provider: "google_2d_satellite",
            bytes: buf.byteLength,
            reason: "google_2d_preferred_for_edge_detection",
          }));
          return {
            buffer: buf,
            contentType: ct,
            url,
            provider: "google_2d_satellite",
            decisionLog: {
              google_2d_available: true,
              mapbox_available: mapboxAvailable,
              selected_provider: "google_2d_satellite",
              bytes: buf.byteLength,
              reason: "google_2d_preferred_for_edge_detection",
              google_3d_debug_available: googleAvailable, // 3D Tiles uses same key
            },
          };
        } else {
          console.warn("[IMAGERY_PROVIDER_SELECTION] google rejected — bytes=", buf.byteLength, "ct=", ct);
        }
      } else {
        console.warn("[IMAGERY_PROVIDER_SELECTION] google fetch failed:", resp.status);
      }
    } catch (e) {
      console.warn("[IMAGERY_PROVIDER_SELECTION] google error:", (e as Error).message);
    }
  }

  // Fallback: Mapbox Satellite.
  if (!mapboxAvailable) {
    throw new Error("No imagery provider available: GOOGLE_MAPS_API_KEY and MAPBOX_PUBLIC_TOKEN are both unset.");
  }
  const url = buildMapboxStaticImageUrl(args);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Mapbox fetch failed: ${resp.status}`);
  const ct = resp.headers.get("content-type") || "";
  const buf = new Uint8Array(await resp.arrayBuffer());
  console.log("[IMAGERY_PROVIDER_SELECTION]", JSON.stringify({
    google_2d_available: googleAvailable,
    mapbox_available: true,
    selected_provider: "mapbox_satellite",
    bytes: buf.byteLength,
    reason: googleAvailable ? "google_unavailable_or_invalid_fallback_to_mapbox" : "google_key_missing",
  }));
  return {
    buffer: buf,
    contentType: ct,
    url,
    provider: "mapbox_satellite",
    decisionLog: {
      google_2d_available: googleAvailable,
      mapbox_available: true,
      selected_provider: "mapbox_satellite",
      bytes: buf.byteLength,
      reason: googleAvailable ? "google_unavailable_or_invalid_fallback_to_mapbox" : "google_key_missing",
      google_3d_debug_available: googleAvailable,
    },
  };
}

async function fetchGoogleSolar(lat: number, lng: number) {
  if (!GOOGLE_SOLAR_API_KEY) return null;
  const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("requiredQuality", "LOW");
  url.searchParams.set("key", GOOGLE_SOLAR_API_KEY);
  const r = await fetch(url.toString());
  if (!r.ok) return null;
  return await r.json();
}

async function runSegmentation(payload: any) {
  if (!UNET_ENDPOINT) {
    return { footprint_polygon_px: [], planes: [], edges: [], confidence: 0 };
  }
  const r = await fetch(UNET_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(UNET_API_KEY ? { Authorization: `Bearer ${UNET_API_KEY}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    console.warn(`Segmentation endpoint failed: ${r.status}`);
    return { footprint_polygon_px: [], planes: [], edges: [], confidence: 0 };
  }
  return await r.json();
}

function metersPerPixel(latitude: number, zoom: number) {
  return 156543.04 * Math.cos((latitude * Math.PI) / 180) / Math.pow(2, zoom);
}
function pitchMultiplier(risePer12: number) {
  return Math.sqrt(12 * 12 + risePer12 * risePer12) / 12;
}
function risePer12ToDegrees(risePer12: number) {
  return Math.atan(risePer12 / 12) * (180 / Math.PI);
}
function polygonAreaSqft(points: Point[], feetPerPixel: number) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    a += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(a / 2) * feetPerPixel * feetPerPixel;
}
function polylineLengthPx(points: Point[]) {
  let t = 0;
  for (let i = 1; i < points.length; i++) t += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return t;
}
function pxToLngLat(p: Point, c: GeoPoint, w: number, h: number, mppActual: number) {
  const R = 6378137;
  const dxM = (p.x - w / 2) * mppActual;
  const dyM = (p.y - h / 2) * mppActual;
  const dLat = -(dyM / R) * (180 / Math.PI);
  const dLng = (dxM / (R * Math.cos((c.lat * Math.PI) / 180))) * (180 / Math.PI);
  return [c.lng + dLng, c.lat + dLat];
}
function lngLatToPx(lat: number, lng: number, c: GeoPoint, w: number, h: number, mppActual: number): Point {
  const R = 6378137;
  const dLat = (lat - c.lat) * (Math.PI / 180);
  const dLng = (lng - c.lng) * (Math.PI / 180);
  const dyM = -dLat * R;
  const dxM = dLng * R * Math.cos((c.lat * Math.PI) / 180);
  return { x: w / 2 + dxM / mppActual, y: h / 2 + dyM / mppActual };
}
function footprintFromSolarBoundingBox(
  solarData: any,
  c: GeoPoint,
  w: number,
  h: number,
  mppActual: number,
): Point[] | null {
  const bb = solarData?.boundingBox;
  if (!bb?.sw || !bb?.ne) return null;
  const sw = lngLatToPx(bb.sw.latitude, bb.sw.longitude, c, w, h, mppActual);
  const ne = lngLatToPx(bb.ne.latitude, bb.ne.longitude, c, w, h, mppActual);
  const minX = clamp(Math.min(sw.x, ne.x), 0, w);
  const maxX = clamp(Math.max(sw.x, ne.x), 0, w);
  const minY = clamp(Math.min(sw.y, ne.y), 0, h);
  const maxY = clamp(Math.max(sw.y, ne.y), 0, h);
  if (maxX - minX < 4 || maxY - minY < 4) return null;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}
function syntheticCenteredFootprint(w: number, h: number, feetPerPixelActual: number): Point[] {
  // ~40ft x 30ft default house footprint, centered.
  const halfW = (40 / 2) / feetPerPixelActual;
  const halfH = (30 / 2) / feetPerPixelActual;
  const cx = w / 2;
  const cy = h / 2;
  return [
    { x: cx - halfW, y: cy - halfH },
    { x: cx + halfW, y: cy - halfH },
    { x: cx + halfW, y: cy + halfH },
    { x: cx - halfW, y: cy + halfH },
  ];
}
function polygonPxToGeoJSON(points: Point[], c: GeoPoint, w: number, h: number, mpp: number) {
  const ring = points.map((p) => pxToLngLat(p, c, w, h, mpp));
  if (ring.length) ring.push(ring[0]);
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}
function polygonVerticesToWKT(vertices: Array<{ lng: number; lat: number }>) {
  const ring = [...vertices, vertices[0]];
  return `POLYGON((${ring.map((p) => `${p.lng} ${p.lat}`).join(", ")}))`;
}
function lineGeoJSONToWKT(feature: any) {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return `LINESTRING(${coords.map((p: any) => `${Number(p[0])} ${Number(p[1])}`).join(", ")})`;
}
function imageBoundsFromRaster(c: GeoPoint, w: number, h: number, mpp: number): [number, number, number, number] {
  const [west, north] = pxToLngLat({ x: 0, y: 0 }, c, w, h, mpp);
  const [east, south] = pxToLngLat({ x: w, y: h }, c, w, h, mpp);
  return [west, south, east, north];
}
function linePxToGeoJSON(points: Point[], c: GeoPoint, w: number, h: number, mpp: number) {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: points.map((p) => pxToLngLat(p, c, w, h, mpp)) },
    properties: {},
  };
}
function cleanPolygon(points: Point[], w: number, h: number) {
  const c = (points || [])
    .map((p) => ({ x: clamp(Number(p.x), 0, w), y: clamp(Number(p.y), 0, h) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  return removeNearDuplicates(c, 2);
}
function cleanLine(points: Point[], w: number, h: number) {
  const c = (points || [])
    .map((p) => ({ x: clamp(Number(p.x), 0, w), y: clamp(Number(p.y), 0, h) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  return removeNearDuplicates(c, 2);
}
function removeNearDuplicates(points: Point[], minDist: number) {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= minDist) out.push(p);
  }
  return out;
}
function polygonsSelfIntersect(points: Point[]) {
  for (let i = 0; i < points.length; i++) {
    const a1 = points[i], a2 = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)) continue;
      const b1 = points[j], b2 = points[(j + 1) % points.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}
function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point) {
  const o = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p1, p2, q1) !== o(p1, p2, q2) && o(q1, q2, p1) !== o(q1, q2, p2);
}
function normalizeEdgeType(v: string): RoofEdge["edge_type"] {
  const s = String(v || "").toLowerCase();
  if (s.includes("ridge")) return "ridge";
  if (s.includes("hip")) return "hip";
  if (s.includes("valley")) return "valley";
  if (s.includes("eave")) return "eave";
  if (s.includes("rake")) return "rake";
  return "unknown";
}
// Whitelist of footprint_source values accepted by the
// roof_measurements_footprint_source_check constraint. Anything not in this
// list MUST be mapped (or fall through to 'unknown') so inserts never fail.
const ALLOWED_FOOTPRINT_SOURCES = new Set<string>([
  "mapbox_vector", "regrid_parcel", "osm_overpass", "microsoft_buildings",
  "solar_api_footprint", "solar_bbox_fallback", "manual_trace", "manual_entry",
  "imported", "user_drawn", "ai_detection", "esri_buildings", "google_solar_api",
  "osm", "google_maps", "satellite", "unknown",
  "google_solar_bbox", "google_solar_segments", "google_solar_segments_hull",
  "unet_mask", "alpha_hull", "convex_hull",
]);

function normalizeRoofMeasurementFootprintSource(source: string) {
  const raw = String(source || "unknown").trim();
  // Direct alias remaps (legacy / producer-specific labels)
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
  console.warn(`[footprint_source] Unknown source '${raw}' — coercing to 'unknown'`);
  return "unknown";
}
function cleanPlane(plane: any, idx: number, w: number, h: number): RoofPlane | null {
  const polygon = cleanPolygon(plane?.polygon_px || [], w, h);
  if (polygon.length < 3) return null;
  if (polygonsSelfIntersect(polygon)) return null;
  return {
    plane_index: plane.plane_index || idx,
    polygon_px: polygon,
    confidence: Number(plane.confidence || 0),
    pitch: plane.pitch != null ? Number(plane.pitch) : null,
    pitch_degrees: plane.pitch_degrees != null ? Number(plane.pitch_degrees) : null,
    azimuth: plane.azimuth != null ? Number(plane.azimuth) : null,
    source: String(plane.source || "unet"),
  };
}
function cleanEdge(edge: any, w: number, h: number): RoofEdge | null {
  const line = cleanLine(edge?.line_px || [], w, h);
  if (line.length < 2) return null;
  return {
    edge_type: normalizeEdgeType(edge.edge_type),
    line_px: line,
    confidence: Number(edge.confidence || 0),
    source: String(edge.source || "unet"),
  };
}
function dominantSolarPitchRise(solarData: any): number | null {
  const segs = solarData?.solarPotential?.roofSegmentStats || [];
  const rises = segs
    .map((s: any) => Number(s.pitchDegrees))
    .filter((n: number) => Number.isFinite(n) && n > 0)
    .map((d: number) => Math.tan((d * Math.PI) / 180) * 12);
  return rises.length ? average(rises) : null;
}
function estimateSolarRoofAreaSqft(solarData: any): number | null {
  const segs = solarData?.solarPotential?.roofSegmentStats || [];
  const areasM2 = segs
    .map((s: any) => Number(s?.stats?.areaMeters2 ?? s?.stats?.groundAreaMeters2))
    .filter((n: number) => Number.isFinite(n) && n > 0);
  if (areasM2.length > 0) return areasM2.reduce((sum: number, n: number) => sum + n, 0) * 10.7639;
  const wholeRoof = Number(solarData?.solarPotential?.wholeRoofStats?.areaMeters2 ?? solarData?.solarPotential?.wholeRoofStats?.groundAreaMeters2);
  return Number.isFinite(wholeRoof) && wholeRoof > 0 ? wholeRoof * 10.7639 : null;
}
function dominantSolarAzimuth(solarData: any): number | null {
  const segs = solarData?.solarPotential?.roofSegmentStats || [];
  const az = segs.map((s: any) => Number(s.azimuthDegrees)).filter((n: number) => Number.isFinite(n));
  return az.length ? average(az) : null;
}
function parsePitchOverride(po: string | null): number | null {
  if (!po) return null;
  const m = /^([0-9]+(?:\.[0-9]+)?)\s*\/\s*12$/.exec(String(po).trim());
  return m ? Number(m[1]) : null;
}
function buildPlaneRows(args: {
  ai_measurement_job_id: string;
  planes: RoofPlane[];
  fallbackFootprint: Point[];
  solarData: any;
  pitchOverride: string | null;
  center: GeoPoint;
  width: number; height: number;
  metersPerPixelActual: number; feetPerPixelActual: number;
}) {
  const overrideRise = parsePitchOverride(args.pitchOverride);
  const solarRise = dominantSolarPitchRise(args.solarData);
  const solarAzimuth = dominantSolarAzimuth(args.solarData);

  const inputPlanes: RoofPlane[] = args.planes.length
    ? args.planes
    : args.fallbackFootprint.length >= 3
      ? [{
          plane_index: 1,
          polygon_px: args.fallbackFootprint,
          confidence: 0.45,
          source: "single_plane_fallback",
          pitch: null, pitch_degrees: null, azimuth: null,
        }]
      : [];

  return inputPlanes.map((plane) => {
    const rise = overrideRise ?? plane.pitch ??
      (plane.pitch_degrees != null ? Math.tan((plane.pitch_degrees * Math.PI) / 180) * 12 : null) ??
      solarRise ?? 6;
    const pitchDegrees = plane.pitch_degrees ?? risePer12ToDegrees(rise);
    const area2d = Array.isArray((plane as any).multi_part_px) && (plane as any).multi_part_px.length
      ? (plane as any).multi_part_px.reduce((sum: number, part: Point[]) => sum + polygonAreaSqft(part, args.feetPerPixelActual), 0)
      : polygonAreaSqft(plane.polygon_px, args.feetPerPixelActual);
    const mult = pitchMultiplier(rise);
    return {
      job_id: args.ai_measurement_job_id,
      plane_index: plane.plane_index,
      source: plane.source,
      polygon_px: plane.polygon_px,
      polygon_geojson: polygonPxToGeoJSON(plane.polygon_px, args.center, args.width, args.height, args.metersPerPixelActual),
      pitch: round(rise, 2),
      pitch_degrees: round(pitchDegrees, 2),
      azimuth: round(plane.azimuth ?? solarAzimuth ?? 0, 2),
      area_2d_sqft: round(area2d, 2),
      pitch_multiplier: round(mult, 4),
      area_pitch_adjusted_sqft: round(area2d * mult, 2),
      confidence: round(plane.confidence, 3),
    };
  });
}
function buildEdgeRows(args: {
  ai_measurement_job_id: string;
  edges: RoofEdge[];
  center: GeoPoint;
  width: number; height: number;
  metersPerPixelActual: number; feetPerPixelActual: number;
}) {
  return args.edges.map((edge) => {
    const lpx = polylineLengthPx(edge.line_px);
    return {
      job_id: args.ai_measurement_job_id,
      edge_type: edge.edge_type,
      source: edge.source,
      line_px: edge.line_px,
      line_geojson: linePxToGeoJSON(edge.line_px, args.center, args.width, args.height, args.metersPerPixelActual),
      length_px: round(lpx, 2),
      length_ft: round(lpx * args.feetPerPixelActual, 2),
      confidence: round(edge.confidence, 3),
    };
  });
}
function calculateTotals(planes: any[], edges: any[], wfp: number) {
  const t2d = planes.reduce((s, p) => s + Number(p.area_2d_sqft || 0), 0);
  const tslope = planes.reduce((s, p) => s + Number(p.area_pitch_adjusted_sqft || 0), 0);
  const lt: Record<string, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, unknown: 0 };
  for (const e of edges) lt[e.edge_type] = (lt[e.edge_type] || 0) + Number(e.length_ft || 0);
  const pb: Record<string, number> = {};
  for (const p of planes) {
    const k = String(p.pitch ?? "unknown");
    pb[k] = (pb[k] || 0) + Number(p.area_pitch_adjusted_sqft || 0);
  }
  const dom = Object.entries(pb).sort((a, b) => b[1] - a[1])[0]?.[0];
  const sq = tslope / 100;
  return {
    total_area_2d_sqft: round(t2d, 2),
    total_area_pitch_adjusted_sqft: round(tslope, 2),
    roof_square_count: round(sq, 2),
    waste_adjusted_squares: round(sq * (1 + wfp / 100), 2),
    ridge_length_ft: round(lt.ridge, 2),
    hip_length_ft: round(lt.hip, 2),
    valley_length_ft: round(lt.valley, 2),
    eave_length_ft: round(lt.eave, 2),
    rake_length_ft: round(lt.rake, 2),
    perimeter_length_ft: round(lt.eave + lt.rake, 2),
    dominant_pitch: dom && dom !== "unknown" ? Number(dom) : null,
    pitch_breakdown: pb,
    line_breakdown: lt,
    plane_breakdown: planes.map((p) => ({
      plane_index: p.plane_index, source: p.source, pitch: p.pitch,
      pitch_degrees: p.pitch_degrees, area_2d_sqft: p.area_2d_sqft,
      area_pitch_adjusted_sqft: p.area_pitch_adjusted_sqft, confidence: p.confidence,
    })),
  };
}
function scoreQuality(input: {
  geocode_location_type: string; solarData: any;
  planes: any[]; edges: any[]; totals: any; usedSinglePlaneFallback: boolean;
}) {
  const avgPC = average(input.planes.map((p) => Number(p.confidence || 0)));
  const areaOK = input.totals.total_area_pitch_adjusted_sqft >= 300 && input.totals.total_area_pitch_adjusted_sqft <= 20000;
  const checks = [
    { name: "geocode_precision", passed: ["STORED","ROOFTOP"].includes(input.geocode_location_type), score: ["STORED","ROOFTOP"].includes(input.geocode_location_type) ? 1 : 0.5, details: { geocode_location_type: input.geocode_location_type } },
    { name: "has_planes", passed: input.planes.length > 0, score: input.planes.length > 0 ? 1 : 0, details: { plane_count: input.planes.length } },
    { name: "has_edges", passed: input.edges.length > 0, score: input.edges.length > 0 ? 1 : 0.5, details: { edge_count: input.edges.length } },
    { name: "single_plane_fallback", passed: !input.usedSinglePlaneFallback, score: input.usedSinglePlaneFallback ? 0.55 : 1, details: { usedSinglePlaneFallback: input.usedSinglePlaneFallback } },
    { name: "solar_available", passed: !!input.solarData, score: input.solarData ? 1 : 0.55, details: { solar: !!input.solarData } },
    { name: "area_reasonable", passed: areaOK, score: areaOK ? 1 : 0.25, details: { total_area_pitch_adjusted_sqft: input.totals.total_area_pitch_adjusted_sqft } },
    { name: "avg_plane_confidence", passed: avgPC >= 0.65, score: avgPC, details: { avg_plane_confidence: avgPC } },
  ];
  const geom = average([getScore(checks,"geocode_precision"), getScore(checks,"has_planes"), getScore(checks,"single_plane_fallback"), getScore(checks,"avg_plane_confidence")]);
  const meas = average([getScore(checks,"has_edges"), getScore(checks,"solar_available"), getScore(checks,"area_reasonable")]);
  return { checks, geometry_score: round(geom, 3), measurement_score: round(meas, 3), overall_score: round(geom * 0.6 + meas * 0.4, 3) };
}
async function setMeasurementJobStatus(id: string, status: string, msg: string, measurement_id: string | null = null) {
  const legacyStatus = ["queued", "processing", "completed", "failed"].includes(status) ? status : "completed";
  const patch: Record<string, unknown> = {
    status: legacyStatus, progress_message: msg, measurement_id,
    error: status === "failed" ? msg : null,
    updated_at: new Date().toISOString(),
    ...(legacyStatus === "completed" || legacyStatus === "failed" ? { completed_at: new Date().toISOString() } : {}),
  };
  if (legacyStatus === "processing") patch.started_at = new Date().toISOString();
  const { error } = await supabase.from("measurement_jobs").update(patch).eq("id", id);
  if (error) console.error("setMeasurementJobStatus failed", { id, status, legacyStatus, error });
}
async function setAiJobStatus(id: string, status: string, msg: string, quality: any = null) {
  await supabase.from("ai_measurement_jobs").update({
    status, status_message: msg,
    updated_at: new Date().toISOString(),
    ...(quality ? {
      confidence_score: quality.overall_score,
      geometry_quality_score: quality.geometry_score,
      measurement_quality_score: quality.measurement_score,
      completed_at: new Date().toISOString(),
    } : {}),
    ...(status === "failed" ? { failure_reason: msg } : {}),
  }).eq("id", id);
}
function average(v: number[]) { const c = v.filter((n) => Number.isFinite(n)); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0; }
function getScore(checks: any[], name: string) { return checks.find((c) => c.name === name)?.score ?? 0; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function round(v: number, d = 2) { const m = Math.pow(10, d); return Math.round(Number(v || 0) * m) / m; }
async function hashSignature(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
