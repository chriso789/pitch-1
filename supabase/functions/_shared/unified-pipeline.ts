/**
 * UNIFIED AI PIPELINE - Phase 5 Orchestration
 * 
 * Combines all new modules:
 * - Polygon simplifier
 * - QA checks
 * - Facet generator
 * - Pitch estimator
 * - Worksheet engine aggregations
 * 
 * Target: <15 seconds end-to-end with 98%+ accuracy
 */

import { simplifyAndClean, snapToOrthogonal, validateClosedPolygon } from './polygon-simplifier.ts';
import { runFullQAChecks, calculateOverallConfidence, type QACheckResult } from './qa-checks.ts';
import { generateFacetsFromFootprint, type GeneratedFacet } from './facet-generator.ts';
import { estimatePitchMultiSource, type PitchEstimationResult } from './pitch-estimator.ts';
import {
  aggregateFacetTotals,
  aggregateLinearByType,
  buildWorksheetFromFacets,
  calculateFacetSurfaceArea,
  parsePitch,
  getSlopeFactorFromPitch,
  type WorksheetJSON,
} from './roofWorksheetEngine.ts';

// ============= Types =============

export interface UnifiedPipelineInput {
  coordinates: { lat: number; lng: number };
  address: string;
  customerId?: string;
  solarData?: any;
  footprint?: {
    vertices: Array<{ lat: number; lng: number }>;
    source: string;
    confidence: number;
  };
  segmentationResult?: {
    facets: any[];
    linearFeatures: any[];
    qualityMetrics: {
      segmentationConfidence: number;
      facetClosureScore: number;
      edgeContinuityScore: number;
    };
    roofType: string;
  };
  pitchOverride?: string;
  imageryUrl?: string;
  analysisZoom?: number;
  imageSize?: number;
}

export interface UnifiedPipelineResult {
  success: boolean;
  error?: string;
  data?: {
    footprint: Array<{ lat: number; lng: number }>;
    facets: GeneratedFacet[];
    facetTotals: ReturnType<typeof aggregateFacetTotals>;
    linearFeatures: any[];
    linearTotals: ReturnType<typeof aggregateLinearByType>;
    predominantPitch: string;
    roofType: string;
    confidence: ReturnType<typeof calculateOverallConfidence>;
    qaResult: QACheckResult;
    qualityMetrics: {
      polygonSimplified: boolean;
      facetsGenerated: boolean;
      pitchesEstimated: boolean;
      qaPass: boolean;
    };
    worksheet?: WorksheetJSON;
    satelliteImageUrl?: string;
    overlayData?: any;
  };
  timings?: {
    polygonCleanup: number;
    facetGeneration: number;
    pitchEstimation: number;
    calculations: number;
    qaChecks: number;
    total: number;
  };
}

// ============= Pipeline Function =============

