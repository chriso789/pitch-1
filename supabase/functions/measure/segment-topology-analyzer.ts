/**
 * Segment Topology Analyzer
 * Extracts ridge, hip, valley positions from Google Solar roofSegmentStats
 * by analyzing segment azimuths and positions to derive roof topology
 */

type XY = [number, number]; // [lng, lat]

export interface SegmentData {
  pitchDegrees: number;
  azimuthDegrees: number;
  stats: { areaMeters2: number };
  center?: { latitude: number; longitude: number };
  boundingBox?: { sw: { latitude: number; longitude: number }; ne: { latitude: number; longitude: number } };
  planeHeightAtCenterMeters?: number;
}

export interface AnalyzedFacet {
  id: string;
  azimuthDegrees: number;
  direction: string;
  centroid: XY;
  areaSqft: number;
  pitchDegrees: number;
  boundingBox?: { sw: XY; ne: XY };
}

export interface TopologyLine {
  type: 'ridge' | 'hip' | 'valley';
  start: XY;
  end: XY;
  lengthFt: number;
  facetIds: string[];
}

export interface SegmentTopology {
  facets: AnalyzedFacet[];
  ridges: TopologyLine[];
  hips: TopologyLine[];
  valleys: TopologyLine[];
  facetCount: number;
  roofType: 'gable' | 'hip' | 'cross-gable' | 'complex' | 'flat';
}

