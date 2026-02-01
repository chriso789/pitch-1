/**
 * Facet Builder from Linear Features
 * 
 * Builds topologically correct, non-overlapping facet polygons by
 * analyzing the connectivity of ridges, hips, valleys, eaves, and rakes.
 * 
 * This creates proper facets by "walking" the geometry graph rather than
 * naive triangulation from perimeter vertices.
 */

export interface GPSCoord {
  lat: number;
  lng: number;
}

export interface LinearSegment {
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  start: GPSCoord;
  end: GPSCoord;
  length: number;
}

export interface FacetPolygon {
  id: string;
  vertices: GPSCoord[];
  area: number;
  boundaryTypes: string[]; // Types of segments forming this facet
  centroid: GPSCoord;
}

interface GraphNode {
  coord: GPSCoord;
  key: string;
  edges: GraphEdge[];
}

interface GraphEdge {
  to: GraphNode;
  type: string;
  segment: LinearSegment;
}

const COORD_TOLERANCE = 0.00001; // ~1 meter at equator

/**
 * Create a unique key for a GPS coordinate
 */
function coordKey(coord: GPSCoord): string {
  return `${coord.lat.toFixed(6)},${coord.lng.toFixed(6)}`;
}

/**
 * Check if two coordinates are approximately equal
 */
function coordsEqual(a: GPSCoord, b: GPSCoord): boolean {
  return Math.abs(a.lat - b.lat) < COORD_TOLERANCE && 
         Math.abs(a.lng - b.lng) < COORD_TOLERANCE;
}

/**
 * Calculate area of polygon in square feet using Shoelace formula
 */
function calculatePolygonArea(vertices: GPSCoord[]): number {
  if (vertices.length < 3) return 0;
  
  const centerLat = vertices.reduce((sum, v) => sum + v.lat, 0) / vertices.length;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);
  
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const xi = vertices[i].lng * metersPerDegLng;
    const yi = vertices[i].lat * metersPerDegLat;
    const xj = vertices[j].lng * metersPerDegLng;
    const yj = vertices[j].lat * metersPerDegLat;
    area += xi * yj - xj * yi;
  }
  
  const areaM2 = Math.abs(area) / 2;
  return areaM2 * 10.7639; // Convert to square feet
}

/**
 * Calculate centroid of polygon
 */
function calculateCentroid(vertices: GPSCoord[]): GPSCoord {
  if (vertices.length === 0) return { lat: 0, lng: 0 };
  return {
    lat: vertices.reduce((sum, v) => sum + v.lat, 0) / vertices.length,
    lng: vertices.reduce((sum, v) => sum + v.lng, 0) / vertices.length,
  };
}

/**
 * Build a graph from linear segments
 */
function buildGraph(segments: LinearSegment[]): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>();
  
  // Create or get node for a coordinate
  const getOrCreateNode = (coord: GPSCoord): GraphNode => {
    const key = coordKey(coord);
    if (!nodes.has(key)) {
      nodes.set(key, { coord, key, edges: [] });
    }
    return nodes.get(key)!;
  };
  
  // Add edges for each segment
  segments.forEach(segment => {
    const startNode = getOrCreateNode(segment.start);
    const endNode = getOrCreateNode(segment.end);
    
    // Add bidirectional edges
    startNode.edges.push({ to: endNode, type: segment.type, segment });
    endNode.edges.push({ to: startNode, type: segment.type, segment });
  });
  
  return nodes;
}

/**
 * Find closed polygons by walking the graph
 * Uses a simplified approach: find cycles starting from each edge node (degree < 3)
 */
