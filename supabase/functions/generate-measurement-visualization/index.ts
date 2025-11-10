// Supabase Edge Function: generate-measurement-visualization
// Generates Mapbox static satellite images with measurement overlays

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAPBOX_TOKEN = Deno.env.get("MAPBOX_PUBLIC_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Point {
  x: number;
  y: number;
}

interface RoofFace {
  id: string;
  wkt: string;
  area_sqft: number;
  pitch?: string;
}

interface LinearFeature {
  id: string;
  wkt: string;
  length_ft: number;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'step' | 'wall' | 'unknown';
}

interface MeasurementData {
  id: string;
  property_id: string;
  faces?: RoofFace[];
  linear_features?: LinearFeature[];
  center_lat?: number;
  center_lng?: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();
    const { measurement_id, property_id, measurement, center_lat, center_lng } = body;

    if (!MAPBOX_TOKEN) {
      console.error('MAPBOX_PUBLIC_TOKEN not configured');
      return json({ ok: false, error: 'Mapbox token not configured' }, corsHeaders, 400);
    }

    if (!measurement_id && !measurement) {
      return json({ ok: false, error: 'measurement_id or measurement data required' }, corsHeaders, 400);
    }

    // Load measurement data if only ID provided
    let measurementData: MeasurementData;
    if (measurement) {
      measurementData = measurement;
    } else {
      const { data, error } = await supabase
        .from('measurements')
        .select('*')
        .eq('id', measurement_id)
        .single();

      if (error || !data) {
        return json({ ok: false, error: 'Measurement not found' }, corsHeaders, 404);
      }
      measurementData = data;
    }

    // Get coordinates
    const lat = center_lat || measurementData.center_lat;
    const lng = center_lng || measurementData.center_lng;

    if (!lat || !lng) {
      return json({ ok: false, error: 'Coordinates required' }, corsHeaders, 400);
    }

    // Build GeoJSON overlay
    const geojson = buildGeoJSONOverlay(measurementData);
    
    if (!geojson.features.length) {
      console.warn('No features to visualize');
      return json({ ok: false, error: 'No measurement features to visualize' }, corsHeaders, 400);
    }

    // Calculate bounds and optimal zoom
    const bounds = calculateBounds(geojson);
    const zoom = calculateOptimalZoom(bounds, 1280, 960);

    // Build Mapbox Static Images API URL
    const width = 1280;
    const height = 960;
    const retina = '@2x';
    
    // Encode GeoJSON for URL
    const encodedGeoJSON = encodeURIComponent(JSON.stringify(geojson));
    
