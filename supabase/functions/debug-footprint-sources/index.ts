// Debug Footprint Sources Edge Function
// Diagnoses Mapbox, Regrid, and OSM footprint extraction for a given coordinate
// Returns detailed diagnostics for troubleshooting

import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const MAPBOX_PUBLIC_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN')!
const REGRID_API_KEY = Deno.env.get('REGRID_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface FootprintDiagnostics {
  mapbox: {
    attempted: boolean;
    success: boolean;
    status?: number;
    error?: string;
    fallbackReason?: string;
    featureCount?: number;
    geometryTypes?: Record<string, number>;
    polygonCount?: number;
    selectedPolygon?: {
      vertexCount: number;
      areaM2: number;
      areaSqft: number;
      containsPoint: boolean;
      distance: number;
      confidence: number;
    };
    rawResponsePreview?: string;
  };
  regrid: {
    attempted: boolean;
    success: boolean;
    status?: number;
    error?: string;
    hasApiKey: boolean;
    vertexCount?: number;
    buildingArea?: number;
    confidence?: number;
    parcelId?: string;
  };
  osm: {
    attempted: boolean;
    success: boolean;
    error?: string;
    buildingsFound?: number;
    selectedBuilding?: {
      vertexCount: number;
      areaSqft: number;
      containsPoint: boolean;
    };
  };
  recommendation: string;
  bestSource: string | null;
  coordinates: { lat: number; lng: number };
  timestamp: string;
}

