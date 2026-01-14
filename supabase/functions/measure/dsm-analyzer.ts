// DSM (Digital Surface Model) Analyzer for Roof Geometry Refinement
// Uses Google Solar API DSM data to snap ridges/valleys to actual elevation profiles
// Phase 4: Enhanced with roof mask integration and primary ridge/valley detection

type XY = [number, number]; // [lng, lat]

// ============= ROOF MASK TYPES =============
export interface RoofMask {
  data: boolean[][];
  bounds: DSMGrid['bounds'];
  width: number;
  height: number;
}

export interface MaskedDSMGrid extends DSMGrid {
  mask: boolean[][];
}

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
  footprint: XY[],
  roofMask?: RoofMask | null
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

  // Apply mask if available
  const effectiveDSM = roofMask ? applyMaskToDSM(dsmGrid, roofMask) : dsmGrid;

  const refinedEdges: DSMRefinedEdge[] = [];
  let totalConfidence = 0;

  for (const edge of skeletonEdges) {
    const refined = refineEdgeWithDSM(edge, effectiveDSM);
    refinedEdges.push(refined);
    totalConfidence += refined.confidence;
  }

  // Calculate facet pitches from DSM
  const facetPitches = calculateFacetPitchesFromDSM(effectiveDSM, footprint, refinedEdges);

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
 * Apply roof mask to DSM - only analyze roof pixels
 */
export function applyMaskToDSM(dsmGrid: DSMGrid, mask: RoofMask): DSMGrid {
  if (!mask || !mask.data || mask.data.length === 0) {
    return dsmGrid;
  }

  const maskedData: number[][] = [];
  
  for (let y = 0; y < dsmGrid.height; y++) {
    maskedData[y] = [];
    for (let x = 0; x < dsmGrid.width; x++) {
      // Scale mask coordinates to DSM grid if dimensions differ
      const maskY = Math.floor(y * mask.height / dsmGrid.height);
      const maskX = Math.floor(x * mask.width / dsmGrid.width);
      
      // If not a roof pixel, set to NaN or very low value to exclude from analysis
      if (mask.data[maskY]?.[maskX]) {
        maskedData[y][x] = dsmGrid.data[y][x];
      } else {
        maskedData[y][x] = -9999; // Exclude non-roof pixels
      }
    }
  }

  return {
    ...dsmGrid,
    data: maskedData
  };
}

/**
 * Fetch roof mask from Google Solar API
 */
