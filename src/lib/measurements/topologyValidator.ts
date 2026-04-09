/**
 * Topology Validator
 * 
 * Post-processes AI-detected linear features to fix common misclassifications:
 * - Valleys should only exist at reflex (concave) vertices where roof wings meet
 * - Hips should radiate from convex corners to ridge endpoints
 * - A simple rectangular perimeter should have 0 valleys
 * 
 * This corrects the AI's hip/valley confusion without re-running detection.
 */

interface GPSCoord {
  lat: number;
  lng: number;
}

interface LinearFeatureData {
  type: string;
  coords: GPSCoord[];
  length: number;
}

interface ValidationResult {
  features: LinearFeatureData[];
  corrections: string[];
  reclassifiedCount: number;
}

/**
 * Validate and correct hip/valley classification based on perimeter topology.
 * 
 * Rules:
 * 1. Find reflex (concave) vertices in the perimeter polygon
 * 2. Valleys MUST originate near a reflex vertex (within tolerance)
 * 3. Hips MUST originate near a convex vertex
 * 4. Misclassified features get reclassified
 * 5. Simple rectangular perimeters (4 vertices, no reflex) → all valleys become hips
 */
export function validateTopology(
  features: LinearFeatureData[],
  perimeterCoords: GPSCoord[]
): ValidationResult {
  const corrections: string[] = [];
  let reclassifiedCount = 0;

  // Need at least 3 perimeter points to analyze
  if (!perimeterCoords || perimeterCoords.length < 3) {
    return { features, corrections: ['Insufficient perimeter data for validation'], reclassifiedCount: 0 };
  }

  // Remove closing duplicate if present
  let vertices = [...perimeterCoords];
  if (vertices.length > 1 &&
    Math.abs(vertices[0].lat - vertices[vertices.length - 1].lat) < 1e-8 &&
    Math.abs(vertices[0].lng - vertices[vertices.length - 1].lng) < 1e-8) {
    vertices = vertices.slice(0, -1);
  }

  if (vertices.length < 3) {
    return { features, corrections: ['Insufficient unique vertices'], reclassifiedCount: 0 };
  }

  // Find reflex vertices
  const reflexIndices = findReflexVertices(vertices);
  const reflexCoords = Array.from(reflexIndices).map(i => vertices[i]);
  const convexCoords = vertices.filter((_, i) => !reflexIndices.has(i));

  const isSimpleRect = vertices.length <= 5 && reflexIndices.size === 0;

  if (isSimpleRect) {
    corrections.push(`Simple rectangular perimeter (${vertices.length} vertices, 0 reflex) - no valleys expected`);
  } else {
    corrections.push(`Complex perimeter: ${vertices.length} vertices, ${reflexIndices.size} reflex`);
  }

  // Snap tolerance in degrees (~15ft at US latitudes)
  const SNAP_TOLERANCE = 0.00015;

  const correctedFeatures = features.map(f => {
    // Only check hips and valleys
    if (f.type !== 'hip' && f.type !== 'valley') return f;
    if (f.coords.length < 2) return f;

    const startCoord = f.coords[0];
    const endCoord = f.coords[f.coords.length - 1];

    if (f.type === 'valley') {
      // Rule: valleys only valid near reflex vertices
      if (isSimpleRect) {
        // Simple rectangle → no valleys allowed, reclassify as hip
        corrections.push(`Valley (${f.length.toFixed(0)}') reclassified as hip: no reflex vertices in rectangular perimeter`);
        reclassifiedCount++;
        return { ...f, type: 'hip' };
      }

      // Check if either endpoint is near a reflex vertex
      const nearReflex = reflexCoords.some(rv =>
        isNearPoint(startCoord, rv, SNAP_TOLERANCE) || isNearPoint(endCoord, rv, SNAP_TOLERANCE)
      );

      if (!nearReflex) {
        // Check if it's near a convex corner instead → reclassify as hip
        const nearConvex = convexCoords.some(cv =>
          isNearPoint(startCoord, cv, SNAP_TOLERANCE) || isNearPoint(endCoord, cv, SNAP_TOLERANCE)
        );

        if (nearConvex) {
          corrections.push(`Valley (${f.length.toFixed(0)}') reclassified as hip: originates at convex corner, not reflex`);
          reclassifiedCount++;
          return { ...f, type: 'hip' };
        }
        // Not near any perimeter vertex - could be interior, keep as-is but warn
        corrections.push(`Valley (${f.length.toFixed(0)}') not near any perimeter vertex - possible interior feature`);
      }
    }

    if (f.type === 'hip') {
      // Rule: hips should NOT originate at reflex vertices
      const nearReflex = reflexCoords.some(rv =>
        isNearPoint(startCoord, rv, SNAP_TOLERANCE) || isNearPoint(endCoord, rv, SNAP_TOLERANCE)
      );

      if (nearReflex && !isSimpleRect) {
        corrections.push(`Hip (${f.length.toFixed(0)}') reclassified as valley: originates at reflex vertex`);
        reclassifiedCount++;
        return { ...f, type: 'valley' };
      }
    }

    return f;
  });

  if (reclassifiedCount > 0) {
    console.log(`🔧 Topology validation: reclassified ${reclassifiedCount} features`, corrections);
  }

  return { features: correctedFeatures, corrections, reclassifiedCount };
}

/**
 * Find reflex (concave) vertices in a polygon.
 * A reflex vertex has an interior angle > 180°.
 */
function findReflexVertices(vertices: GPSCoord[]): Set<number> {
  const reflex = new Set<number>();
  const n = vertices.length;

  // Determine polygon winding (CW vs CCW)
  let windingSum = 0;
  for (let i = 0; i < n; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    windingSum += (next.lng - curr.lng) * (next.lat + curr.lat);
  }
  const isCW = windingSum > 0;

  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    const cross = (curr.lng - prev.lng) * (next.lat - prev.lat) -
                  (curr.lat - prev.lat) * (next.lng - prev.lng);

    // For CW winding, reflex = cross < 0; for CCW, reflex = cross > 0
    if ((isCW && cross < -1e-10) || (!isCW && cross > 1e-10)) {
      reflex.add(i);
    }
  }

  return reflex;
}

/**
 * Check if two GPS points are within tolerance
 */
function isNearPoint(a: GPSCoord, b: GPSCoord, tolerance: number): boolean {
  return Math.abs(a.lat - b.lat) < tolerance && Math.abs(a.lng - b.lng) < tolerance;
}
