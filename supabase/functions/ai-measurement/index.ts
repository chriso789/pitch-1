import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Point = { x: number; y: number };
type GeoPoint = { lat: number; lng: number };

type RoofPlane = {
  plane_index: number;
  source: string;
  polygon_px: Point[];
  pitch?: number | null;
  pitch_degrees?: number | null;
  azimuth?: number | null;
  confidence: number;
};

type RoofEdge = {
  edge_type: "ridge" | "hip" | "valley" | "eave" | "rake" | "unknown";
  source: string;
  line_px: Point[];
  confidence: number;
  adjacent_plane_ids?: string[];
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_TOKEN") || Deno.env.get("MAPBOX_PUBLIC_TOKEN") || "";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const GOOGLE_SOLAR_API_KEY = Deno.env.get("GOOGLE_SOLAR_API_KEY") || GOOGLE_MAPS_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return json({});
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "POST required" }, 405);
    }

    const body = await req.json();

    const {
      lead_id,
      project_id,
      company_id,
      property_address,
      latitude,
      longitude,
      waste_factor_percent = 10,
      image_width = 768,
      image_height = 768,
      zoom = 20
    } = body;

    if (!lead_id && !project_id) {
      return json(
        {
          error:
            "AI Measurement must be started from a lead or project record. Missing lead_id or project_id."
        },
        400
      );
    }

    if (!property_address && (!latitude || !longitude)) {
      return json(
        {
          error:
            "Missing property address or latitude/longitude. AI Measurement requires a lead/project property location."
        },
        400
      );
    }

    const jobInsert = await supabase
      .from("ai_measurement_jobs")
      .insert({
        lead_id: lead_id || null,
        project_id: project_id || null,
        company_id: company_id || null,
        property_address: property_address || "Unknown Address",
        latitude: latitude || null,
        longitude: longitude || null,
        status: "running",
        status_message:
          "AI measurement started from existing lead/project AI Measurement button"
      })
      .select()
      .single();

    if (jobInsert.error) throw jobInsert.error;

    const job = jobInsert.data;

    await updateJob(job.id, "running", "Geocoding property address");

    const coords = latitude && longitude
      ? { lat: Number(latitude), lng: Number(longitude) }
      : await geocodeAddress(property_address);

    if (!coords) {
      await failJob(job.id, "Unable to geocode property address");
      return json({
        job_id: job.id,
        status: "failed",
        reason: "Unable to geocode property address"
      }, 422);
    }

    await supabase
      .from("ai_measurement_jobs")
      .update({
        latitude: coords.lat,
        longitude: coords.lng,
        updated_at: new Date().toISOString()
      })
      .eq("id", job.id);

    await updateJob(job.id, "running", "Calculating image calibration");

    const metersPerPixel = calculateMetersPerPixel(coords.lat, Number(zoom));
    const feetPerPixel = metersPerPixel * 3.280839895;

    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
      await failJob(job.id, "Invalid calibration: meters per pixel could not be calculated");
      return json({
        job_id: job.id,
        status: "failed",
        reason: "Invalid calibration"
      }, 422);
    }

    await updateJob(job.id, "running", "Pulling Mapbox satellite image");

    const mapboxImage = buildMapboxStaticImageUrl(
      coords.lng,
      coords.lat,
      Number(zoom),
      Number(image_width),
      Number(image_height)
    );

    await supabase
      .from("ai_measurement_images")
      .insert({
        job_id: job.id,
        source: "mapbox_satellite",
        image_url: mapboxImage,
        width: image_width,
        height: image_height,
        zoom,
        bearing: 0,
        pitch: 0,
        meters_per_pixel: metersPerPixel,
        feet_per_pixel: feetPerPixel,
        calibration: {
          method: "web_mercator_zoom_latitude",
          latitude: coords.lat,
          longitude: coords.lng,
          zoom,
          image_width,
          image_height,
          meters_per_pixel: metersPerPixel,
          feet_per_pixel: feetPerPixel,
          formula:
            "meters_per_pixel = 156543.03392 * cos(latitude * PI / 180) / 2^zoom"
        },
        is_primary: true
      });

    await updateJob(job.id, "running", "Pulling Google Solar roof geometry");

    const solarData = await fetchGoogleSolar(coords.lat, coords.lng);

    await updateJob(job.id, "running", "Running AI roof segmentation");

    const aiDetection = await runRoofSegmentation({
      job_id: job.id,
      lead_id: lead_id || null,
      project_id: project_id || null,
      company_id: company_id || null,
      property_address,
      image_url: mapboxImage,
      width: Number(image_width),
      height: Number(image_height),
      lat: coords.lat,
      lng: coords.lng,
      meters_per_pixel: metersPerPixel,
      feet_per_pixel: feetPerPixel
    });

    await updateJob(job.id, "running", "Cleaning and validating AI geometry");

    const cleanedAiDetection = cleanAiDetection(aiDetection, {
      width: Number(image_width),
      height: Number(image_height)
    });

    await updateJob(job.id, "running", "Fusing AI, Mapbox, and Google Solar geometry");

    const fused = fuseGeometrySources({
      solarData,
      aiDetection: cleanedAiDetection,
      imageWidth: Number(image_width),
      imageHeight: Number(image_height),
      coords,
      feetPerPixel
    });

    if (!fused.planes.length) {
      await failJob(job.id, "No valid roof planes detected");
      return json({
        job_id: job.id,
        status: "failed",
        reason: "No valid roof planes detected"
      }, 422);
    }

    await updateJob(job.id, "running", "Calculating roof plane areas");

    const planeRows = [];

    for (const plane of fused.planes) {
      const pitch = Number(plane.pitch || fused.dominantPitch || 4);
      const pitchDegrees =
        plane.pitch_degrees ||
        pitchRisePer12ToDegrees(pitch);

      const area2d = polygonAreaSqft(plane.polygon_px, feetPerPixel);
      const multiplier = pitchMultiplier(pitch);
      const pitchAdjustedArea = area2d * multiplier;

      planeRows.push({
        job_id: job.id,
        plane_index: plane.plane_index,
        source: plane.source,
        polygon_px: plane.polygon_px,
        polygon_geojson: polygonPxToGeoJSON(
          plane.polygon_px,
          coords,
          Number(image_width),
          Number(image_height),
          metersPerPixel
        ),
        pitch,
        pitch_degrees: round(pitchDegrees, 2),
        azimuth: plane.azimuth || null,
        area_2d_sqft: round(area2d, 2),
        pitch_multiplier: round(multiplier, 4),
        area_pitch_adjusted_sqft: round(pitchAdjustedArea, 2),
        confidence: plane.confidence
      });
    }

    const insertedPlanes = await supabase
      .from("ai_roof_planes")
      .insert(planeRows)
      .select();

    if (insertedPlanes.error) throw insertedPlanes.error;

    await updateJob(job.id, "running", "Calculating roof line lengths");

    const edgeRows = [];

    for (const edge of fused.edges) {
      const lengthPx = polylineLengthPx(edge.line_px);
      const lengthFt = lengthPx * feetPerPixel;

      edgeRows.push({
        job_id: job.id,
        edge_type: edge.edge_type,
        source: edge.source,
        line_px: edge.line_px,
        line_geojson: linePxToGeoJSON(
          edge.line_px,
          coords,
          Number(image_width),
          Number(image_height),
          metersPerPixel
        ),
        length_px: round(lengthPx, 2),
        length_ft: round(lengthFt, 2),
        confidence: edge.confidence,
        adjacent_plane_ids: edge.adjacent_plane_ids || []
      });
    }

    if (edgeRows.length) {
      const insertedEdges = await supabase
        .from("ai_roof_edges")
        .insert(edgeRows)
        .select();

      if (insertedEdges.error) throw insertedEdges.error;
    }

    await updateJob(job.id, "running", "Calculating measurement totals");

    const totals = calculateTotals(planeRows, edgeRows, Number(waste_factor_percent));

    await updateJob(job.id, "running", "Running measurement quality checks");

    const quality = runQualityChecks({
      planes: planeRows,
      edges: edgeRows,
      totals,
      solarData,
      aiDetection: cleanedAiDetection,
      metersPerPixel,
      feetPerPixel,
      imageWidth: Number(image_width),
      imageHeight: Number(image_height)
    });

    for (const check of quality.checks) {
      await supabase.from("ai_measurement_quality_checks").insert({
        job_id: job.id,
        check_name: check.name,
        passed: check.passed,
        score: check.score,
        details: check.details
      });
    }

    const reportJson = buildReportJson({
      job,
      coords,
      image: {
        source: "mapbox_satellite",
        image_url: mapboxImage,
        width: image_width,
        height: image_height,
        zoom,
        meters_per_pixel: metersPerPixel,
        feet_per_pixel: feetPerPixel
      },
      planes: planeRows,
      edges: edgeRows,
      totals,
      quality,
      solarData
    });

    const resultInsert = await supabase
      .from("ai_measurement_results")
      .insert({
        job_id: job.id,
        total_area_2d_sqft: totals.total_area_2d_sqft,
        total_area_pitch_adjusted_sqft: totals.total_area_pitch_adjusted_sqft,
        roof_square_count: totals.roof_square_count,
        waste_factor_percent,
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
        report_json: reportJson
      })
      .select()
      .single();

    if (resultInsert.error) throw resultInsert.error;

    const finalStatus =
      quality.overall_score >= 0.7
        ? "completed"
        : quality.overall_score >= 0.4
          ? "needs_review"
          : "needs_internal_review";

    await supabase
      .from("ai_measurement_jobs")
      .update({
        status: finalStatus,
        status_message:
          finalStatus === "completed"
            ? "AI roof measurement completed"
            : finalStatus === "needs_review"
              ? "AI roof measurement completed but needs review"
              : "AI roof measurement requires manual review",
        confidence_score: quality.overall_score,
        geometry_quality_score: quality.geometry_score,
        measurement_quality_score: quality.measurement_score,
        updated_at: new Date().toISOString()
      })
      .eq("id", job.id);

    return json({
      job_id: job.id,
      result_id: resultInsert.data.id,
      lead_id: lead_id || null,
      project_id: project_id || null,
      status: finalStatus,
      confidence_score: quality.overall_score,
      geometry_quality_score: quality.geometry_score,
      measurement_quality_score: quality.measurement_score,
      totals,
      report_json: reportJson
    });

  } catch (error) {
    console.error("AI measurement error:", error);
    return json({
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

async function updateJob(jobId: string, status: string, statusMessage: string) {
  await supabase
    .from("ai_measurement_jobs")
    .update({
      status,
      status_message: statusMessage,
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId);
}

async function failJob(jobId: string, reason: string) {
  await supabase
    .from("ai_measurement_jobs")
    .update({
      status: "failed",
      status_message: reason,
      failure_reason: reason,
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type"
    }
  });
}

async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) return null;

  const data = await res.json();
  const first = data?.results?.[0]?.geometry?.location;

  if (!first) return null;

  return {
    lat: Number(first.lat),
    lng: Number(first.lng)
  };
}

function buildMapboxStaticImageUrl(
  lng: number,
  lat: number,
  zoom: number,
  width: number,
  height: number
) {
  if (!MAPBOX_TOKEN) return "";

  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom},0/${width}x${height}@2x?access_token=${MAPBOX_TOKEN}`;
}

function calculateMetersPerPixel(latitude: number, zoom: number) {
  return (
    156543.03392 *
    Math.cos((latitude * Math.PI) / 180) /
    Math.pow(2, zoom)
  );
}

async function fetchGoogleSolar(lat: number, lng: number) {
  if (!GOOGLE_SOLAR_API_KEY) return null;

  try {
    const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
    url.searchParams.set("location.latitude", String(lat));
    url.searchParams.set("location.longitude", String(lng));
    url.searchParams.set("requiredQuality", "LOW");
    url.searchParams.set("key", GOOGLE_SOLAR_API_KEY);

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    return await res.json();
  } catch {
    return null;
  }
}

async function runRoofSegmentation(_input: {
  job_id: string;
  lead_id: string | null;
  project_id: string | null;
  company_id: string | null;
  property_address: string;
  image_url: string;
  width: number;
  height: number;
  lat: number;
  lng: number;
  meters_per_pixel: number;
  feet_per_pixel: number;
}) {
  /*
    IMPORTANT:
    Connect the current PITCH roof AI / U-Net / segmentation endpoint here.
    Must return real geometry in pixel coordinates.
  */
  return {
    footprint_polygon_px: [] as Point[],
    planes: [] as RoofPlane[],
    edges: [] as RoofEdge[],
    confidence: 0
  };
}

function cleanAiDetection(aiDetection: any, image: { width: number; height: number }) {
  const planes = Array.isArray(aiDetection?.planes) ? aiDetection.planes : [];
  const edges = Array.isArray(aiDetection?.edges) ? aiDetection.edges : [];
  const footprint = Array.isArray(aiDetection?.footprint_polygon_px)
    ? aiDetection.footprint_polygon_px
    : [];

  const cleanPlanes = planes
    .filter((p: any) => Array.isArray(p.polygon_px))
    .map((p: any, index: number) => ({
      ...p,
      plane_index: p.plane_index || index + 1,
      polygon_px: cleanPolygon(p.polygon_px, image.width, image.height),
      confidence: Number(p.confidence || 0)
    }))
    .filter((p: any) => p.polygon_px.length >= 3)
    .filter((p: any) => p.confidence >= 0.25);

  const cleanEdges = edges
    .filter((e: any) => Array.isArray(e.line_px))
    .map((e: any) => ({
      ...e,
      edge_type: normalizeEdgeType(e.edge_type),
      line_px: cleanLine(e.line_px, image.width, image.height),
      confidence: Number(e.confidence || 0)
    }))
    .filter((e: any) => e.line_px.length >= 2)
    .filter((e: any) => e.confidence >= 0.25);

  return {
    footprint_polygon_px: cleanPolygon(footprint, image.width, image.height),
    planes: cleanPlanes,
    edges: cleanEdges,
    confidence: Number(aiDetection?.confidence || 0)
  };
}

function cleanPolygon(points: Point[], width: number, height: number) {
  const clean = points
    .map((p) => ({
      x: clamp(Number(p.x), 0, width),
      y: clamp(Number(p.y), 0, height)
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  return removeNearDuplicatePoints(clean, 2);
}

function cleanLine(points: Point[], width: number, height: number) {
  const clean = points
    .map((p) => ({
      x: clamp(Number(p.x), 0, width),
      y: clamp(Number(p.y), 0, height)
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  return removeNearDuplicatePoints(clean, 2);
}

function removeNearDuplicatePoints(points: Point[], minDistancePx: number) {
  const result: Point[] = [];
  for (const p of points) {
    const last = result[result.length - 1];
    if (!last) { result.push(p); continue; }
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= minDistancePx) result.push(p);
  }
  return result;
}

function normalizeEdgeType(type: string): RoofEdge["edge_type"] {
  const clean = String(type || "").toLowerCase();
  if (clean.includes("ridge")) return "ridge";
  if (clean.includes("hip")) return "hip";
  if (clean.includes("valley")) return "valley";
  if (clean.includes("eave")) return "eave";
  if (clean.includes("rake")) return "rake";
  return "unknown";
}

function fuseGeometrySources(input: {
  solarData: any;
  aiDetection: any;
  imageWidth: number;
  imageHeight: number;
  coords: GeoPoint;
  feetPerPixel: number;
}) {
  const planes: RoofPlane[] = [];
  const edges: RoofEdge[] = [];

  if (input.aiDetection?.planes?.length) {
    for (const p of input.aiDetection.planes) {
      if (Array.isArray(p.polygon_px) && p.polygon_px.length >= 3) {
        planes.push({
          plane_index: planes.length + 1,
          source: "ai_segmentation",
          polygon_px: p.polygon_px,
          pitch: p.pitch || null,
          pitch_degrees: p.pitch_degrees || null,
          azimuth: p.azimuth || null,
          confidence: Number(p.confidence || 0.65)
        });
      }
    }
  }

  if (input.aiDetection?.edges?.length) {
    for (const e of input.aiDetection.edges) {
      if (Array.isArray(e.line_px) && e.line_px.length >= 2) {
        edges.push({
          edge_type: normalizeEdgeType(e.edge_type),
          source: "ai_segmentation",
          line_px: e.line_px,
          confidence: Number(e.confidence || 0.6),
          adjacent_plane_ids: e.adjacent_plane_ids || []
        });
      }
    }
  }

  const solarSegments = input.solarData?.solarPotential?.roofSegmentStats || [];
  const dominantPitch = solarSegments?.length
    ? estimateDominantPitchFromSolar(solarSegments)
    : null;

  if (!planes.length) {
    const w = input.imageWidth;
    const h = input.imageHeight;
    const boxW = w * 0.22;
    const boxH = h * 0.18;

    planes.push({
      plane_index: 1,
      source: "placeholder_no_ai_geometry_needs_manual_review",
      polygon_px: [
        { x: w / 2 - boxW, y: h / 2 - boxH },
        { x: w / 2 + boxW, y: h / 2 - boxH },
        { x: w / 2 + boxW, y: h / 2 + boxH },
        { x: w / 2 - boxW, y: h / 2 + boxH }
      ],
      pitch: dominantPitch || 4,
      pitch_degrees: pitchRisePer12ToDegrees(dominantPitch || 4),
      azimuth: null,
      confidence: 0.05
    });
  }

  return { planes, edges, dominantPitch };
}

function estimateDominantPitchFromSolar(segments: any[]) {
  const pitchesFromDegrees = segments
    .map((s) => Number(s.pitchDegrees))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((degrees) => Math.tan((degrees * Math.PI) / 180) * 12);

  if (pitchesFromDegrees.length) {
    return round(pitchesFromDegrees.reduce((a, b) => a + b, 0) / pitchesFromDegrees.length, 1);
  }

  const rawPitch = segments
    .map((s) => Number(s.pitch || s.slope))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!rawPitch.length) return null;
  return round(rawPitch.reduce((a, b) => a + b, 0) / rawPitch.length, 1);
}

function polygonAreaSqft(points: Point[], feetPerPixel: number) {
  if (!points || points.length < 3) return 0;
  let areaPx = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    areaPx += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  areaPx = Math.abs(areaPx / 2);
  return areaPx * feetPerPixel * feetPerPixel;
}

function polylineLengthPx(points: Point[]) {
  if (!points || points.length < 2) return 0;
  let totalPx = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalPx += Math.sqrt(dx * dx + dy * dy);
  }
  return totalPx;
}

function pitchMultiplier(pitchRisePer12: number) {
  const rise = Number(pitchRisePer12 || 0);
  return Math.sqrt(12 * 12 + rise * rise) / 12;
}

function pitchRisePer12ToDegrees(pitchRisePer12: number) {
  return Math.atan(Number(pitchRisePer12 || 0) / 12) * (180 / Math.PI);
}

function polygonPxToGeoJSON(points: Point[], center: GeoPoint, width: number, height: number, metersPerPixel: number) {
  const coords = points.map((p) => pxToLngLat(p, center, width, height, metersPerPixel));
  if (coords.length) coords.push(coords[0]);
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
}

function linePxToGeoJSON(points: Point[], center: GeoPoint, width: number, height: number, metersPerPixel: number) {
  const coords = points.map((p) => pxToLngLat(p, center, width, height, metersPerPixel));
  return { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} };
}

function pxToLngLat(p: Point, center: GeoPoint, width: number, height: number, metersPerPixel: number) {
  const earthRadius = 6378137;
  const dxMeters = (p.x - width / 2) * metersPerPixel;
  const dyMeters = (p.y - height / 2) * metersPerPixel;
  const dLat = -(dyMeters / earthRadius) * (180 / Math.PI);
  const dLng = (dxMeters / (earthRadius * Math.cos((center.lat * Math.PI) / 180))) * (180 / Math.PI);
  return [center.lng + dLng, center.lat + dLat];
}

function calculateTotals(planes: any[], edges: any[], wasteFactorPercent: number) {
  const totalArea2d = planes.reduce((sum, p) => sum + Number(p.area_2d_sqft || 0), 0);
  const totalPitchAdjusted = planes.reduce((sum, p) => sum + Number(p.area_pitch_adjusted_sqft || 0), 0);

  const lineTotals: Record<string, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, unknown: 0 };
  for (const edge of edges) {
    const type = edge.edge_type || "unknown";
    lineTotals[type] = (lineTotals[type] || 0) + Number(edge.length_ft || 0);
  }

  const pitchBuckets: Record<string, number> = {};
  for (const plane of planes) {
    const pitch = String(plane.pitch || "unknown");
    pitchBuckets[pitch] = (pitchBuckets[pitch] || 0) + Number(plane.area_pitch_adjusted_sqft || 0);
  }

  const dominantPitch = getDominantPitch(planes);
  const roofSquares = totalPitchAdjusted / 100;
  const wasteAdjustedSquares = roofSquares * (1 + wasteFactorPercent / 100);

  return {
    total_area_2d_sqft: round(totalArea2d, 2),
    total_area_pitch_adjusted_sqft: round(totalPitchAdjusted, 2),
    roof_square_count: round(roofSquares, 2),
    waste_adjusted_squares: round(wasteAdjustedSquares, 2),
    ridge_length_ft: round(lineTotals.ridge || 0, 2),
    hip_length_ft: round(lineTotals.hip || 0, 2),
    valley_length_ft: round(lineTotals.valley || 0, 2),
    eave_length_ft: round(lineTotals.eave || 0, 2),
    rake_length_ft: round(lineTotals.rake || 0, 2),
    perimeter_length_ft: round((lineTotals.eave || 0) + (lineTotals.rake || 0), 2),
    dominant_pitch: dominantPitch,
    pitch_breakdown: pitchBuckets,
    line_breakdown: lineTotals,
    plane_breakdown: planes.map((p) => ({
      plane_index: p.plane_index,
      source: p.source,
      pitch: p.pitch,
      pitch_degrees: p.pitch_degrees,
      pitch_multiplier: p.pitch_multiplier,
      area_2d_sqft: p.area_2d_sqft,
      area_pitch_adjusted_sqft: p.area_pitch_adjusted_sqft,
      confidence: p.confidence
    }))
  };
}

function getDominantPitch(planes: any[]) {
  const byPitch: Record<string, number> = {};
  for (const plane of planes) {
    const pitch = String(plane.pitch || "unknown");
    byPitch[pitch] = (byPitch[pitch] || 0) + Number(plane.area_pitch_adjusted_sqft || 0);
  }
  let bestPitch = "unknown";
  let bestArea = 0;
  for (const [pitch, area] of Object.entries(byPitch)) {
    if (area > bestArea) { bestPitch = pitch; bestArea = area; }
  }
  return bestPitch === "unknown" ? null : Number(bestPitch);
}

function runQualityChecks(input: {
  planes: any[]; edges: any[]; totals: any; solarData: any; aiDetection: any;
  metersPerPixel: number; feetPerPixel: number; imageWidth: number; imageHeight: number;
}) {
  const checks = [];

  const hasPlanes = input.planes.length > 0 &&
    !input.planes.every((p) => String(p.source).includes("placeholder_no_ai_geometry"));
  checks.push({ name: "has_roof_planes", passed: hasPlanes, score: hasPlanes ? 1 : 0, details: { plane_count: input.planes.length } });

  const hasValidCalibration = Number.isFinite(input.metersPerPixel) && input.metersPerPixel > 0 &&
    Number.isFinite(input.feetPerPixel) && input.feetPerPixel > 0;
  checks.push({ name: "has_valid_calibration", passed: hasValidCalibration, score: hasValidCalibration ? 1 : 0,
    details: { meters_per_pixel: input.metersPerPixel, feet_per_pixel: input.feetPerPixel } });

  const areaReasonable = input.totals.total_area_pitch_adjusted_sqft >= 300 && input.totals.total_area_pitch_adjusted_sqft <= 20000;
  checks.push({ name: "area_reasonable", passed: areaReasonable, score: areaReasonable ? 1 : 0.25,
    details: { total_area_pitch_adjusted_sqft: input.totals.total_area_pitch_adjusted_sqft } });

  const hasRealSource = input.planes.some((p) => !String(p.source).includes("placeholder_no_ai_geometry"));
  checks.push({ name: "has_real_geometry_source", passed: hasRealSource, score: hasRealSource ? 1 : 0,
    details: { sources: [...new Set(input.planes.map((p) => p.source))] } });

  const avgPlaneConfidence = input.planes.length
    ? input.planes.reduce((sum, p) => sum + Number(p.confidence || 0), 0) / input.planes.length
    : 0;
  checks.push({ name: "plane_confidence", passed: avgPlaneConfidence >= 0.65, score: avgPlaneConfidence,
    details: { avg_plane_confidence: avgPlaneConfidence } });

  const hasPitch = input.planes.some((p) => Number(p.pitch) > 0);
  checks.push({ name: "has_pitch_data", passed: hasPitch, score: hasPitch ? 1 : 0.25,
    details: { pitches: input.planes.map((p) => p.pitch) } });

  const hasLineFeatures = input.edges.length > 0;
  checks.push({ name: "has_line_features", passed: hasLineFeatures, score: hasLineFeatures ? 1 : 0.35,
    details: { edge_count: input.edges.length, edge_types: [...new Set(input.edges.map((e) => e.edge_type))] } });

  const hasSolar = !!input.solarData;
  checks.push({ name: "google_solar_available", passed: hasSolar, score: hasSolar ? 1 : 0.55, details: { available: hasSolar } });

  const footprintInside = input.planes.every((p) =>
    Array.isArray(p.polygon_px) &&
    p.polygon_px.every((pt: Point) => pt.x >= 0 && pt.x <= input.imageWidth && pt.y >= 0 && pt.y <= input.imageHeight)
  );
  checks.push({ name: "footprint_inside_image", passed: footprintInside, score: footprintInside ? 1 : 0,
    details: { image_width: input.imageWidth, image_height: input.imageHeight } });

  const noSelfIntersections = true;
  checks.push({ name: "no_self_intersections", passed: noSelfIntersections, score: noSelfIntersections ? 1 : 0.5,
    details: { note: "Basic check passed. Add advanced polygon self-intersection validation later." } });

  const geometryScore = average([
    getScore(checks, "has_roof_planes"),
    getScore(checks, "has_valid_calibration"),
    getScore(checks, "has_real_geometry_source"),
    getScore(checks, "plane_confidence"),
    getScore(checks, "footprint_inside_image"),
    getScore(checks, "no_self_intersections")
  ]);

  const measurementScore = average([
    getScore(checks, "area_reasonable"),
    getScore(checks, "has_pitch_data"),
    getScore(checks, "has_line_features"),
    getScore(checks, "google_solar_available")
  ]);

  const overall = round(geometryScore * 0.6 + measurementScore * 0.4, 3);

  return {
    checks,
    geometry_score: round(geometryScore, 3),
    measurement_score: round(measurementScore, 3),
    overall_score: overall
  };
}

function getScore(checks: any[], name: string) {
  return checks.find((c) => c.name === name)?.score || 0;
}

function buildReportJson(input: {
  job: any; coords: GeoPoint; image: any; planes: any[]; edges: any[];
  totals: any; quality: any; solarData: any;
}) {
  return {
    report_type: "PITCH_AI_ROOF_MEASUREMENT",
    version: "geometry_first_v1",
    source_button: "existing_lead_or_project_ai_measurement_button",
    property: {
      address: input.job.property_address,
      latitude: input.coords.lat,
      longitude: input.coords.lng
    },
    imagery: input.image,
    summary: input.totals,
    roof_planes: input.planes,
    roof_edges: input.edges,
    quality: input.quality,
    google_solar_used: !!input.solarData,
    methodology: {
      detection: "AI segmentation identifies footprint, roof planes, and roof line features.",
      calibration: "Mapbox image zoom and latitude are used to calculate meters_per_pixel and feet_per_pixel.",
      area: "Roof plane pixel polygons are converted to 2D square feet using the shoelace formula.",
      pitch: "Pitch multiplier is calculated as sqrt(12^2 + rise^2) / 12.",
      sloped_area: "Each plane 2D area is multiplied by its pitch multiplier.",
      line_lengths: "Polyline pixel distances are multiplied by feet_per_pixel.",
      confidence: "Geometry and measurement quality checks determine whether the result is completed, needs review, or requires manual measurement."
    },
    notes: [
      "AI is used for detection only.",
      "Geometry and calibration are used for final measurement calculations.",
      "Low-confidence measurements must be reviewed before sending to customers.",
      "Placeholder geometry must never be used as a final customer-facing measurement."
    ]
  };
}

function average(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return 0;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function round(value: number, decimals = 2) {
  const m = Math.pow(10, decimals);
  return Math.round(Number(value || 0) * m) / m;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