export async function runUnifiedAIPipeline(
  input: UnifiedPipelineInput
): Promise<UnifiedPipelineResult> {
  const startTime = Date.now();
  const timings: Record<string, number> = {};
  
  console.log('🚀 Starting Unified AI Pipeline...');
  console.log(`   Address: ${input.address}`);
  console.log(`   Coordinates: ${input.coordinates.lat}, ${input.coordinates.lng}`);
  
  try {
    // ========================================
    // STEP 1: Polygon Cleanup & Simplification
    // ========================================
    const polygonStart = Date.now();
    
    let cleanedFootprint = input.footprint?.vertices || [];
    
    if (cleanedFootprint.length >= 4) {
      // Convert to [lng, lat] format for simplifier
      const polygonCoords = cleanedFootprint.map(v => [v.lng, v.lat] as [number, number]);
      
      // Apply Douglas-Peucker simplification + angle snapping
      const simplified = simplifyAndClean(polygonCoords, {
        tolerance: 0.5, // ~0.5 meters tolerance
        snapAngles: true,
        angleThreshold: 12, // Snap within ±12° to 90°/45°
      });
      
      // Convert back to { lat, lng } format
      cleanedFootprint = simplified.polygon.map(([lng, lat]) => ({ lat, lng }));
      
      console.log(`   ✓ Polygon simplified: ${input.footprint?.vertices?.length || 0} → ${cleanedFootprint.length} vertices`);
      console.log(`   ✓ Snap corrections: ${simplified.snapCorrections}, straightened: ${simplified.edgesStraightened}`);
    } else if (input.segmentationResult?.facets?.length > 0) {
      // Try to extract footprint from facets
      const allVertices: Array<{ lat: number; lng: number }> = [];
      input.segmentationResult.facets.forEach((f: any) => {
        if (f.polygonGps) {
          f.polygonGps.forEach((v: any) => allVertices.push(v));
        } else if (f.polygon) {
          f.polygon.forEach((v: any) => allVertices.push(v));
        }
      });
      
      if (allVertices.length >= 4) {
        // Create convex hull for footprint
        cleanedFootprint = createConvexHull(allVertices);
      }
    }
    
    timings.polygonCleanup = Date.now() - polygonStart;
    
    // ========================================
    // STEP 2: Facet Generation
    // ========================================
    const facetStart = Date.now();
    
    let facets: GeneratedFacet[] = input.segmentationResult?.facets?.map((f: any, idx: number) => ({
      id: f.id || `F${idx + 1}`,
      polygon: f.polygonGps || f.polygon || [],
      areaSqft: f.areaSqft || f.area || 0,
      estimatedPitch: f.estimatedPitch || f.pitch || 'unknown',
      orientation: f.orientation || 'unknown',
      type: f.type || 'unknown',
      centroid: f.centroid,
    })) || [];
    
    // Generate facets if none detected
    if (facets.length === 0 && cleanedFootprint.length >= 4) {
      const roofType = input.segmentationResult?.roofType || detectRoofTypeFromFootprint(cleanedFootprint);
      
      facets = generateFacetsFromFootprint(
        cleanedFootprint.map(v => [v.lng, v.lat] as [number, number]),
        {
          roofType,
          solarSegments: input.solarData?.roofSegments,
          ridgeDirection: 'auto',
        }
      );
      
      console.log(`   ✓ Generated ${facets.length} facets for ${roofType} roof`);
    }
    
    timings.facetGeneration = Date.now() - facetStart;
    
    // ========================================
    // STEP 3: Pitch Estimation
    // ========================================
    const pitchStart = Date.now();
    
    // Extract state from address for regional defaults
    const stateMatch = input.address.match(/,\s*([A-Z]{2})\s*\d{5}/);
    const state = stateMatch?.[1] || 'unknown';
    
    for (const facet of facets) {
      if (!facet.estimatedPitch || facet.estimatedPitch === 'unknown') {
        // Use pitch override if provided
        if (input.pitchOverride) {
          facet.estimatedPitch = input.pitchOverride;
        } else {
          // Estimate pitch using multi-source approach
          const pitchResult = await estimatePitchMultiSource({
            facetId: facet.id,
            facetPolygon: facet.polygon,
            solarSegments: input.solarData?.roofSegments,
            coordinates: input.coordinates,
            state,
            buildingType: 'residential',
          });
          
          facet.estimatedPitch = pitchResult.pitch;
          facet.pitchConfidence = pitchResult.confidence;
          facet.pitchSource = pitchResult.source;
        }
      }
    }
    
    timings.pitchEstimation = Date.now() - pitchStart;
    
    // ========================================
    // STEP 4: Aggregate Measurements
    // ========================================
    const calcStart = Date.now();
    
    // Calculate facet totals
    const facetTotals = aggregateFacetTotals(
      facets.map(f => ({
        id: f.id,
        planAreaSqft: f.areaSqft,
        pitch: f.estimatedPitch || '6/12',
        orientation: f.orientation,
      }))
    );
    
    // Aggregate linear features by type
    const linearFeatures = input.segmentationResult?.linearFeatures || [];
    const linearTotals = aggregateLinearByType(
      linearFeatures.map((lf: any) => ({
        type: lf.type,
        lengthFt: lf.lengthFt || lf.length_ft || 0,
      }))
    );
    
    // Build full worksheet
    const worksheet = buildWorksheetFromFacets(
      facets.map(f => ({
        id: f.id,
        planAreaSqft: f.areaSqft,
        pitch: f.estimatedPitch || '6/12',
        orientation: f.orientation,
      })),
      linearFeatures.map((lf: any) => ({
        type: lf.type,
        lengthFt: lf.lengthFt || lf.length_ft || 0,
      })),
      {
        address: input.address,
        roofType: input.segmentationResult?.roofType || 'unknown',
      }
    );
    
    timings.calculations = Date.now() - calcStart;
    
    // ========================================
    // STEP 5: QA Validation
    // ========================================
    const qaStart = Date.now();
    
    const qaResult = runFullQAChecks({
      footprint: cleanedFootprint.map(v => [v.lng, v.lat] as [number, number]),
      facets: facets.map(f => ({
        id: f.id,
        polygon: f.polygon,
        areaSqft: f.areaSqft,
        pitch: f.estimatedPitch || '6/12',
      })),
      linearFeatures: linearFeatures.map((lf: any) => ({
        type: lf.type,
        lengthFt: lf.lengthFt || lf.length_ft || 0,
        start: lf.start,
        end: lf.end,
      })),
      solarData: input.solarData,
    });
    
    // Calculate overall confidence
    const confidence = calculateOverallConfidence({
      segmentationConfidence: input.segmentationResult?.qualityMetrics?.segmentationConfidence || 0.7,
      facetClosureScore: input.segmentationResult?.qualityMetrics?.facetClosureScore || 0.8,
      edgeContinuityScore: input.segmentationResult?.qualityMetrics?.edgeContinuityScore || 0.8,
      qaResult,
    });
    
    timings.qaChecks = Date.now() - qaStart;
    timings.total = Date.now() - startTime;
    
    console.log(`   ✓ QA Result: ${qaResult.overallPass ? 'PASS' : 'FAIL'} (${qaResult.passedChecks}/${qaResult.totalChecks} checks)`);
    console.log(`   ✓ Confidence: ${(confidence.overallConfidence * 100).toFixed(1)}% (${confidence.confidenceLevel})`);
    console.log(`   ⏱️ Total time: ${timings.total}ms`);
    
    return {
      success: true,
      data: {
        footprint: cleanedFootprint,
        facets,
        facetTotals,
        linearFeatures,
        linearTotals,
        predominantPitch: facetTotals.predominantPitch,
        roofType: input.segmentationResult?.roofType || 'unknown',
        confidence,
        qaResult,
        qualityMetrics: {
          polygonSimplified: timings.polygonCleanup > 0,
          facetsGenerated: facets.length > 0,
          pitchesEstimated: facets.every(f => f.estimatedPitch && f.estimatedPitch !== 'unknown'),
          qaPass: qaResult.overallPass,
        },
        worksheet,
        satelliteImageUrl: input.imageryUrl,
      },
      timings,
    };
    
  } catch (error) {
    console.error('❌ Unified pipeline error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown pipeline error',
      timings: {
        polygonCleanup: timings.polygonCleanup || 0,
        facetGeneration: timings.facetGeneration || 0,
        pitchEstimation: timings.pitchEstimation || 0,
        calculations: timings.calculations || 0,
        qaChecks: timings.qaChecks || 0,
        total: Date.now() - startTime,
      },
    };
  }
}

