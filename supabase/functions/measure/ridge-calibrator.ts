// Ridge Position Calibrator (Phase 3)
// Detection priority: Manual Override → DSM Peaks → Google Solar Segments → AI Vision → Straight Skeleton
// Ensures ridge lines are in the exact correct position

type XY = [number, number]; // [lng, lat]

export interface RidgeCalibrationResult {
  ridgeLines: Array<{
    start: XY;
    end: XY;
    source: 'manual' | 'dsm' | 'solar_segment' | 'ai_vision' | 'skeleton';
    confidence: number;
    elevationProfile?: { start: number; end: number; maxAlong: number };
  }>;
  primaryRidgeDirection: XY;
  calibrationMethod: string;
  qualityScore: number;
}

export interface ManualRidgeTrace {
  start: XY;
  end: XY;
  createdAt?: Date;
  userId?: string;
}

export interface DSMPeakData {
  grid: number[][];
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  resolution: number;
}

export interface SegmentData {
  azimuthDegrees: number;
  pitchDegrees: number;
  center: { lat: number; lng: number };
  planeHeightAtCenter?: number;
}

/**
 * Calibrate ridge position using multi-source detection
 * Priority: Manual → DSM → Segments → AI → Skeleton
 */
export function calibrateRidgePosition(
  footprint: XY[],
  options: {
    manualTraces?: ManualRidgeTrace[];
    dsmData?: DSMPeakData;
    solarSegments?: SegmentData[];
    skeletonRidges?: Array<{ start: XY; end: XY }>;
    aiVisionRidges?: Array<{ start: XY; end: XY; confidence: number }>;
  }
): RidgeCalibrationResult {
  const ridgeLines: RidgeCalibrationResult['ridgeLines'] = [];
  let calibrationMethod = 'none';
  let qualityScore = 0;

  // PRIORITY 1: Manual Ridge Override (highest confidence)
  if (options.manualTraces && options.manualTraces.length > 0) {
    console.log(`🎯 Using ${options.manualTraces.length} MANUAL ridge trace(s) - highest priority`);
    
    for (const trace of options.manualTraces) {
      ridgeLines.push({
        start: trace.start,
        end: trace.end,
        source: 'manual',
        confidence: 0.99 // User-verified
      });
    }
    
    calibrationMethod = 'manual_override';
    qualityScore = 0.99;
    
    return {
      ridgeLines,
      primaryRidgeDirection: calculateRidgeDirection(ridgeLines[0]),
      calibrationMethod,
      qualityScore
    };
  }

  // PRIORITY 2: DSM Peak Detection
  if (options.dsmData && options.dsmData.grid.length > 0) {
    console.log(`📈 Detecting ridges from DSM elevation data`);
    
    const dsmRidges = detectRidgesFromDSM(options.dsmData, footprint);
    
    if (dsmRidges.length > 0) {
      for (const ridge of dsmRidges) {
        ridgeLines.push({
          ...ridge,
          source: 'dsm',
          confidence: ridge.confidence || 0.92
        });
      }
      
      calibrationMethod = 'dsm_peaks';
      qualityScore = 0.92;
      
      console.log(`  → Found ${dsmRidges.length} ridge(s) from DSM peaks`);
      
      return {
        ridgeLines,
        primaryRidgeDirection: calculateRidgeDirection(ridgeLines[0]),
        calibrationMethod,
        qualityScore
      };
    }
  }

  // PRIORITY 3: Google Solar Segment Analysis
  if (options.solarSegments && options.solarSegments.length > 0) {
    console.log(`🔆 Inferring ridges from ${options.solarSegments.length} solar segments`);
    
    const segmentRidges = inferRidgesFromSegments(options.solarSegments, footprint);
    
    if (segmentRidges.length > 0) {
      for (const ridge of segmentRidges) {
        ridgeLines.push({
          ...ridge,
          source: 'solar_segment',
          confidence: 0.85
        });
      }
      
      calibrationMethod = 'solar_segments';
      qualityScore = 0.85;
      
      console.log(`  → Inferred ${segmentRidges.length} ridge(s) from segment azimuths`);
      
      return {
        ridgeLines,
        primaryRidgeDirection: calculateRidgeDirection(ridgeLines[0]),
        calibrationMethod,
        qualityScore
      };
    }
  }

  // PRIORITY 4: AI Vision Detection
  if (options.aiVisionRidges && options.aiVisionRidges.length > 0) {
    console.log(`🤖 Using ${options.aiVisionRidges.length} AI vision-detected ridge(s)`);
    
    for (const ridge of options.aiVisionRidges) {
      ridgeLines.push({
        start: ridge.start,
        end: ridge.end,
        source: 'ai_vision',
        confidence: ridge.confidence || 0.75
      });
    }
    
    calibrationMethod = 'ai_vision';
    qualityScore = options.aiVisionRidges.reduce((s, r) => s + (r.confidence || 0.75), 0) / options.aiVisionRidges.length;
    
    return {
      ridgeLines,
      primaryRidgeDirection: calculateRidgeDirection(ridgeLines[0]),
      calibrationMethod,
      qualityScore
    };
  }

  // PRIORITY 5: Straight Skeleton (fallback)
  if (options.skeletonRidges && options.skeletonRidges.length > 0) {
    console.log(`📐 Using ${options.skeletonRidges.length} skeleton-derived ridge(s) (fallback)`);
    
    for (const ridge of options.skeletonRidges) {
      ridgeLines.push({
        start: ridge.start,
        end: ridge.end,
        source: 'skeleton',
        confidence: 0.70
      });
    }
    
    calibrationMethod = 'skeleton_geometric';
    qualityScore = 0.70;
    
    return {
      ridgeLines,
      primaryRidgeDirection: calculateRidgeDirection(ridgeLines[0]),
      calibrationMethod,
      qualityScore
    };
  }

  // No ridges detected
  console.warn(`⚠️ No ridges detected from any source`);
  
  return {
    ridgeLines: [],
    primaryRidgeDirection: [1, 0], // Default horizontal
    calibrationMethod: 'none',
    qualityScore: 0
  };
}

