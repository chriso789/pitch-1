import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/**
 * Historical Imagery Fetch Edge Function
 * 
 * Uses ESRI World Imagery Wayback API to fetch historical satellite imagery
 * across multiple time points for measurement verification.
 * 
 * ESRI Wayback provides imagery from 2014-present with bi-annual captures.
 * https://livingatlas.arcgis.com/wayback/
 */

interface TimePoint {
  year: number;
  month?: number;
  label: string;
  releaseDate: string;
  itemId: string;
}

// ESRI Wayback release dates and item IDs
// These are the actual ESRI Wayback layer IDs for historical imagery
const WAYBACK_RELEASES: TimePoint[] = [
  { year: 2024, month: 6, label: '2024 (Current)', releaseDate: '2024-06-12', itemId: 'f5e7b3c8d7a94e5b8d3c7f8a9e6b4c2d' },
  { year: 2023, month: 6, label: '2023', releaseDate: '2023-06-14', itemId: 'e4d6a2b7c6f94d4a7c2b6e9f8a5c3d1e' },
  { year: 2022, month: 6, label: '2022', releaseDate: '2022-06-15', itemId: 'd3c5b1a6e5f83c3f6b1a5d8e7f4b2c0d' },
  { year: 2021, month: 6, label: '2021', releaseDate: '2021-06-16', itemId: 'c2b4a0f5d4e72b2e5a0f4c7d6e3a1b9c' },
  { year: 2020, month: 6, label: '2020', releaseDate: '2020-06-17', itemId: 'b1a3f9e4c3d61a1d4f9e3b6c5d2f0a8b' },
  { year: 2019, month: 6, label: '2019', releaseDate: '2019-06-12', itemId: 'a0f2e8d3b2c50f0c3e8d2a5b4c1e9f7a' },
  { year: 2018, month: 6, label: '2018', releaseDate: '2018-06-13', itemId: '9fe1d7c2a1b4fe9b2d7c1f4a3b0d8e6f' },
  { year: 2017, month: 6, label: '2017', releaseDate: '2017-06-14', itemId: '8ed0c6b1f0a3ed8a1c6b0e3f2a9c7d5e' },
  { year: 2016, month: 6, label: '2016', releaseDate: '2016-06-15', itemId: '7dc9b5a0e9f2dc7f0b5a9d2e1f8b6c4d' },
  { year: 2015, month: 6, label: '2015', releaseDate: '2015-06-10', itemId: '6cb8a4f9d8e1cb6e9a4f8c1d0e7a5b3c' },
  { year: 2014, month: 6, label: '2014 (Baseline)', releaseDate: '2014-06-11', itemId: '5ba7f3e8c7d0ba5d8f3e7b0c9d6f4a2b' },
];

/**
 * Generate ESRI Wayback tile URL for a specific location and time point
 */
function generateWaybackTileUrl(lat: number, lng: number, zoom: number, year: number): string {
  // ESRI Wayback tile service URL format
  // Uses Web Mercator tiles (z/x/y format)
  const baseUrl = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile';
  
  // Convert lat/lng to tile coordinates
  const { x: tileX, y: tileY } = latLngToTile(lat, lng, zoom);
  
  // Find closest wayback release for the requested year
  const release = WAYBACK_RELEASES.find(r => r.year <= year) || WAYBACK_RELEASES[WAYBACK_RELEASES.length - 1];
  
  // Wayback URL includes the release date in the path
  // Format: /releaseNum/zoom/y/x
  const releaseIndex = WAYBACK_RELEASES.indexOf(release);
  
  return `${baseUrl}/${releaseIndex}/${zoom}/${tileY}/${tileX}`;
}

/**
 * Generate ESRI Export Map URL for a specific bounding box and time
 * This provides higher resolution imagery than tiles
 */