    const mapboxUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/geojson(${encodedGeoJSON})/${lng},${lat},${zoom},0,0/${width}x${height}${retina}?access_token=${MAPBOX_TOKEN}`;

    console.log('Fetching Mapbox static image:', { lat, lng, zoom, features: geojson.features.length });

    // Fetch static image
    const imageResponse = await fetch(mapboxUrl);
    
    if (!imageResponse.ok) {
      const errorText = await imageResponse.text();
      console.error('Mapbox API error:', errorText);
      return json({ ok: false, error: 'Failed to generate visualization from Mapbox' }, corsHeaders, 500);
    }

    const imageBlob = await imageResponse.blob();
    const imageArrayBuffer = await imageBlob.arrayBuffer();
    const imageBuffer = new Uint8Array(imageArrayBuffer);

    // Upload to Supabase Storage
    const fileName = `${property_id || measurementData.property_id}/${measurementData.id || measurement_id}.png`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('measurement-visualizations')
      .upload(fileName, imageBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return json({ ok: false, error: 'Failed to upload visualization' }, corsHeaders, 500);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('measurement-visualizations')
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    // Update measurements table
    const metadata = {
      bounds,
      zoom,
      dimensions: { width, height },
      center: { lat, lng },
      feature_count: geojson.features.length,
      generated_at: new Date().toISOString(),
    };

    const updatePayload: any = {
      mapbox_visualization_url: publicUrl,
      visualization_metadata: metadata,
      visualization_generated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('measurements')
      .update(updatePayload)
      .eq('id', measurementData.id || measurement_id);

    if (updateError) {
      console.error('Failed to update measurement with visualization URL:', updateError);
      // Don't fail the request, just log the error
    }

    console.log('Visualization generated successfully:', { 
      id: measurementData.id || measurement_id, 
      url: publicUrl 
    });

    return json({
      ok: true,
      data: {
        visualization_url: publicUrl,
        metadata,
      }
    }, corsHeaders);

  } catch (err) {
    console.error('Visualization generation error:', err);
    return json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, corsHeaders, 500);
  }
});

// Build GeoJSON overlay from measurement data
function buildGeoJSONOverlay(measurement: MeasurementData) {
  const features: any[] = [];

  // Add roof polygons (faces)
  if (measurement.faces && measurement.faces.length > 0) {
    measurement.faces.forEach((face, index) => {
      const coords = wktToCoordinates(face.wkt);
      if (coords && coords.length >= 3) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [coords],
          },
          properties: {
            fill: '#64c8ff',
            'fill-opacity': 0.4,
            stroke: '#007cbf',
            'stroke-width': 2,
            'stroke-opacity': 0.9,
          },
        });
      }
    });
  }

  // Add linear features (ridges, hips, valleys)
  if (measurement.linear_features && measurement.linear_features.length > 0) {
    measurement.linear_features.forEach((feature) => {
      const coords = lineWktToCoordinates(feature.wkt);
      if (coords && coords.length >= 2) {
        const color = getFeatureColor(feature.type);
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
          properties: {
            stroke: color,
            'stroke-width': 3,
            'stroke-opacity': 0.9,
          },
        });
      }
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

// Convert WKT POLYGON to coordinates array
function wktToCoordinates(wkt: string): [number, number][] | null {
  const match = wkt.match(/POLYGON\(\(([^)]+)\)\)/);
  if (!match) return null;

  return match[1]
    .split(',')
    .map(pair => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return [lng, lat] as [number, number];
    })
    .filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
}

// Convert WKT LINESTRING to coordinates array
function lineWktToCoordinates(wkt: string): [number, number][] | null {
  const match = wkt.match(/LINESTRING\(([^)]+)\)/);
  if (!match) return null;

  return match[1]
    .split(',')
    .map(pair => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return [lng, lat] as [number, number];
    })
    .filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
}

// Get color for feature type
function getFeatureColor(type: string): string {
  const colors: Record<string, string> = {
    ridge: '#22c55e',  // green
    hip: '#3b82f6',    // blue
    valley: '#ef4444', // red
    eave: '#f59e0b',   // amber
    rake: '#8b5cf6',   // purple
    step: '#ec4899',   // pink
  };
  return colors[type] || '#6b7280'; // gray fallback
}

// Calculate bounding box from GeoJSON
function calculateBounds(geojson: any) {
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  geojson.features.forEach((feature: any) => {
    const coords = feature.geometry.type === 'Polygon' 
      ? feature.geometry.coordinates[0]
      : feature.geometry.coordinates;

    coords.forEach((coord: [number, number]) => {
      const [lng, lat] = coord;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });
  });

  return {
    minLng,
    maxLng,
    minLat,
    maxLat,
    centerLng: (minLng + maxLng) / 2,
    centerLat: (minLat + maxLat) / 2,
  };
}

// Calculate optimal zoom level for bounds
function calculateOptimalZoom(bounds: any, width: number, height: number): number {
  const WORLD_DIM = { height: 256, width: 256 };
  const ZOOM_MAX = 21;

  function latRad(lat: number) {
    const sin = Math.sin(lat * Math.PI / 180);
    const radX2 = Math.log((1 + sin) / (1 - sin)) / 2;
    return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2;
  }

  function zoom(mapPx: number, worldPx: number, fraction: number) {
    return Math.floor(Math.log(mapPx / worldPx / fraction) / Math.LN2);
  }

  const latFraction = (latRad(bounds.maxLat) - latRad(bounds.minLat)) / Math.PI;
  const lngDiff = bounds.maxLng - bounds.minLng;
  const lngFraction = ((lngDiff < 0) ? (lngDiff + 360) : lngDiff) / 360;

  const latZoom = zoom(height, WORLD_DIM.height, latFraction);
  const lngZoom = zoom(width, WORLD_DIM.width, lngFraction);

  // Add padding by reducing zoom by 1
  return Math.min(latZoom, lngZoom, ZOOM_MAX) - 1;
}

function json(payload: unknown, headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