function findFacetCycles(
  nodes: Map<string, GraphNode>,
  maxFacets: number = 20
): GPSCoord[][] {
  const visitedEdges = new Set<string>();
  const facets: GPSCoord[][] = [];
  
  // Sort nodes by degree - start from edge nodes (eave/rake endpoints)
  const sortedNodes = Array.from(nodes.values()).sort((a, b) => a.edges.length - b.edges.length);
  
  // Try to find cycles starting from each unvisited edge
  for (const startNode of sortedNodes) {
    if (facets.length >= maxFacets) break;
    
    for (const startEdge of startNode.edges) {
      const edgeKey = `${startNode.key}->${startEdge.to.key}`;
      if (visitedEdges.has(edgeKey)) continue;
      
      // Try to complete a cycle
      const cycle = findCycle(startNode, startEdge, visitedEdges, nodes);
      if (cycle && cycle.length >= 3) {
        facets.push(cycle);
        // Mark all edges in cycle as visited
        for (let i = 0; i < cycle.length; i++) {
          const j = (i + 1) % cycle.length;
          visitedEdges.add(`${coordKey(cycle[i])}->${coordKey(cycle[j])}`);
          visitedEdges.add(`${coordKey(cycle[j])}->${coordKey(cycle[i])}`);
        }
      }
    }
  }
  
  return facets;
}

/**
 * Find a cycle starting from an edge, using right-hand rule
 */
function findCycle(
  startNode: GraphNode,
  firstEdge: GraphEdge,
  visitedEdges: Set<string>,
  allNodes: Map<string, GraphNode>,
  maxSteps: number = 50
): GPSCoord[] | null {
  const path: GraphNode[] = [startNode];
  let currentNode = firstEdge.to;
  let prevNode = startNode;
  let steps = 0;
  
  while (steps < maxSteps) {
    steps++;
    path.push(currentNode);
    
    // Check if we've completed a cycle
    if (currentNode.key === startNode.key && path.length > 3) {
      return path.map(n => n.coord);
    }
    
    // Find next edge using right-hand rule (turn right at each junction)
    const nextEdge = findNextEdge(currentNode, prevNode);
    if (!nextEdge) break;
    
    const edgeKey = `${currentNode.key}->${nextEdge.to.key}`;
    if (visitedEdges.has(edgeKey)) break;
    
    prevNode = currentNode;
    currentNode = nextEdge.to;
  }
  
  return null;
}

/**
 * Find the next edge using right-hand rule
 * At a junction, turn right (clockwise) from incoming direction
 */
function findNextEdge(node: GraphNode, prevNode: GraphNode): GraphEdge | null {
  if (node.edges.length === 0) return null;
  if (node.edges.length === 1) return null; // Dead end
  if (node.edges.length === 2) {
    // Simple pass-through
    return node.edges.find(e => e.to.key !== prevNode.key) || null;
  }
  
  // Multiple edges - sort by angle and pick next clockwise
  const incomingAngle = Math.atan2(
    node.coord.lat - prevNode.coord.lat,
    node.coord.lng - prevNode.coord.lng
  );
  
  const otherEdges = node.edges.filter(e => e.to.key !== prevNode.key);
  
  // Sort by angle difference from incoming (clockwise)
  otherEdges.sort((a, b) => {
    const angleA = Math.atan2(
      a.to.coord.lat - node.coord.lat,
      a.to.coord.lng - node.coord.lng
    );
    const angleB = Math.atan2(
      b.to.coord.lat - node.coord.lat,
      b.to.coord.lng - node.coord.lng
    );
    
    // Normalize angles relative to incoming direction
    const diffA = ((angleA - incomingAngle + Math.PI * 2) % (Math.PI * 2));
    const diffB = ((angleB - incomingAngle + Math.PI * 2) % (Math.PI * 2));
    
    return diffA - diffB;
  });
  
  return otherEdges[0] || null;
}

/**
 * Build facets from linear features using topological analysis.
 * This is the main entry point for facet generation.
 */
