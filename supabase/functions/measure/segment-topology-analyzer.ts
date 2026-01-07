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
 */
export function analyzeSegmentTopology(
  roofSegmentStats: SegmentData[],
  buildingCenter?: { lat: number; lng: number }
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
  
  // 2. Find ridges - where opposing facets meet
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
  
  for (let i = 0; i < facets.length; i++) {
    for (let j = i + 1; j < facets.length; j++) {
      const f1 = facets[i];
      const f2 = facets[j];
      const pairKey = `${f1.id}-${f2.id}`;
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);
      
      const azDiff = Math.abs(((f1.azimuthDegrees - f2.azimuthDegrees + 180) % 360) - 180);
      
      if (areOpposingAzimuths(f1.azimuthDegrees, f2.azimuthDegrees)) {
        // RIDGE: Opposing facets (N/S or E/W facing)
        const ridgeMidpoint = midpoint(f1.centroid, f2.centroid);
        
        // Ridge runs perpendicular to the facet facing directions
        // For N/S facets, ridge runs E-W
        // For E/W facets, ridge runs N-S
        const ridgeAzimuth = ((f1.azimuthDegrees + 90) % 180);
        const ridgeRad = ridgeAzimuth * Math.PI / 180;
        const ridgeHalfLen = 0.00015; // ~15m each side
        
        const ridgeStart: XY = [
          ridgeMidpoint[0] - Math.sin(ridgeRad) * ridgeHalfLen,
          ridgeMidpoint[1] - Math.cos(ridgeRad) * ridgeHalfLen
        ];
        const ridgeEnd: XY = [
          ridgeMidpoint[0] + Math.sin(ridgeRad) * ridgeHalfLen,
          ridgeMidpoint[1] + Math.cos(ridgeRad) * ridgeHalfLen
        ];
        
        ridges.push({
          type: 'ridge',
          start: ridgeStart,
          end: ridgeEnd,
          lengthFt: distance(ridgeStart, ridgeEnd, midLat),
          facetIds: [f1.id, f2.id]
        });
        
        console.log(`   Ridge found: ${f1.id}(${f1.direction}) ↔ ${f2.id}(${f2.direction})`);
        
      } else if (arePerpendicular(f1.azimuthDegrees, f2.azimuthDegrees)) {
        // Check if facets are adjacent (close centroids)
        const distBetween = distance(f1.centroid, f2.centroid, midLat);
        if (distBetween < 100) { // Within 100ft
          // Determine if hip or valley based on relative positions
          // Hip: outside corner (facets face away from each other)
          // Valley: inside corner (facets face toward each other)
          
          const hipMidpoint = midpoint(f1.centroid, f2.centroid);
          const hipAzimuth = (f1.azimuthDegrees + f2.azimuthDegrees) / 2;
          const hipRad = hipAzimuth * Math.PI / 180;
          const hipHalfLen = 0.00008; // ~8m each side
          
          const hipStart: XY = [
            hipMidpoint[0] - Math.sin(hipRad) * hipHalfLen,
            hipMidpoint[1] - Math.cos(hipRad) * hipHalfLen
          ];
          const hipEnd: XY = [
            hipMidpoint[0] + Math.sin(hipRad) * hipHalfLen,
            hipMidpoint[1] + Math.cos(hipRad) * hipHalfLen
          ];
          
          // Heuristic: if combined area is large relative to building, likely hip
          // If segments are in inner part of L-shape, likely valley
          const combinedArea = f1.areaSqft + f2.areaSqft;
          const avgArea = facets.reduce((s, f) => s + f.areaSqft, 0) / facets.length;
          
          if (combinedArea > avgArea * 1.5) {
            hips.push({
              type: 'hip',
              start: hipStart,
              end: hipEnd,
              lengthFt: distance(hipStart, hipEnd, midLat),
              facetIds: [f1.id, f2.id]
            });
          } else {
            valleys.push({
              type: 'valley',
              start: hipStart,
              end: hipEnd,
              lengthFt: distance(hipStart, hipEnd, midLat),
              facetIds: [f1.id, f2.id]
            });
          }
        }
      }
    }
  }
  
  // 4. Determine roof type
  let roofType: SegmentTopology['roofType'] = 'complex';
  
  if (facets.length === 0 || facets.every(f => f.pitchDegrees < 5)) {
    roofType = 'flat';
  } else if (facets.length === 2 && ridges.length === 1) {
    roofType = 'gable';
  } else if (facets.length === 4 && ridges.length === 1 && hips.length >= 2) {
    roofType = 'hip';
  } else if (ridges.length >= 2 || valleys.length >= 1) {
    roofType = 'cross-gable';
  }
  
  console.log(`   Result: ${facets.length} facets, ${ridges.length} ridges, ${hips.length} hips, ${valleys.length} valleys → ${roofType}`);
  
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
  
  topology.ridges.forEach((r, i) => {
    features.push({
      id: `LF${id++}`,
      wkt: `LINESTRING(${r.start[0]} ${r.start[1]}, ${r.end[0]} ${r.end[1]})`,
      length_ft: r.lengthFt,
      type: 'ridge',
      label: `Ridge ${i + 1}`
    });
  });
  
  topology.hips.forEach((h, i) => {
    features.push({
      id: `LF${id++}`,
      wkt: `LINESTRING(${h.start[0]} ${h.start[1]}, ${h.end[0]} ${h.end[1]})`,
      length_ft: h.lengthFt,
      type: 'hip',
      label: `Hip ${i + 1}`
    });
  });
  
  topology.valleys.forEach((v, i) => {
    features.push({
      id: `LF${id++}`,
      wkt: `LINESTRING(${v.start[0]} ${v.start[1]}, ${v.end[0]} ${v.end[1]})`,
      length_ft: v.lengthFt,
      type: 'valley',
      label: `Valley ${i + 1}`
    });
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