// Compass directions
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function getDirection(azimuth: number): string {
  const normalized = ((azimuth % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return DIRECTIONS[index];
}

function degToMeters(latDeg: number) {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(latDeg * Math.PI / 180);
  return { metersPerDegLat, metersPerDegLng };
}

function distance(p1: XY, p2: XY, midLat: number): number {
  const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
  const dx = (p2[0] - p1[0]) * metersPerDegLng;
  const dy = (p2[1] - p1[1]) * metersPerDegLat;
  return Math.sqrt(dx * dx + dy * dy) * 3.28084; // Convert to feet
}

function midpoint(p1: XY, p2: XY): XY {
  return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}

// Check if two azimuths are opposing (indicating a ridge between them)
function areOpposingAzimuths(a1: number, a2: number): boolean {
  const diff = Math.abs(((a1 - a2 + 180) % 360) - 180);
  return diff > 150 && diff < 210; // ~180° ± 30°
}

// Check if azimuths form a hip (perpendicular relationship)
function arePerpendicular(a1: number, a2: number): boolean {
  const diff = Math.abs(((a1 - a2 + 180) % 360) - 180);
  return (diff > 60 && diff < 120); // ~90° ± 30°
}

// Estimate facet centroid from solar panel positions or bounding box
function estimateFacetCentroid(segment: SegmentData, index: number, allSegments: SegmentData[]): XY {
  // If center is provided directly
  if (segment.center) {
    return [segment.center.longitude, segment.center.latitude];
  }
  
  // Use bounding box center
  if (segment.boundingBox) {
    const { sw, ne } = segment.boundingBox;
    return [
      (sw.longitude + ne.longitude) / 2,
      (sw.latitude + ne.latitude) / 2
    ];
  }
  
  // Fallback: estimate based on overall building and azimuth
  // This is approximate - arrange segments in a grid based on azimuth
  const overallCentroid = calculateOverallCentroid(allSegments);
  const offset = 0.00005; // ~5m offset
  const rad = segment.azimuthDegrees * Math.PI / 180;
  return [
    overallCentroid[0] + Math.sin(rad) * offset,
    overallCentroid[1] + Math.cos(rad) * offset
  ];
}

function calculateOverallCentroid(segments: SegmentData[]): XY {
  const centroids: XY[] = segments
    .filter(s => s.boundingBox)
    .map(s => {
      const { sw, ne } = s.boundingBox!;
      return [(sw.longitude + ne.longitude) / 2, (sw.latitude + ne.latitude) / 2] as XY;
    });
  
  if (centroids.length === 0) return [0, 0];
  
  const sumLng = centroids.reduce((s, c) => s + c[0], 0);
  const sumLat = centroids.reduce((s, c) => s + c[1], 0);
  return [sumLng / centroids.length, sumLat / centroids.length];
}

/**
 * Main analysis function - extracts topology from segment stats
 * IMPROVED: Uses building footprint bounds for accurate ridge/hip length estimation
 */
export function analyzeSegmentTopology(
  roofSegmentStats: SegmentData[],
  buildingCenter?: { lat: number; lng: number },
  footprintBounds?: { minX: number; maxX: number; minY: number; maxY: number }
): SegmentTopology {
  console.log(`📊 Analyzing ${roofSegmentStats.length} roof segments for topology`);
  
  if (!roofSegmentStats || roofSegmentStats.length === 0) {
    return {
      facets: [],
      ridges: [],
      hips: [],
      valleys: [],
      facetCount: 0,
      roofType: 'flat'
    };
  }
  
  // 1. Build facet list with centroids and metadata
  const facets: AnalyzedFacet[] = roofSegmentStats.map((seg, i) => {
    const centroid = estimateFacetCentroid(seg, i, roofSegmentStats);
    return {
      id: String.fromCharCode(65 + i), // A, B, C...
      azimuthDegrees: seg.azimuthDegrees || 0,
      direction: getDirection(seg.azimuthDegrees || 0),
      centroid,
      areaSqft: (seg.stats?.areaMeters2 || 0) * 10.7639,
      pitchDegrees: seg.pitchDegrees || 0,
      boundingBox: seg.boundingBox ? {
        sw: [seg.boundingBox.sw.longitude, seg.boundingBox.sw.latitude] as XY,
        ne: [seg.boundingBox.ne.longitude, seg.boundingBox.ne.latitude] as XY
      } : undefined
    };
  });
  
  const midLat = facets.length > 0 
    ? facets.reduce((s, f) => s + f.centroid[1], 0) / facets.length 
    : buildingCenter?.lat || 0;
  
  // Calculate building dimensions for realistic ridge/hip lengths
  let buildingWidthFt = 40; // Default
  let buildingLengthFt = 60; // Default
  
  if (footprintBounds) {
    // Support both naming conventions (minX/minY and minLng/minLat)
    const minX = footprintBounds.minX ?? (footprintBounds as any).minLng;
    const maxX = footprintBounds.maxX ?? (footprintBounds as any).maxLng;
    const minY = footprintBounds.minY ?? (footprintBounds as any).minLat;
    const maxY = footprintBounds.maxY ?? (footprintBounds as any).maxLat;
    
    // Validate bounds are valid numbers
    if (minX != null && maxX != null && minY != null && maxY != null &&
        !isNaN(minX) && !isNaN(maxX) && !isNaN(minY) && !isNaN(maxY)) {
      buildingWidthFt = distance([minX, minY], [maxX, minY], midLat);
      buildingLengthFt = distance([minX, minY], [minX, maxY], midLat);
      
      // Extra validation - ensure we got valid distances
      if (isNaN(buildingWidthFt) || isNaN(buildingLengthFt) || buildingWidthFt <= 0 || buildingLengthFt <= 0) {
        console.warn(`⚠️ Invalid building dimensions calculated: ${buildingWidthFt} x ${buildingLengthFt}, using area estimate`);
        const totalAreaSqft = facets.reduce((s, f) => s + f.areaSqft, 0);
        const estSide = Math.sqrt(totalAreaSqft);
        buildingWidthFt = estSide * 0.8;
        buildingLengthFt = estSide * 1.2;
      } else {
        console.log(`   Building dimensions: ${buildingWidthFt.toFixed(0)}ft x ${buildingLengthFt.toFixed(0)}ft`);
      }
    } else {
      console.warn(`⚠️ Invalid footprintBounds values, using area estimate`);
      const totalAreaSqft = facets.reduce((s, f) => s + f.areaSqft, 0);
      const estSide = Math.sqrt(totalAreaSqft);
      buildingWidthFt = estSide * 0.8;
      buildingLengthFt = estSide * 1.2;
    }
  } else {
    // Estimate from total roof area
    const totalAreaSqft = facets.reduce((s, f) => s + f.areaSqft, 0);
    const estSide = Math.sqrt(totalAreaSqft);
    buildingWidthFt = estSide * 0.8;
    buildingLengthFt = estSide * 1.2;
    console.log(`   Estimated dimensions from area: ${buildingWidthFt.toFixed(0)}ft x ${buildingLengthFt.toFixed(0)}ft`);
  }
  
  // 2. Find ridges, hips, valleys based on facet relationships
  const ridges: TopologyLine[] = [];
  const hips: TopologyLine[] = [];
  const valleys: TopologyLine[] = [];
  
  // Group facets by approximate azimuth direction
  const facetsByDirection = new Map<string, AnalyzedFacet[]>();
  facets.forEach(f => {
    const dir = f.direction;
    if (!facetsByDirection.has(dir)) facetsByDirection.set(dir, []);
    facetsByDirection.get(dir)!.push(f);
  });
  
  console.log(`   Facets by direction:`, 
    Array.from(facetsByDirection.entries()).map(([d, fs]) => `${d}:${fs.length}`).join(', '));
  
  // 3. Identify ridge lines between opposing facet pairs
  const processedPairs = new Set<string>();
  const longerDim = Math.max(buildingLengthFt, buildingWidthFt);
  const shorterDim = Math.min(buildingLengthFt, buildingWidthFt);
  
  for (let i = 0; i < facets.length; i++) {
    for (let j = i + 1; j < facets.length; j++) {
      const f1 = facets[i];
      const f2 = facets[j];
      const pairKey = `${f1.id}-${f2.id}`;
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);
      
      if (areOpposingAzimuths(f1.azimuthDegrees, f2.azimuthDegrees)) {
        // RIDGE: Opposing facets (N/S or E/W facing)
        const ridgeMidpoint = midpoint(f1.centroid, f2.centroid);
        
        // IMPROVED: Ridge length should be ~70-90% of the building's longer dimension
        // For standard hip roofs, ridge is shorter than building length
        const ridgeLengthFt = longerDim * 0.75; // 75% of longer dimension
        
        // Ridge runs perpendicular to the facet facing directions
        const ridgeAzimuth = ((f1.azimuthDegrees + 90) % 180);
        const ridgeRad = ridgeAzimuth * Math.PI / 180;
        
        // Convert length to degrees
        const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
        const ridgeHalfLenDeg = (ridgeLengthFt * 0.3048 / 2) / metersPerDegLng;
        
        const ridgeStart: XY = [
          ridgeMidpoint[0] - Math.sin(ridgeRad) * ridgeHalfLenDeg,
          ridgeMidpoint[1] - Math.cos(ridgeRad) * ridgeHalfLenDeg
        ];
        const ridgeEnd: XY = [
          ridgeMidpoint[0] + Math.sin(ridgeRad) * ridgeHalfLenDeg,
          ridgeMidpoint[1] + Math.cos(ridgeRad) * ridgeHalfLenDeg
        ];
        
        // Validate ridge length before adding
        if (!isNaN(ridgeLengthFt) && ridgeLengthFt > 0) {
          ridges.push({
            type: 'ridge',
            start: ridgeStart,
            end: ridgeEnd,
            lengthFt: ridgeLengthFt,
            facetIds: [f1.id, f2.id]
          });
          console.log(`   Ridge found: ${f1.id}(${f1.direction}) ↔ ${f2.id}(${f2.direction}) = ${ridgeLengthFt.toFixed(0)}ft`);
        } else {
          console.warn(`   ⚠️ Invalid ridge length: ${ridgeLengthFt}, skipping`);
        }
        
      } else if (arePerpendicular(f1.azimuthDegrees, f2.azimuthDegrees)) {
        // Check if facets are adjacent
        const distBetween = distance(f1.centroid, f2.centroid, midLat);
        
        // IMPROVED: Hip length estimation based on roof geometry
        // Hip runs from ridge end to eave corner, typically at 45° angle
        // Length ≈ √((width/2)² + (height_diff)²) ≈ width/2 * 1.4 for typical pitches
        const hipLengthFt = (shorterDim / 2) * 1.4;
        
        if (distBetween < longerDim * 1.5) {
          const hipMidpoint = midpoint(f1.centroid, f2.centroid);
          const hipAzimuth = (f1.azimuthDegrees + f2.azimuthDegrees) / 2;
          const hipRad = hipAzimuth * Math.PI / 180;
          
          const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
          const hipHalfLenDeg = (hipLengthFt * 0.3048 / 2) / metersPerDegLng;
          
          const hipStart: XY = [
            hipMidpoint[0] - Math.sin(hipRad) * hipHalfLenDeg,
            hipMidpoint[1] - Math.cos(hipRad) * hipHalfLenDeg
          ];
          const hipEnd: XY = [
            hipMidpoint[0] + Math.sin(hipRad) * hipHalfLenDeg,
            hipMidpoint[1] + Math.cos(hipRad) * hipHalfLenDeg
          ];
          
          // Heuristic: if combined area is large, likely hip; if small, likely valley
          const combinedArea = f1.areaSqft + f2.areaSqft;
          const avgArea = facets.reduce((s, f) => s + f.areaSqft, 0) / facets.length;
          
          // Validate hip/valley length before adding
          if (!isNaN(hipLengthFt) && hipLengthFt > 0) {
            if (combinedArea > avgArea * 1.2) {
              hips.push({
                type: 'hip',
                start: hipStart,
                end: hipEnd,
                lengthFt: hipLengthFt,
                facetIds: [f1.id, f2.id]
              });
              console.log(`   Hip found: ${f1.id} ↔ ${f2.id} = ${hipLengthFt.toFixed(0)}ft`);
            } else {
              // Valley: typically similar length to hip
              const valleyLengthFt = hipLengthFt * 0.9;
              valleys.push({
                type: 'valley',
                start: hipStart,
                end: hipEnd,
                lengthFt: valleyLengthFt,
                facetIds: [f1.id, f2.id]
              });
              console.log(`   Valley found: ${f1.id} ↔ ${f2.id} = ${valleyLengthFt.toFixed(0)}ft`);
            }
          } else {
            console.warn(`   ⚠️ Invalid hip/valley length: ${hipLengthFt}, skipping`);
          }
        }
      }
    }
  }
  
  // 4. If no ridges found from facet analysis, estimate from roof type
  if (ridges.length === 0 && facets.length >= 2) {
    // Default: assume single ridge running along longer dimension
    const ridgeLengthFt = longerDim * 0.7;
    const center = buildingCenter 
      ? [buildingCenter.lng, buildingCenter.lat] as XY 
      : facets[0].centroid;
    
    // Validate center coordinates before creating ridge
    if (!isNaN(center[0]) && !isNaN(center[1]) && isFinite(center[0]) && isFinite(center[1])) {
      // Calculate actual ridge endpoints (ridge runs E-W by default)
      const { metersPerDegLng } = degToMeters(center[1]);
      const ridgeHalfLenDeg = (ridgeLengthFt * 0.3048 / 2) / metersPerDegLng;
      
      const ridgeStart: XY = [center[0] - ridgeHalfLenDeg, center[1]];
      const ridgeEnd: XY = [center[0] + ridgeHalfLenDeg, center[1]];
      
      ridges.push({
        type: 'ridge',
        start: ridgeStart,
        end: ridgeEnd,
        lengthFt: ridgeLengthFt,
        facetIds: facets.map(f => f.id)
      });
      console.log(`   Default ridge estimated: ${ridgeLengthFt.toFixed(0)}ft`);
    } else {
      console.warn('⚠️ Cannot create default ridge: invalid center coordinates');
    }
  }
  
  // 5. If no hips found for 4+ facet roof, estimate standard hip roof hips
  if (hips.length === 0 && facets.length >= 4) {
    // Standard hip roof has 4 hips, one from each corner
    const hipLengthFt = (shorterDim / 2) * 1.4;
    const center = buildingCenter 
      ? [buildingCenter.lng, buildingCenter.lat] as XY 
      : facets[0].centroid;
    
    // Validate center coordinates before creating hips
    if (!isNaN(center[0]) && !isNaN(center[1]) && isFinite(center[0]) && isFinite(center[1])) {
      const { metersPerDegLng } = degToMeters(center[1]);
      const hipHalfLenDeg = (hipLengthFt * 0.3048 / 2) / metersPerDegLng;
      
      // Create 4 hips at 45° angles from corners
      const angles = [45, 135, 225, 315];
      for (const angle of angles) {
        const rad = angle * Math.PI / 180;
        const hipStart: XY = [
          center[0] - Math.sin(rad) * hipHalfLenDeg,
          center[1] - Math.cos(rad) * hipHalfLenDeg
        ];
        const hipEnd: XY = [
          center[0] + Math.sin(rad) * hipHalfLenDeg,
          center[1] + Math.cos(rad) * hipHalfLenDeg
        ];
        
        hips.push({
          type: 'hip',
          start: hipStart,
          end: hipEnd,
          lengthFt: hipLengthFt,
          facetIds: []
        });
      }
      console.log(`   Default hips estimated: 4 × ${hipLengthFt.toFixed(0)}ft`);
    } else {
      console.warn('⚠️ Cannot create default hips: invalid center coordinates');
    }
  }
  
  // 6. Determine roof type
  let roofType: SegmentTopology['roofType'] = 'complex';
  
  // NEW: Check for L-shape pattern from facet azimuths
  const hasN = facets.some(f => f.direction === 'N');
  const hasS = facets.some(f => f.direction === 'S');
  const hasE = facets.some(f => f.direction === 'E');
  const hasW = facets.some(f => f.direction === 'W');
  
  const hasNS = hasN && hasS;
  const hasEW = hasE && hasW;
  const isLShape = hasNS && hasEW && facets.length >= 6;
  
  if (facets.length === 0 || facets.every(f => f.pitchDegrees < 5)) {
    roofType = 'flat';
  } else if (facets.length === 2 && ridges.length === 1) {
    roofType = 'gable';
  } else if (facets.length === 4 && ridges.length === 1 && hips.length >= 2) {
    roofType = 'hip';
  } else if (ridges.length >= 2 || valleys.length >= 1 || isLShape) {
    roofType = 'cross-gable';
    if (isLShape) {
      console.log(`   L-SHAPE PATTERN DETECTED: ${facets.length} facets with N/S AND E/W opposing pairs`);
    }
  }
  
  console.log(`   Result: ${facets.length} facets, ${ridges.length} ridges, ${hips.length} hips, ${valleys.length} valleys → ${roofType}`);
  console.log(`   Totals: ridge=${ridges.reduce((s,r)=>s+r.lengthFt,0).toFixed(0)}ft, hip=${hips.reduce((s,h)=>s+h.lengthFt,0).toFixed(0)}ft, valley=${valleys.reduce((s,v)=>s+v.lengthFt,0).toFixed(0)}ft`);
  
  return {
    facets,
    ridges,
    hips,
    valleys,
    facetCount: facets.length,
    roofType
  };
}

/**
 * Convert segment topology to LinearFeature array for storage
 */
export function topologyToLinearFeatures(topology: SegmentTopology): Array<{
  id: string;
  wkt: string;
  length_ft: number;
  type: string;
  label: string;
}> {
  const features: Array<{ id: string; wkt: string; length_ft: number; type: string; label: string }> = [];
  let id = 1;
  
  // Helper to validate coordinates
  const isValidCoord = (xy: XY): boolean => 
    xy && !isNaN(xy[0]) && !isNaN(xy[1]) && isFinite(xy[0]) && isFinite(xy[1]);
  
  // Helper to check for non-zero length (distinct start/end points)
  const isNonZeroLength = (start: XY, end: XY): boolean =>
    start[0] !== end[0] || start[1] !== end[1];
  
  topology.ridges.forEach((r, i) => {
    if (isValidCoord(r.start) && isValidCoord(r.end) && isNonZeroLength(r.start, r.end)) {
      features.push({
        id: `LF${id++}`,
        wkt: `LINESTRING(${r.start[0]} ${r.start[1]}, ${r.end[0]} ${r.end[1]})`,
        length_ft: r.lengthFt,
        type: 'ridge',
        label: `Ridge ${i + 1}`
      });
    }
  });
  
  topology.hips.forEach((h, i) => {
    if (isValidCoord(h.start) && isValidCoord(h.end) && isNonZeroLength(h.start, h.end)) {
      features.push({
        id: `LF${id++}`,
        wkt: `LINESTRING(${h.start[0]} ${h.start[1]}, ${h.end[0]} ${h.end[1]})`,
        length_ft: h.lengthFt,
        type: 'hip',
        label: `Hip ${i + 1}`
      });
    }
  });
  
  topology.valleys.forEach((v, i) => {
    if (isValidCoord(v.start) && isValidCoord(v.end) && isNonZeroLength(v.start, v.end)) {
      features.push({
        id: `LF${id++}`,
        wkt: `LINESTRING(${v.start[0]} ${v.start[1]}, ${v.end[0]} ${v.end[1]})`,
        length_ft: v.lengthFt,
        type: 'valley',
        label: `Valley ${i + 1}`
      });
    }
  });
  
  return features;
}

/**
 * Calculate totals from topology
 */
export function topologyToTotals(topology: SegmentTopology): Record<string, number> {
  return {
    ridge_ft: topology.ridges.reduce((s, r) => s + r.lengthFt, 0),
    hip_ft: topology.hips.reduce((s, h) => s + h.lengthFt, 0),
    valley_ft: topology.valleys.reduce((s, v) => s + v.lengthFt, 0),
    perimeter_ft: 0, // Calculated separately from footprint
    eave_ft: 0,
    rake_ft: 0
  };
}
