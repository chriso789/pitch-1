/**
 * AI Geometry Converter
 * 
 * Converts AI building detection output to WKT format for storage
 * and rendering in the roof diagram overlay system.
 */

import { haversineDistanceFeet, type GPSCoord } from './gpsCalculations';

interface AIEdge {
  start: GPSCoord;
  end: GPSCoord;
  lengthPixels?: number;
  facetsConnected?: number[];
}

interface AIEdges {
  ridges?: AIEdge[];
  hips?: AIEdge[];
  valleys?: AIEdge[];
  eaves?: AIEdge[];
  rakes?: AIEdge[];
}

interface AIFacet {
  facetNumber: number;
  polygon: GPSCoord[];
  orientation?: string;
  estimatedPitch?: string;
  pitchConfidence?: string;
  areaPixels?: number;
  notes?: string;
}

interface AIAnalysis {
  buildingFootprint?: {
    main?: GPSCoord[];
    attachedStructures?: Array<{ polygon?: GPSCoord[] }>;
  };
  roofType?: string;
  facets?: AIFacet[];
  edges?: AIEdges;
  features?: {
    chimneys?: any[];
    skylights?: any[];
    vents?: any[];
    dormers?: any[];
  };
  pitchAnalysis?: {
    method?: string;
    overallPitchRange?: string;
    confidence?: string;
    notes?: string;
  };
}

export interface LinearFeatureWKT {
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'perimeter';
  wkt: string;
  length_ft: number;
}

export interface FacetWKT {
  facet_number: number;
  boundary_wkt: string;
  area_sqft?: number;
  pitch?: string;
  orientation?: string;
  centroid?: GPSCoord;
}

/**
 * Convert a GPS coordinate array to WKT LINESTRING
 */
function coordsToLineWKT(start: GPSCoord, end: GPSCoord): string {
  return `LINESTRING(${start.lng} ${start.lat}, ${end.lng} ${end.lat})`;
}

/**
 * Convert a GPS polygon to WKT POLYGON
 */
function polygonToWKT(coords: GPSCoord[]): string {
  if (coords.length < 3) return '';
  
  // Close the polygon by adding first point at end if not already closed
  const closed = [...coords];
  if (coords[0].lat !== coords[coords.length - 1].lat || 
      coords[0].lng !== coords[coords.length - 1].lng) {
    closed.push(coords[0]);
  }
  
  const coordsString = closed.map(c => `${c.lng} ${c.lat}`).join(', ');
  return `POLYGON((${coordsString}))`;
}

/**
 * Calculate centroid of a polygon
 */
function calculateCentroid(coords: GPSCoord[]): GPSCoord {
  const lat = coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
  const lng = coords.reduce((sum, c) => sum + c.lng, 0) / coords.length;
  return { lat, lng };
}

/**
 * Convert AI edge array to LinearFeatureWKT array
 */
function convertEdges(edges: AIEdge[] | undefined, type: LinearFeatureWKT['type']): LinearFeatureWKT[] {
  if (!edges || !Array.isArray(edges)) return [];
  
  return edges
    .filter(edge => edge.start && edge.end && edge.start.lat && edge.start.lng && edge.end.lat && edge.end.lng)
    .map(edge => ({
      type,
      wkt: coordsToLineWKT(edge.start, edge.end),
      length_ft: haversineDistanceFeet(edge.start, edge.end),
    }));
}

/**
 * Convert AI building footprint to perimeter WKT
 */
function convertFootprintToPerimeter(footprint: GPSCoord[] | undefined): LinearFeatureWKT | null {
  if (!footprint || footprint.length < 3) return null;
  
  // Calculate perimeter length
  let perimeterLength = 0;
  for (let i = 0; i < footprint.length; i++) {
    const j = (i + 1) % footprint.length;
    perimeterLength += haversineDistanceFeet(footprint[i], footprint[j]);
  }
  
  return {
    type: 'perimeter',
    wkt: polygonToWKT(footprint),
    length_ft: perimeterLength,
  };
}

/**
 * Convert AI analysis edges to WKT linear features
 */
