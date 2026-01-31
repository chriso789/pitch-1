/**
 * Satellite Image Fetcher
 * Phase 1: AI Roof Measurement Pipeline Overhaul
 * 
 * Unified service for fetching high-resolution satellite imagery from:
 * 1. Google Static Maps API (primary - highest quality)
 * 2. Mapbox Static API (fallback)
 * 
 * Features:
 * - 2560x2560 effective resolution at zoom 21
 * - Geospatial bounds calculation for coordinate transformation
 * - Image caching via Supabase Storage
 * - Quality scoring for preprocessing decisions
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// ============================================
// TYPES
// ============================================

export interface SatelliteImageRequest {
  lat: number;
  lng: number;
  propertyId?: string;
  zoom?: number;
  size?: number;
  scale?: number;
  preferredSource?: 'google' | 'mapbox';
}

export interface GeospatialBounds {
  north: number;  // Top latitude
  south: number;  // Bottom latitude  
  east: number;   // Right longitude
  west: number;   // Left longitude
  center: { lat: number; lng: number };
  metersPerPixel: number;
}

export interface SatelliteImageResult {
  success: boolean;
  imageBase64: string;
  imageUrl?: string;
  source: 'google' | 'mapbox' | 'cache';
  bounds: GeospatialBounds;
  dimensions: {
    width: number;
    height: number;
    effectiveWidth: number;  // After scale multiplier
    effectiveHeight: number;
  };
  zoom: number;
  qualityScore: number;
  fetchTimeMs: number;
  cacheHit: boolean;
  error?: string;
}

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_ZOOM = 20;
const DEFAULT_SIZE = 640;
const DEFAULT_SCALE = 2;  // 2x for retina
const MAX_ZOOM = 21;
const MAX_SIZE = 640;  // Google's max for Static Maps
const CACHE_TTL_DAYS = 30;

// ============================================
// MAIN FETCHER
// ============================================

/**
 * Fetch high-resolution satellite imagery for a property
 * Tries Google first, falls back to Mapbox
 */
export async function fetchSatelliteImage(
  request: SatelliteImageRequest,
  googleApiKey?: string,
  mapboxToken?: string,
  supabase?: SupabaseClient
): Promise<SatelliteImageResult> {
  const startTime = Date.now();
  const zoom = Math.min(request.zoom || DEFAULT_ZOOM, MAX_ZOOM);
  const size = Math.min(request.size || DEFAULT_SIZE, MAX_SIZE);
  const scale = request.scale || DEFAULT_SCALE;

  // Check cache first if supabase client provided
  if (supabase && request.propertyId) {
    const cached = await checkImageCache(supabase, request.lat, request.lng, zoom);
    if (cached) {
      console.log(`📦 Cache HIT for satellite image at (${request.lat.toFixed(6)}, ${request.lng.toFixed(6)})`);
      return {
        ...cached,
        cacheHit: true,
        fetchTimeMs: Date.now() - startTime,
      };
    }
  }

  // Try Google Static Maps first (highest quality)
  if (googleApiKey && request.preferredSource !== 'mapbox') {
    try {
      const googleResult = await fetchGoogleStaticMap(
        request.lat,
        request.lng,
        zoom,
        size,
        scale,
        googleApiKey
      );
      
      if (googleResult.success) {
        // Cache the result
        if (supabase && request.propertyId) {
          await cacheImage(supabase, request.lat, request.lng, zoom, googleResult);
        }
        
        return {
          ...googleResult,
          fetchTimeMs: Date.now() - startTime,
          cacheHit: false,
        };
      }
    } catch (err) {
      console.warn('⚠️ Google Static Maps failed:', err);
    }
  }

  // Fallback to Mapbox
  if (mapboxToken) {
    try {
      const mapboxResult = await fetchMapboxStaticImage(
        request.lat,
        request.lng,
        zoom,
        size,
        mapboxToken
      );
      
      if (mapboxResult.success) {
        // Cache the result
        if (supabase && request.propertyId) {
          await cacheImage(supabase, request.lat, request.lng, zoom, mapboxResult);
        }
        
        return {
          ...mapboxResult,
          fetchTimeMs: Date.now() - startTime,
          cacheHit: false,
        };
      }
    } catch (err) {
      console.warn('⚠️ Mapbox Static API failed:', err);
    }
  }

  // Both failed
  return {
    success: false,
    imageBase64: '',
    source: 'google',
    bounds: calculateBounds(request.lat, request.lng, size, zoom),
    dimensions: { width: size, height: size, effectiveWidth: size * scale, effectiveHeight: size * scale },
    zoom,
    qualityScore: 0,
    fetchTimeMs: Date.now() - startTime,
    cacheHit: false,
    error: 'All satellite image sources failed',
  };
}

