// Facet Splitter - Divides roof footprint into individual facets
// Uses skeleton topology to create proper facet polygons with area/pitch/azimuth

type XY = [number, number]; // [lng, lat]

interface SkeletonEdge {
  start: XY;
  end: XY;
  type: 'ridge' | 'hip' | 'valley';
}

export interface RoofFacet {
  id: string;
  polygon: XY[];
  area: number; // Sloped area in sq ft
  planArea: number; // Flat/projected area in sq ft
  pitch: number; // Degrees
  pitchRatio: string; // e.g., "4/12"
  azimuth: number; // Direction faced, 0-360 from North
  requiresReview: boolean;
  reviewReason?: string;
}

interface SplitResult {
  facets: RoofFacet[];
  manualReviewRecommended: boolean;
  splitQuality: number; // 0-1
}

/**
 * Split footprint into facets using skeleton topology
 */
export function splitFootprintIntoFacets(
  footprint: XY[],
  skeleton: SkeletonEdge[],
  googleSolarSegments?: any[]
): SplitResult {
  // Ensure closed footprint
  if (!isClosed(footprint)) {
    footprint = [...footprint, footprint[0]];
  }

  const vertices = footprint.slice(0, -1);
  const n = vertices.length;

  // If we have Google Solar segments with actual data, use those
  if (googleSolarSegments && googleSolarSegments.length > 0) {
    return createFacetsFromGoogleSegments(footprint, googleSolarSegments);
  }

  // Otherwise, derive facets from skeleton topology
  const ridges = skeleton.filter(e => e.type === 'ridge');
  const hips = skeleton.filter(e => e.type === 'hip');
  const valleys = skeleton.filter(e => e.type === 'valley');

  console.log(`Splitting footprint: ${n} vertices, ${ridges.length} ridges, ${hips.length} hips, ${valleys.length} valleys`);

  // Simple case: rectangular building with single ridge
  if (n === 4 && ridges.length === 1 && valleys.length === 0) {
    return splitRectangularRoof(footprint, ridges[0], hips);
  }

  // Complex case: L, T, U shapes or multi-ridge
  return splitComplexRoof(footprint, skeleton);
}

/**
 * Create facets from Google Solar segment data
 */
function createFacetsFromGoogleSegments(
  footprint: XY[],
  segments: any[]
): SplitResult {
  const facets: RoofFacet[] = [];
  let totalQuality = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const pitchDeg = seg.pitchDegrees || 18.5; // Default ~4/12
    const azimuthDeg = seg.azimuthDegrees || 0;
    const areaSqM = seg.stats?.areaMeters2 || 0;
    const areaSqFt = areaSqM * 10.7639;

    // Calculate pitch factor for plan area
    const pitchFactor = 1 / Math.cos(pitchDeg * Math.PI / 180);
    const planAreaSqFt = areaSqFt / pitchFactor;

    facets.push({
      id: String.fromCharCode(65 + i), // A, B, C...
      polygon: footprint, // Google doesn't give us facet polygons, use footprint
      area: areaSqFt,
      planArea: planAreaSqFt,
      pitch: pitchDeg,
      pitchRatio: degreesToPitchRatio(pitchDeg),
      azimuth: azimuthDeg,
      requiresReview: false
    });

    totalQuality += 0.9; // High quality from Google data
  }

  return {
    facets,
    manualReviewRecommended: false,
    splitQuality: facets.length > 0 ? totalQuality / facets.length : 0
  };
}

/**
 * Split a simple rectangular roof
 */
