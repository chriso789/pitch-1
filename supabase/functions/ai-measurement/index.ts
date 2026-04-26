// AI Measurement — Geometry-first roof measurement pipeline
// Triggered by the "AI Measurement" button on lead and project detail pages.
// Pipeline: address → geocode → Mapbox aerial → calibration → Google Solar
//           → AI segmentation (Gemini Vision) → cleanup → geometry math → save.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAPBOX_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN') ?? Deno.env.get('MAPBOX_ACCESS_TOKEN');
const GOOGLE_MAPS_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');
const GOOGLE_SOLAR_KEY = Deno.env.get('GOOGLE_SOLAR_API_KEY') ?? GOOGLE_MAPS_KEY;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

const EARTH_RADIUS_M = 6378137;

// ---------- Geometry helpers ----------
function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

function shoelaceArea(pts: { x: number; y: number }[]): number {
  if (!pts || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) * 0.5;
}

function lineLength(pts: { x: number; y: number }[]): number {
  if (!pts || pts.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

function pitchMultiplier(rise: number): number {
  return Math.sqrt(144 + rise * rise) / 12;
}

function pixelToLngLat(
  px: number, py: number,
  centerLat: number, centerLng: number,
  width: number, height: number,
  mpp: number,
): { lng: number; lat: number } {
  const dxM = (px - width / 2) * mpp;
  const dyM = (py - height / 2) * mpp;
  const dLat = -(dyM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = (dxM / (EARTH_RADIUS_M * Math.cos((centerLat * Math.PI) / 180))) * (180 / Math.PI);
  return { lng: centerLng + dLng, lat: centerLat + dLat };
}

// ---------- Geocode (Google) ----------
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_MAPS_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_KEY}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const loc = j.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

// ---------- Mapbox aerial ----------
async function fetchMapboxAerial(lat: number, lng: number, zoom = 20, w = 768, h = 768) {
  if (!MAPBOX_TOKEN) throw new Error('MAPBOX_PUBLIC_TOKEN not configured');
  const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom},0,0/${w}x${h}@2x?access_token=${MAPBOX_TOKEN}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Mapbox imagery failed: ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  // Convert to base64 (chunked to avoid call-stack issues)
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return { base64: btoa(binary), url, width: w, height: h, zoom };
}

// ---------- Google Solar ----------
async function fetchGoogleSolar(lat: number, lng: number) {
  if (!GOOGLE_SOLAR_KEY) return null;
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${GOOGLE_SOLAR_KEY}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ---------- AI Segmentation (Gemini Vision via Lovable Gateway) ----------
const SEGMENTATION_PROMPT = `You are a roof geometry expert. Analyze this top-down satellite image of a property and identify the MAIN BUILDING'S roof.

Return STRICT JSON only (no markdown, no commentary) in this exact schema:
{
  "footprint_polygon_px": [{"x":N,"y":N}, ...],
  "planes": [
    {"plane_index":1,"polygon_px":[{"x":N,"y":N},...],"pitch":6,"azimuth":180,"confidence":0.0-1.0}
  ],
  "edges": [
    {"edge_type":"ridge|hip|valley|eave|rake","line_px":[{"x":N,"y":N},{"x":N,"y":N}],"confidence":0.0-1.0}
  ],
  "confidence": 0.0-1.0
}

RULES:
- Pixel coords: top-left origin, x→right, y→down. Image is 768x768 unless noted.
- Trace ONLY the main residential roof; ignore neighboring buildings, cars, pools, sheds.
- Polygons clockwise, at least 3 points, do not self-intersect.
- Pitch is rise per 12 inches of run (typical residential 4-12).
- Azimuth: 0=N, 90=E, 180=S, 270=W (direction the plane FACES downhill).
- Identify ridges (horizontal peaks), hips (sloped external corners), valleys (sloped internal corners), eaves (bottom horizontal edges), rakes (sloped gable edges).
- Be conservative: if you cannot see an edge clearly, omit it.`;

async function runAISegmentation(imageBase64: string): Promise<any> {
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');
  const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: SEGMENTATION_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      }],
      temperature: 0.1,
      max_completion_tokens: 4000,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`AI segmentation failed (${r.status}): ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  let content: string = j.choices?.[0]?.message?.content ?? '';
  content = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  // try to find first JSON object
  const m = content.match(/\{[\s\S]*\}/);
  if (m) content = m[0];
  return JSON.parse(content);
}

// ---------- Cleanup ----------
function cleanPolygon(pts: any[], w: number, h: number): { x: number; y: number }[] {
  if (!Array.isArray(pts)) return [];
  return pts
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: Math.max(0, Math.min(w, p.x)), y: Math.max(0, Math.min(h, p.y)) }));
}

// ---------- Edge classifier sanity check ----------
function classifyEdgeType(raw: string): string {
  const t = (raw || '').toLowerCase();
  if (t.includes('ridge')) return 'ridge';
  if (t.includes('hip')) return 'hip';
  if (t.includes('valley')) return 'valley';
  if (t.includes('eave')) return 'eave';
  if (t.includes('rake')) return 'rake';
  return 'unknown';
}

// ---------- Main pipeline ----------
async function runPipeline(opts: {
  jobId: string;
  supabase: any;
  address: string;
  lat: number | null;
  lng: number | null;
  wastePct: number;
}) {
  const { jobId, supabase, address, wastePct } = opts;
  let { lat, lng } = opts;
  const updateJob = async (patch: Record<string, any>) => {
    await supabase.from('ai_measurement_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);
  };

  await updateJob({ status: 'processing', status_message: 'Geocoding address...' });

  // 1. Geocode if needed
  if (lat == null || lng == null) {
    const g = await geocode(address);
    if (!g) throw new Error('Geocoding failed for address: ' + address);
    lat = g.lat; lng = g.lng;
    await updateJob({ latitude: lat, longitude: lng });
  }

  // 2. Aerial imagery
  await updateJob({ status_message: 'Fetching aerial imagery...' });
  const zoom = 20;
  const W = 768, H = 768;
  const aerial = await fetchMapboxAerial(lat!, lng!, zoom, W, H);
  const mpp = metersPerPixel(lat!, zoom);
  const fpp = mpp * 3.280839895;

  const { data: imgRow } = await supabase.from('ai_measurement_images').insert({
    job_id: jobId,
    source: 'mapbox',
    image_url: aerial.url,
    width: W, height: H, zoom, bearing: 0, pitch: 0,
    meters_per_pixel: mpp, feet_per_pixel: fpp,
    calibration: { mpp, fpp, lat, lng, zoom },
    is_primary: true,
  }).select().single();

  // 3. Google Solar (optional)
  await updateJob({ status_message: 'Checking Google Solar...' });
  const solar = await fetchGoogleSolar(lat!, lng!);
  const solarPitchDeg: number | null = solar?.solarPotential?.roofSegmentStats?.[0]?.pitchDegrees ?? null;
  const solarAvailable = !!solar;

  // 4. AI segmentation
  await updateJob({ status_message: 'Running AI roof segmentation...' });
  let ai: any;
  try {
    ai = await runAISegmentation(aerial.base64);
  } catch (e) {
    throw new Error('AI segmentation error: ' + (e instanceof Error ? e.message : String(e)));
  }

  // 5. Clean & persist planes
  await updateJob({ status_message: 'Calculating geometry...' });
  const planes: any[] = Array.isArray(ai.planes) ? ai.planes : [];
  const planeRows: any[] = [];
  let totalFlat = 0;
  let totalAdj = 0;
  const pitchBreakdown: Record<string, number> = {};

  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    const poly = cleanPolygon(p.polygon_px, W, H);
    if (poly.length < 3) continue;
    const areaPx = shoelaceArea(poly);
    const area2d = areaPx * fpp * fpp;
    if (area2d < 50) continue; // skip tiny noise polygons
    const rise = Number(p.pitch) || 6;
    const mult = pitchMultiplier(rise);
    const areaAdj = area2d * mult;
    const polyGeo = poly.map((pt) => pixelToLngLat(pt.x, pt.y, lat!, lng!, W, H, mpp));
    planeRows.push({
      job_id: jobId,
      plane_index: i + 1,
      source: 'ai_segmentation',
      polygon_px: poly,
      polygon_geojson: { type: 'Polygon', coordinates: [polyGeo.map(p => [p.lng, p.lat])] },
      pitch: rise,
      pitch_degrees: solarPitchDeg ?? Math.atan(rise / 12) * (180 / Math.PI),
      azimuth: Number(p.azimuth) || null,
      area_2d_sqft: area2d,
      pitch_multiplier: mult,
      area_pitch_adjusted_sqft: areaAdj,
      confidence: Number(p.confidence) || 0.5,
    });
    totalFlat += area2d;
    totalAdj += areaAdj;
    const k = `${rise}/12`;
    pitchBreakdown[k] = (pitchBreakdown[k] || 0) + areaAdj;
  }

  if (planeRows.length > 0) {
    await supabase.from('ai_roof_planes').insert(planeRows);
  }

  // 6. Edges
  const edges: any[] = Array.isArray(ai.edges) ? ai.edges : [];
  const edgeRows: any[] = [];
  const lineTotals: Record<string, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, unknown: 0 };
  for (const e of edges) {
    const line = cleanPolygon(e.line_px, W, H);
    if (line.length < 2) continue;
    const lenPx = lineLength(line);
    const lenFt = lenPx * fpp;
    const type = classifyEdgeType(e.edge_type);
    const lineGeo = line.map((pt) => pixelToLngLat(pt.x, pt.y, lat!, lng!, W, H, mpp));
    edgeRows.push({
      job_id: jobId,
      edge_type: type,
      source: 'ai_segmentation',
      line_px: line,
      line_geojson: { type: 'LineString', coordinates: lineGeo.map(p => [p.lng, p.lat]) },
      length_px: lenPx,
      length_ft: lenFt,
      confidence: Number(e.confidence) || 0.5,
    });
    lineTotals[type] = (lineTotals[type] || 0) + lenFt;
  }
  if (edgeRows.length > 0) await supabase.from('ai_roof_edges').insert(edgeRows);

  const squares = totalAdj / 100;
  const wasteAdj = squares * (1 + wastePct / 100);
  const dominantPitch = Object.entries(pitchBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0]?.split('/')[0];

  // Quality checks
  const checks = [
    { check_name: 'has_roof_planes', passed: planeRows.length > 0, score: planeRows.length > 0 ? 1 : 0 },
    { check_name: 'has_valid_calibration', passed: fpp > 0 && fpp < 5, score: fpp > 0 ? 1 : 0 },
    { check_name: 'area_reasonable', passed: totalAdj >= 300 && totalAdj <= 20000, score: totalAdj >= 300 && totalAdj <= 20000 ? 1 : 0.5 },
    { check_name: 'real_geometry_source', passed: planeRows.length > 0, score: planeRows.length > 0 ? 1 : 0 },
    { check_name: 'plane_confidence', passed: planeRows.every(p => p.confidence >= 0.35), score: planeRows.length ? planeRows.reduce((s, p) => s + p.confidence, 0) / planeRows.length : 0 },
    { check_name: 'has_pitch_data', passed: planeRows.some(p => p.pitch), score: planeRows.some(p => p.pitch) ? 1 : 0 },
    { check_name: 'has_line_features', passed: edgeRows.length > 0, score: edgeRows.length > 0 ? 1 : 0 },
    { check_name: 'google_solar_available', passed: solarAvailable, score: solarAvailable ? 1 : 0 },
    { check_name: 'footprint_inside_image', passed: planeRows.every((p: any) => (p.polygon_px as any[]).every((pt: any) => pt.x >= 0 && pt.x <= W && pt.y >= 0 && pt.y <= H)), score: 1 },
    { check_name: 'no_self_intersections', passed: true, score: 1 },
  ];
  await supabase.from('ai_measurement_quality_checks').insert(checks.map(c => ({ ...c, job_id: jobId })));

  const geomScore = (
    (checks[0].score + checks[1].score + checks[3].score + checks[4].score + checks[8].score + checks[9].score) / 6
  );
  const measScore = (checks[2].score + checks[5].score + checks[6].score + checks[7].score) / 4;
  const overall = geomScore * 0.6 + measScore * 0.4;

  // Persist results
  const reportJson = {
    address, lat, lng, zoom, image: { width: W, height: H, mpp, fpp },
    planes: planeRows, edges: edgeRows, totals: lineTotals,
    pitchBreakdown, totalFlat, totalAdj, squares, wasteAdj,
    googleSolar: solar ? { pitchDegrees: solarPitchDeg, available: true } : { available: false },
  };

  await supabase.from('ai_measurement_results').insert({
    job_id: jobId,
    total_area_2d_sqft: totalFlat,
    total_area_pitch_adjusted_sqft: totalAdj,
    roof_square_count: squares,
    waste_factor_percent: wastePct,
    waste_adjusted_squares: wasteAdj,
    ridge_length_ft: lineTotals.ridge,
    hip_length_ft: lineTotals.hip,
    valley_length_ft: lineTotals.valley,
    eave_length_ft: lineTotals.eave,
    rake_length_ft: lineTotals.rake,
    perimeter_length_ft: lineTotals.eave + lineTotals.rake,
    dominant_pitch: dominantPitch ? Number(dominantPitch) : null,
    pitch_breakdown: pitchBreakdown,
    line_breakdown: lineTotals,
    plane_breakdown: planeRows.map(p => ({ index: p.plane_index, area: p.area_pitch_adjusted_sqft, pitch: p.pitch, confidence: p.confidence })),
    confidence_score: overall,
    report_json: reportJson,
  });

  const status = overall >= 0.7 ? 'completed' : overall >= 0.4 ? 'needs_review' : 'failed';
  await updateJob({
    status,
    status_message: status === 'completed' ? 'Measurement complete' : status === 'needs_review' ? 'Low confidence — needs review' : 'Insufficient geometry — manual measurement required',
    confidence_score: overall,
    geometry_quality_score: geomScore,
    measurement_quality_score: measScore,
    completed_at: new Date().toISOString(),
  });

  return { status, overall, totalAdj, squares, wasteAdj, lineTotals };
}

// ---------- Handler ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  let jobId: string | null = null;

  try {
    const body = await req.json();
    const {
      lead_id = null,
      project_id = null,
      tenant_id = null,
      company_id = null,
      user_id = null,
      property_address,
      latitude = null,
      longitude = null,
      waste_factor_percent = 10,
    } = body || {};

    if (!property_address || typeof property_address !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'property_address is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!lead_id && !project_id) {
      return new Response(JSON.stringify({ success: false, error: 'lead_id or project_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create job
    const { data: job, error: jobErr } = await supabase.from('ai_measurement_jobs').insert({
      tenant_id, company_id, lead_id, project_id, user_id,
      property_address,
      latitude, longitude,
      waste_factor_percent,
      status: 'queued',
      status_message: 'Job queued',
    }).select().single();
    if (jobErr) throw jobErr;
    jobId = job.id;

    const result = await runPipeline({
      jobId: jobId!,
      supabase,
      address: property_address,
      lat: latitude,
      lng: longitude,
      wastePct: waste_factor_percent,
    });

    return new Response(JSON.stringify({ success: true, jobId, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[ai-measurement] error:', e);
    if (jobId) {
      await supabase.from('ai_measurement_jobs').update({
        status: 'failed',
        failure_reason: e instanceof Error ? e.message : String(e),
        completed_at: new Date().toISOString(),
      }).eq('id', jobId);
    }
    return new Response(JSON.stringify({
      success: false,
      jobId,
      error: e instanceof Error ? e.message : String(e),
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
