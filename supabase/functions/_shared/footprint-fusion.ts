/**
 * Phase 7: Multi-Source Footprint Fusion
 * Combine multiple footprint sources for highest accuracy perimeter
 */

import { haversineDistanceFt, extractVerticesFromWKT } from './vertex-detector.ts';

export interface FootprintSource {
  name: 'mapbox' | 'microsoft' | 'osm' | 'solar_api' | 'user_drawn';
  polygonWKT: string;
  areaSqft: number;
  vertexCount: number;
  confidence: number;
  weight?: number;
}

export interface FusedFootprint {
  polygonWKT: string;
  areaSqft: number;
  vertices: FusedVertex[];
  sourceWeights: Record<string, number>;
  fusionMethod: 'weighted_average' | 'highest_confidence' | 'vertex_alignment';
  qualityScore: number;
  warnings: string[];
}

export interface FusedVertex {
  lat: number;
  lng: number;
  confidence: number;
  sourcesUsed: string[];
  originalPositions: { source: string; lat: number; lng: number }[];
}

export interface FusionConfig {
  vertexSnapToleranceFt: number;
  minSourcesForFusion: number;
  confidenceThreshold: number;
  preferHigherVertexCount: boolean;
}

const DEFAULT_CONFIG: FusionConfig = {
  vertexSnapToleranceFt: 5.0,
  minSourcesForFusion: 2,
  confidenceThreshold: 0.6,
  preferHigherVertexCount: true
};

/**
 * Calculate polygon area using Shoelace formula
 */
export function calculatePolygonArea(vertices: { lat: number; lng: number }[]): number {
  if (vertices.length < 3) return 0;

  // Convert to approximate feet (rough conversion at mid-latitudes)
  const avgLat = vertices.reduce((sum, v) => sum + v.lat, 0) / vertices.length;
  const ftPerDegLat = 364000; // Approximate feet per degree latitude
  const ftPerDegLng = ftPerDegLat * Math.cos(avgLat * Math.PI / 180);

  const verticesFt = vertices.map(v => ({
    x: v.lng * ftPerDegLng,
    y: v.lat * ftPerDegLat
  }));

  let area = 0;
  for (let i = 0; i < verticesFt.length; i++) {
    const j = (i + 1) % verticesFt.length;
    area += verticesFt[i].x * verticesFt[j].y;
    area -= verticesFt[j].x * verticesFt[i].y;
  }

  return Math.abs(area / 2);
}

/**
 * Normalize source weights based on confidence
 */
export function normalizeWeights(sources: FootprintSource[]): FootprintSource[] {
  const totalConfidence = sources.reduce((sum, s) => sum + s.confidence, 0);

  return sources.map(s => ({
    ...s,
    weight: s.confidence / totalConfidence
  }));
}

/**
 * Find corresponding vertices across sources
 */
export function findCorrespondingVertices(
  sources: FootprintSource[],
  toleranceFt: number
): Map<number, { source: string; lat: number; lng: number }[]>[] {
  if (sources.length === 0) return [];

  // Use the source with highest vertex count as reference
  const sortedSources = [...sources].sort((a, b) => b.vertexCount - a.vertexCount);
  const referenceSource = sortedSources[0];
  const referenceVertices = extractVerticesFromWKT(referenceSource.polygonWKT);

  const correspondences: Map<number, { source: string; lat: number; lng: number }[]>[] = [];

  // For each reference vertex, find corresponding vertices in other sources
  for (let i = 0; i < referenceVertices.length; i++) {
    const refVertex = referenceVertices[i];
    const correspondence = new Map<number, { source: string; lat: number; lng: number }[]>();
    
    const matchedVertices: { source: string; lat: number; lng: number }[] = [
      { source: referenceSource.name, lat: refVertex.lat, lng: refVertex.lng }
    ];

    // Search other sources for nearby vertices
    for (const source of sources) {
      if (source.name === referenceSource.name) continue;

      const sourceVertices = extractVerticesFromWKT(source.polygonWKT);
      let closestVertex: { lat: number; lng: number } | null = null;
      let closestDistance = Infinity;

      for (const vertex of sourceVertices) {
        const distance = haversineDistanceFt(refVertex.lat, refVertex.lng, vertex.lat, vertex.lng);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestVertex = vertex;
        }
      }

      if (closestVertex && closestDistance <= toleranceFt) {
        matchedVertices.push({
          source: source.name,
          lat: closestVertex.lat,
          lng: closestVertex.lng
        });
      }
    }

    correspondence.set(i, matchedVertices);
    correspondences.push(correspondence);
  }

  return correspondences;
}

