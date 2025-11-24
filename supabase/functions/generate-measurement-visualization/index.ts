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
    const { measurement_id, property_id, measurement, center_lat, center_lng, verified_address_lat, verified_address_lng } = body;
    
    // Apply default zoom adjustment for initial pulls (tighter birds-eye view)
    const isInitialPull = body.zoom_adjustment === undefined;
    const defaultZoomAdjustment = isInitialPull ? -1 : 0;
    const zoom_adjustment = (body.zoom_adjustment || 0) + defaultZoomAdjustment;

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

    // Get coordinates - prioritize verified address
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
    
    // Priority order for centering:
    // 1. Verified address coordinates (most accurate for property location)
    // 2. Calculated bounds center from features
    // 3. Fallback to request parameters
    const finalCenterLat = verified_address_lat || bounds.centerLat || lat;
    const finalCenterLng = verified_address_lng || bounds.centerLng || lng;
    
    // CRITICAL: Calculate distance between verified address and bounds center for diagnostics
    // ALWAYS log coordinate discrepancy for debugging
    if (verified_address_lat && verified_address_lng) {
      const latDiff = Math.abs(verified_address_lat - bounds.centerLat);
      const lngDiff = Math.abs(verified_address_lng - bounds.centerLng);
      const distanceMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000; // Rough conversion to meters
      
      if (distanceMeters > 10) {
        const severity = distanceMeters > 50 ? '🚨 CRITICAL' : distanceMeters > 30 ? '⚠️ WARNING' : 'ℹ️ INFO';
        console.error(`${severity} Coordinate mismatch detected:`, {
          property_id,
          measurement_id,
          verifiedCoords: { lat: verified_address_lat, lng: verified_address_lng },
          boundsCoords: { lat: bounds.centerLat, lng: bounds.centerLng },
          distanceMeters: Math.round(distanceMeters),
          action: 'Using verified address coordinates (priority #1)',
          severity: distanceMeters > 50 ? 'CRITICAL - House likely not visible' : 
                    distanceMeters > 30 ? 'HIGH - House may be off-center' : 
                    'LOW - Minor offset'
        });
      } else {
        console.log('✅ Coordinates aligned:', {
          verifiedCoords: { lat: verified_address_lat, lng: verified_address_lng },
          boundsCoords: { lat: bounds.centerLat, lng: bounds.centerLng },
          distanceMeters: Math.round(distanceMeters),
          status: 'GOOD'
        });
      }
    } else {
      console.warn('⚠️ No verified address coordinates provided - using calculated bounds center:', {
        boundsCoords: { lat: bounds.centerLat, lng: bounds.centerLng },
        recommendation: 'Pass verified_address_lat/lng for accurate centering'
      });
    }
    
    // With @2x retina, requesting 640x480 yields 1280x960 effective resolution
    const width = 640;   
    const height = 480;  // 4:3 ratio
    const zoom = calculateOptimalZoom(bounds, width, height, zoom_adjustment || 0);

    // Build Mapbox Static Images API URL with higher resolution
    const retina = '@2x';
    
    // Encode GeoJSON for URL
    const encodedGeoJSON = encodeURIComponent(JSON.stringify(geojson));
    
    // Use verified address center for precise property framing
    const mapboxUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/geojson(${encodedGeoJSON})/${finalCenterLng},${finalCenterLat},${zoom},0,0/${width}x${height}${retina}?access_token=${MAPBOX_TOKEN}`;

    console.log('Mapbox Static Image Request:', { 
      finalCenterLat, 
      finalCenterLng,
      verifiedAddressUsed: !!(verified_address_lat && verified_address_lng),
      zoom, 
      features: geojson.features.length,
      dimensions: `${width}x${height}${retina}`,
      bounds,
      geojson: JSON.stringify(geojson).substring(0, 500) + '...' // Log first 500 chars
    });

    // Retry logic with exponential backoff (3 attempts)
    let imageBuffer: Uint8Array | null = null;
    let lastError: string | null = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Mapbox fetch attempt ${attempt}/3`);
        const imageResponse = await fetch(mapboxUrl);
        
        if (!imageResponse.ok) {
          const errorText = await imageResponse.text();
          lastError = errorText;
          console.error(`Mapbox API error (attempt ${attempt}/3):`, {
            status: imageResponse.status,
            statusText: imageResponse.statusText,
            error: errorText,
            url: mapboxUrl.substring(0, 200) + '...' // Log URL (truncated)
          });
          
          if (attempt < 3) {
            // Exponential backoff: 1s, 2s, 4s
            const delay = Math.pow(2, attempt - 1) * 1000;
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        } else {
          // Success - extract image buffer
          const imageBlob = await imageResponse.blob();
          const imageArrayBuffer = await imageBlob.arrayBuffer();
          imageBuffer = new Uint8Array(imageArrayBuffer);
          console.log(`Mapbox image fetched successfully (${imageBuffer.length} bytes)`);
          break;
        }
      } catch (fetchError) {
        lastError = fetchError instanceof Error ? fetchError.message : String(fetchError);
        console.error(`Mapbox fetch error (attempt ${attempt}/3):`, lastError);
        
        if (attempt < 3) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // If Mapbox failed after 3 attempts, fallback to Google Maps
    if (!imageBuffer) {
      console.warn('Mapbox failed after 3 attempts, falling back to Google Maps Static API');
      
      try {
        // Call google-maps-proxy edge function for fallback
        const googleMapsResponse = await fetch(`${SUPABASE_URL}/functions/v1/google-maps-proxy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({
            endpoint: 'staticmap',
            params: {
              center: `${finalCenterLat},${finalCenterLng}`,
              zoom: Math.floor(zoom),
              size: '1280x1280',
              maptype: 'satellite',
              scale: 2,
            }
          })
        });
        
        if (!googleMapsResponse.ok) {
          const googleError = await googleMapsResponse.text();
          console.error('Google Maps fallback also failed:', googleError);
          return json({ 
            ok: false, 
            error: `Both Mapbox and Google Maps failed. Mapbox: ${lastError}. Google: ${googleError}` 
          }, corsHeaders, 500);
        }
        
        const googleData = await googleMapsResponse.json();
        if (googleData.image_data) {
          // Convert base64 to Uint8Array
          const base64Data = googleData.image_data.replace(/^data:image\/\w+;base64,/, '');
          const binaryString = atob(base64Data);
          imageBuffer = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            imageBuffer[i] = binaryString.charCodeAt(i);
          }
          console.log('Google Maps fallback successful');
        } else {
          return json({ 
            ok: false, 
            error: 'Google Maps fallback returned no image data' 
          }, corsHeaders, 500);
        }
      } catch (googleError) {
        console.error('Google Maps fallback exception:', googleError);
        return json({ 
          ok: false, 
          error: `Visualization generation failed. Mapbox: ${lastError}. Google fallback: ${googleError}` 
        }, corsHeaders, 500);
      }
    }

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
      center: { lat: finalCenterLat, lng: finalCenterLng },
      verified_address: verified_address_lat && verified_address_lng ? {
        lat: verified_address_lat,
        lng: verified_address_lng
      } : null,
      coordinate_source: verified_address_lat ? 'verified_address' : 'bounds_calculation',
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
function calculateOptimalZoom(bounds: any, width: number, height: number, zoomAdjustment: number = 0): number {
  const ZOOM_MAX = 21;
  const WORLD_DIM = { height: 256, width: 256 };

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

  // Use a much wider default view for initial pulls
  const minZoom = 12; // Allow zoom 12 for very wide view (~800m radius)
  const maxZoom = 18; // Reasonable maximum detail
  
  const optimalZoom = Math.min(latZoom, lngZoom, ZOOM_MAX);
  const baseZoom = Math.max(optimalZoom - 0.5, minZoom);
  
  // Apply zoom adjustment and clamp between min/max
  const finalZoom = Math.max(
    Math.min(baseZoom + zoomAdjustment, maxZoom),
    minZoom
  );
  
  console.log(`Zoom calculation: optimal=${optimalZoom.toFixed(2)}, base=${baseZoom.toFixed(2)}, adjustment=${zoomAdjustment}, final=${finalZoom.toFixed(2)}`);
  
  return finalZoom;
}

function json(payload: unknown, headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
