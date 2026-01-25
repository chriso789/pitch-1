/**
 * Phase 21: Multi-Image Triangulation System
 * Fetches imagery from multiple sources (Google, Mapbox, Bing) and triangulates
 * roof vertex positions for higher accuracy through cross-validation.
 */

export interface ImagerySource {
  name: 'google' | 'mapbox' | 'bing';
  zoomLevel: number;
  imageUrl?: string;
  vertices?: TriangulatedVertex[];
  quality?: number;
}

export interface TriangulatedVertex {
  id: string;
  lat: number;
  lng: number;
  type: 'perimeter' | 'ridge-end' | 'hip-junction' | 'valley-intersection';
  confidence: number;
  source: string;
  matchedVertexIds?: string[];
}

export interface TriangulationResult {
  fusedVertices: TriangulatedVertex[];
  triangulationQuality: 'poor' | 'fair' | 'good' | 'excellent';
  averagePositionErrorFt: number;
  sourceComparison: {
    google: { vertexCount: number; quality: number };
    mapbox: { vertexCount: number; quality: number };
    bing: { vertexCount: number; quality: number };
  };
  matchedVertexCount: number;
}

const EARTH_RADIUS_FT = 20902231; // Earth radius in feet

/**
 * Calculate haversine distance between two coordinates in feet
 */
function haversineDistanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 + 
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.sqrt(a));
}

/**
 * Fetch imagery URLs from multiple sources at different zoom levels
 */
export async function fetchMultiSourceImagery(
  lat: number, 
  lng: number,
  sources: ('google' | 'mapbox' | 'bing')[] = ['google', 'mapbox', 'bing'],
  zoomLevels: number[] = [19, 20, 21]
): Promise<ImagerySource[]> {
  const imagery: ImagerySource[] = [];
  
  for (const source of sources) {
    for (const zoom of zoomLevels) {
      const imageUrl = await getImageryUrl(source, lat, lng, zoom);
      if (imageUrl) {
        imagery.push({
          name: source,
          zoomLevel: zoom,
          imageUrl,
          quality: estimateImageQuality(zoom)
        });
      }
    }
  }
  
  return imagery;
}

/**
 * Get imagery URL for a specific source
 */
async function getImageryUrl(
  source: 'google' | 'mapbox' | 'bing',
  lat: number,
  lng: number,
  zoom: number
): Promise<string | null> {
  const tileSize = 512;
  
  switch (source) {
    case 'mapbox': {
      const mapboxToken = Deno.env.get('MAPBOX_ACCESS_TOKEN');
      if (!mapboxToken) return null;
      return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom}/${tileSize}x${tileSize}?access_token=${mapboxToken}`;
    }
    case 'google': {
      const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
      if (!googleKey) return null;
      return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${tileSize}x${tileSize}&maptype=satellite&key=${googleKey}`;
    }
    case 'bing': {
      const bingKey = Deno.env.get('BING_MAPS_API_KEY');
      if (!bingKey) return null;
      return `https://dev.virtualearth.net/REST/v1/Imagery/Map/Aerial/${lat},${lng}/${zoom}?mapSize=${tileSize},${tileSize}&key=${bingKey}`;
    }
    default:
      return null;
  }
}

/**
 * Estimate image quality based on zoom level
 */
function estimateImageQuality(zoom: number): number {
  if (zoom >= 21) return 0.95;
  if (zoom >= 20) return 0.85;
  if (zoom >= 19) return 0.70;
  return 0.50;
}

/**
 * Match vertices across different imagery sources
 * Uses spatial proximity to identify corresponding vertices
 */
export function matchVerticesAcrossImages(
  vertices1: TriangulatedVertex[],
  vertices2: TriangulatedVertex[],
  toleranceFt: number = 3.0
): Map<string, string[]> {
  const matches = new Map<string, string[]>();
  
  for (const v1 of vertices1) {
    const matchedIds: string[] = [];
    
    for (const v2 of vertices2) {
      // Only match same vertex types
      if (v1.type !== v2.type) continue;
      
      const distance = haversineDistanceFt(v1.lat, v1.lng, v2.lat, v2.lng);
      if (distance <= toleranceFt) {
        matchedIds.push(v2.id);
      }
    }
    
    if (matchedIds.length > 0) {
      matches.set(v1.id, matchedIds);
    }
  }
  
  return matches;
}

/**
 * Calculate triangulated position from multiple matched vertices
 * Uses confidence-weighted averaging
 */
export function calculateTriangulatedPosition(
  matchedVertices: TriangulatedVertex[]
): { lat: number; lng: number; confidence: number } {
  if (matchedVertices.length === 0) {
    throw new Error('No vertices to triangulate');
  }
  
  if (matchedVertices.length === 1) {
    return {
      lat: matchedVertices[0].lat,
      lng: matchedVertices[0].lng,
      confidence: matchedVertices[0].confidence
    };
  }
  
  // Confidence-weighted average
  let totalWeight = 0;
  let weightedLat = 0;
  let weightedLng = 0;
  
  for (const v of matchedVertices) {
    const weight = v.confidence;
    weightedLat += v.lat * weight;
    weightedLng += v.lng * weight;
    totalWeight += weight;
  }
  
  const avgLat = weightedLat / totalWeight;
  const avgLng = weightedLng / totalWeight;
  
  // Calculate confidence boost from multiple sources
  const sourceCount = new Set(matchedVertices.map(v => v.source)).size;
  const confidenceBoost = Math.min(0.15, (sourceCount - 1) * 0.05);
  
  // Calculate average confidence with boost
  const avgConfidence = (matchedVertices.reduce((sum, v) => sum + v.confidence, 0) / matchedVertices.length) + confidenceBoost;
  
  return {
    lat: avgLat,
    lng: avgLng,
    confidence: Math.min(0.99, avgConfidence)
  };
}

