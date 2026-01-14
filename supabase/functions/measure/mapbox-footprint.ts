// Mapbox Vector Footprint Fetcher
// Fetches high-resolution building footprints from Mapbox Tilequery API
// Provides sub-meter accuracy for roof perimeters

type XY = [number, number]; // [lng, lat]

export interface MapboxFootprint {
  coordinates: XY[];
  source: 'mapbox_vector';
  confidence: number;
  buildingId?: string;
  areaM2?: number;
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
export async function fetchMapboxFootprint(
  lat: number,
  lng: number,
  accessToken: string,
  options?: {
    radius?: number;
    tilesetId?: string;
  }
): Promise<MapboxFootprintResult> {
  const tileset = options?.tilesetId || 'mapbox.mapbox-streets-v8';
  const layers = 'building';
  const radius = options?.radius || 25; // meters
  
  try {
    const url = `https://api.mapbox.com/v4/${tileset}/tilequery/${lng},${lat}.json?radius=${radius}&layers=${layers}&limit=10&access_token=${accessToken}`;
    
    console.log(`🗺️ Fetching Mapbox footprint at ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Mapbox Tilequery failed: ${response.status} - ${errorText}`);
      return {
        footprint: null,
        error: `Mapbox API error: ${response.status}`,
        fallbackReason: 'api_error'
      };
    }
    
    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
      console.log('No building features found in Mapbox response');
      return {
        footprint: null,
        fallbackReason: 'no_buildings_found'
      };
    }
    
    // Find the building feature closest to and containing the target point
    const buildings = data.features.filter((f: any) => 
      f.geometry?.type === 'Polygon' && 
      f.geometry?.coordinates?.[0]?.length >= 4
    );
    
    if (buildings.length === 0) {
      return {
        footprint: null,
        fallbackReason: 'no_polygon_buildings'
      };
    }
    
    // Sort by distance to target (tilequery.distance property)
    buildings.sort((a: any, b: any) => {
      const distA = a.properties?.tilequery?.distance || Infinity;
      const distB = b.properties?.tilequery?.distance || Infinity;
      return distA - distB;
    });
    
    // Take the closest building that contains the point or is very close
    let bestBuilding = buildings[0];
    
    // Check if point is inside building polygon
    for (const building of buildings) {
      const ring = building.geometry.coordinates[0] as XY[];
      if (pointInPolygon([lng, lat], ring)) {
        bestBuilding = building;
        break;
      }
    }
    
    const ring = bestBuilding.geometry.coordinates[0] as XY[];
    
    // Ensure polygon is closed
    const coords = ensureClosed(ring);
    
    // Calculate area for confidence estimation
    const areaM2 = calculatePolygonAreaM2(coords);
    
    // Confidence based on distance and area
    const distance = bestBuilding.properties?.tilequery?.distance || 0;
    let confidence = 0.92;
    
    if (distance > 10) confidence -= 0.1;
    if (distance > 20) confidence -= 0.1;
    if (areaM2 < 50) confidence -= 0.15; // Very small building, might be wrong
    if (areaM2 > 2000) confidence -= 0.05; // Very large, might be commercial
    
    confidence = Math.max(0.5, Math.min(0.98, confidence));
    
    console.log(`✓ Mapbox footprint: ${coords.length} vertices, ${Math.round(areaM2)}m², confidence ${(confidence * 100).toFixed(0)}%`);
    
    return {
      footprint: {
        coordinates: coords,
        source: 'mapbox_vector',
        confidence,
        buildingId: bestBuilding.properties?.id?.toString(),
        areaM2
      }
    };
    
  } catch (error) {
    console.error('Mapbox footprint fetch error:', error);
    return {
      footprint: null,
      error: String(error),
      fallbackReason: 'fetch_error'
    };
  }
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
 * Merge Mapbox footprint with existing perimeter (prefer Mapbox for precision)
 * Returns the better of the two based on vertex count and area match
 */
export function selectBestFootprint(
  mapboxFootprint: MapboxFootprint | null,
  existingCoords: XY[],
  targetAreaSqft?: number
): { coords: XY[]; source: string; confidence: number } {
  // If no Mapbox footprint, use existing
  if (!mapboxFootprint || mapboxFootprint.coordinates.length < 4) {
    return {
      coords: existingCoords,
      source: 'existing',
      confidence: 0.7
    };
  }
  
  // If no existing coords, use Mapbox
  if (!existingCoords || existingCoords.length < 4) {
    return {
      coords: mapboxFootprint.coordinates,
      source: 'mapbox_vector',
      confidence: mapboxFootprint.confidence
    };
  }
  
  // If we have a target area, compare which matches better
  if (targetAreaSqft && targetAreaSqft > 0) {
    const mapboxAreaSqft = (mapboxFootprint.areaM2 || 0) * 10.7639;
    const existingAreaSqft = calculatePolygonAreaM2(existingCoords) * 10.7639;
    
    const mapboxError = Math.abs(mapboxAreaSqft - targetAreaSqft) / targetAreaSqft;
    const existingError = Math.abs(existingAreaSqft - targetAreaSqft) / targetAreaSqft;
    
    if (mapboxError < existingError) {
      return {
        coords: mapboxFootprint.coordinates,
        source: 'mapbox_vector',
        confidence: mapboxFootprint.confidence
      };
    }
  }
  
  // Prefer Mapbox if it has more vertices (usually higher resolution)
  if (mapboxFootprint.coordinates.length > existingCoords.length) {
    return {
      coords: mapboxFootprint.coordinates,
      source: 'mapbox_vector',
      confidence: mapboxFootprint.confidence
    };
  }
  
  // Otherwise keep existing
  return {
    coords: existingCoords,
    source: 'existing',
    confidence: 0.75
  };
}