// ============= Helper Functions =============

/**
 * Detect roof type from footprint shape
 */
function detectRoofTypeFromFootprint(vertices: Array<{ lat: number; lng: number }>): string {
  const count = vertices.length;
  
  if (count === 4) {
    // Check aspect ratio for gable vs hip
    const width = Math.abs(vertices[1].lng - vertices[0].lng);
    const height = Math.abs(vertices[2].lat - vertices[1].lat);
    const aspectRatio = Math.max(width, height) / Math.min(width, height);
    
    return aspectRatio > 1.5 ? 'gable' : 'hip';
  }
  
  if (count === 6 || count === 8) {
    // L-shape or T-shape
    return 'l_shape';
  }
  
  return 'complex';
}

/**
 * Create convex hull from vertices (simplified Graham scan)
 */
function createConvexHull(points: Array<{ lat: number; lng: number }>): Array<{ lat: number; lng: number }> {
  if (points.length < 3) return points;
  
  // Sort by lat, then lng
  const sorted = [...points].sort((a, b) => a.lat - b.lat || a.lng - b.lng);
  
  // Build lower hull
  const lower: Array<{ lat: number; lng: number }> = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  
  // Build upper hull
  const upper: Array<{ lat: number; lng: number }> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  
  // Remove last point of each half because it's repeated
  lower.pop();
  upper.pop();
  
  return [...lower, ...upper];
}

