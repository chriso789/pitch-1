// Supabase Edge Function: measure
// Production-ready measurement orchestrator with multi-provider support
// Handles: Regrid (sync), OSM (sync), EagleView/Nearmap/HOVER (async ready)
// Generates vendor-agnostic Smart Tags for estimate templates

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Environment
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
const OSM_ENABLED = true;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Types
type EdgeFeatureType = 'ridge'|'hip'|'valley'|'eave'|'rake'|'step'|'wall'|'unknown';

interface LinearFeature {
  id: string;
  wkt: string;
  length_ft: number;
  type: EdgeFeatureType;
  label?: string;
}

interface RoofFace {
  id: string;
  wkt: string;
  plan_area_sqft: number;
  pitch?: string;
  area_sqft: number;
  linear_features?: LinearFeature[];
}

interface MeasureSummary {
  total_area_sqft: number;
  total_squares: number;
  waste_pct: number;
  pitch_method: 'manual'|'vendor'|'assumed';
}

interface MeasureResult {
  id?: string;
  property_id: string;
  source: string;
  faces: RoofFace[];
  linear_features?: LinearFeature[];
  summary: MeasureSummary;
  created_at?: string;
  geom_wkt?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Geometry utilities
function degToMeters(latDeg: number) {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(latDeg * Math.PI / 180);
  return { metersPerDegLat, metersPerDegLng };
}

function polygonAreaSqftFromLngLat(coords: [number, number][]) {
  if (coords.length < 4) return 0;
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const x1 = lng1 * metersPerDegLng, y1 = lat1 * metersPerDegLat;
    const x2 = lng2 * metersPerDegLng, y2 = lat2 * metersPerDegLat;
    sum += (x1 * y2 - x2 * y1);
  }
  const area_m2 = Math.abs(sum) / 2;
  return area_m2 * 10.7639;
}

function pitchFactor(pitch?: string) {
  if (!pitch || pitch === 'flat') return 1;
  const m = pitch.match(/^(\d+)\/(\d+)$/);
  if (!m) return 1;
  const rise = Number(m[1]), run = Number(m[2] || 12);
  const factor = Math.sqrt(rise * rise + run * run) / run;
  return isFinite(factor) && factor > 0 ? factor : 1;
}

function toPolygonWKT(coords: [number, number][]) {
  const inner = coords.map(c => `${c[0]} ${c[1]}`).join(', ');
  return `POLYGON((${inner}))`;
}

function unionFacesWKT(faces: RoofFace[]): string | undefined {
  if (!faces.length) return undefined;
  const polys = faces.map(f => f.wkt.replace(/^POLYGON/,'')).join(',');
  return `MULTIPOLYGON(${polys})`;
}

// Smart Tags builder
function buildSmartTags(meas: MeasureResult) {
  const tags: Record<string, number|string> = {};
  const sum = meas.summary;
  const faces = meas.faces || [];
  const linear = (meas.linear_features || []).concat(
    ...faces.map(f => f.linear_features || [])
  );

  const total_plan_sqft = faces.reduce((s, f) => s + (f.plan_area_sqft || 0), 0);
  const total_adj_sqft = sum.total_area_sqft;
  const total_squares = sum.total_squares;
  const face_count = faces.length;
  const avg_pitch_factor = faces.length
    ? faces.reduce((s, f) => s + pitchFactor(f.pitch), 0) / faces.length
    : 1;

  const lfBy = (types: EdgeFeatureType[]) =>
    linear.filter(l => types.includes((l.type as EdgeFeatureType) || 'unknown'))
          .reduce((s, l) => s + (l.length_ft || 0), 0);

  tags["roof.plan_sqft"] = round(total_plan_sqft);
  tags["roof.total_sqft"] = round(total_adj_sqft);
  tags["roof.squares"] = round(total_squares, 2);
  tags["roof.faces_count"] = face_count;
  tags["roof.waste_pct"] = sum.waste_pct;
  tags["roof.pitch_factor"] = round(avg_pitch_factor, 3);

  tags["lf.ridge"] = round(lfBy(['ridge']));
  tags["lf.hip"] = round(lfBy(['hip']));
  tags["lf.valley"] = round(lfBy(['valley']));
  tags["lf.eave"] = round(lfBy(['eave']));
  tags["lf.rake"] = round(lfBy(['rake']));
  tags["lf.step"] = round(lfBy(['step']));

  // Derived quantities
  tags["bundles.shingles"] = Math.ceil(total_squares * 3);
  tags["bundles.ridge_cap"] = Math.ceil((tags["lf.ridge"] as number) / 33);
  tags["rolls.valley"] = Math.ceil((tags["lf.valley"] as number) / 50);
  tags["sticks.drip_edge"] = Math.ceil(((tags["lf.eave"] as number) + (tags["lf.rake"] as number)) / 10);

  return tags;
}

