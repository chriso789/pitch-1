// Microsoft Building Footprints Extractor
// Uses Microsoft's global building footprint dataset (Open Buildings)
// Free, no API key required - covers most of the world
// 
// Data source: https://github.com/microsoft/GlobalMLBuildingFootprints
// US coverage: https://github.com/microsoft/USBuildingFootprints

type XY = [number, number]; // [lng, lat]

export interface MicrosoftFootprint {
  coordinates: XY[];
  source: 'microsoft_buildings';
  confidence: number;
  areaM2?: number;
  vertexCount: number;
}

export interface MicrosoftFootprintResult {
  footprint: MicrosoftFootprint | null;
  error?: string;
  fallbackReason?: string;
}

/**
 * Fetch building footprint from Microsoft Building Footprints via PMTiles or GeoJSON
 * Uses the publicly available quad key structure
 * 
 * Note: This is a simplified implementation that queries a tile server
 * For production, consider hosting your own PMTiles or using Azure Maps
 */
export async function fetchMicrosoftBuildingFootprint(
  lat: number,
  lng: number,
  options?: {
    searchRadius?: number; // meters
  }
): Promise<MicrosoftFootprintResult> {
  const searchRadius = options?.searchRadius || 50;
  
  try {
    // Microsoft provides data through multiple channels:
    // 1. PMTiles hosted on Azure (requires account)
    // 2. GeoJSON downloads (large files)
    // 3. Bing Maps API (requires key)
    // 
    // For now, we'll use the free Overture Maps foundation data
    // which incorporates Microsoft's building footprints
    
    // Overture Maps provides Microsoft building footprints via their API
    // https://docs.overturemaps.org/
    
    // Calculate bounding box for search
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);
    const latOffset = searchRadius / metersPerDegLat;
    const lngOffset = searchRadius / metersPerDegLng;
    
    const bbox = {
      minLng: lng - lngOffset,
      maxLng: lng + lngOffset,
      minLat: lat - latOffset,
      maxLat: lat + latOffset,
    };
    
    console.log(`🏢 Microsoft/Overture search: ${lat.toFixed(6)}, ${lng.toFixed(6)} (radius=${searchRadius}m)`);
    
    // Query Overture Maps buildings endpoint (public, no key needed)
    // This uses DuckDB's spatial extension via a public endpoint
    // Note: For production, host your own Overture data or use parquet files
    
    // Alternative: Use the free Esri Building Footprints service
    // which also incorporates Microsoft data
    const esriUrl = `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Structures/FeatureServer/0/query?where=1%3D1&geometry=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=*&f=geojson`;
    
    const response = await fetch(esriUrl);
    
    if (!response.ok) {
      console.warn(`⚠️ Microsoft/Esri Buildings API failed: ${response.status}`);
      return {
        footprint: null,
        error: `API error: ${response.status}`,
        fallbackReason: 'api_error',
      };
    }
    
    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
      console.log('⚠️ No Microsoft/Esri building footprints found');
      return {
        footprint: null,
        fallbackReason: 'no_buildings_found',
      };
    }
    
    console.log(`📊 Microsoft/Esri: ${data.features.length} buildings found`);
    
    // Find the building closest to / containing the point
    type BuildingCandidate = {
      ring: XY[];
      distance: number;
      containsPoint: boolean;
      areaM2: number;
    };
    
    const candidates: BuildingCandidate[] = [];
    const targetPoint: XY = [lng, lat];
    
    for (const feature of data.features) {
      const geom = feature.geometry;
      
      if (geom?.type === 'Polygon' && geom.coordinates?.[0]?.length >= 4) {
        const ring = geom.coordinates[0] as XY[];
        const closed = ensureClosed(ring);
        const centroid = calculateCentroid(closed);
        const distance = haversineDistance(lat, lng, centroid[1], centroid[0]);
        
        candidates.push({
          ring: closed,
          distance,
          containsPoint: pointInPolygon(targetPoint, closed),
          areaM2: calculatePolygonAreaM2(closed),
        });
      } else if (geom?.type === 'MultiPolygon') {
        for (const polygonCoords of geom.coordinates) {
          if (polygonCoords?.[0]?.length >= 4) {
            const ring = polygonCoords[0] as XY[];
            const closed = ensureClosed(ring);
            const centroid = calculateCentroid(closed);
            const distance = haversineDistance(lat, lng, centroid[1], centroid[0]);
            
            candidates.push({
              ring: closed,
              distance,
              containsPoint: pointInPolygon(targetPoint, closed),
              areaM2: calculatePolygonAreaM2(closed),
            });
          }
        }
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
      if (a.containsPoint !== b.containsPoint) return a.containsPoint ? -1 : 1;
      if (Math.abs(a.distance - b.distance) > 5) return a.distance - b.distance;
      const aResidential = a.areaM2 >= 100 && a.areaM2 <= 500;
      const bResidential = b.areaM2 >= 100 && b.areaM2 <= 500;
      if (aResidential !== bResidential) return aResidential ? -1 : 1;
      return 0;
    });
    
    const best = candidates[0];
    
    // Calculate confidence based on distance and containment
    let confidence = 0.88; // Microsoft data is generally good quality
    if (!best.containsPoint) confidence -= 0.1;
    if (best.distance > 15) confidence -= 0.1;
    if (best.distance > 30) confidence -= 0.1;
    if (best.areaM2 < 50) confidence -= 0.15;
    confidence = Math.max(0.5, Math.min(0.95, confidence));
    
    console.log(`✅ Microsoft footprint: ${best.ring.length} vertices, ${Math.round(best.areaM2)}m² (${Math.round(best.areaM2 * 10.764)}sqft), distance=${best.distance.toFixed(1)}m, confidence ${(confidence * 100).toFixed(0)}%`);
    
    return {
      footprint: {
        coordinates: best.ring,
        source: 'microsoft_buildings',
        confidence,
        areaM2: best.areaM2,
        vertexCount: best.ring.length,
      },
    };
    
  } catch (error) {
    console.error('❌ Microsoft footprint fetch error:', error);
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
