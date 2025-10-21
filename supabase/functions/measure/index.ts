// Supabase Edge Function: measure
// Production-ready measurement orchestrator with multi-provider support
// Handles: Regrid (sync), OSM (sync), EagleView/Nearmap/HOVER (async ready)
// Generates vendor-agnostic Smart Tags for estimate templates

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Environment
const REGRID_API_KEY = Deno.env.get("REGRID_API_KEY") || "";
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

// Provider: Regrid (sync, US coverage)
async function providerRegrid(lat: number, lng: number) {
  if (!REGRID_API_KEY) throw new Error("REGRID_API_KEY not configured");
  
  const url = `https://app.regrid.com/api/v1/parcels/near?lat=${lat}&lng=${lng}&limit=1&include_buildings=true`;
  const resp = await fetch(url, { 
    headers: { Authorization: `Token ${REGRID_API_KEY}` }
  });
  
  if (!resp.ok) throw new Error(`Regrid HTTP ${resp.status}`);
  const json = await resp.json();
  const bldg = json?.results?.[0]?.buildings?.[0];
  if (!bldg?.geometry?.coordinates?.[0]) throw new Error("No building polygon");

  const coords: [number, number][] = bldg.geometry.coordinates[0].map((c: number[]) => [c[0], c[1]]);
  if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1]) {
    coords.push(coords[0]);
  }
  
  const plan_sqft = polygonAreaSqftFromLngLat(coords);
  const defaultPitch = '4/12';
  const pf = pitchFactor(defaultPitch);
  const wastePct = 12;
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
    source: 'regrid',
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
    // GET /measure/:propertyId/latest
    const latestMatch = pathname.match(/^\/measure\/([^/]+)\/latest$/);
    if (req.method === 'GET' && latestMatch) {
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
      }

      return json({ ok: true, data: { measurement, tags } }, corsHeaders);
    }

    // POST /measure/pull (auto-pull with provider chain)
    if (req.method === 'POST' && pathname === '/measure/pull') {
      const body = await req.json();
      const { propertyId, lat, lng } = body;

      if (!propertyId || !lat || !lng) {
        throw new Error('propertyId, lat, and lng required');
      }

      // Get user ID
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      // Provider chain (sync-capable today)
      let meas: MeasureResult | null = null;
      const tryOrder = [
        async () => await providerRegrid(lat, lng),
        async () => await providerOSM(lat, lng),
      ];

      for (const fn of tryOrder) {
        try {
          const r = await fn();
          meas = { ...r, property_id: propertyId };
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

      return json({ 
        ok: true, 
        data: { measurement: row, tags } 
      }, corsHeaders);
    }

    // POST /measure/manual (save manual measurements)
    if (req.method === 'POST' && pathname === '/measure/manual') {
      const body = await req.json();
      const { propertyId, faces, linear_features, waste_pct = 12 } = body;

      if (!propertyId || !faces || faces.length === 0) {
        throw new Error('propertyId and faces required');
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

    return new Response('Not found', { status: 404, headers: corsHeaders });

  } catch (err) {
    console.error('Measure error:', err);
    return json({ 
      ok: false, 
      error: err instanceof Error ? err.message : String(err) 
    }, corsHeaders, 400);
  }
});

function json(payload: unknown, headers: Record<string,string>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