function round(n: number, p = 1) {
  return Math.round(n * (10 ** p)) / (10 ** p);
}

// Helper: Convert Google's bounding box to polygon coordinates
function boundingBoxToPolygon(box: any): [number, number][] {
  const { sw, ne } = box;
  return [
    [sw.longitude, sw.latitude],
    [ne.longitude, sw.latitude],
    [ne.longitude, ne.latitude],
    [sw.longitude, ne.latitude],
    [sw.longitude, sw.latitude], // Close the polygon
  ];
}

// Helper: Convert degrees to roof pitch format (18.5° → "4/12")
function degreesToRoofPitch(degrees: number): string {
  if (degrees < 2) return 'flat';
  const rise = Math.round(Math.tan(degrees * Math.PI / 180) * 12);
  return `${rise}/12`;
}

// Helper: Estimate linear features from roof geometry
function estimateLinearFeatures(faces: RoofFace[]): LinearFeature[] {
  const features: LinearFeature[] = [];
  let featureId = 1;

  faces.forEach(face => {
    // Parse WKT to get coordinates
    const coords = face.wkt.match(/[\d.-]+/g)?.map(Number) || [];
    if (coords.length < 8) return; // Need at least 4 points (8 numbers)

    // Calculate perimeter edges
    for (let i = 0; i < coords.length - 2; i += 2) {
      const x1 = coords[i], y1 = coords[i + 1];
      const x2 = coords[i + 2], y2 = coords[i + 3];
      
      const { metersPerDegLat, metersPerDegLng } = degToMeters(y1);
      const dx = (x2 - x1) * metersPerDegLng;
      const dy = (y2 - y1) * metersPerDegLat;
      const length_m = Math.sqrt(dx * dx + dy * dy);
      const length_ft = length_m * 3.28084;

      if (length_ft > 5) { // Only add significant edges
        features.push({
          id: `LF${featureId++}`,
          wkt: `LINESTRING(${x1} ${y1}, ${x2} ${y2})`,
          length_ft,
          type: face.pitch === 'flat' ? 'eave' : 'rake',
          label: `Edge ${featureId - 1}`
        });
      }
    }
  });

  return features;
}

