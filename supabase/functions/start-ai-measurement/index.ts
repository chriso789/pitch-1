// supabase/functions/start-ai-measurement/index.ts
// Geometry-first v2 — full replacement.
// Canonical AI Measurement entrypoint. Accepts both legacy
// (pipelineEntryId/lat/lng/tenantId/userId/pitchOverride/address)
// and new (lead_id/project_id/property_address/...) payload shapes.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { computeStraightSkeleton } from "../_shared/straight-skeleton.ts";
import { buildTopology } from "../_shared/topology-engine.ts";
import { fetchOSMBuildingFootprint } from "../_shared/osm-footprint-extractor.ts";

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
};

type RoofEdge = {
  edge_type: "ridge" | "hip" | "valley" | "eave" | "rake" | "unknown";
  line_px: Point[];
  confidence: number;
  source: string;
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

    if (!MAPBOX_TOKEN) throw new Error("MAPBOX_PUBLIC_TOKEN is not configured.");

    const imageUrl = buildMapboxStaticImageUrl({
      lng: coords.lng,
      lat: coords.lat,
      zoom: Number(input.zoom),
      width: Number(input.logical_image_width),
      height: Number(input.logical_image_height),
    });

    await setAiJobStatus(input.ai_measurement_job_id, "running", "Fetching aerial imagery");
    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) throw new Error(`Mapbox fetch failed: ${imageResp.status}`);
    const imageBuffer = new Uint8Array(await imageResp.arrayBuffer());
    const raster = await decodeRaster(imageBuffer, imageResp.headers.get("content-type"));

    await setAiJobStatus(input.ai_measurement_job_id, "running", "Fetching Google Solar priors");
    const solarData = await fetchGoogleSolar(coords.lat, coords.lng);

    // ───────── GEOMETRY-FIRST PIPELINE ─────────
    // U-Net is OPTIONAL. Solar bbox is ONLY allowed as a crop/search hint.
    // The deterministic topology engine is the geometry source of truth.

    // 1. Resolve a REAL footprint (OSM building → Solar bbox crop hint → none).
    let footprint: Point[] = [];
    let footprintSource: string = "none";

    try {
      const osmRes = await fetchOSMBuildingFootprint(coords.lat, coords.lng, { searchRadius: 60 });
      if (osmRes.footprint?.coordinates && osmRes.footprint.coordinates.length >= 4) {
        footprint = osmRes.footprint.coordinates.map(([lng, lat]) =>
          lngLatToPx(lat, lng, { lat: coords.lat, lng: coords.lng }, raster.width, raster.height, actualMpp),
        );
        // Drop the closing duplicate vertex if present
        if (footprint.length > 3) {
          const f = footprint[0], l = footprint[footprint.length - 1];
          if (Math.hypot(f.x - l.x, f.y - l.y) < 1) footprint = footprint.slice(0, -1);
        }
        footprint = cleanPolygon(footprint, raster.width, raster.height);
        if (footprint.length >= 3) footprintSource = "osm_building";
      }
    } catch (e) {
      console.warn("[geometry-first] OSM footprint lookup failed:", (e as Error).message);
    }

    // 2. OPTIONAL U-Net pass — only used to refine edges/planes when configured.
    //    Never required, never the geometry source.
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
    if (footprint.length < 3) {
      const segFootprint = cleanPolygon(segmentation.footprint_polygon_px || [], raster.width, raster.height);
      if (segFootprint.length >= 3) {
        footprint = segFootprint;
        footprintSource = "unet_segmentation";
      }
    }

    // 3. Run deterministic topology (straight skeleton primary, triangulation fallback).
    let cleanPlanes: RoofPlane[] = [];
    let cleanEdges: RoofEdge[] = [];
    let topologySource = "none";
    let usedSolarBboxAsCropOnly = false;
    let usedSyntheticDebugRectangle = false;

    if (footprint.length >= 3) {
      await setAiJobStatus(input.ai_measurement_job_id, "running", "Running deterministic topology engine");
      try {
        // Primary: straight skeleton — emits real ridges/hips/valleys.
        const skeletonEdges = computeStraightSkeleton(
          footprint.map((p) => [p.x, p.y] as [number, number]),
        );
        if (skeletonEdges && skeletonEdges.length > 0) {
          // Convert skeleton edges into RoofEdge (interior topology only).
          for (const se of skeletonEdges as any[]) {
            const a = se.a ?? se.p1 ?? se[0];
            const b = se.b ?? se.p2 ?? se[1];
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
          topologySource = "straight_skeleton";
        }

        // Always derive planes via triangulation/merge so we get >1 facet
        // when the footprint warrants it.
        const topo = buildTopology(footprint);
        if (topo.planes.length > 0) {
          cleanPlanes = topo.planes.map((tp, idx) => ({
            plane_index: idx + 1,
            polygon_px: tp.polygon,
            confidence: 0.7,
            pitch: null,
            pitch_degrees: null,
            azimuth: null,
            source: "topology_engine_v2",
          }));
          if (topologySource === "none") topologySource = "triangulation";
          // Append perimeter eaves/rakes from topology engine if skeleton missed them.
          if (cleanEdges.length === 0) {
            for (const e of topo.edges) {
              cleanEdges.push({
                edge_type: e.type,
                line_px: [e.p1, e.p2],
                confidence: 0.65,
                source: "topology_engine_v2",
              });
            }
          } else {
            // Add perimeter eaves/rakes regardless (skeleton only emits interior).
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
        }
      } catch (e) {
        console.warn("[geometry-first] topology engine failed:", (e as Error).message);
      }
    }

    // 4. Refine with U-Net output ONLY if topology produced nothing AND U-Net did.
    if (cleanPlanes.length === 0 && unetPlanes.length > 0) {
      cleanPlanes = unetPlanes;
      topologySource = "unet_planes";
    }
    if (cleanEdges.length === 0 && unetEdges.length > 0) {
      cleanEdges = unetEdges;
    }

    // 5. Solar bbox / synthetic rectangle are NOT customer-shippable geometry.
    //    Track whether they were considered (for audit), but never let them
    //    become the final footprint here.
    if (footprint.length < 3 && solarData?.boundingBox) {
      usedSolarBboxAsCropOnly = true; // bbox would only have been a crop region
    }

    console.log("[GEOMETRY_SOURCE_DECISION]", JSON.stringify({
      has_unet_endpoint: !!UNET_ENDPOINT,
      used_unet: unetPlanes.length > 0 || unetEdges.length > 0,
      used_solar_bbox_as_crop_only: usedSolarBboxAsCropOnly,
      used_synthetic_debug_rectangle: usedSyntheticDebugRectangle,
      used_deterministic_topology: topologySource === "straight_skeleton" || topologySource === "triangulation",
      footprint_source: footprintSource,
      topology_source: topologySource,
      final_plane_count: cleanPlanes.length,
      final_edge_count: cleanEdges.length,
    }));

    // Hard guard: a real footprint is required to publish a customer measurement.
    // Solar bbox / synthetic rectangles are NOT acceptable as final geometry.
    if (footprint.length < 3) {
      throw new Error(
        "No real building footprint could be resolved (OSM/segmentation both empty). " +
        "Geometry engine refuses to fabricate roof shape from Solar bbox or synthetic rectangle.",
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

    // Block customer-shippable report when only 1 plane was produced for a
    // non-trivial footprint — that signals topology collapse, not a real flat roof.
    const blockCustomerReportReason: string | null =
      (planeRows.length === 1 && Number(totals.total_area_2d_sqft) > 800)
        ? "single_plane_for_large_footprint"
        : null;

    const quality = scoreQuality({
      geocode_location_type: coords.geocode_location_type,
      solarData,
      planes: planeRows,
      edges: edgeRows,
      totals,
      usedSinglePlaneFallback,
    });

    const resolvedGeometrySource =
      topologySource === "straight_skeleton" ? "deterministic_straight_skeleton"
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

    const geometryReportJson = { planes: planeRows, edges: edgeRows, totals, quality };
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
    const aiDetectionData = {
      source_button: input.source_button,
      engine_version: "geometry_first_v2",
      geometry_source: resolvedGeometrySource,
      footprint_source: footprintSource,
      topology_source: topologySource,
      block_customer_report_reason: blockCustomerReportReason,
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
        footprint_source: footprintSource,
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

    const finalJobStatus = blockCustomerReportReason ? "needs_review" : "completed";
    const finalJobMessage = blockCustomerReportReason
      ? `Geometry collapsed to single plane on ${Math.round(totals.total_area_2d_sqft)} sqft footprint — needs human topology review.`
      : "Measurement complete";

    await setMeasurementJobStatus(
      input.measurement_job_id,
      finalJobStatus,
      finalJobMessage,
      roofMeasurement.id,
    );
    await setAiJobStatus(input.ai_measurement_job_id, finalAiStatus, finalJobMessage, quality);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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

async function decodeRaster(buf: Uint8Array, contentType?: string | null): Promise<DecodedRaster> {
  const ct = String(contentType || "").toLowerCase();
  const format =
    ct.includes("png") ? "png" :
    ct.includes("jpeg") || ct.includes("jpg") ? "jpeg" :
    sniffRasterFormat(buf);

  if (format === "png") {
    const { PNG } = await import("npm:pngjs@7.0.0");
    const png = (PNG as any).sync.read(buf);
    return { width: png.width, height: png.height, data: png.data as Uint8Array };
  }
  if (format === "jpeg") {
    const jpeg = await import("npm:jpeg-js@0.4.4");
    const decoded = (jpeg as any).decode(buf, { useTArray: true });
    if (!decoded?.width || !decoded?.height || !decoded?.data) throw new Error("JPEG decode failed");
    return { width: decoded.width, height: decoded.height, data: decoded.data as Uint8Array };
  }
  throw new Error(`Unsupported raster format: ${contentType || "unknown"}`);
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
    const area2d = polygonAreaSqft(plane.polygon_px, args.feetPerPixelActual);
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
  await supabase.from("measurement_jobs").update({
    status, progress_message: msg, measurement_id,
    updated_at: new Date().toISOString(),
    ...(status === "completed" || status === "failed" ? { completed_at: new Date().toISOString() } : {}),
  }).eq("id", id);
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
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