/**
 * Detect ridges from DSM elevation data
 * Finds linear high points (crests) in the elevation grid
 */
function detectRidgesFromDSM(
  dsmData: DSMPeakData,
  footprint: XY[]
): Array<{ start: XY; end: XY; confidence: number; elevationProfile: { start: number; end: number; maxAlong: number } }> {
  const { grid, bounds } = dsmData;
  const ridges: Array<{ start: XY; end: XY; confidence: number; elevationProfile: { start: number; end: number; maxAlong: number } }> = [];
  
  if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) {
    return [];
  }

  const height = grid.length;
  const width = grid[0].length;

  // Find local maxima rows (potential ridge lines)
  const ridgePixelRows: number[] = [];
  
  for (let y = 1; y < height - 1; y++) {
    let isRidgeRow = true;
    let peakCount = 0;
    
    for (let x = 1; x < width - 1; x++) {
      const val = grid[y][x];
      const above = grid[y - 1][x];
      const below = grid[y + 1][x];
      
      // Check if this point is a local maximum in Y direction
      if (val > above && val > below) {
        peakCount++;
      }
    }
    
    // If most points in this row are peaks, it's likely a ridge
    if (peakCount > width * 0.6) {
      ridgePixelRows.push(y);
    }
  }

  // Similarly check columns for vertical ridges
  const ridgePixelCols: number[] = [];
  
  for (let x = 1; x < width - 1; x++) {
    let peakCount = 0;
    
    for (let y = 1; y < height - 1; y++) {
      const val = grid[y][x];
      const left = grid[y][x - 1];
      const right = grid[y][x + 1];
      
      if (val > left && val > right) {
        peakCount++;
      }
    }
    
    if (peakCount > height * 0.6) {
      ridgePixelCols.push(x);
    }
  }

  // Convert pixel rows to geographic ridges (horizontal ridges)
  for (const y of ridgePixelRows) {
    const lat = bounds.maxLat - (y / height) * (bounds.maxLat - bounds.minLat);
    
    // Get elevation profile
    const elevations = grid[y].filter(v => v > 0);
    const maxElev = Math.max(...elevations);
    
    ridges.push({
      start: [bounds.minLng, lat],
      end: [bounds.maxLng, lat],
      confidence: 0.90,
      elevationProfile: {
        start: grid[y][0] || 0,
        end: grid[y][width - 1] || 0,
        maxAlong: maxElev
      }
    });
  }

  // Convert pixel columns to geographic ridges (vertical ridges)
  for (const x of ridgePixelCols) {
    const lng = bounds.minLng + (x / width) * (bounds.maxLng - bounds.minLng);
    
    const elevations = grid.map(row => row[x]).filter(v => v > 0);
    const maxElev = Math.max(...elevations);
    
    ridges.push({
      start: [lng, bounds.minLat],
      end: [lng, bounds.maxLat],
      confidence: 0.90,
      elevationProfile: {
        start: grid[0]?.[x] || 0,
        end: grid[height - 1]?.[x] || 0,
        maxAlong: maxElev
      }
    });
  }

  // Clip ridges to footprint
  return ridges
    .map(ridge => clipRidgeToFootprint(ridge, footprint))
    .filter(ridge => ridge !== null) as typeof ridges;
}

/**
 * Infer ridge positions from segment azimuths
 * Ridges exist where opposing azimuths meet
 */