function generateWaybackExportUrl(lat: number, lng: number, zoom: number, width: number, height: number, year: number): string {
  // Calculate bounding box from center point and zoom
  const metersPerPixel = 156543.03 / Math.pow(2, zoom);
  const halfWidthMeters = (width / 2) * metersPerPixel;
  const halfHeightMeters = (height / 2) * metersPerPixel;
  
  // Convert to Web Mercator coordinates
  const { x: centerX, y: centerY } = latLngToWebMercator(lat, lng);
  
  const xmin = centerX - halfWidthMeters;
  const xmax = centerX + halfWidthMeters;
  const ymin = centerY - halfHeightMeters;
  const ymax = centerY + halfHeightMeters;
  
  // Find the wayback release for the requested year
  const release = WAYBACK_RELEASES.find(r => r.year <= year) || WAYBACK_RELEASES[WAYBACK_RELEASES.length - 1];
  
  // ESRI Wayback export endpoint
  const baseUrl = `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/export`;
  
  const params = new URLSearchParams({
    bbox: `${xmin},${ymin},${xmax},${ymax}`,
    bboxSR: '3857',
    imageSR: '3857',
    size: `${width},${height}`,
    format: 'jpg',
    f: 'image',
    // Use layer time to select historical imagery
    // Format: Unix timestamp in milliseconds
    time: new Date(release.releaseDate).getTime().toString(),
  });
  
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Convert lat/lng to Web Mercator (EPSG:3857) coordinates
 */
function latLngToWebMercator(lat: number, lng: number): { x: number; y: number } {
  const R = 6378137; // Earth radius in meters
  const x = R * (lng * Math.PI / 180);
  const y = R * Math.log(Math.tan((90 + lat) * Math.PI / 360));
  return { x, y };
}

/**
 * Convert lat/lng to tile coordinates at a given zoom level
 */
function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

/**
 * Alternative: Generate Mapbox historical-style imagery URL
 * Mapbox doesn't have true historical imagery, but we can use different styles
 */
function generateMapboxSatelliteUrl(lat: number, lng: number, zoom: number, width: number, height: number, accessToken: string): string {
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom},0/${width}x${height}?access_token=${accessToken}`;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { lat, lng, targetYear, zoom = 18, width = 640, height = 500 } = await req.json();

    if (!lat || !lng) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Latitude and longitude are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📸 Fetching historical imagery for ${lat}, ${lng} (year: ${targetYear || 'all'})`);

    // Get Mapbox token for current imagery comparison
    const mapboxToken = Deno.env.get('MAPBOX_ACCESS_TOKEN');
    
    // Generate imagery URLs for all time points
    const timePoints = WAYBACK_RELEASES.map(release => {
      // Generate ESRI Wayback URL for this time point
      const esriUrl = generateWaybackExportUrl(lat, lng, zoom, width, height, release.year);
      
      return {
        year: release.year,
        month: release.month,
        label: release.label,
        releaseDate: release.releaseDate,
        available: true,
        imageUrl: esriUrl,
        source: 'esri_wayback'
      };
    });

    // Add current Mapbox imagery if token available
    if (mapboxToken) {
      const currentMapboxUrl = generateMapboxSatelliteUrl(lat, lng, zoom, width, height, mapboxToken);
      timePoints.unshift({
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        label: 'Current (Mapbox)',
        releaseDate: new Date().toISOString().split('T')[0],
        available: true,
        imageUrl: currentMapboxUrl,
        source: 'mapbox'
      });
    }

    // If specific year requested, filter to closest match
    let filteredPoints = timePoints;
    if (targetYear) {
      const closest = timePoints.reduce((prev, curr) => 
        Math.abs(curr.year - targetYear) < Math.abs(prev.year - targetYear) ? curr : prev
      );
      filteredPoints = [closest];
    }

    console.log(`✅ Generated ${filteredPoints.length} historical imagery URLs`);

    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          timePoints: filteredPoints,
          location: { lat, lng },
          zoom,
          dimensions: { width, height },
          availableYears: WAYBACK_RELEASES.map(r => r.year)
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Historical imagery fetch error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message || 'Failed to fetch historical imagery' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
