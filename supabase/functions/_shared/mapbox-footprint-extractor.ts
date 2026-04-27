// Mapbox Vector Footprint Extractor
// Fetches high-resolution building footprints from Mapbox Tilequery API
// Provides sub-meter accuracy for roof perimeters
// 
// This is the AUTHORITATIVE footprint source for the Solar Fast Path
// Mapbox vector tiles have ~1m precision vs Solar API's bounding box (rectangle only)

type XY = [number, number]; // [lng, lat]

export interface MapboxFootprint {
  coordinates: XY[];
  source: 'mapbox_vector';
  confidence: number;
  buildingId?: string;
  areaM2?: number;
  vertexCount: number;
}

export interface MapboxFootprintResult {
  footprint: MapboxFootprint | null;
  error?: string;
  fallbackReason?: string;
}

/**
 * Fetch high-resolution building footprint from Mapbox Tilequery API
 * Uses the mapbox.mapbox-streets-v8 tileset which includes building footprints
 */
// IMPORTANT:
// Mapbox Tilequery does NOT return full polygon rings for vector features.
// Per Mapbox docs, the response geometry is always a Point (closest-point);
// the original geometry type is exposed only in `properties.tilequery.geometry`.
// Therefore this helper cannot be used as an authoritative polygon footprint
// source. It is intentionally disabled to stop the AI Measurement pipeline
// from depending on a structurally impossible API behavior.
export async function fetchMapboxVectorFootprint(
  _lat: number,
  _lng: number,
  _accessToken: string,
  _options?: {
    radius?: number;
    tilesetId?: string;
  }
): Promise<MapboxFootprintResult> {
  console.warn(
    '[mapbox-footprint-extractor] disabled: Tilequery is point-only and cannot provide building polygon rings'
  );
  return {
    footprint: null,
    error: 'Mapbox Tilequery cannot provide full building polygon geometry for this extractor.',
    fallbackReason: 'tilequery_returns_points_only',
  };
}

/**
 * Point in polygon test for [lng, lat] coordinates
 */
function pointInPolygon(point: XY, polygon: XY[]): boolean {
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

/**
 * Ensure polygon ring is closed (first point equals last point)
 */
function ensureClosed(coords: XY[]): XY[] {
  if (coords.length < 3) return coords;
  
  const first = coords[0];
  const last = coords[coords.length - 1];
  
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...coords, first];
  }
  
  return coords;
}

/**
 * Calculate polygon area in square meters using Shoelace formula
 */
function calculatePolygonAreaM2(coords: XY[]): number {
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

/**
 * Compare two footprints and return the better one for roof measurement
 * Prefers Mapbox if it has more vertices (better detail) and similar area
 */
export function selectBestFootprint(
  mapboxFootprint: MapboxFootprint | null,
  solarBoundingBox: { sw: { latitude: number; longitude: number }; ne: { latitude: number; longitude: number } } | null,
  solarAreaSqft: number
): {
  source: 'mapbox_vector' | 'google_solar_api' | 'solar_bbox_fallback';
  coordinates: XY[];
  confidence: number;
  vertexCount: number;
  reasoning: string;
} {
  // If we have Mapbox footprint with enough vertices, prefer it
  if (mapboxFootprint && mapboxFootprint.vertexCount >= 4) {
    const mapboxAreaSqft = (mapboxFootprint.areaM2 || 0) * 10.764;
    
    // Check if Mapbox area is reasonable compared to Solar API
    if (solarAreaSqft > 0) {
      const areaRatio = mapboxAreaSqft / solarAreaSqft;
      
      // If Mapbox area is within 40% of Solar area, use it (it has more detail)
      if (areaRatio >= 0.6 && areaRatio <= 1.4) {
        return {
          source: 'mapbox_vector',
          coordinates: mapboxFootprint.coordinates,
          confidence: mapboxFootprint.confidence,
          vertexCount: mapboxFootprint.vertexCount,
          reasoning: `Mapbox has ${mapboxFootprint.vertexCount} vertices vs Solar bbox 4 vertices, area matches within ${Math.round(Math.abs(1 - areaRatio) * 100)}%`
        };
      }
      
      // Area mismatch - might be wrong building, but still prefer Mapbox if it has many vertices
      if (mapboxFootprint.vertexCount >= 8) {
        return {
          source: 'mapbox_vector',
          coordinates: mapboxFootprint.coordinates,
          confidence: mapboxFootprint.confidence * 0.8, // Reduce confidence due to area mismatch
          vertexCount: mapboxFootprint.vertexCount,
          reasoning: `Mapbox has ${mapboxFootprint.vertexCount} vertices (high detail), area mismatch ${Math.round(areaRatio * 100)}%`
        };
      }
    } else {
      // No Solar area to compare, use Mapbox
      return {
        source: 'mapbox_vector',
        coordinates: mapboxFootprint.coordinates,
        confidence: mapboxFootprint.confidence,
        vertexCount: mapboxFootprint.vertexCount,
        reasoning: `Using Mapbox footprint with ${mapboxFootprint.vertexCount} vertices (no Solar area to compare)`
      };
    }
  }
  
  // Fallback to Solar bounding box (rectangle with 4 vertices)
  if (solarBoundingBox?.sw && solarBoundingBox?.ne) {
    const sw = solarBoundingBox.sw;
    const ne = solarBoundingBox.ne;
    const coords: XY[] = [
      [sw.longitude, sw.latitude],
      [ne.longitude, sw.latitude],
      [ne.longitude, ne.latitude],
      [sw.longitude, ne.latitude],
      [sw.longitude, sw.latitude], // Close the ring
    ];
    
    return {
      source: 'solar_bbox_fallback',
      coordinates: coords,
      confidence: 0.75, // Lower confidence for rectangle approximation
      vertexCount: 4,
      reasoning: 'Using Solar API bounding box rectangle (Mapbox unavailable or unreliable)'
    };
  }
  
  // No footprint available
  throw new Error('No footprint source available');
}
