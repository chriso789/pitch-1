/**
 * Geometry Validator
 * Validate roof geometry for accuracy and reasonableness
 */

export interface ValidationResult {
  valid: boolean;
  confidence: number;
  errors: string[];
  warnings: string[];
  metrics: {
    areaSqFt: number;
    perimeterFt: number;
    vertexCount: number;
    aspectRatio: number;
    compactness: number;
  };
}

export type FootprintSource = 'google_solar_api' | 'regrid_parcel' | 'ai_detection' | 'manual';

/**
 * Haversine formula for calculating distance between GPS coordinates
 * Returns distance in feet
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 20902231; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate polygon area in square feet using GPS coordinates
 */
export function calculateAreaSqFt(vertices: Array<{ lat: number; lng: number }>): number {
  if (vertices.length < 3) return 0;

  // Use the Shoelace formula with proper coordinate conversion
  const avgLat = vertices.reduce((sum, v) => sum + v.lat, 0) / vertices.length;
  
  // Convert degrees to feet at this latitude
  const latToFeet = 364000; // 1 degree latitude ≈ 364,000 feet
  const lngToFeet = 364000 * Math.cos(avgLat * Math.PI / 180);

  // Convert to local coordinate system in feet
  const localVertices = vertices.map(v => ({
    x: v.lng * lngToFeet,
    y: v.lat * latToFeet,
  }));

  // Shoelace formula
  let area = 0;
  for (let i = 0; i < localVertices.length; i++) {
    const j = (i + 1) % localVertices.length;
    area += localVertices[i].x * localVertices[j].y;
    area -= localVertices[j].x * localVertices[i].y;
  }

  return Math.abs(area / 2);
}

/**
 * Calculate polygon perimeter in feet
 */
export function calculatePerimeterFt(vertices: Array<{ lat: number; lng: number }>): number {
  if (vertices.length < 2) return 0;

  let perimeter = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const distance = haversineDistance(
      vertices[i].lat,
      vertices[i].lng,
      vertices[j].lat,
      vertices[j].lng
    );
    perimeter += distance;
  }

  return perimeter;
}

/**
 * Calculate aspect ratio (width/height) of bounding box
 */
export function calculateAspectRatio(vertices: Array<{ lat: number; lng: number }>): number {
  if (vertices.length < 3) return 1;

  const lats = vertices.map(v => v.lat);
  const lngs = vertices.map(v => v.lng);
  
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const height = haversineDistance(minLat, minLng, maxLat, minLng);
  const width = haversineDistance(minLat, minLng, minLat, maxLng);

  if (height === 0) return 1;
  return width / height;
}

/**
 * Calculate compactness (how circular the shape is)
 * A perfect circle has compactness of 1, a line has compactness of 0
 */
export function calculateCompactness(
  areaSqFt: number,
  perimeterFt: number
): number {
  if (perimeterFt === 0) return 0;
  
  // Isoperimetric quotient: 4π * area / perimeter²
  // A perfect circle has value of 1
  return (4 * Math.PI * areaSqFt) / (perimeterFt * perimeterFt);
}

/**
 * Validate roof geometry
 */
export function validateGeometry(
  vertices: Array<{ lat: number; lng: number }>,
  source: FootprintSource
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let confidence = 1.0;

  // Calculate metrics
  const areaSqFt = calculateAreaSqFt(vertices);
  const perimeterFt = calculatePerimeterFt(vertices);
  const vertexCount = vertices.length;
  const aspectRatio = calculateAspectRatio(vertices);
  const compactness = calculateCompactness(areaSqFt, perimeterFt);

  // Validation checks
  if (vertexCount < 3) {
    errors.push('Polygon must have at least 3 vertices');
    confidence = 0;
  }

  if (vertexCount < 4) {
    warnings.push('Polygon has very few vertices - may be oversimplified');
    confidence *= 0.8;
  }

  if (areaSqFt < 500) {
    errors.push(`Area too small: ${areaSqFt.toFixed(0)} sqft (minimum 500 sqft)`);
    confidence *= 0.3;
  } else if (areaSqFt < 800) {
    warnings.push(`Area is small: ${areaSqFt.toFixed(0)} sqft - verify measurement`);
    confidence *= 0.9;
  }

  if (areaSqFt > 50000) {
    errors.push(`Area too large: ${areaSqFt.toFixed(0)} sqft (maximum 50,000 sqft for residential)`);
    confidence *= 0.3;
  } else if (areaSqFt > 10000) {
    warnings.push(`Large area: ${areaSqFt.toFixed(0)} sqft - verify for residential property`);
    confidence *= 0.9;
  }

  if (aspectRatio < 0.2 || aspectRatio > 5) {
    warnings.push(`Unusual aspect ratio: ${aspectRatio.toFixed(2)} (typical range: 0.5-2.0)`);
    confidence *= 0.85;
  }

  if (compactness < 0.3) {
    warnings.push(`Low compactness: ${compactness.toFixed(2)} - shape may be irregular`);
    confidence *= 0.9;
  }

  // Check for degenerate edges
  let shortEdgeCount = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const edgeLength = haversineDistance(
      vertices[i].lat,
      vertices[i].lng,
      vertices[j].lat,
      vertices[j].lng
    );
    
    if (edgeLength < 1) {
      shortEdgeCount++;
    }
  }

  if (shortEdgeCount > 0) {
    warnings.push(`${shortEdgeCount} very short edge(s) detected (<1 ft)`);
    confidence *= Math.max(0.8, 1 - (shortEdgeCount * 0.05));
  }

  // Check for self-intersection (simplified check)
  if (hasSelfIntersection(vertices)) {
    errors.push('Polygon appears to self-intersect');
    confidence *= 0.5;
  }

  // Source-based confidence adjustments
  switch (source) {
    case 'google_solar_api':
      confidence *= 0.98; // Solar API is very reliable
      break;
    case 'regrid_parcel':
      confidence *= 0.90; // Parcel data is good but may be outdated
      break;
    case 'ai_detection':
      confidence *= 0.65; // AI detection is less reliable
      warnings.push('Geometry from AI detection - manual verification recommended');
      break;
    case 'manual':
      confidence *= 0.95; // Manual tracing is usually good
      break;
  }

  return {
    valid: errors.length === 0,
    confidence: Math.max(0, Math.min(1, confidence)),
    errors,
    warnings,
    metrics: {
      areaSqFt,
      perimeterFt,
      vertexCount,
      aspectRatio,
      compactness,
    },
  };
}