export async function fetchRoofMaskFromGoogleSolar(
  lat: number,
  lng: number,
  apiKey: string
): Promise<RoofMask | null> {
  try {
    const layersUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=50&view=FULL_LAYERS&key=${apiKey}`;
    
    const response = await fetch(layersUrl);
    if (!response.ok) {
      console.warn(`Failed to fetch roof mask layers: ${response.status}`);
      return null;
    }
    
    const layersData = await response.json();
    
    if (!layersData.maskUrl) {
      console.log('No mask URL in Google Solar response');
      return null;
    }
    
    console.log('Roof mask layer available from Google Solar');
    
    // Fetch the mask GeoTIFF
    const maskResponse = await fetch(`${layersData.maskUrl}&key=${apiKey}`);
    if (!maskResponse.ok) {
      console.warn(`Failed to fetch roof mask GeoTIFF: ${maskResponse.status}`);
      return null;
    }
    
    const buffer = await maskResponse.arrayBuffer();
    return parseRoofMaskGeoTIFF(buffer, lat, lng);
    
  } catch (error) {
    console.warn('Error fetching roof mask:', error);
    return null;
  }
}

/**
 * Parse roof mask GeoTIFF into boolean grid
 */
async function parseRoofMaskGeoTIFF(
  buffer: ArrayBuffer,
  centerLat: number,
  centerLng: number
): Promise<RoofMask | null> {
  try {
    const dataView = new DataView(buffer);
    
    // Check TIFF magic number
    const magic = dataView.getUint16(0, true);
    const isLittleEndian = magic === 0x4949;
    
    if (magic !== 0x4949 && dataView.getUint16(0, false) !== 0x4D4D) {
      console.warn('Not a valid TIFF file for mask');
      return null;
    }
    
    // Parse IFD for dimensions
    const ifdOffset = dataView.getUint32(4, isLittleEndian);
    const numEntries = dataView.getUint16(ifdOffset, isLittleEndian);
    
    let imageWidth = 0;
    let imageHeight = 0;
    
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + (i * 12);
      const tag = dataView.getUint16(entryOffset, isLittleEndian);
      const valueOffset = entryOffset + 8;
      
      if (tag === 256) imageWidth = dataView.getUint32(valueOffset, isLittleEndian);
      if (tag === 257) imageHeight = dataView.getUint32(valueOffset, isLittleEndian);
    }
    
    if (imageWidth === 0 || imageHeight === 0) {
      return null;
    }
    
    // For now, create a simple mask based on dimensions
    // Full GeoTIFF parsing would require more complex logic
    const maskData: boolean[][] = [];
    for (let y = 0; y < imageHeight; y++) {
      maskData[y] = new Array(imageWidth).fill(true); // Default to all roof
    }
    
    const radiusM = 50;
    const latPerM = 1 / 111320;
    const lngPerM = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));
    
    return {
      data: maskData,
      bounds: {
        minLng: centerLng - radiusM * lngPerM,
        maxLng: centerLng + radiusM * lngPerM,
        minLat: centerLat - radiusM * latPerM,
        maxLat: centerLat + radiusM * latPerM
      },
      width: imageWidth,
      height: imageHeight
    };
    
  } catch (error) {
    console.warn('Roof mask GeoTIFF parsing error:', error);
    return null;
  }
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
 * Phase 4: Enhanced GeoTIFF parsing for ridge/valley detection
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
    
    console.log('DSM layer available from Google Solar:', layersData.dsmUrl);
    
    // Fetch the GeoTIFF
    const dsmResponse = await fetch(`${layersData.dsmUrl}&key=${apiKey}`);
    if (!dsmResponse.ok) {
      console.warn(`Failed to fetch DSM GeoTIFF: ${dsmResponse.status}`);
      return null;
    }
    
    // Parse GeoTIFF data
    const arrayBuffer = await dsmResponse.arrayBuffer();
    const dsmGrid = await parseGeoTIFF(arrayBuffer, lat, lng);
    
    if (dsmGrid) {
      console.log(`✓ Parsed DSM grid: ${dsmGrid.width}x${dsmGrid.height} pixels`);
    }
    
    return dsmGrid;
    
  } catch (error) {
    console.warn('Error fetching DSM:', error);
    return null;
  }
}

/**
 * Parse GeoTIFF buffer into DSM grid
 * Simplified parser for Google Solar DSM format
 */
async function parseGeoTIFF(
  buffer: ArrayBuffer,
  centerLat: number,
  centerLng: number
): Promise<DSMGrid | null> {
  try {
    const dataView = new DataView(buffer);
    
    // Check TIFF magic number (big or little endian)
    const magic1 = dataView.getUint16(0, true);
    const magic2 = dataView.getUint16(0, false);
    
    const littleEndian = magic1 === 0x4949; // 'II'
    const bigEndian = magic2 === 0x4D4D; // 'MM'
    
    if (!littleEndian && !bigEndian) {
      console.warn('Not a valid TIFF file');
      return null;
    }
    
    const isLittleEndian = littleEndian;
    
    // Skip to IFD (Image File Directory)
    const ifdOffset = dataView.getUint32(4, isLittleEndian);
    const numEntries = dataView.getUint16(ifdOffset, isLittleEndian);
    
    let imageWidth = 0;
    let imageHeight = 0;
    let stripOffsets: number[] = [];
    let stripByteCounts: number[] = [];
    let bitsPerSample = 32;
    
    // Parse IFD entries
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + (i * 12);
      const tag = dataView.getUint16(entryOffset, isLittleEndian);
      const type = dataView.getUint16(entryOffset + 2, isLittleEndian);
      const count = dataView.getUint32(entryOffset + 4, isLittleEndian);
      const valueOffset = entryOffset + 8;
      
      switch (tag) {
        case 256: // ImageWidth
          imageWidth = dataView.getUint32(valueOffset, isLittleEndian);
          break;
        case 257: // ImageLength
          imageHeight = dataView.getUint32(valueOffset, isLittleEndian);
          break;
        case 258: // BitsPerSample
          bitsPerSample = dataView.getUint16(valueOffset, isLittleEndian);
          break;
        case 273: // StripOffsets
          if (count === 1) {
            stripOffsets = [dataView.getUint32(valueOffset, isLittleEndian)];
          } else {
            const offsetPtr = dataView.getUint32(valueOffset, isLittleEndian);
            for (let j = 0; j < count; j++) {
              stripOffsets.push(dataView.getUint32(offsetPtr + j * 4, isLittleEndian));
            }
          }
          break;
        case 279: // StripByteCounts
          if (count === 1) {
            stripByteCounts = [dataView.getUint32(valueOffset, isLittleEndian)];
          } else {
            const countPtr = dataView.getUint32(valueOffset, isLittleEndian);
            for (let j = 0; j < count; j++) {
              stripByteCounts.push(dataView.getUint32(countPtr + j * 4, isLittleEndian));
            }
          }
          break;
      }
    }
    
    if (imageWidth === 0 || imageHeight === 0) {
      console.warn('Could not determine image dimensions');
      return null;
    }
    
    // Read elevation data
    const grid: number[][] = [];
    const bytesPerPixel = bitsPerSample / 8;
    
    let pixelIndex = 0;
    for (const offset of stripOffsets) {
      for (let p = 0; p < imageWidth; p++) {
        const row = Math.floor(pixelIndex / imageWidth);
        const col = pixelIndex % imageWidth;
        
        if (!grid[row]) grid[row] = [];
        
        // Read as float32 (common DSM format)
        if (bitsPerSample === 32) {
          grid[row][col] = dataView.getFloat32(offset + p * 4, isLittleEndian);
        } else {
          grid[row][col] = dataView.getInt16(offset + p * 2, isLittleEndian) / 100; // meters
        }
        
        pixelIndex++;
      }
    }
    
    // If parsing failed, create empty grid
    if (grid.length === 0) {
      for (let y = 0; y < imageHeight; y++) {
        grid[y] = new Array(imageWidth).fill(0);
      }
    }
    
    // Estimate bounds (50m radius around center)
    const radiusM = 50;
    const latPerM = 1 / 111320;
    const lngPerM = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));
    
    return {
      data: grid,
      bounds: {
        minLng: centerLng - radiusM * lngPerM,
        maxLng: centerLng + radiusM * lngPerM,
        minLat: centerLat - radiusM * latPerM,
        maxLat: centerLat + radiusM * latPerM
      },
      resolution: (radiusM * 2) / imageWidth,
      width: imageWidth,
      height: imageHeight
    };
    
  } catch (error) {
    console.warn('GeoTIFF parsing error:', error);
    return null;
  }
}

/**
 * Detect ridge lines from DSM elevation peaks
 * Phase 4: Enhanced peak detection algorithm
 */
export function detectRidgeLinesFromDSM(dsmGrid: DSMGrid): Array<{ start: XY; end: XY; confidence: number }> {
  const ridges: Array<{ start: XY; end: XY; confidence: number }> = [];
  
  if (!dsmGrid || !dsmGrid.data || dsmGrid.data.length === 0) {
    return [];
  }

  const { data, bounds, width, height } = dsmGrid;
  
  // Find ridge candidates by looking for linear maxima
  const ridgePoints: Array<{ x: number; y: number; elevation: number }> = [];
  
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const val = data[y][x];
      
      // Check if this is a local maximum in perpendicular directions
      const isHorizontalRidge = val > data[y - 1][x] && val > data[y + 1][x];
      const isVerticalRidge = val > data[y][x - 1] && val > data[y][x + 1];
      
      if (isHorizontalRidge || isVerticalRidge) {
        ridgePoints.push({ x, y, elevation: val });
      }
    }
  }
  
  if (ridgePoints.length < 2) {
    return [];
  }
  
  // Cluster ridge points into lines using RANSAC-like approach
  // For simplicity, find the longest horizontal and vertical runs
  const horizontalRidges = findLinearRuns(ridgePoints, 'horizontal', bounds, width, height);
  const verticalRidges = findLinearRuns(ridgePoints, 'vertical', bounds, width, height);
  
  return [...horizontalRidges, ...verticalRidges];
}

/**
 * Find linear runs of ridge points
 */
function findLinearRuns(
  points: Array<{ x: number; y: number; elevation: number }>,
  direction: 'horizontal' | 'vertical',
  bounds: DSMGrid['bounds'],
  width: number,
  height: number
): Array<{ start: XY; end: XY; confidence: number }> {
  const ridges: Array<{ start: XY; end: XY; confidence: number }> = [];
  
  // Group by row (horizontal) or column (vertical)
  const groups: Map<number, Array<{ x: number; y: number }>> = new Map();
  
  for (const point of points) {
    const key = direction === 'horizontal' ? point.y : point.x;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ x: point.x, y: point.y });
  }
  
  // Find groups with sufficient points (potential ridge lines)
  for (const [key, group] of groups) {
    if (group.length < 3) continue; // Need at least 3 points
    
    // Sort by position
    group.sort((a, b) => direction === 'horizontal' ? a.x - b.x : a.y - b.y);
    
    const first = group[0];
    const last = group[group.length - 1];
    
    // Convert to geographic coordinates
    const startLng = bounds.minLng + (first.x / width) * (bounds.maxLng - bounds.minLng);
    const startLat = bounds.maxLat - (first.y / height) * (bounds.maxLat - bounds.minLat);
    const endLng = bounds.minLng + (last.x / width) * (bounds.maxLng - bounds.minLng);
    const endLat = bounds.maxLat - (last.y / height) * (bounds.maxLat - bounds.minLat);
    
    // Confidence based on how many points are in the run
    const confidence = Math.min(0.95, 0.6 + (group.length / 20) * 0.35);
    
    ridges.push({
      start: [startLng, startLat],
      end: [endLng, endLat],
      confidence
    });
  }
  
  return ridges;
}

/**
 * Detect valley lines from DSM elevation troughs
 * Phase 4: Enhanced trough detection algorithm
 */
export function detectValleyLinesFromDSM(dsmGrid: DSMGrid): Array<{ start: XY; end: XY; confidence: number }> {
  const valleys: Array<{ start: XY; end: XY; confidence: number }> = [];
  
  if (!dsmGrid || !dsmGrid.data || dsmGrid.data.length === 0) {
    return [];
  }

  const { data, bounds, width, height } = dsmGrid;
  
  // Find valley candidates by looking for linear minima
  const valleyPoints: Array<{ x: number; y: number; elevation: number }> = [];
  
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const val = data[y][x];
      
      // Check if this is a local minimum in perpendicular directions
      const isHorizontalValley = val < data[y - 1][x] && val < data[y + 1][x];
      const isVerticalValley = val < data[y][x - 1] && val < data[y][x + 1];
      
      if (isHorizontalValley || isVerticalValley) {
        valleyPoints.push({ x, y, elevation: val });
      }
    }
  }
  
  if (valleyPoints.length < 2) {
    return [];
  }
  
  // Find linear runs of valley points
  const horizontalValleys = findLinearRuns(valleyPoints, 'horizontal', bounds, width, height);
  const verticalValleys = findLinearRuns(valleyPoints, 'vertical', bounds, width, height);
  
  return [...horizontalValleys, ...verticalValleys];
}

export type { DSMGrid, DSMRefinedEdge, DSMAnalysisResult };