// Point in polygon test
function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    if (((yi > point[1]) !== (yj > point[1])) &&
        (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

// Calculate polygon area in square meters
function calculatePolygonAreaM2(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  
  let sum = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const x1 = coords[i][0] * metersPerDegLng;
    const y1 = coords[i][1] * metersPerDegLat;
    const x2 = coords[j][0] * metersPerDegLng;
    const y2 = coords[j][1] * metersPerDegLat;
    sum += (x1 * y2 - x2 * y1);
  }
  
  return Math.abs(sum) / 2;
}

// Test Mapbox Tilequery
async function testMapbox(lat: number, lng: number): Promise<FootprintDiagnostics['mapbox']> {
  const result: FootprintDiagnostics['mapbox'] = {
    attempted: true,
    success: false,
  };
  
  if (!MAPBOX_PUBLIC_TOKEN) {
    result.error = 'MAPBOX_PUBLIC_TOKEN not configured';
    return result;
  }
  
  try {
    const tileset = 'mapbox.mapbox-streets-v8';
    const layers = 'building';
    const radius = 50;
    
    const url = `https://api.mapbox.com/v4/${tileset}/tilequery/${lng},${lat}.json?radius=${radius}&layers=${layers}&limit=25&access_token=${MAPBOX_PUBLIC_TOKEN}`;
    
    console.log(`🗺️ Mapbox request: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    
    const response = await fetch(url);
    result.status = response.status;
    
    if (!response.ok) {
      const errorText = await response.text();
      result.error = `API error: ${response.status} - ${errorText.substring(0, 200)}`;
      return result;
    }
    
    const data = await response.json();
    result.featureCount = data.features?.length || 0;
    
    if (!data.features || data.features.length === 0) {
      result.fallbackReason = 'no_buildings_found';
      return result;
    }
    
    // Analyze geometry types
    const geomTypes: Record<string, number> = {};
    data.features.forEach((f: any) => {
      const gtype = f.geometry?.type || 'unknown';
      geomTypes[gtype] = (geomTypes[gtype] || 0) + 1;
    });
    result.geometryTypes = geomTypes;
    
    // Extract polygons
    type Candidate = {
      ring: [number, number][];
      distance: number;
      containsPoint: boolean;
      areaM2: number;
    };
    
    const candidates: Candidate[] = [];
    const targetPoint: [number, number] = [lng, lat];
    
    for (const feature of data.features) {
      const geom = feature.geometry;
      const distance = feature.properties?.tilequery?.distance || 0;
      
      if (geom?.type === 'Polygon' && geom.coordinates?.[0]?.length >= 4) {
        const ring = geom.coordinates[0] as [number, number][];
        candidates.push({
          ring,
          distance,
          containsPoint: pointInPolygon(targetPoint, ring),
          areaM2: calculatePolygonAreaM2(ring),
        });
      } else if (geom?.type === 'MultiPolygon' && geom.coordinates?.length > 0) {
        for (const polygonCoords of geom.coordinates) {
          if (polygonCoords?.[0]?.length >= 4) {
            const ring = polygonCoords[0] as [number, number][];
            candidates.push({
              ring,
              distance,
              containsPoint: pointInPolygon(targetPoint, ring),
              areaM2: calculatePolygonAreaM2(ring),
            });
          }
        }
      }
    }
    
    result.polygonCount = candidates.length;
    
    if (candidates.length === 0) {
      result.fallbackReason = 'no_polygon_buildings';
      return result;
    }
    
    // Sort and pick best
    candidates.sort((a, b) => {
      if (a.containsPoint !== b.containsPoint) return a.containsPoint ? -1 : 1;
      if (Math.abs(a.distance - b.distance) > 5) return a.distance - b.distance;
      const aResidential = a.areaM2 >= 100 && a.areaM2 <= 500;
      const bResidential = b.areaM2 >= 100 && b.areaM2 <= 500;
      if (aResidential !== bResidential) return aResidential ? -1 : 1;
      return 0;
    });
    
    const best = candidates[0];
    
    let confidence = 0.92;
    if (!best.containsPoint) confidence -= 0.1;
    if (best.distance > 10) confidence -= 0.05;
    if (best.distance > 20) confidence -= 0.1;
    if (best.areaM2 < 50) confidence -= 0.15;
    if (best.areaM2 > 2000) confidence -= 0.05;
    confidence = Math.max(0.5, Math.min(0.98, confidence));
    
    result.selectedPolygon = {
      vertexCount: best.ring.length,
      areaM2: Math.round(best.areaM2),
      areaSqft: Math.round(best.areaM2 * 10.764),
      containsPoint: best.containsPoint,
      distance: Math.round(best.distance * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
    };
    
    result.success = true;
    
  } catch (err) {
    result.error = String(err);
  }
  
  return result;
}

// Test Regrid API
async function testRegrid(lat: number, lng: number): Promise<FootprintDiagnostics['regrid']> {
  const result: FootprintDiagnostics['regrid'] = {
    attempted: true,
    success: false,
    hasApiKey: !!REGRID_API_KEY,
  };
  
  if (!REGRID_API_KEY) {
    result.error = 'REGRID_API_KEY not configured';
    return result;
  }
  
  try {
    const url = `https://app.regrid.com/api/v2/parcels/point.json?lat=${lat}&lon=${lng}&token=${REGRID_API_KEY}`;
    
    console.log(`🏠 Regrid request: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    
    const response = await fetch(url);
    result.status = response.status;
    
    if (!response.ok) {
      const errorText = await response.text();
      result.error = `API error: ${response.status} - ${errorText.substring(0, 200)}`;
      return result;
    }
    
    const data = await response.json();
    
    if (!data.parcels || data.parcels.length === 0) {
      result.error = 'No parcels found at location';
      return result;
    }
    
    const parcel = data.parcels[0];
    result.parcelId = parcel.properties?.ll_uuid || parcel.id;
    
    // Check for building geometry
    const geom = parcel.geometry;
    if (!geom || !geom.coordinates) {
      result.error = 'Parcel has no geometry';
      return result;
    }
    
    let vertices: [number, number][] = [];
    
    if (geom.type === 'Polygon' && geom.coordinates[0]) {
      vertices = geom.coordinates[0];
    } else if (geom.type === 'MultiPolygon' && geom.coordinates[0]?.[0]) {
      vertices = geom.coordinates[0][0];
    }
    
    if (vertices.length < 4) {
      result.error = `Insufficient vertices: ${vertices.length}`;
      return result;
    }
    
    result.vertexCount = vertices.length;
    const areaM2 = calculatePolygonAreaM2(vertices);
    result.buildingArea = Math.round(areaM2 * 10.764);
    result.confidence = 0.85;
    result.success = true;
    
  } catch (err) {
    result.error = String(err);
  }
  
  return result;
}

// Test OpenStreetMap Overpass API
async function testOSM(lat: number, lng: number): Promise<FootprintDiagnostics['osm']> {
  const result: FootprintDiagnostics['osm'] = {
    attempted: true,
    success: false,
  };
  
  try {
    // Query buildings within 50m radius
    const radius = 50;
    const query = `
      [out:json][timeout:10];
      (
        way["building"](around:${radius},${lat},${lng});
        relation["building"](around:${radius},${lat},${lng});
      );
      out geom;
    `;
    
    console.log(`🌍 OSM Overpass request: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    
    if (!response.ok) {
      result.error = `Overpass API error: ${response.status}`;
      return result;
    }
    
    const data = await response.json();
    const elements = data.elements || [];
    
    result.buildingsFound = elements.length;
    
    if (elements.length === 0) {
      result.error = 'No buildings found in OSM';
      return result;
    }
    
    // Find building containing point or nearest
    const targetPoint: [number, number] = [lng, lat];
    let bestBuilding: { vertices: [number, number][]; containsPoint: boolean; area: number } | null = null;
    
    for (const element of elements) {
      if (!element.geometry || element.geometry.length < 4) continue;
      
      const vertices: [number, number][] = element.geometry.map((g: any) => [g.lon, g.lat]);
      const containsPoint = pointInPolygon(targetPoint, vertices);
      const area = calculatePolygonAreaM2(vertices);
      
      // Prefer building containing point, then largest residential-sized
      if (!bestBuilding || 
          (containsPoint && !bestBuilding.containsPoint) ||
          (containsPoint === bestBuilding.containsPoint && area > bestBuilding.area && area < 1000)) {
        bestBuilding = { vertices, containsPoint, area };
      }
    }
    
    if (bestBuilding && bestBuilding.vertices.length >= 4) {
      result.selectedBuilding = {
        vertexCount: bestBuilding.vertices.length,
        areaSqft: Math.round(bestBuilding.area * 10.764),
        containsPoint: bestBuilding.containsPoint,
      };
      result.success = true;
    } else {
      result.error = 'No valid building geometry found';
    }
    
  } catch (err) {
    result.error = String(err);
  }
  
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { lat, lng } = await req.json();
    
    if (!lat || !lng) {
      return new Response(JSON.stringify({ error: 'lat and lng required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log(`🔍 Debugging footprint sources for ${lat}, ${lng}`);
    
    // Run all tests in parallel
    const [mapbox, regrid, osm] = await Promise.all([
      testMapbox(lat, lng),
      testRegrid(lat, lng),
      testOSM(lat, lng),
    ]);
    
    // Determine best source and recommendation
    let bestSource: string | null = null;
    let recommendation = '';
    
    if (mapbox.success && mapbox.selectedPolygon && mapbox.selectedPolygon.vertexCount > 4) {
      bestSource = 'mapbox';
      recommendation = `✅ Mapbox has good footprint with ${mapbox.selectedPolygon.vertexCount} vertices`;
    } else if (regrid.success && regrid.vertexCount && regrid.vertexCount > 4) {
      bestSource = 'regrid';
      recommendation = `✅ Regrid has footprint with ${regrid.vertexCount} vertices`;
    } else if (osm.success && osm.selectedBuilding) {
      bestSource = 'osm';
      recommendation = `✅ OSM has building with ${osm.selectedBuilding.vertexCount} vertices`;
    } else if (mapbox.success && mapbox.selectedPolygon?.vertexCount === 4) {
      bestSource = 'mapbox';
      recommendation = `⚠️ Only rectangular footprint available (4 vertices) from Mapbox`;
    } else {
      recommendation = `❌ No footprint sources available. Errors: Mapbox: ${mapbox.error || mapbox.fallbackReason}, Regrid: ${regrid.error}, OSM: ${osm.error}`;
    }
    
    const diagnostics: FootprintDiagnostics = {
      mapbox,
      regrid,
      osm,
      recommendation,
      bestSource,
      coordinates: { lat, lng },
      timestamp: new Date().toISOString(),
    };
    
    console.log(`📊 Diagnostics complete. Best source: ${bestSource || 'none'}`);
    
    return new Response(JSON.stringify(diagnostics), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (err) {
    console.error('❌ Debug function error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