function cross(o: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

/**
 * Transform pipeline result to legacy format for backward compatibility
 */
export function transformToLegacyFormat(result: UnifiedPipelineResult): {
  measurement: any;
  tags: Record<string, any>;
} {
  if (!result.success || !result.data) {
    return { measurement: {}, tags: {} };
  }
  
  const { data } = result;
  
  const measurement = {
    faces: data.facets.map((f, i) => ({
      id: i + 1,
      facet_number: i + 1,
      pitch: f.estimatedPitch || '6/12',
      plan_area_sqft: f.areaSqft,
      area_sqft: calculateFacetSurfaceArea(f.areaSqft, f.estimatedPitch || '6/12').surfaceArea,
      orientation: f.orientation,
      wkt: '', // Would need to convert polygon to WKT
    })),
    linear_features: data.linearFeatures,
    perimeter_wkt: '', // Would need to convert footprint to WKT
    analysis_zoom: 20,
    analysis_image_size: { width: 640, height: 640 },
    roof_type: data.roofType,
    predominant_pitch: data.predominantPitch,
    confidence_score: data.confidence.overallConfidence,
    requires_review: data.confidence.requiresManualReview,
    summary: {
      total_area_sqft: data.facetTotals.totalSurfaceAreaSqft,
      total_squares: data.facetTotals.totalSurfaceAreaSqft / 100,
      pitch: data.predominantPitch,
      ridge_ft: data.linearTotals.breakdown.ridge?.total || 0,
      hip_ft: data.linearTotals.breakdown.hip?.total || 0,
      valley_ft: data.linearTotals.breakdown.valley?.total || 0,
      eave_ft: data.linearTotals.breakdown.eave?.total || 0,
      rake_ft: data.linearTotals.breakdown.rake?.total || 0,
    },
    footprint_source: 'unified_pipeline',
    footprint_confidence: data.confidence.overallConfidence,
    qa_passed: data.qaResult.overallPass,
  };
  
  const tags: Record<string, any> = {
    'roof.plan_area': data.facetTotals.totalPlanAreaSqft,
    'roof.total_area': data.facetTotals.totalSurfaceAreaSqft,
    'roof.squares': data.facetTotals.totalSurfaceAreaSqft / 100,
    'roof.faces_count': data.facets.length,
    'lf.ridge': data.linearTotals.breakdown.ridge?.total || 0,
    'lf.hip': data.linearTotals.breakdown.hip?.total || 0,
    'lf.valley': data.linearTotals.breakdown.valley?.total || 0,
    'lf.eave': data.linearTotals.breakdown.eave?.total || 0,
    'lf.rake': data.linearTotals.breakdown.rake?.total || 0,
    'ai.confidence': data.confidence.overallConfidence,
    'ai.rating': data.confidence.confidenceLevel,
    'ai.roof_type': data.roofType,
    'qa.passed': data.qaResult.overallPass,
    'qa.score': data.qaResult.passedChecks / data.qaResult.totalChecks,
  };
  
  return { measurement, tags };
}