/**
 * Calculate weighted average position for a vertex
 */
export function calculateWeightedAveragePosition(
  positions: { source: string; lat: number; lng: number }[],
  sourceWeights: Record<string, number>
): { lat: number; lng: number; confidence: number } {
  let totalWeight = 0;
  let weightedLat = 0;
  let weightedLng = 0;

  for (const pos of positions) {
    const weight = sourceWeights[pos.source] || 1 / positions.length;
    weightedLat += pos.lat * weight;
    weightedLng += pos.lng * weight;
    totalWeight += weight;
  }

  // Confidence based on number of sources that agree
  const confidence = Math.min(1.0, positions.length / 3);

  return {
    lat: weightedLat / totalWeight,
    lng: weightedLng / totalWeight,
    confidence
  };
}

/**
 * Fuse multiple footprint sources into a single high-accuracy footprint
 */
export function fuseFootprints(
  sources: FootprintSource[],
  config: Partial<FusionConfig> = {}
): FusedFootprint {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const warnings: string[] = [];

  // Filter sources by confidence threshold
  const validSources = sources.filter(s => s.confidence >= cfg.confidenceThreshold);

  if (validSources.length === 0) {
    warnings.push('No sources meet confidence threshold, using highest confidence source');
    const bestSource = sources.reduce((best, s) => s.confidence > best.confidence ? s : best);
    const vertices = extractVerticesFromWKT(bestSource.polygonWKT);
    
    return {
      polygonWKT: bestSource.polygonWKT,
      areaSqft: bestSource.areaSqft,
      vertices: vertices.map(v => ({
        lat: v.lat,
        lng: v.lng,
        confidence: bestSource.confidence,
        sourcesUsed: [bestSource.name],
        originalPositions: [{ source: bestSource.name, lat: v.lat, lng: v.lng }]
      })),
      sourceWeights: { [bestSource.name]: 1.0 },
      fusionMethod: 'highest_confidence',
      qualityScore: bestSource.confidence * 100,
      warnings
    };
  }

  if (validSources.length === 1) {
    warnings.push('Only one valid source available, no fusion performed');
    const source = validSources[0];
    const vertices = extractVerticesFromWKT(source.polygonWKT);
    
    return {
      polygonWKT: source.polygonWKT,
      areaSqft: source.areaSqft,
      vertices: vertices.map(v => ({
        lat: v.lat,
        lng: v.lng,
        confidence: source.confidence,
        sourcesUsed: [source.name],
        originalPositions: [{ source: source.name, lat: v.lat, lng: v.lng }]
      })),
      sourceWeights: { [source.name]: 1.0 },
      fusionMethod: 'highest_confidence',
      qualityScore: source.confidence * 100,
      warnings
    };
  }

  // Normalize weights
  const weightedSources = normalizeWeights(validSources);
  const sourceWeights: Record<string, number> = {};
  weightedSources.forEach(s => { sourceWeights[s.name] = s.weight || 0; });

  // Find vertex correspondences
  const correspondences = findCorrespondingVertices(weightedSources, cfg.vertexSnapToleranceFt);

  // Calculate fused vertices
  const fusedVertices: FusedVertex[] = [];

  for (const correspondence of correspondences) {
    const [index, positions] = [...correspondence.entries()][0];
    const avgPosition = calculateWeightedAveragePosition(positions, sourceWeights);

    fusedVertices.push({
      lat: avgPosition.lat,
      lng: avgPosition.lng,
      confidence: avgPosition.confidence,
      sourcesUsed: positions.map(p => p.source),
      originalPositions: positions
    });
  }

  // Generate fused polygon WKT
  const coordString = fusedVertices
    .map(v => `${v.lng} ${v.lat}`)
    .join(', ');
  const closingCoord = `${fusedVertices[0].lng} ${fusedVertices[0].lat}`;
  const polygonWKT = `POLYGON((${coordString}, ${closingCoord}))`;

  // Calculate fused area
  const areaSqft = calculatePolygonArea(fusedVertices);

  // Calculate quality score
  const avgConfidence = fusedVertices.reduce((sum, v) => sum + v.confidence, 0) / fusedVertices.length;
  const sourceCoverage = Object.keys(sourceWeights).length / sources.length;
  const qualityScore = (avgConfidence * 0.7 + sourceCoverage * 0.3) * 100;

  // Check for area consistency
  const areas = validSources.map(s => s.areaSqft);
  const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
  const maxAreaDeviation = Math.max(...areas.map(a => Math.abs(a - avgArea) / avgArea * 100));

  if (maxAreaDeviation > 10) {
    warnings.push(`Source areas vary by up to ${maxAreaDeviation.toFixed(1)}% - fusion may be less reliable`);
  }

  return {
    polygonWKT,
    areaSqft,
    vertices: fusedVertices,
    sourceWeights,
    fusionMethod: 'weighted_average',
    qualityScore,
    warnings
  };
}