export function buildFacetsFromLinearFeatures(
  perimeterCoords: GPSCoord[],
  ridges: LinearSegment[],
  hips: LinearSegment[],
  valleys: LinearSegment[]
): FacetPolygon[] {
  // Collect all segments including perimeter edges
  const allSegments: LinearSegment[] = [...ridges, ...hips, ...valleys];
  
  // Add perimeter as eave segments
  for (let i = 0; i < perimeterCoords.length - 1; i++) {
    const start = perimeterCoords[i];
    const end = perimeterCoords[i + 1];
    const dx = (end.lng - start.lng) * 111320 * Math.cos(start.lat * Math.PI / 180);
    const dy = (end.lat - start.lat) * 111320;
    const length = Math.sqrt(dx * dx + dy * dy) * 3.28084;
    
    allSegments.push({
      type: 'eave',
      start,
      end,
      length,
    });
  }
  
  if (allSegments.length < 3) {
    console.log('📐 Not enough segments to build facets');
    return [];
  }
  
  // Build graph
  const graph = buildGraph(allSegments);
  console.log(`📐 Built graph with ${graph.size} nodes from ${allSegments.length} segments`);
  
  // Find facet cycles
  const cycles = findFacetCycles(graph);
  console.log(`📐 Found ${cycles.length} facet cycles`);
  
  // Convert cycles to facet polygons
  const facets: FacetPolygon[] = cycles.map((vertices, idx) => {
    const area = calculatePolygonArea(vertices);
    const centroid = calculateCentroid(vertices);
    
    // Determine boundary types
    const boundaryTypes = new Set<string>();
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const v1 = vertices[i];
      const v2 = vertices[j];
      
      // Find the segment that matches this edge
      const matchingSegment = allSegments.find(s => 
        (coordsEqual(s.start, v1) && coordsEqual(s.end, v2)) ||
        (coordsEqual(s.start, v2) && coordsEqual(s.end, v1))
      );
      
      if (matchingSegment) {
        boundaryTypes.add(matchingSegment.type);
      }
    }
    
    return {
      id: `F${idx + 1}`,
      vertices,
      area,
      boundaryTypes: Array.from(boundaryTypes),
      centroid,
    };
  });
  
  // Filter out degenerate facets
  return facets.filter(f => f.area > 10 && f.vertices.length >= 3);
}

/**
 * Parse linear features from measurement WKT data
 */
export function parseLinearFeaturesFromWKT(
  linearFeaturesWkt: any[]
): { ridges: LinearSegment[]; hips: LinearSegment[]; valleys: LinearSegment[] } {
  const ridges: LinearSegment[] = [];
  const hips: LinearSegment[] = [];
  const valleys: LinearSegment[] = [];
  
  if (!Array.isArray(linearFeaturesWkt)) {
    return { ridges, hips, valleys };
  }
  
  linearFeaturesWkt.forEach(feature => {
    if (!feature.wkt || !feature.type) return;
    
    // Parse WKT LINESTRING
    const match = feature.wkt.match(/LINESTRING\s*\(([^)]+)\)/i);
    if (!match) return;
    
    const coords = match[1].split(',').map((pair: string) => {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number);
      return { lat, lng };
    });
    
    if (coords.length < 2) return;
    
    const segment: LinearSegment = {
      type: feature.type.toLowerCase() as any,
      start: coords[0],
      end: coords[coords.length - 1],
      length: feature.length_ft || feature.length || 0,
    };
    
    switch (segment.type) {
      case 'ridge': ridges.push(segment); break;
      case 'hip': hips.push(segment); break;
      case 'valley': valleys.push(segment); break;
    }
  });
  
  return { ridges, hips, valleys };
}

/**
 * Validate that generated facets match expected topology
 */
export function validateFacetTopology(
  facets: FacetPolygon[],
  expectedCount?: number
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (facets.length === 0) {
    issues.push('No facets generated');
  }
  
  if (expectedCount && Math.abs(facets.length - expectedCount) > 2) {
    issues.push(`Expected ~${expectedCount} facets, got ${facets.length}`);
  }
  
  // Check for overlapping facets
  // (simplified: just check centroid uniqueness)
  const centroids = new Set<string>();
  facets.forEach(f => {
    const key = `${f.centroid.lat.toFixed(5)},${f.centroid.lng.toFixed(5)}`;
    if (centroids.has(key)) {
      issues.push('Duplicate facet centroids detected');
    }
    centroids.add(key);
  });
  
  // Check for very small facets
  const smallFacets = facets.filter(f => f.area < 50);
  if (smallFacets.length > 0) {
    issues.push(`${smallFacets.length} facets smaller than 50 sqft`);
  }
  
  return { valid: issues.length === 0, issues };
}
