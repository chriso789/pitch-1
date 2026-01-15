/**
 * OSM Building Footprints Extractor
 * Uses OpenStreetMap Overpass API to fetch building footprints
 * Free, no API key required - covers most developed areas
 * 
 * Data source: https://wiki.openstreetmap.org/wiki/Overpass_API
 */

type XY = [number, number]; // [lng, lat]

export interface OSMFootprint {
  coordinates: XY[];
  source: 'osm_buildings';
  confidence: number;
  areaM2?: number;
  vertexCount: number;
  osmId?: string;
  buildingType?: string;
}

export interface OSMFootprintResult {
  footprint: OSMFootprint | null;
  error?: string;
  fallbackReason?: string;
}

/**
 * Fetch building footprint from OpenStreetMap via Overpass API
 * 
 * @param lat - Latitude of target location
 * @param lng - Longitude of target location
 * @param options - Configuration options
 */
export async function fetchOSMBuildingFootprint(
  lat: number,
  lng: number,
  options?: {
    searchRadius?: number; // meters
    timeout?: number; // ms
  }
): Promise<OSMFootprintResult> {
  const searchRadius = options?.searchRadius || 50;
  const timeout = options?.timeout || 10000;
  
  try {
    console.log(`🗺️ OSM Overpass search: ${lat.toFixed(6)}, ${lng.toFixed(6)} (radius=${searchRadius}m)`);
    
    // Build Overpass QL query to find buildings within radius
    const query = `
      [out:json][timeout:10];
      (
        way["building"](around:${searchRadius},${lat},${lng});
        relation["building"](around:${searchRadius},${lat},${lng});
      );
      out body geom;
    `;
    
    // Use public Overpass API endpoint
    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(overpassUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.warn(`⚠️ OSM Overpass API failed: ${response.status}`);
        return {
          footprint: null,
          error: `API error: ${response.status}`,
          fallbackReason: 'api_error',
        };
      }
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) {
        console.log('⚠️ No OSM building footprints found');
        return {
          footprint: null,
          fallbackReason: 'no_buildings_found',
        };
      }
      
      console.log(`📊 OSM: ${data.elements.length} buildings found`);
      
      // Process buildings to find best match
      type BuildingCandidate = {
        ring: XY[];
        distance: number;
        containsPoint: boolean;
        areaM2: number;
        osmId: string;
        buildingType: string;
      };
      
      const candidates: BuildingCandidate[] = [];
      const targetPoint: XY = [lng, lat];
      
      for (const element of data.elements) {
        let ring: XY[] = [];
        
        if (element.type === 'way' && element.geometry?.length >= 4) {
          // Convert OSM way geometry to [lng, lat] coordinates
          ring = element.geometry.map((node: { lat: number; lon: number }) => 
            [node.lon, node.lat] as XY
          );
        } else if (element.type === 'relation' && element.members) {
          // Handle multipolygon relations - take outer ring
          const outerWay = element.members.find((m: any) => m.role === 'outer' && m.geometry);
          if (outerWay?.geometry?.length >= 4) {
            ring = outerWay.geometry.map((node: { lat: number; lon: number }) => 
              [node.lon, node.lat] as XY
            );
          }
        }
        
        if (ring.length >= 4) {
          const closed = ensureClosed(ring);
          const centroid = calculateCentroid(closed);
          const distance = haversineDistance(lat, lng, centroid[1], centroid[0]);
          
          candidates.push({
            ring: closed,
            distance,
            containsPoint: pointInPolygon(targetPoint, closed),
            areaM2: calculatePolygonAreaM2(closed),
            osmId: element.id?.toString() || '',
            buildingType: element.tags?.building || 'yes',
          });
        }
      }
      
      if (candidates.length === 0) {
        return {
          footprint: null,
          fallbackReason: 'no_polygon_buildings',
        };
      }
      
      // Sort: containing point first, then by distance, then by residential size
      candidates.sort((a, b) => {
        // Prefer buildings that contain the target point
        if (a.containsPoint !== b.containsPoint) return a.containsPoint ? -1 : 1;
        
        // Then prefer closer buildings
        if (Math.abs(a.distance - b.distance) > 5) return a.distance - b.distance;
        
        // Prefer residential-sized buildings (100-500 m²)
        const aResidential = a.areaM2 >= 100 && a.areaM2 <= 500;
        const bResidential = b.areaM2 >= 100 && b.areaM2 <= 500;
        if (aResidential !== bResidential) return aResidential ? -1 : 1;
        
        // Prefer buildings tagged as residential types
        const residentialTypes = ['house', 'residential', 'detached', 'semidetached_house'];
        const aIsResType = residentialTypes.includes(a.buildingType);
        const bIsResType = residentialTypes.includes(b.buildingType);
        if (aIsResType !== bIsResType) return aIsResType ? -1 : 1;
        
        return 0;
      });
      
      const best = candidates[0];
      
      // Calculate confidence based on distance, containment, and vertex count
      let confidence = 0.85; // OSM data quality varies
      if (!best.containsPoint) confidence -= 0.1;
      if (best.distance > 15) confidence -= 0.1;
      if (best.distance > 30) confidence -= 0.1;
      if (best.areaM2 < 50) confidence -= 0.15;
      if (best.ring.length < 5) confidence -= 0.1; // Simple rectangles less accurate
      if (best.ring.length >= 8) confidence += 0.05; // More vertices = more detailed
      confidence = Math.max(0.45, Math.min(0.92, confidence));
      
      console.log(`✅ OSM footprint: ${best.ring.length} vertices, ${Math.round(best.areaM2)}m² (${Math.round(best.areaM2 * 10.764)}sqft), type=${best.buildingType}, distance=${best.distance.toFixed(1)}m, confidence ${(confidence * 100).toFixed(0)}%`);
      
      return {
        footprint: {
          coordinates: best.ring,
          source: 'osm_buildings',
          confidence,
          areaM2: best.areaM2,
          vertexCount: best.ring.length,
          osmId: best.osmId,
          buildingType: best.buildingType,
        },
      };
      
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        console.warn('⚠️ OSM Overpass request timed out');
        return {
          footprint: null,
          error: 'Request timeout',
          fallbackReason: 'timeout',
        };
      }
      throw fetchErr;
    }
    
  } catch (error) {
    console.error('❌ OSM footprint fetch error:', error);
    return {
      footprint: null,
      error: String(error),
      fallbackReason: 'fetch_error',
    };
  }
}

// Helper functions

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

function ensureClosed(coords: XY[]): XY[] {
  if (coords.length < 3) return coords;
  
  const first = coords[0];
  const last = coords[coords.length - 1];
  
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...coords, first];
  }
  
  return coords;
}

function calculateCentroid(coords: XY[]): XY {
  if (coords.length === 0) return [0, 0];
  const sumLng = coords.reduce((s, c) => s + c[0], 0);
  const sumLat = coords.reduce((s, c) => s + c[1], 0);
  return [sumLng / coords.length, sumLat / coords.length];
}

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

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