/**
 * Main triangulation function - combines vertices from multiple sources
 */
export function triangulateFromMultipleSources(
  sourceVertices: Map<string, TriangulatedVertex[]>,
  toleranceFt: number = 3.0
): TriangulationResult {
  const allVertices: TriangulatedVertex[] = [];
  const fusedVertices: TriangulatedVertex[] = [];
  const processedIds = new Set<string>();
  
  // Collect all vertices
  for (const [source, vertices] of sourceVertices) {
    for (const v of vertices) {
      allVertices.push({ ...v, source });
    }
  }
  
  // Group vertices by proximity
  const vertexGroups: TriangulatedVertex[][] = [];
  
  for (const vertex of allVertices) {
    if (processedIds.has(vertex.id)) continue;
    
    const group: TriangulatedVertex[] = [vertex];
    processedIds.add(vertex.id);
    
    // Find nearby vertices from other sources
    for (const other of allVertices) {
      if (processedIds.has(other.id)) continue;
      if (vertex.source === other.source) continue;
      if (vertex.type !== other.type) continue;
      
      const distance = haversineDistanceFt(vertex.lat, vertex.lng, other.lat, other.lng);
      if (distance <= toleranceFt) {
        group.push(other);
        processedIds.add(other.id);
      }
    }
    
    vertexGroups.push(group);
  }
  
  // Fuse each group
  let totalError = 0;
  let matchedCount = 0;
  
  for (let i = 0; i < vertexGroups.length; i++) {
    const group = vertexGroups[i];
    const fused = calculateTriangulatedPosition(group);
    
    // Calculate position error (average distance from fused position)
    let groupError = 0;
    for (const v of group) {
      groupError += haversineDistanceFt(fused.lat, fused.lng, v.lat, v.lng);
    }
    totalError += groupError / group.length;
    
    if (group.length > 1) {
      matchedCount++;
    }
    
    fusedVertices.push({
      id: `fused_${i}`,
      lat: fused.lat,
      lng: fused.lng,
      type: group[0].type,
      confidence: fused.confidence,
      source: 'triangulated',
      matchedVertexIds: group.map(v => v.id)
    });
  }
  
  const averageError = vertexGroups.length > 0 ? totalError / vertexGroups.length : 0;
  
  // Determine triangulation quality
  let quality: 'poor' | 'fair' | 'good' | 'excellent' = 'poor';
  const matchRatio = matchedCount / fusedVertices.length;
  
  if (matchRatio >= 0.8 && averageError < 1.0) {
    quality = 'excellent';
  } else if (matchRatio >= 0.6 && averageError < 2.0) {
    quality = 'good';
  } else if (matchRatio >= 0.4 && averageError < 3.0) {
    quality = 'fair';
  }
  
  // Build source comparison
  const sourceComparison = {
    google: { vertexCount: 0, quality: 0 },
    mapbox: { vertexCount: 0, quality: 0 },
    bing: { vertexCount: 0, quality: 0 }
  };
  
  for (const [source, vertices] of sourceVertices) {
    const key = source as 'google' | 'mapbox' | 'bing';
    if (sourceComparison[key]) {
      sourceComparison[key].vertexCount = vertices.length;
      sourceComparison[key].quality = vertices.reduce((sum, v) => sum + v.confidence, 0) / vertices.length;
    }
  }
  
  return {
    fusedVertices,
    triangulationQuality: quality,
    averagePositionErrorFt: averageError,
    sourceComparison,
    matchedVertexCount: matchedCount
  };
}

/**
 * Cross-validate detected features between imagery sources
 */
export function crossValidateFeatures(
  sourceFeatures: Map<string, { ridges: any[]; hips: any[]; valleys: any[] }>
): {
  validatedFeatures: { ridges: any[]; hips: any[]; valleys: any[] };
  discrepancies: { type: string; details: string }[];
} {
  const discrepancies: { type: string; details: string }[] = [];
  const validatedFeatures = { ridges: [], hips: [], valleys: [] };
  
  // Get feature counts from each source
  const ridgeCounts: number[] = [];
  const hipCounts: number[] = [];
  const valleyCounts: number[] = [];
  
  for (const [source, features] of sourceFeatures) {
    ridgeCounts.push(features.ridges.length);
    hipCounts.push(features.hips.length);
    valleyCounts.push(features.valleys.length);
  }
  
  // Check for count discrepancies
  if (Math.max(...ridgeCounts) - Math.min(...ridgeCounts) > 1) {
    discrepancies.push({
      type: 'ridge_count',
      details: `Ridge count varies: ${ridgeCounts.join(', ')}`
    });
  }
  
  if (Math.max(...hipCounts) - Math.min(...hipCounts) > 2) {
    discrepancies.push({
      type: 'hip_count',
      details: `Hip count varies: ${hipCounts.join(', ')}`
    });
  }
  
  if (Math.max(...valleyCounts) - Math.min(...valleyCounts) > 1) {
    discrepancies.push({
      type: 'valley_count',
      details: `Valley count varies: ${valleyCounts.join(', ')}`
    });
  }
  
  // Use majority voting for feature selection
  // (implementation would merge features based on spatial matching)
  
  return { validatedFeatures, discrepancies };
}