/**
 * Simple self-intersection check
 */
function hasSelfIntersection(vertices: Array<{ lat: number; lng: number }>): boolean {
  const n = vertices.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      // Skip adjacent edges
      if (i === 0 && j === n - 1) continue;

      const a1 = vertices[i];
      const a2 = vertices[(i + 1) % n];
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];

      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return false;
}

function segmentsIntersect(
  a1: { lat: number; lng: number },
  a2: { lat: number; lng: number },
  b1: { lat: number; lng: number },
  b2: { lat: number; lng: number }
): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

function direction(
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number },
  p3: { lat: number; lng: number }
): number {
  return (p3.lng - p1.lng) * (p2.lat - p1.lat) - (p2.lng - p1.lng) * (p3.lat - p1.lat);
}

/**
 * Convert geo vertices to pixel coordinates
 */
export function geoToPixel(
  vertices: Array<{ lat: number; lng: number }>,
  center: { lat: number; lng: number },
  imageSize: number,
  zoomLevel: number = 20
): Array<{ x: number; y: number }> {
  const scale = Math.pow(2, zoomLevel) * 256;
  
  return vertices.map(v => {
    const x = (v.lng - center.lng) * (scale / 360) + imageSize / 2;
    const latRad = v.lat * Math.PI / 180;
    const centerLatRad = center.lat * Math.PI / 180;
    const y = (Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2)) - 
               Math.log(Math.tan(Math.PI / 4 + latRad / 2))) * 
              (scale / (2 * Math.PI)) + imageSize / 2;
    return { x, y };
  });
}

/**
 * Convert pixel coordinates back to geo
 */
export function pixelToGeo(
  pixels: Array<{ x: number; y: number }>,
  center: { lat: number; lng: number },
  imageSize: number,
  zoomLevel: number = 20
): Array<{ lat: number; lng: number }> {
  const scale = Math.pow(2, zoomLevel) * 256;

  return pixels.map(p => {
    const lng = center.lng + (p.x - imageSize / 2) * 360 / scale;
    const centerLatRad = center.lat * Math.PI / 180;
    const yOffset = (p.y - imageSize / 2) * (2 * Math.PI) / scale;
    const latRad = 2 * Math.atan(Math.exp(Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2)) - yOffset)) - Math.PI / 2;
    const lat = latRad * 180 / Math.PI;
    return { lat, lng };
  });
}

/**
 * Format validation result for logging
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];
  
  lines.push(`Valid: ${result.valid ? '✅' : '❌'}`);
  lines.push(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  lines.push(`Area: ${result.metrics.areaSqFt.toFixed(0)} sqft`);
  lines.push(`Perimeter: ${result.metrics.perimeterFt.toFixed(0)} ft`);
  lines.push(`Vertices: ${result.metrics.vertexCount}`);
  lines.push(`Aspect Ratio: ${result.metrics.aspectRatio.toFixed(2)}`);
  lines.push(`Compactness: ${result.metrics.compactness.toFixed(2)}`);

  if (result.errors.length > 0) {
    lines.push(`Errors: ${result.errors.join(', ')}`);
  }

  if (result.warnings.length > 0) {
    lines.push(`Warnings: ${result.warnings.join(', ')}`);
  }

  return lines.join('\n');
}