function splitRectangularRoof(
  footprint: XY[],
  ridge: SkeletonEdge,
  hips: SkeletonEdge[]
): SplitResult {
  const vertices = footprint.slice(0, -1);
  
  // Find which sides of the rectangle are split by the ridge
  const ridgeMidY = (ridge.start[1] + ridge.end[1]) / 2;
  const centroidY = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
  
  // Create two facets (front and back)
  const facet1Verts: XY[] = [];
  const facet2Verts: XY[] = [];
  
  for (const v of vertices) {
    if (v[1] > centroidY) {
      facet1Verts.push(v);
    } else {
      facet2Verts.push(v);
    }
  }
  
  // Add ridge endpoints to each facet
  facet1Verts.push(ridge.start, ridge.end);
  facet2Verts.push(ridge.start, ridge.end);
  
  // Sort vertices to form proper polygons
  const sorted1 = sortPolygonVertices(facet1Verts);
  const sorted2 = sortPolygonVertices(facet2Verts);
  
  // Calculate areas
  const area1 = calculatePolygonAreaSqFt(sorted1);
  const area2 = calculatePolygonAreaSqFt(sorted2);
  
  // Estimate pitch based on building dimensions
  const width = Math.abs(vertices[0][0] - vertices[2][0]) * 111000 * Math.cos(vertices[0][1] * Math.PI / 180);
  const estimatedRise = width * 0.25; // Assume moderate pitch
  const estimatedPitch = Math.atan(estimatedRise / (width / 2)) * 180 / Math.PI;
  
  const facets: RoofFacet[] = [
    {
      id: 'A',
      polygon: closePolygon(sorted1),
      area: area1 * (1 / Math.cos(estimatedPitch * Math.PI / 180)),
      planArea: area1,
      pitch: estimatedPitch,
      pitchRatio: degreesToPitchRatio(estimatedPitch),
      azimuth: 0, // North-facing
      requiresReview: true,
      reviewReason: 'Pitch estimated from geometry'
    },
    {
      id: 'B',
      polygon: closePolygon(sorted2),
      area: area2 * (1 / Math.cos(estimatedPitch * Math.PI / 180)),
      planArea: area2,
      pitch: estimatedPitch,
      pitchRatio: degreesToPitchRatio(estimatedPitch),
      azimuth: 180, // South-facing
      requiresReview: true,
      reviewReason: 'Pitch estimated from geometry'
    }
  ];
  
  return {
    facets,
    manualReviewRecommended: true,
    splitQuality: 0.7
  };
}

/**
 * Split a complex roof (L, T, U shapes)
 * 
 * IMPORTANT: We no longer create placeholder facets with the entire footprint.
 * Instead, we return NO facets and flag for manual review.
 * This prevents misleading geometry from being displayed.
 */
function splitComplexRoof(
  footprint: XY[],
  skeleton: SkeletonEdge[]
): SplitResult {
  const vertices = footprint.slice(0, -1);
  const n = vertices.length;
  
  // Count reflex vertices to understand complexity
  const reflexIndices = findReflexVertices(vertices);
  const numReflex = reflexIndices.size;
  
  // Calculate total footprint area for reference
  const totalPlanArea = calculatePolygonAreaSqFt(vertices);
  
  // Estimate number of facets (for metadata only, not creating placeholder facets)
  const estimatedFacetCount = Math.max(4, n - numReflex);
  
  console.log(`Complex roof: ${n} vertices, ${numReflex} reflex. Estimated ${estimatedFacetCount} facets. Returning empty facets for manual review.`);
  console.log(`Total plan area: ${Math.round(totalPlanArea)} sqft`);
  
  // DO NOT create placeholder facets - this was causing the ~4800 sqft issue
  // where all facets used the entire footprint polygon as their geometry.
  // Instead, return empty facets array and flag for manual review.
  
  return {
    facets: [], // No placeholder facets - user must verify/draw
    manualReviewRecommended: true,
    splitQuality: 0.3, // Low quality indicates we couldn't split properly
  };
}

// ===== Utility Functions =====

function isClosed(ring: XY[]): boolean {
  const a = ring[0], b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

function closePolygon(vertices: XY[]): XY[] {
  if (isClosed(vertices)) return vertices;
  return [...vertices, vertices[0]];
}

function findReflexVertices(vertices: XY[]): Set<number> {
  const reflex = new Set<number>();
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    
    // Cross product to determine concavity
    const ax = prev[0] - curr[0];
    const ay = prev[1] - curr[1];
    const bx = next[0] - curr[0];
    const by = next[1] - curr[1];
    const cross = ax * by - ay * bx;
    
    if (cross < 0) reflex.add(i);
  }
  
  return reflex;
}

function sortPolygonVertices(vertices: XY[]): XY[] {
  if (vertices.length < 3) return vertices;
  
  // Find centroid
  const cx = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
  const cy = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
  
  // Sort by angle from centroid
  return vertices.slice().sort((a, b) => {
    const angleA = Math.atan2(a[1] - cy, a[0] - cx);
    const angleB = Math.atan2(b[1] - cy, b[0] - cx);
    return angleA - angleB;
  });
}

function calculatePolygonAreaSqFt(coords: XY[]): number {
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
  
  const areaSqM = Math.abs(sum) / 2;
  return areaSqM * 10.7639; // Convert to sq ft
}

function degreesToPitchRatio(degrees: number): string {
  if (degrees < 2) return 'flat';
  const rise = Math.round(Math.tan(degrees * Math.PI / 180) * 12);
  return `${rise}/12`;
}

// Types are exported inline above