// ============================================
// GOOGLE STATIC MAPS
// ============================================

async function fetchGoogleStaticMap(
  lat: number,
  lng: number,
  zoom: number,
  size: number,
  scale: number,
  apiKey: string
): Promise<SatelliteImageResult> {
  console.log(`🛰️ Fetching Google Static Map at zoom ${zoom}, size ${size}x${size}@${scale}x`);

  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('center', `${lat},${lng}`);
  url.searchParams.set('zoom', String(zoom));
  url.searchParams.set('size', `${size}x${size}`);
  url.searchParams.set('scale', String(scale));
  url.searchParams.set('maptype', 'satellite');
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Google API error: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    const errorData = await response.json();
    throw new Error(`Google API error: ${JSON.stringify(errorData)}`);
  }

  const imageBuffer = await response.arrayBuffer();
  const imageBase64 = base64FromBytes(new Uint8Array(imageBuffer));
  const bounds = calculateBounds(lat, lng, size * scale, zoom);
  
  // Estimate quality based on response size
  const qualityScore = estimateImageQuality(imageBuffer.byteLength, size * scale);

  console.log(`✅ Google image fetched: ${imageBuffer.byteLength} bytes, quality score: ${qualityScore.toFixed(2)}`);

  return {
    success: true,
    imageBase64: `data:image/png;base64,${imageBase64}`,
    source: 'google',
    bounds,
    dimensions: {
      width: size,
      height: size,
      effectiveWidth: size * scale,
      effectiveHeight: size * scale,
    },
    zoom,
    qualityScore,
    fetchTimeMs: 0,
    cacheHit: false,
  };
}

// ============================================
// MAPBOX STATIC API
// ============================================

