/**
 * Regrid Footprint Extractor
 * Extract building footprint from Regrid parcel API
 * Fallback when Solar API is unavailable
 * Regrid provides county assessor building footprints
 */

export interface RegridFootprint {
  vertices: Array<{ lat: number; lng: number }>;
  confidence: number;
  source: 'regrid_parcel';
  parcelId?: string;
  county?: string;
  state?: string;
  buildingArea?: number;
  yearBuilt?: number;
}

export interface RegridParcelResponse {
  results?: Array<{
    properties?: {
      ll_uuid?: string;
      county?: string;
      state?: string;
      building_sqft?: number;
      year_built?: number;
      building_geometry?: any;
    };
    geometry?: {
      type: string;
      coordinates: number[][][];
    };
  }>;
}

/**
 * Fetch building footprint from Regrid API
 */
export async function fetchRegridFootprint(
  latitude: number,
  longitude: number,
  apiKey: string
): Promise<RegridFootprint | null> {
  try {
    console.log(`🗺️ Fetching Regrid parcel footprint for: ${latitude}, ${longitude}`);

    // FIXED: Use correct Regrid API v2 URL format per their documentation
    // Format: https://app.regrid.com/api/v2/us/parcels/point?lat=...&lon=...&token=...
    // Note: No .json extension, use /us/ country code prefix, and query params
    const url = `https://app.regrid.com/api/v2/us/parcels/point?lat=${latitude}&lon=${longitude}&token=${apiKey}&return_geometry=true`;

    console.log(`🔗 Regrid request URL: ${url.replace(apiKey, 'REDACTED')}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read response');
      console.error(`❌ Regrid API error: ${response.status} - ${errorText.substring(0, 200)}`);
      return null;
    }

    const data: RegridParcelResponse = await response.json();

    // Regrid returns GeoJSON with building footprints
    if (!data.results || data.results.length === 0) {
      console.warn('⚠️ No Regrid parcels found at location');
      return null;
    }

    const parcel = data.results[0];
    
    // Try to get building geometry first, fall back to parcel geometry
    const geometry = parcel.properties?.building_geometry || parcel.geometry;

    if (!geometry || !geometry.coordinates) {
      console.warn('⚠️ Regrid parcel has no geometry');
      return null;
    }

    // Handle different geometry types
    let coords: number[][];
    if (geometry.type === 'Polygon') {
      coords = geometry.coordinates[0]; // First ring of polygon
    } else if (geometry.type === 'MultiPolygon') {
      // Use the largest polygon (main building)
      let maxArea = 0;
      let maxCoords = geometry.coordinates[0][0];
      for (const poly of geometry.coordinates) {
        const area = calculatePolygonArea(poly[0]);
        if (area > maxArea) {
          maxArea = area;
          maxCoords = poly[0];
        }
      }
      coords = maxCoords;
    } else {
      console.warn(`⚠️ Unsupported geometry type: ${geometry.type}`);
      return null;
    }

    // Convert GeoJSON coordinates to our format
    // GeoJSON format: [lng, lat] - we need {lat, lng}
    const vertices = coords.map((coord: number[]) => ({
      lat: coord[1],
      lng: coord[0],
    }));

    // Remove duplicate closing vertex if present
    if (vertices.length > 1) {
      const first = vertices[0];
      const last = vertices[vertices.length - 1];
      if (Math.abs(first.lat - last.lat) < 0.0000001 && 
          Math.abs(first.lng - last.lng) < 0.0000001) {
        vertices.pop();
      }
    }

    // Validate minimum vertices
    if (vertices.length < 3) {
      console.warn('⚠️ Regrid footprint has too few vertices');
      return null;
    }

    const footprint: RegridFootprint = {
      vertices,
      confidence: 0.85, // Regrid data is pretty accurate (county assessor)
      source: 'regrid_parcel',
      parcelId: parcel.properties?.ll_uuid,
      county: parcel.properties?.county,
      state: parcel.properties?.state,
      buildingArea: parcel.properties?.building_sqft,
      yearBuilt: parcel.properties?.year_built,
    };

    console.log(`✅ Regrid footprint extracted with 85% confidence`);
    console.log(`📍 ${vertices.length} vertices from ${footprint.county || 'Unknown'}, ${footprint.state || 'Unknown'}`);
    if (footprint.buildingArea) {
      console.log(`📐 Building area: ${footprint.buildingArea} sqft`);
    }

    return footprint;

  } catch (error) {
    console.error('❌ Error fetching Regrid footprint:', error);
    return null;
  }
}

/**
 * Calculate polygon area from coordinates array
 */
function calculatePolygonArea(coords: number[][]): number {
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    area += coords[i][0] * coords[j][1];
    area -= coords[j][0] * coords[i][1];
  }
  return Math.abs(area / 2);
}

/**
 * Simplify polygon to reduce vertex count while maintaining shape
 * Uses Douglas-Peucker algorithm
 */
export function simplifyPolygon(
  vertices: Array<{ lat: number; lng: number }>,
  tolerance: number = 0.00001
): Array<{ lat: number; lng: number }> {
  if (vertices.length <= 4) return vertices;

  const simplified = douglasPeucker(vertices, tolerance);
  
  // Ensure we have at least 4 vertices for a building
  if (simplified.length < 4) {
    return vertices.slice(0, 4);
  }

  return simplified;
}

function douglasPeucker(
  points: Array<{ lat: number; lng: number }>,
  tolerance: number
): Array<{ lat: number; lng: number }> {
  if (points.length <= 2) return points;

  // Find the point with the maximum distance from line
  let maxDist = 0;
  let maxIndex = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  // Return just start and end points
  return [start, end];
}

function perpendicularDistance(
  point: { lat: number; lng: number },
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number }
): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  
  const lineLength = Math.sqrt(dx * dx + dy * dy);
  if (lineLength === 0) {
    const pdx = point.lng - lineStart.lng;
    const pdy = point.lat - lineStart.lat;
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }

  const t = ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / (lineLength * lineLength);
  
  let nearestLng: number;
  let nearestLat: number;
  
  if (t < 0) {
    nearestLng = lineStart.lng;
    nearestLat = lineStart.lat;
  } else if (t > 1) {
    nearestLng = lineEnd.lng;
    nearestLat = lineEnd.lat;
  } else {
    nearestLng = lineStart.lng + t * dx;
    nearestLat = lineStart.lat + t * dy;
  }

  const pdx = point.lng - nearestLng;
  const pdy = point.lat - nearestLat;
  return Math.sqrt(pdx * pdx + pdy * pdy);
}

/**
 * Validate Regrid footprint for residential use
 */
export function validateRegridFootprint(
  footprint: RegridFootprint
): { valid: boolean; reason?: string } {
  const { vertices } = footprint;

  if (vertices.length < 3) {
    return { valid: false, reason: 'Not enough vertices' };
  }

  // Calculate approximate area
  const avgLat = vertices.reduce((sum, v) => sum + v.lat, 0) / vertices.length;
  const lngToFeet = 364000 * Math.cos(avgLat * Math.PI / 180);
  const latToFeet = 364000;

  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const x1 = vertices[i].lng * lngToFeet;
    const y1 = vertices[i].lat * latToFeet;
    const x2 = vertices[j].lng * lngToFeet;
    const y2 = vertices[j].lat * latToFeet;
    area += x1 * y2 - x2 * y1;
  }
  const areaSqFt = Math.abs(area / 2);

  if (areaSqFt < 500) {
    return { valid: false, reason: `Building too small (${areaSqFt.toFixed(0)} sqft)` };
  }

  if (areaSqFt > 50000) {
    return { valid: false, reason: `Building too large (${areaSqFt.toFixed(0)} sqft)` };
  }

  return { valid: true };
}