export function convertAIEdgesToWKT(edges: AIEdges): LinearFeatureWKT[] {
  const features: LinearFeatureWKT[] = [];
  
  features.push(...convertEdges(edges.ridges, 'ridge'));
  features.push(...convertEdges(edges.hips, 'hip'));
  features.push(...convertEdges(edges.valleys, 'valley'));
  features.push(...convertEdges(edges.eaves, 'eave'));
  features.push(...convertEdges(edges.rakes, 'rake'));
  
  return features;
}

/**
 * Convert AI facets to WKT polygons
 */
export function convertAIFacetsToWKT(facets: AIFacet[]): FacetWKT[] {
  if (!facets || !Array.isArray(facets)) return [];
  
  return facets
    .filter(facet => facet.polygon && facet.polygon.length >= 3)
    .map(facet => ({
      facet_number: facet.facetNumber,
      boundary_wkt: polygonToWKT(facet.polygon),
      pitch: facet.estimatedPitch,
      orientation: facet.orientation,
      centroid: calculateCentroid(facet.polygon),
    }));
}

/**
 * Convert full AI analysis to database-ready format
 */
export function convertAIAnalysisToDBFormat(analysis: AIAnalysis): {
  linear_features_wkt: LinearFeatureWKT[];
  perimeter_wkt: string | null;
  facets: FacetWKT[];
  ai_detected_geometry: AIAnalysis;
  summary: {
    ridge_ft: number;
    hip_ft: number;
    valley_ft: number;
    eave_ft: number;
    rake_ft: number;
    perimeter_ft: number;
    facet_count: number;
    roof_type: string;
    predominant_pitch: string;
  };
} {
  // Convert edges to WKT
  const linearFeatures = analysis.edges ? convertAIEdgesToWKT(analysis.edges) : [];
  
  // Convert building footprint to perimeter
  const perimeter = convertFootprintToPerimeter(analysis.buildingFootprint?.main);
  if (perimeter) {
    linearFeatures.push(perimeter);
  }
  
  // Convert facets
  const facets = convertAIFacetsToWKT(analysis.facets || []);
  
  // Calculate totals
  const sumByType = (type: LinearFeatureWKT['type']) => 
    linearFeatures.filter(f => f.type === type).reduce((sum, f) => sum + f.length_ft, 0);
  
  // Determine predominant pitch from facets
  const pitchCounts: Record<string, number> = {};
  (analysis.facets || []).forEach(facet => {
    if (facet.estimatedPitch) {
      pitchCounts[facet.estimatedPitch] = (pitchCounts[facet.estimatedPitch] || 0) + 1;
    }
  });
  const predominantPitch = Object.entries(pitchCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || '6/12';
  
  return {
    linear_features_wkt: linearFeatures.filter(f => f.type !== 'perimeter'),
    perimeter_wkt: perimeter?.wkt || null,
    facets,
    ai_detected_geometry: analysis,
    summary: {
      ridge_ft: Math.round(sumByType('ridge') * 100) / 100,
      hip_ft: Math.round(sumByType('hip') * 100) / 100,
      valley_ft: Math.round(sumByType('valley') * 100) / 100,
      eave_ft: Math.round(sumByType('eave') * 100) / 100,
      rake_ft: Math.round(sumByType('rake') * 100) / 100,
      perimeter_ft: Math.round((perimeter?.length_ft || 0) * 100) / 100,
      facet_count: facets.length,
      roof_type: analysis.roofType || 'unknown',
      predominant_pitch: predominantPitch,
    },
  };
}

/**
 * Merge AI-detected geometry with existing measurement data
 */
export function mergeAIGeometryWithMeasurement(
  existingMeasurement: any,
  aiData: ReturnType<typeof convertAIAnalysisToDBFormat>
): any {
  return {
    ...existingMeasurement,
    linear_features_wkt: aiData.linear_features_wkt,
    linear_features: aiData.linear_features_wkt, // Legacy field
    perimeter_wkt: aiData.perimeter_wkt,
    ai_detected_geometry: aiData.ai_detected_geometry,
    facet_count: aiData.summary.facet_count,
    summary: {
      ...existingMeasurement?.summary,
      ...aiData.summary,
    },
    total_ridge_length: aiData.summary.ridge_ft,
    total_hip_length: aiData.summary.hip_ft,
    total_valley_length: aiData.summary.valley_ft,
    total_eave_length: aiData.summary.eave_ft,
    total_rake_length: aiData.summary.rake_ft,
  };
}