/**
 * Validate fused footprint against individual sources
 */
export function validateFusedFootprint(
  fused: FusedFootprint,
  sources: FootprintSource[]
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check area is within reasonable range of source areas
  const sourceAreas = sources.map(s => s.areaSqft);
  const minArea = Math.min(...sourceAreas);
  const maxArea = Math.max(...sourceAreas);

  if (fused.areaSqft < minArea * 0.9 || fused.areaSqft > maxArea * 1.1) {
    issues.push(`Fused area ${fused.areaSqft.toFixed(0)} sqft is outside source range (${minArea.toFixed(0)}-${maxArea.toFixed(0)})`);
  }

  // Check vertex count is reasonable
  const sourceVertexCounts = sources.map(s => s.vertexCount);
  const maxVertexCount = Math.max(...sourceVertexCounts);

  if (fused.vertices.length < 3) {
    issues.push('Fused footprint has fewer than 3 vertices');
  }

  if (fused.vertices.length > maxVertexCount * 1.5) {
    issues.push('Fused footprint has significantly more vertices than sources');
  }

  // Check for self-intersecting polygon (basic check)
  // This would require more complex geometry validation

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Select best single source if fusion fails validation
 */
export function selectBestSource(sources: FootprintSource[]): FootprintSource {
  // Prefer sources with higher confidence and more vertices
  return sources.reduce((best, source) => {
    const bestScore = best.confidence * 0.7 + (best.vertexCount / 20) * 0.3;
    const sourceScore = source.confidence * 0.7 + (source.vertexCount / 20) * 0.3;
    return sourceScore > bestScore ? source : best;
  });
}

/**
 * Main fusion entry point with fallback
 */
export function processFootprintFusion(
  sources: FootprintSource[],
  config: Partial<FusionConfig> = {}
): FusedFootprint {
  if (sources.length === 0) {
    throw new Error('No footprint sources provided');
  }

  if (sources.length === 1) {
    const source = sources[0];
    const vertices = extractVerticesFromWKT(source.polygonWKT);
    return {
      polygonWKT: source.polygonWKT,
      areaSqft: source.areaSqft,
      vertices: vertices.map(v => ({
        lat: v.lat,
        lng: v.lng,
        confidence: source.confidence,
        sourcesUsed: [source.name],
        originalPositions: [{ source: source.name, lat: v.lat, lng: v.lng }]
      })),
      sourceWeights: { [source.name]: 1.0 },
      fusionMethod: 'highest_confidence',
      qualityScore: source.confidence * 100,
      warnings: ['Only one source provided, no fusion performed']
    };
  }

  // Attempt fusion
  const fused = fuseFootprints(sources, config);

  // Validate result
  const validation = validateFusedFootprint(fused, sources);

  if (!validation.valid) {
    // Fall back to best single source
    const bestSource = selectBestSource(sources);
    const vertices = extractVerticesFromWKT(bestSource.polygonWKT);
    
    return {
      polygonWKT: bestSource.polygonWKT,
      areaSqft: bestSource.areaSqft,
      vertices: vertices.map(v => ({
        lat: v.lat,
        lng: v.lng,
        confidence: bestSource.confidence,
        sourcesUsed: [bestSource.name],
        originalPositions: [{ source: bestSource.name, lat: v.lat, lng: v.lng }]
      })),
      sourceWeights: { [bestSource.name]: 1.0 },
      fusionMethod: 'highest_confidence',
      qualityScore: bestSource.confidence * 100,
      warnings: [
        'Fusion validation failed, using best single source',
        ...validation.issues
      ]
    };
  }

  return fused;
}