function inferRidgesFromSegments(
  segments: SegmentData[],
  footprint: XY[]
): Array<{ start: XY; end: XY }> {
  const ridges: Array<{ start: XY; end: XY }> = [];
  
  if (segments.length < 2) return [];

  // Find segment pairs with opposing azimuths (±180°)
  const azimuthTolerance = 30; // degrees
  const opposingPairs: Array<{ seg1: SegmentData; seg2: SegmentData }> = [];
  
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const az1 = segments[i].azimuthDegrees;
      const az2 = segments[j].azimuthDegrees;
      
      const diff = Math.abs(az1 - az2);
      const isOpposing = Math.abs(diff - 180) < azimuthTolerance;
      
      if (isOpposing) {
        opposingPairs.push({ seg1: segments[i], seg2: segments[j] });
      }
    }
  }

  // For each opposing pair, create a ridge between their centers
  for (const pair of opposingPairs) {
    const c1 = pair.seg1.center;
    const c2 = pair.seg2.center;
    
    // Ridge runs perpendicular to the line connecting centers
    const dx = c2.lng - c1.lng;
    const dy = c2.lat - c1.lat;
    const midpoint: XY = [(c1.lng + c2.lng) / 2, (c1.lat + c2.lat) / 2];
    
    // Perpendicular direction
    const perpLen = Math.sqrt(dx * dx + dy * dy);
    const perpX = -dy / perpLen;
    const perpY = dx / perpLen;
    
    // Extend ridge to footprint bounds
    const extent = 0.001; // ~100m extension
    
    ridges.push({
      start: [midpoint[0] - perpX * extent, midpoint[1] - perpY * extent],
      end: [midpoint[0] + perpX * extent, midpoint[1] + perpY * extent]
    });
  }

  // If no opposing pairs, try to find ridge from dominant azimuth
  if (ridges.length === 0 && segments.length > 0) {
    // Ridge runs perpendicular to the dominant segment azimuth
    const dominantAz = segments.reduce((acc, s) => acc + s.azimuthDegrees, 0) / segments.length;
    const ridgeAz = (dominantAz + 90) % 360;
    
    const centroid = calculateCentroid(footprint);
    const extent = 0.0005;
    const ridgeRad = ridgeAz * Math.PI / 180;
    
    ridges.push({
      start: [centroid[0] - Math.sin(ridgeRad) * extent, centroid[1] - Math.cos(ridgeRad) * extent],
      end: [centroid[0] + Math.sin(ridgeRad) * extent, centroid[1] + Math.cos(ridgeRad) * extent]
    });
  }

  // Clip ridges to footprint
  return ridges
    .map(ridge => clipRidgeToFootprint({ ...ridge, confidence: 0.85, elevationProfile: { start: 0, end: 0, maxAlong: 0 } }, footprint))
    .filter(r => r !== null)
    .map(r => ({ start: r!.start, end: r!.end }));
}

/**
 * Clip a ridge line to stay within the footprint polygon
 */
function clipRidgeToFootprint<T extends { start: XY; end: XY }>(
  ridge: T,
  footprint: XY[]
): T | null {
  // Simple clipping - find intersections with footprint edges
  const intersections: XY[] = [];
  
  for (let i = 0; i < footprint.length - 1; i++) {
    const edgeStart = footprint[i];
    const edgeEnd = footprint[i + 1];
    
    const intersection = lineSegmentIntersection(
      ridge.start, ridge.end,
      edgeStart, edgeEnd
    );
    
    if (intersection) {
      intersections.push(intersection);
    }
  }

  if (intersections.length >= 2) {
    // Sort by distance from ridge start
    intersections.sort((a, b) => 
      distance(ridge.start, a) - distance(ridge.start, b)
    );
    
    return {
      ...ridge,
      start: intersections[0],
      end: intersections[intersections.length - 1]
    };
  }

  // Check if ridge is entirely inside footprint
  if (pointInPolygon(ridge.start, footprint) && pointInPolygon(ridge.end, footprint)) {
    return ridge;
  }

  return null;
}

/**
 * Calculate normalized ridge direction vector
 */
function calculateRidgeDirection(ridge: { start: XY; end: XY }): XY {
  const dx = ridge.end[0] - ridge.start[0];
  const dy = ridge.end[1] - ridge.start[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  
  if (len < 0.0000001) return [1, 0];
  
  return [dx / len, dy / len];
}

/**
 * Calculate centroid of polygon
 */
function calculateCentroid(coords: XY[]): XY {
  const n = coords.length - 1; // Exclude closing point
  const sumX = coords.slice(0, n).reduce((s, c) => s + c[0], 0);
  const sumY = coords.slice(0, n).reduce((s, c) => s + c[1], 0);
  return [sumX / n, sumY / n];
}

/**
 * Line segment intersection
 */
function lineSegmentIntersection(
  p1: XY, p2: XY,
  p3: XY, p4: XY
): XY | null {
  const d = (p4[1] - p3[1]) * (p2[0] - p1[0]) - (p4[0] - p3[0]) * (p2[1] - p1[1]);
  
  if (Math.abs(d) < 0.0000001) return null;
  
  const ua = ((p4[0] - p3[0]) * (p1[1] - p3[1]) - (p4[1] - p3[1]) * (p1[0] - p3[0])) / d;
  const ub = ((p2[0] - p1[0]) * (p1[1] - p3[1]) - (p2[1] - p1[1]) * (p1[0] - p3[0])) / d;
  
  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return [
      p1[0] + ua * (p2[0] - p1[0]),
      p1[1] + ua * (p2[1] - p1[1])
    ];
  }
  
  return null;
}

/**
 * Point in polygon test
 */
function pointInPolygon(point: XY, polygon: XY[]): boolean {
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
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
 * Distance between two points
 */
function distance(a: XY, b: XY): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}

export type { XY };
