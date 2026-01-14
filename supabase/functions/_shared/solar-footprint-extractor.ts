/**
 * Solar API Footprint Extractor
 * Extract accurate building footprint from Google Solar API
 * This provides ground-truth geometry instead of AI guessing
 */

export interface SolarFootprint {
  vertices: Array<{ lat: number; lng: number }>;
  confidence: number;
  source: 'google_solar_api';
  imageryQuality: string;
  imageryDate?: string;
  centerLat: number;
  centerLng: number;
  boundingBox: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export interface SolarAPIResponse {
  name?: string;
  center?: { latitude: number; longitude: number };
  boundingBox?: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  imageryDate?: { year: number; month: number; day: number };
  imageryQuality?: 'HIGH' | 'MEDIUM' | 'LOW';
  imageryProcessedDate?: { year: number; month: number; day: number };
  solarPotential?: any;
  regionCode?: string;
}

/**
 * Fetch building footprint from Google Solar API
 */
export async function fetchSolarFootprint(
  latitude: number,
  longitude: number,
  apiKey: string
): Promise<SolarFootprint | null> {
  try {
    console.log(`🌞 Fetching Solar API footprint for: ${latitude}, ${longitude}`);

    const url = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest');
    url.searchParams.append('location.latitude', latitude.toString());
    url.searchParams.append('location.longitude', longitude.toString());
    url.searchParams.append('key', apiKey);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Solar API error: ${response.status} - ${errorText}`);
      return null;
    }

    const data: SolarAPIResponse = await response.json();

    // Validate response has required data
    if (!data.boundingBox || !data.center) {
      console.warn('⚠️ Solar API returned incomplete data');
      return null;
    }

    // Check imagery quality
    const quality = data.imageryQuality || 'UNKNOWN';
    console.log(`📸 Imagery Quality: ${quality}`);

    // Only use HIGH or MEDIUM quality imagery
    if (quality !== 'HIGH' && quality !== 'MEDIUM') {
      console.warn(`⚠️ Imagery quality too low: ${quality}`);
      return null;
    }

    // Extract bounding box
    const { sw, ne } = data.boundingBox;
    
    // Convert bounding box to polygon vertices (clockwise from SW)
    const vertices = [
      { lat: sw.latitude, lng: sw.longitude },  // SW
      { lat: sw.latitude, lng: ne.longitude },  // SE
      { lat: ne.latitude, lng: ne.longitude },  // NE
      { lat: ne.latitude, lng: sw.longitude },  // NW
    ];

    // Calculate confidence based on imagery quality
    const confidence = quality === 'HIGH' ? 0.95 : 0.85;

    // Format imagery date
    let imageryDate: string | undefined;
    if (data.imageryDate) {
      imageryDate = `${data.imageryDate.year}-${String(data.imageryDate.month).padStart(2, '0')}-${String(data.imageryDate.day).padStart(2, '0')}`;
    }

    const footprint: SolarFootprint = {
      vertices,
      confidence,
      source: 'google_solar_api',
      imageryQuality: quality,
      imageryDate,
      centerLat: data.center.latitude,
      centerLng: data.center.longitude,
      boundingBox: {
        north: ne.latitude,
        south: sw.latitude,
        east: ne.longitude,
        west: sw.longitude,
      },
    };

    console.log(`✅ Solar API footprint extracted with ${confidence * 100}% confidence`);
    console.log(`📍 Bounds: N=${ne.latitude.toFixed(6)}, S=${sw.latitude.toFixed(6)}, E=${ne.longitude.toFixed(6)}, W=${sw.longitude.toFixed(6)}`);

    return footprint;

  } catch (error) {
    console.error('❌ Error fetching Solar API footprint:', error);
    return null;
  }
}

/**
 * Extract detailed roof polygon from Solar API roof segments
 * Solar API provides roofSegmentStats with detailed polygons
 */
export function extractRoofPolygonFromSegments(
  solarData: any
): Array<{ lat: number; lng: number }> | null {
  try {
    if (!solarData?.solarPotential?.roofSegmentStats) {
      return null;
    }

    const segments = solarData.solarPotential.roofSegmentStats;
    if (!segments.length) return null;

    // Collect all corner points from all segments
    const allPoints: Array<{ lat: number; lng: number }> = [];
    
    for (const segment of segments) {
      if (segment.boundingBox) {
        const { sw, ne } = segment.boundingBox;
        allPoints.push(
          { lat: sw.latitude, lng: sw.longitude },
          { lat: sw.latitude, lng: ne.longitude },
          { lat: ne.latitude, lng: ne.longitude },
          { lat: ne.latitude, lng: sw.longitude }
        );
      }
    }

    if (allPoints.length === 0) return null;

    // Calculate convex hull of all segment corners for overall footprint
    const hull = calculateConvexHull(allPoints);
    
    console.log(`📐 Extracted roof polygon from ${segments.length} Solar segments`);
    return hull;

  } catch (error) {
    console.error('❌ Error extracting roof polygon from segments:', error);
    return null;
  }
}

/**
 * Calculate convex hull of points using Graham scan
 */
function calculateConvexHull(
  points: Array<{ lat: number; lng: number }>
): Array<{ lat: number; lng: number }> {
  if (points.length < 3) return points;

  // Find the bottom-most point (or left most point in case of tie)
  let minIdx = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].lat < points[minIdx].lat ||
        (points[i].lat === points[minIdx].lat && points[i].lng < points[minIdx].lng)) {
      minIdx = i;
    }
  }

  // Place the bottom-most point at first position
  [points[0], points[minIdx]] = [points[minIdx], points[0]];
  const pivot = points[0];

  // Sort points by polar angle with respect to pivot
  const sorted = points.slice(1).sort((a, b) => {
    const angle1 = Math.atan2(a.lat - pivot.lat, a.lng - pivot.lng);
    const angle2 = Math.atan2(b.lat - pivot.lat, b.lng - pivot.lng);
    return angle1 - angle2;
  });

  const hull = [pivot];

  for (const point of sorted) {
    // Remove points that make clockwise turn
    while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
      hull.pop();
    }
    hull.push(point);
  }

  return hull;
}

function cross(o: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

/**
 * Expand bounding box to account for roof overhangs/eaves
 * Residential roofs typically have 1-3 foot overhangs
 */
export function expandFootprintForOverhang(
  vertices: Array<{ lat: number; lng: number }>,
  overhangFeet: number = 2
): Array<{ lat: number; lng: number }> {
  if (vertices.length < 3) return vertices;

  // Convert feet to approximate degrees
  // At ~28°N (Florida), 1 foot ≈ 0.0000028 degrees latitude
  // Longitude varies by latitude: 1 foot ≈ 0.0000032 degrees at 28°N
  const avgLat = vertices.reduce((sum, v) => sum + v.lat, 0) / vertices.length;
  const latFeetToDegrees = 1 / 364000; // 1 degree latitude ≈ 364,000 feet
  const lngFeetToDegrees = 1 / (364000 * Math.cos(avgLat * Math.PI / 180));
  
  const overhangLatDegrees = overhangFeet * latFeetToDegrees;
  const overhangLngDegrees = overhangFeet * lngFeetToDegrees;

  // Find center point
  const centerLat = vertices.reduce((sum, v) => sum + v.lat, 0) / vertices.length;
  const centerLng = vertices.reduce((sum, v) => sum + v.lng, 0) / vertices.length;

  // Expand each vertex away from center
  return vertices.map(vertex => {
    const latDiff = vertex.lat - centerLat;
    const lngDiff = vertex.lng - centerLng;
    
    // Calculate expansion direction (normalized)
    const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
    if (distance === 0) return vertex;
    
    const expandLat = (latDiff / distance) * overhangLatDegrees;
    const expandLng = (lngDiff / distance) * overhangLngDegrees;

    return {
      lat: vertex.lat + expandLat,
      lng: vertex.lng + expandLng,
    };
  });
}

/**
 * Convert Solar API bounding box to footprint
 */
export function boundingBoxToFootprint(
  boundingBox: { sw: { latitude: number; longitude: number }; ne: { latitude: number; longitude: number } }
): Array<{ lat: number; lng: number }> {
  const { sw, ne } = boundingBox;
  return [
    { lat: sw.latitude, lng: sw.longitude },  // SW
    { lat: sw.latitude, lng: ne.longitude },  // SE
    { lat: ne.latitude, lng: ne.longitude },  // NE
    { lat: ne.latitude, lng: sw.longitude },  // NW
  ];
}

/**
 * Validate that footprint is reasonable for residential property
 */
export function validateSolarFootprint(
  vertices: Array<{ lat: number; lng: number }>
): { valid: boolean; reason?: string; areaSqFt?: number } {
  if (vertices.length < 3) {
    return { valid: false, reason: 'Not enough vertices' };
  }

  // Calculate approximate area using Shoelace formula
  // Convert to approximate square feet
  const avgLat = vertices.reduce((sum, v) => sum + v.lat, 0) / vertices.length;
  const latToFeet = 364000;
  const lngToFeet = 364000 * Math.cos(avgLat * Math.PI / 180);

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

  // Validate reasonable size for residential
  if (areaSqFt < 500) {
    return { valid: false, reason: 'Building too small (<500 sqft)', areaSqFt };
  }

  if (areaSqFt > 50000) {
    return { valid: false, reason: 'Building too large (>50,000 sqft)', areaSqFt };
  }

  return { valid: true, areaSqFt };
}