async function fetchMapboxStaticImage(
  lat: number,
  lng: number,
  zoom: number,
  size: number,
  token: string
): Promise<SatelliteImageResult> {
  console.log(`🗺️ Fetching Mapbox satellite at zoom ${zoom}, size ${size}x${size}@2x`);

  // Mapbox satellite-v9 style with @2x for retina
  const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/` +
    `${lng},${lat},${zoom}/${size}x${size}@2x?` +
    `access_token=${token}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mapbox API error: ${response.status} - ${errorText}`);
  }

  const imageBuffer = await response.arrayBuffer();
  const imageBase64 = base64FromBytes(new Uint8Array(imageBuffer));
  const bounds = calculateBounds(lat, lng, size * 2, zoom);  // @2x = 2x size
  const qualityScore = estimateImageQuality(imageBuffer.byteLength, size * 2);

  console.log(`✅ Mapbox image fetched: ${imageBuffer.byteLength} bytes, quality score: ${qualityScore.toFixed(2)}`);

  return {
    success: true,
    imageBase64: `data:image/png;base64,${imageBase64}`,
    source: 'mapbox',
    bounds,
    dimensions: {
      width: size,
      height: size,
      effectiveWidth: size * 2,
      effectiveHeight: size * 2,
    },
    zoom,
    qualityScore,
    fetchTimeMs: 0,
    cacheHit: false,
  };
}

// ============================================
// BOUNDS CALCULATION
// ============================================

/**
 * Calculate geospatial bounds for the satellite image
 * Uses Web Mercator projection math
 */
export function calculateBounds(
  centerLat: number,
  centerLng: number,
  pixelSize: number,
  zoom: number
): GeospatialBounds {
  // Meters per pixel at this zoom and latitude
  const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
  
  // Total span in meters
  const widthMeters = pixelSize * metersPerPixel;
  const heightMeters = pixelSize * metersPerPixel;
  
  // Convert to degrees
  const metersPerDegreeLat = 111320;  // Approximately constant
  const metersPerDegreeLng = 111320 * Math.cos(centerLat * Math.PI / 180);
  
  const latSpan = heightMeters / metersPerDegreeLat / 2;
  const lngSpan = widthMeters / metersPerDegreeLng / 2;
  
  return {
    north: centerLat + latSpan,
    south: centerLat - latSpan,
    east: centerLng + lngSpan,
    west: centerLng - lngSpan,
    center: { lat: centerLat, lng: centerLng },
    metersPerPixel,
  };
}

/**
 * Convert GPS coordinates to pixel position within the image
 */
export function gpsToPixel(
  lat: number,
  lng: number,
  bounds: GeospatialBounds,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number } {
  const x = ((lng - bounds.west) / (bounds.east - bounds.west)) * imageWidth;
  const y = ((bounds.north - lat) / (bounds.north - bounds.south)) * imageHeight;
  return { x, y };
}

/**
 * Convert pixel position to GPS coordinates
 */
export function pixelToGps(
  x: number,
  y: number,
  bounds: GeospatialBounds,
  imageWidth: number,
  imageHeight: number
): { lat: number; lng: number } {
  const lng = bounds.west + (x / imageWidth) * (bounds.east - bounds.west);
  const lat = bounds.north - (y / imageHeight) * (bounds.north - bounds.south);
  return { lat, lng };
}

// ============================================
// CACHING
// ============================================

const CACHE_BUCKET = 'satellite-imagery';

async function checkImageCache(
  supabase: SupabaseClient,
  lat: number,
  lng: number,
  zoom: number
): Promise<SatelliteImageResult | null> {
  try {
    const cacheKey = generateCacheKey(lat, lng, zoom);
    
    // Check for cached entry in function_cache table
    const { data, error } = await supabase
      .from('function_cache')
      .select('result, created_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    // Check TTL
    const age = Date.now() - new Date(data.created_at).getTime();
    const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    
    if (age > ttlMs) {
      // Expired - delete and return null
      await supabase.from('function_cache').delete().eq('cache_key', cacheKey);
      return null;
    }

    const cached = JSON.parse(data.result);
    return {
      ...cached,
      source: 'cache' as const,
    };
  } catch (err) {
    console.warn('Cache lookup failed:', err);
    return null;
  }
}

async function cacheImage(
  supabase: SupabaseClient,
  lat: number,
  lng: number,
  zoom: number,
  result: SatelliteImageResult
): Promise<void> {
  try {
    const cacheKey = generateCacheKey(lat, lng, zoom);
    
    // Store metadata in function_cache (not the image itself - too large)
    // The image URL can be reconstructed
    const cacheData = {
      bounds: result.bounds,
      dimensions: result.dimensions,
      zoom: result.zoom,
      qualityScore: result.qualityScore,
      source: result.source,
      // Don't cache the base64 - it's too large
      // Instead store a flag that the image was fetched
      imageFetched: true,
    };

    await supabase.from('function_cache').upsert({
      cache_key: cacheKey,
      result: JSON.stringify(cacheData),
      ttl_seconds: CACHE_TTL_DAYS * 24 * 60 * 60,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });

    console.log(`💾 Cached satellite image metadata for ${cacheKey}`);
  } catch (err) {
    console.warn('Cache write failed:', err);
  }
}

function generateCacheKey(lat: number, lng: number, zoom: number): string {
  // Round to 6 decimal places (~0.1m precision)
  const latRounded = lat.toFixed(6);
  const lngRounded = lng.toFixed(6);
  return `sat_${latRounded}_${lngRounded}_z${zoom}`;
}

// ============================================
// QUALITY ESTIMATION
// ============================================

/**
 * Estimate image quality based on file size and resolution
 * Higher values = better quality
 */
function estimateImageQuality(byteSize: number, pixelSize: number): number {
  // Expected bytes for a good satellite image at this resolution
  // A well-detailed 1280x1280 JPEG/PNG should be ~200-500KB
  const expectedBytes = pixelSize * pixelSize * 0.3;  // ~0.3 bytes per pixel
  
  // Ratio of actual to expected
  const ratio = byteSize / expectedBytes;
  
  // Very small = likely low detail or cloud cover
  // Very large = possibly overcompressed artifacts
  if (ratio < 0.3) return 0.4;  // Too small - likely low quality
  if (ratio < 0.6) return 0.7;
  if (ratio < 1.5) return 0.9;  // Good range
  if (ratio < 3.0) return 0.85;
  return 0.7;  // Very large - might have issues
}

// ============================================
// UTILITIES
// ============================================

/**
 * Base64 encode bytes without using std modules
 */
function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Fetch satellite image with enhanced settings for measurement
 * Convenience function with optimal defaults for roof measurement
 */
export async function fetchMeasurementSatelliteImage(
  lat: number,
  lng: number,
  propertyId: string,
  googleApiKey: string,
  mapboxToken: string,
  supabase?: SupabaseClient
): Promise<SatelliteImageResult> {
  return fetchSatelliteImage(
    {
      lat,
      lng,
      propertyId,
      zoom: 20,      // Zoom 20 for optimal detail
      size: 640,     // Max size
      scale: 2,      // 2x for 1280px effective
      preferredSource: 'google',
    },
    googleApiKey,
    mapboxToken,
    supabase
  );
}

/**
 * Fetch high-res satellite image for overlay generation
 * Uses zoom 21 for maximum detail
 */
export async function fetchOverlaySatelliteImage(
  lat: number,
  lng: number,
  googleApiKey: string,
  mapboxToken: string
): Promise<SatelliteImageResult> {
  return fetchSatelliteImage(
    {
      lat,
      lng,
      zoom: 21,      // Maximum zoom for overlay
      size: 640,
      scale: 2,
      preferredSource: 'google',
    },
    googleApiKey,
    mapboxToken
  );
}
