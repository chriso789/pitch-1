// DSM (Digital Surface Model) Analyzer for Roof Geometry Refinement
// Uses Google Solar API DSM data to snap ridges/valleys to actual elevation profiles

type XY = [number, number]; // [lng, lat]

interface DSMGrid {
  data: number[][]; // 2D elevation grid in meters
  bounds: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  resolution: number; // meters per pixel
  width: number;
  height: number;
}

interface DSMRefinedEdge {
  start: XY;
  end: XY;
  type: 'ridge' | 'hip' | 'valley';
  confidence: number; // 0-1 based on DSM alignment
  elevationStart?: number;
  elevationEnd?: number;
  requiresReview: boolean;
}

interface DSMAnalysisResult {
  refinedEdges: DSMRefinedEdge[];
  facetPitches: Map<string, { pitch: number; azimuth: number; confidence: number }>;
  dsmAvailable: boolean;
  qualityScore: number; // 0-1 overall DSM quality
}

/**
 * Analyze DSM data to refine roof geometry
 * Snaps ridges to high points, valleys to low points
 */
export function analyzeDSM(
  dsmGrid: DSMGrid | null,
  skeletonEdges: Array<{ start: XY; end: XY; type: 'ridge' | 'hip' | 'valley' }>,
  footprint: XY[]
): DSMAnalysisResult {
  if (!dsmGrid || !dsmGrid.data || dsmGrid.data.length === 0) {
    console.log('DSM data not available, returning unrefined edges');
    return {
      refinedEdges: skeletonEdges.map(e => ({
        ...e,
        confidence: 0.6, // Lower confidence without DSM
        requiresReview: true
      })),
      facetPitches: new Map(),
      dsmAvailable: false,
      qualityScore: 0
    };
  }

  console.log(`Analyzing DSM grid: ${dsmGrid.width}x${dsmGrid.height} pixels`);

  const refinedEdges: DSMRefinedEdge[] = [];
  let totalConfidence = 0;

  for (const edge of skeletonEdges) {
    const refined = refineEdgeWithDSM(edge, dsmGrid);
    refinedEdges.push(refined);
    totalConfidence += refined.confidence;
  }

  // Calculate facet pitches from DSM
  const facetPitches = calculateFacetPitchesFromDSM(dsmGrid, footprint, refinedEdges);

  const qualityScore = skeletonEdges.length > 0 
    ? totalConfidence / skeletonEdges.length 
    : 0;

  return {
    refinedEdges,
    facetPitches,
    dsmAvailable: true,
    qualityScore
  };
}

/**
 * Refine a single edge using DSM elevation data
 */
function refineEdgeWithDSM(
  edge: { start: XY; end: XY; type: 'ridge' | 'hip' | 'valley' },
  dsmGrid: DSMGrid
): DSMRefinedEdge {
  const startElev = getElevationAt(edge.start, dsmGrid);
  const endElev = getElevationAt(edge.end, dsmGrid);

  // Sample elevations along the edge
  const samples = 10;
  const elevations: number[] = [];
  
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const point: XY = [
      edge.start[0] + (edge.end[0] - edge.start[0]) * t,
      edge.start[1] + (edge.end[1] - edge.start[1]) * t
    ];
    const elev = getElevationAt(point, dsmGrid);
    if (elev !== null) elevations.push(elev);
  }

  if (elevations.length < 3) {
    return {
      ...edge,
      confidence: 0.5,
      requiresReview: true
    };
  }

  // Analyze elevation profile
  const avgElev = elevations.reduce((a, b) => a + b, 0) / elevations.length;
  const maxElev = Math.max(...elevations);
  const minElev = Math.min(...elevations);
  const elevRange = maxElev - minElev;

  let confidence = 0.7; // Base confidence
  let requiresReview = false;

  // Validate edge type against elevation profile
  if (edge.type === 'ridge') {
    // Ridge should be at or near maximum elevation
    const ridgeScore = (avgElev - minElev) / (elevRange || 1);
    confidence = Math.min(0.95, 0.6 + ridgeScore * 0.35);
    
    // Check if all points are near max elevation
    const highPoints = elevations.filter(e => e > avgElev - elevRange * 0.1).length;
    if (highPoints < elevations.length * 0.7) {
      requiresReview = true;
      confidence *= 0.8;
    }
  } else if (edge.type === 'valley') {
    // Valley should be at or near minimum elevation
    const valleyScore = (maxElev - avgElev) / (elevRange || 1);
    confidence = Math.min(0.95, 0.6 + valleyScore * 0.35);
    
    // Check if all points are near min elevation
    const lowPoints = elevations.filter(e => e < avgElev + elevRange * 0.1).length;
    if (lowPoints < elevations.length * 0.7) {
      requiresReview = true;
      confidence *= 0.8;
    }
  } else if (edge.type === 'hip') {
    // Hip should show consistent slope from high to low
    const isDecreasing = startElev !== null && endElev !== null && 
      (startElev > endElev || endElev > startElev);
    confidence = isDecreasing ? 0.85 : 0.7;
  }

  // Snap endpoints to local extrema if needed
  const refinedStart = snapToLocalExtrema(edge.start, edge.type, dsmGrid);
  const refinedEnd = snapToLocalExtrema(edge.end, edge.type, dsmGrid);

  return {
    start: refinedStart,
    end: refinedEnd,
    type: edge.type,
    confidence,
    elevationStart: startElev ?? undefined,
    elevationEnd: endElev ?? undefined,
    requiresReview
  };
}