// Provider: Google Solar API (sync, US coverage, actual pitch data)
async function providerGoogleSolar(supabase: any, lat: number, lng: number) {
  if (!GOOGLE_PLACES_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY not configured");

  // Check cache first (within 10m, <90 days old)
  const { data: cached } = await supabase.rpc('nearby_buildings', {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: 10,
    p_max_age_days: 90
  });

  if (cached && cached.length > 0) {
    console.log('Using cached building data from', cached[0].source);
    const building = cached[0];
    
    // Convert cached data to MeasureResult
    const polygon = building.building_polygon;
    const coords: [number, number][] = polygon.coordinates[0];
    const plan_sqft = polygonAreaSqftFromLngLat(coords);
    
    const faces: RoofFace[] = [];
    if (building.roof_segments && building.roof_segments.length > 0) {
      building.roof_segments.forEach((seg: any, idx: number) => {
        const pitch = degreesToRoofPitch(seg.pitchDegrees || 18.5);
        const pf = pitchFactor(pitch);
        const segArea = seg.stats?.areaMeters2 * 10.7639 || (plan_sqft / building.roof_segments.length);
        
        faces.push({
          id: String.fromCharCode(65 + idx),
          wkt: toPolygonWKT(coords),
          plan_area_sqft: segArea / pf,
          pitch,
          area_sqft: segArea
        });
      });
    } else {
      const defaultPitch = '4/12';
      const pf = pitchFactor(defaultPitch);
      faces.push({
        id: 'A',
        wkt: toPolygonWKT(coords),
        plan_area_sqft: plan_sqft,
        pitch: defaultPitch,
        area_sqft: plan_sqft * pf
      });
    }

    const wastePct = 12;
    const totalArea = faces.reduce((s, f) => s + f.area_sqft, 0) * (1 + wastePct / 100);

    return {
      property_id: "",
      source: building.source,
      faces,
      linear_features: estimateLinearFeatures(faces),
      summary: {
        total_area_sqft: totalArea,
        total_squares: totalArea / 100,
        waste_pct: wastePct,
        pitch_method: building.roof_segments ? 'vendor' : 'assumed'
      },
      geom_wkt: unionFacesWKT(faces)
    };
  }

  // Fetch fresh from Google Solar API
  console.log('Fetching fresh data from Google Solar API');
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_PLACES_API_KEY}`;
  
  const resp = await fetch(url);
  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`Google Solar HTTP ${resp.status}: ${error}`);
  }

  const json = await resp.json();
  
  if (!json.boundingBox) {
    throw new Error("No building data from Google Solar");
  }

  // Extract building polygon
  const coords = boundingBoxToPolygon(json.boundingBox);
  const plan_sqft = polygonAreaSqftFromLngLat(coords);
  
  // Process roof segments
  const faces: RoofFace[] = [];
  const roofSegments = json.solarPotential?.roofSegmentStats || [];
  
  if (roofSegments.length > 0) {
    roofSegments.forEach((segment: any, idx: number) => {
      const pitchDeg = segment.pitchDegrees || 18.5;
      const pitch = degreesToRoofPitch(pitchDeg);
      const pf = pitchFactor(pitch);
      const segmentArea = segment.stats?.areaMeters2 * 10.7639 || (plan_sqft / roofSegments.length);
      
      faces.push({
        id: String.fromCharCode(65 + idx), // A, B, C...
        wkt: toPolygonWKT(coords),
        plan_area_sqft: segmentArea / pf,
        pitch,
        area_sqft: segmentArea
      });
    });
  } else {
    // No segment data, use building footprint with assumed pitch
    const defaultPitch = '4/12';
    const pf = pitchFactor(defaultPitch);
    faces.push({
      id: 'A',
      wkt: toPolygonWKT(coords),
      plan_area_sqft: plan_sqft,
      pitch: defaultPitch,
      area_sqft: plan_sqft * pf
    });
  }

  const wastePct = 12;
  const totalArea = faces.reduce((s, f) => s + f.area_sqft, 0) * (1 + wastePct / 100);

  const result: MeasureResult = {
    property_id: "",
    source: 'google_solar',
    faces,
    linear_features: estimateLinearFeatures(faces),
    summary: {
      total_area_sqft: totalArea,
      total_squares: totalArea / 100,
      waste_pct: wastePct,
      pitch_method: roofSegments.length > 0 ? 'vendor' : 'assumed'
    },
    geom_wkt: unionFacesWKT(faces)
  };

  // Cache for future use
  try {
    await supabase.from('building_footprints').insert({
      lat,
      lng,
      geom_geog: `SRID=4326;POLYGON((${coords.map(c => `${c[0]} ${c[1]}`).join(', ')}))`,
      source: 'google_solar',
      building_polygon: {
        type: 'Polygon',
        coordinates: [coords]
      },
      roof_segments: roofSegments.length > 0 ? roofSegments : null,
      imagery_date: json.imageryDate ? new Date(json.imageryDate) : null,
      confidence_score: json.imageryQuality === 'HIGH' ? 0.95 : 0.80
    });
    console.log('Cached building data for future use');
  } catch (cacheError) {
    console.warn('Failed to cache building:', cacheError);
    // Continue even if caching fails
  }

  return result;
}

// Provider: OpenStreetMap (sync, global coverage)
async function providerOSM(lat: number, lng: number) {
  if (!OSM_ENABLED) throw new Error("OSM disabled");
  
  const delta = 0.0005;
  const bbox = `${lat-delta},${lng-delta},${lat+delta},${lng+delta}`;
  const query = `
    [out:json][timeout:15];
    (
      way["building"](${bbox});
      relation["building"](${bbox});
    );
    out body;
    >; out skel qt;
  `.trim();

  const resp = await fetch("https://overpass-api.de/api/interpreter", { 
    method: "POST", 
    body: query 
  });
  
  if (!resp.ok) throw new Error(`OSM HTTP ${resp.status}`);
  const data = await resp.json();

  const nodes: Record<string,{lat:number,lon:number}> = {};
  data.elements.filter((e:any) => e.type === 'node').forEach((n:any) => {
    nodes[n.id] = {lat: n.lat, lon: n.lon};
  });
  
  const way = data.elements.find((e:any) => e.type === 'way' && e.nodes?.length > 3);
  if (!way) throw new Error("No OSM building");

  const coords: [number, number][] = way.nodes.map((id:string) => [nodes[id].lon, nodes[id].lat]);
  if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1]) {
    coords.push(coords[0]);
  }

  const plan_sqft = polygonAreaSqftFromLngLat(coords);
  const defaultPitch = '4/12', wastePct = 12;
  const pf = pitchFactor(defaultPitch);
  const adjusted = plan_sqft * pf * (1 + wastePct/100);

  const face: RoofFace = {
    id: "A",
    wkt: toPolygonWKT(coords),
    plan_area_sqft: plan_sqft,
    pitch: defaultPitch,
    area_sqft: adjusted,
  };

  const result: MeasureResult = {
    property_id: "",
    source: 'osm',
    faces: [face],
    summary: {
      total_area_sqft: adjusted,
      total_squares: adjusted / 100,
      waste_pct: wastePct,
      pitch_method: 'assumed'
    },
    geom_wkt: `MULTIPOLYGON((${toPolygonWKT(coords).replace(/^POLYGON/, '')}))`
  };

  return result;
}

// Persistence helpers
async function persistMeasurement(supabase: any, m: MeasureResult, userId?: string) {
  const { data, error } = await supabase.rpc('insert_measurement', {
    p_property_id: m.property_id,
    p_source: m.source,
    p_faces: m.faces,
    p_linear_features: m.linear_features || [],
    p_summary: m.summary,
    p_created_by: userId || null,
    p_geom_wkt: m.geom_wkt || null
  });

  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return data;
}

async function persistTags(supabase: any, measurementId: string, propertyId: string, tags: Record<string,any>, userId?: string) {
  const { data, error } = await supabase
    .from('measurement_tags')
    .insert({
      measurement_id: measurementId,
      property_id: propertyId,
      tags,
      created_by: userId || null
    })
    .select()
    .single();

  if (error) throw new Error(`Tags insert failed: ${error.message}`);
  return data;
}

// Main router
serve(async (req) => {
  const url = new URL(req.url);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('authorization');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    global: { headers: { Authorization: authHeader || '' } }
  });

  try {
    // Handle body-based routing (for supabase.functions.invoke())
    if (req.method === 'POST') {
      const body = await req.json();
      const { action } = body;
      
      console.log('Measure request:', { action, pathname, body: JSON.stringify(body).substring(0, 200) });

      // Route: action=latest
      if (action === 'latest') {
        const { propertyId } = body;
        if (!propertyId) {
          return json({ ok: false, error: 'propertyId required' }, corsHeaders, 400);
        }
        
        const { data: measurements } = await supabase
          .from('measurements')
          .select('*')
          .eq('property_id', propertyId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1);

        const measurement = measurements?.[0] || null;
        let tags = null;

        if (measurement?.id) {
          const { data: tagRows } = await supabase
            .from('measurement_tags')
            .select('*')
            .eq('measurement_id', measurement.id)
            .order('created_at', { ascending: false })
            .limit(1);
          
          tags = tagRows?.[0]?.tags || null;
          
          // If no tags found in DB, generate them from measurement data
          if (!tags && measurement) {
            tags = buildSmartTags(measurement);
          }
        }

        return json({ ok: true, data: { measurement, tags } }, corsHeaders);
      }

      // Route: action=pull
      if (action === 'pull') {
        const { propertyId, lat, lng, address } = body;

        if (!propertyId) {
          return json({ 
            ok: false, 
            error: 'Missing propertyId',
            details: 'propertyId is required' 
          }, corsHeaders, 400);
        }

        if (!lat || !lng || (lat === 0 && lng === 0)) {
          return json({ 
            ok: false, 
            error: 'Missing coordinates',
            details: 'lat and lng must be provided and non-zero. Verify the property address first.' 
          }, corsHeaders, 400);
        }

        console.log('Pull request:', { propertyId, lat, lng, address });

        // Get user ID
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;

        // Provider chain: Google Solar (primary) → OSM (fallback)
        let meas: MeasureResult | null = null;
        const tryOrder = [
          async () => await providerGoogleSolar(supabase, lat, lng),
          async () => await providerOSM(lat, lng),
        ];

        for (const fn of tryOrder) {
          try {
            const r = await fn();
            meas = { ...r, property_id: propertyId };
            console.log(`Provider success: ${meas.source}`);
            break;
          } catch (err) {
            console.log(`Provider failed: ${err}`);
          }
        }

        if (!meas) {
          return json({ 
            ok: false, 
            error: 'No provider available. Please use manual measurements.' 
          }, corsHeaders, 404);
        }

        // Save measurement
        const row = await persistMeasurement(supabase, meas, userId);
        
        // Generate and save Smart Tags
        const tags = buildSmartTags({ ...meas, id: row.id });
        await persistTags(supabase, row.id, propertyId, tags, userId);

        console.log('Measurement saved:', { id: row.id, source: meas.source, squares: tags['roof.squares'] });

        return json({ 
          ok: true, 
          data: { measurement: row, tags } 
        }, corsHeaders);
      }

      // Route: action=manual
      if (action === 'manual') {
        const { propertyId, faces, linear_features, waste_pct = 12 } = body;

        if (!propertyId || !faces || faces.length === 0) {
          return json({ ok: false, error: 'propertyId and faces required' }, corsHeaders, 400);
        }

        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;

        const total = faces.reduce((s: number, f: any) => s + (f.area_sqft || 0), 0);
        
        const result: MeasureResult = {
          property_id: propertyId,
          source: 'manual',
          faces,
          linear_features: linear_features || [],
          summary: {
            total_area_sqft: total,
            total_squares: total / 100,
            waste_pct,
            pitch_method: 'manual'
          },
          geom_wkt: unionFacesWKT(faces)
        };

        const row = await persistMeasurement(supabase, result, userId);
        const tags = buildSmartTags({ ...result, id: row.id });
        await persistTags(supabase, row.id, propertyId, tags, userId);

        return json({ 
          ok: true, 
          data: { measurement: row, tags } 
        }, corsHeaders);
      }

      // Route: action=manual-verify
      if (action === 'manual-verify') {
        const { propertyId, measurement: manualMeasurement, tags: manualTags } = body;

        if (!propertyId || !manualMeasurement || !manualTags) {
          return json({ ok: false, error: 'propertyId, measurement, and tags required' }, corsHeaders, 400);
        }

        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;

        // Mark as manually verified with high confidence
        const verifiedMeasurement = {
          ...manualMeasurement,
          property_id: propertyId,
          source: manualMeasurement.source === 'manual' ? 'manual' : `${manualMeasurement.source}_verified`,
          confidence: 0.95,
          manually_verified: true,
          verified_by: userId,
          verified_at: new Date().toISOString()
        };

        // Save to database
        const row = await persistMeasurement(supabase, verifiedMeasurement, userId);
        
        // Update tags with verified status
        const updatedTags = {
          ...manualTags,
          'meta.manually_verified': true,
          'meta.verified_by': userId,
          'meta.verified_at': new Date().toISOString()
        };
        
        await persistTags(supabase, row.id, propertyId, updatedTags, userId);

        console.log('Manual verification saved:', { id: row.id, propertyId, userId });

        return json({ 
          ok: true, 
          data: { measurement: row, tags: updatedTags } 
        }, corsHeaders);
      }

      return json({ ok: false, error: 'Invalid action. Use: latest, pull, manual, or manual-verify' }, corsHeaders, 400);
    }

    // Fallback for GET requests (legacy path-based routing)
    if (req.method === 'GET') {
      const latestMatch = pathname.match(/^\/measure\/([^/]+)\/latest$/);
      if (latestMatch) {
        const propertyId = latestMatch[1];
        
        const { data: measurements } = await supabase
          .from('measurements')
          .select('*')
          .eq('property_id', propertyId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1);

        const measurement = measurements?.[0] || null;
        let tags = null;

        if (measurement?.id) {
          const { data: tagRows } = await supabase
            .from('measurement_tags')
            .select('*')
            .eq('measurement_id', measurement.id)
            .order('created_at', { ascending: false })
            .limit(1);
          
          tags = tagRows?.[0]?.tags || null;
          
          // If no tags found in DB, generate them from measurement data
          if (!tags && measurement) {
            tags = buildSmartTags(measurement);
          }
        }

        return json({ ok: true, data: { measurement, tags } }, corsHeaders);
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });

  } catch (err) {
    console.error('Measure error:', err);
    return json({ 
      ok: false, 
      error: err instanceof Error ? err.message : String(err),
      details: err instanceof Error ? err.stack : undefined
    }, corsHeaders, 400);
  }
});

function json(payload: unknown, headers: Record<string,string>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