/**
 * Get elevation at a point from DSM grid
 */
function getElevationAt(point: XY, dsmGrid: DSMGrid): number | null {
  const { bounds, width, height, data } = dsmGrid;
  
  // Convert lng/lat to pixel coordinates
  const x = Math.floor((point[0] - bounds.minLng) / (bounds.maxLng - bounds.minLng) * width);
  const y = Math.floor((bounds.maxLat - point[1]) / (bounds.maxLat - bounds.minLat) * height);
  
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return null;
  }
  
  return data[y]?.[x] ?? null;
}

/**
 * Snap point to local extrema (peak for ridges, trough for valleys)
 */
function snapToLocalExtrema(
  point: XY,
  edgeType: 'ridge' | 'hip' | 'valley',
  dsmGrid: DSMGrid,
  searchRadius = 3 // pixels
): XY {
  const { bounds, width, height, data } = dsmGrid;
  
  const centerX = Math.floor((point[0] - bounds.minLng) / (bounds.maxLng - bounds.minLng) * width);
  const centerY = Math.floor((bounds.maxLat - point[1]) / (bounds.maxLat - bounds.minLat) * height);
  
  let bestX = centerX;
  let bestY = centerY;
  let bestElev = data[centerY]?.[centerX] ?? 0;
  
  const findMax = edgeType === 'ridge' || edgeType === 'hip';
  
  for (let dy = -searchRadius; dy <= searchRadius; dy++) {
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      const x = centerX + dx;
      const y = centerY + dy;
      
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const elev = data[y]?.[x] ?? 0;
      if ((findMax && elev > bestElev) || (!findMax && elev < bestElev)) {
        bestElev = elev;
        bestX = x;
        bestY = y;
      }
    }
  }
  
  // If we found a better point, convert back to lng/lat
  if (bestX !== centerX || bestY !== centerY) {
    return [
      bounds.minLng + (bestX + 0.5) / width * (bounds.maxLng - bounds.minLng),
      bounds.maxLat - (bestY + 0.5) / height * (bounds.maxLat - bounds.minLat)
    ];
  }
  
  return point;
}

/**
 * Calculate pitch and azimuth for each facet using DSM
 */
function calculateFacetPitchesFromDSM(
  dsmGrid: DSMGrid,
  footprint: XY[],
  edges: DSMRefinedEdge[]
): Map<string, { pitch: number; azimuth: number; confidence: number }> {
  const pitches = new Map<string, { pitch: number; azimuth: number; confidence: number }>();
  
  // Simplified: estimate overall roof pitch from DSM
  const centroid = getCentroid(footprint);
  const centerElev = getElevationAt(centroid, dsmGrid);
  
  if (centerElev === null) return pitches;
  
  // Sample elevations at footprint corners
  const cornerElevs = footprint.slice(0, -1).map(p => ({
    point: p,
    elev: getElevationAt(p, dsmGrid)
  })).filter(c => c.elev !== null);
  
  if (cornerElevs.length < 3) return pitches;
  
  // Calculate average slope from center to edges
  let totalPitch = 0;
  let validSamples = 0;
  
  for (const corner of cornerElevs) {
    const dx = corner.point[0] - centroid[0];
    const dy = corner.point[1] - centroid[1];
    const horizontalDist = Math.sqrt(dx * dx + dy * dy) * 111000; // approx meters
    const verticalDist = Math.abs(centerElev - (corner.elev as number));
    
    if (horizontalDist > 0) {
      const pitchRad = Math.atan(verticalDist / horizontalDist);
      const pitchDeg = pitchRad * 180 / Math.PI;
      totalPitch += pitchDeg;
      validSamples++;
    }
  }
  
  if (validSamples > 0) {
    const avgPitch = totalPitch / validSamples;
    pitches.set('overall', {
      pitch: avgPitch,
      azimuth: 0, // Would need more analysis for direction
      confidence: 0.7
    });
  }
  
  return pitches;
}

function getCentroid(coords: XY[]): XY {
  const n = coords.length - 1; // Exclude closing point
  const sumX = coords.slice(0, n).reduce((s, c) => s + c[0], 0);
  const sumY = coords.slice(0, n).reduce((s, c) => s + c[1], 0);
  return [sumX / n, sumY / n];
}

/**
 * Fetch DSM data from Google Solar API
 */
export async function fetchDSMFromGoogleSolar(
  lat: number,
  lng: number,
  apiKey: string
): Promise<DSMGrid | null> {
  try {
    // Get data layers info
    const layersUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=50&view=FULL_LAYERS&key=${apiKey}`;
    
    const response = await fetch(layersUrl);
    if (!response.ok) {
      console.warn(`Failed to fetch DSM layers: ${response.status}`);
      return null;
    }
    
    const layersData = await response.json();
    
    if (!layersData.dsmUrl) {
      console.log('No DSM URL in Google Solar response');
      return null;
    }
    
    // Note: Actually fetching and parsing the GeoTIFF would require additional libraries
    // For now, return metadata indicating DSM is available
    console.log('DSM layer available from Google Solar');
    
    // In production, you would:
    // 1. Fetch the GeoTIFF from layersData.dsmUrl
    // 2. Parse it using a GeoTIFF library
    // 3. Extract elevation values into a 2D grid
    
    return null; // Placeholder - full implementation would parse GeoTIFF
    
  } catch (error) {
    console.warn('Error fetching DSM:', error);
    return null;
  }
}

export type { DSMGrid, DSMRefinedEdge, DSMAnalysisResult };
