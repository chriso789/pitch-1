// Unified Measurement Pipeline
// Single entry point that handles all API integrations automatically
// Includes: Solar API, footprint resolution, terrain elevation, topology,
//           facet calculation, geometry snapping, multi-source fusion, and QA

import { 
  resolveFootprint, 
  type ResolvedFootprint,
  type FootprintSource 
} from './footprint-resolver.ts';

import { 
  buildRoofTopology, 
  type RoofTopology 
} from './roof-topology-builder.ts';

import { 
  computeFacetsAndAreas, 
  type AreaCalculationResult 
} from './facet-area-calculator.ts';

import { 
  runQAGate, 
  type QAGateResult 
} from './measurement-qa-gate.ts';

import { 
  fetchGoogleSolarData, 
  getPredominantPitchFromSolar,
  fetchGoogleSolarDataLayers,
  type SolarAPIData,
  type SolarDataLayersMetadata,
} from './google-solar-api.ts';

import {
  fetchTerrainElevation,
  type TerrainElevationResult,
} from './mapbox-terrain-fetcher.ts';

import {
  fuseMeasurements,
  mergeVendorIntoFusion,
  type FusionInput,
  type FusedMeasurement,
  type VendorTruth,
} from './measurement-fusion.ts';

import {
  snapEdgesToFootprint,
  type DetectedEdge,
  type SnapResult,
} from './geometry-snapper.ts';

import {
  flattenGeometrySegments,
  estimateFeetPerPixel,
  lineMeasurementsFromGeometry,
  buildFinalReportPayload,
  type VendorGeometry,
  type FinalReportPayload,
  type GroupedGeometry,
  type LineMeasurement,
  type LineKey,
  LINE_KEYS,
} from './geometry-alignment.ts';

// ============================================
// TYPES
// ============================================

export interface UnifiedMeasurementRequest {
  lat: number;
  lng: number;
  address?: string;
  pitchOverride?: string;
  eaveOverhangFt?: number;
  enableDebugLogs?: boolean;
  vendorTruth?: VendorTruth;
  vendorGeometry?: VendorGeometry;
  fetchDataLayers?: boolean;
}

export interface UnifiedMeasurementResult {
  success: boolean;
  measurementId?: string;
  footprint: ResolvedFootprint | null;
  topology: RoofTopology | null;
  areas: AreaCalculationResult | null;
  qa: QAGateResult | null;
  solarData: SolarAPIData | null;
  solarDataLayers: SolarDataLayersMetadata | null;
  terrain: TerrainElevationResult | null;
  fused: FusedMeasurement | null;
  snapResult: SnapResult | null;
  vendorTruthUsed: boolean;
  finalReport: FinalReportPayload | null;
  apiSources: {
    footprint: FootprintSource | 'none';
    ridgeDirection: string;
    solar: boolean;
    terrain: boolean;
    pitch: string;
    fusionUsed: boolean;
    vendorTruth: boolean;
    vendorGeometry: boolean;
  };
  timing: {
    totalMs: number;
    solarFetchMs: number;
    footprintResolveMs: number;
    terrainFetchMs: number;
    topologyBuildMs: number;
    areaCalcMs: number;
    fusionMs: number;
    qaGateMs: number;
    calibrationMs: number;
  };
  errors: string[];
  warnings: string[];
}

// ============================================
// ENVIRONMENT API KEYS
// ============================================

function getAPIKeys() {
  return {
    GOOGLE_SOLAR_API_KEY: Deno.env.get('GOOGLE_SOLAR_API_KEY') || '',
    MAPBOX_ACCESS_TOKEN: Deno.env.get('MAPBOX_ACCESS_TOKEN') || '',
    REGRID_API_KEY: Deno.env.get('REGRID_API_KEY') || '',
    GOOGLE_MAPS_API_KEY: Deno.env.get('GOOGLE_MAPS_API_KEY') || '',
    GOOGLE_PLACES_API_KEY: Deno.env.get('GOOGLE_PLACES_API_KEY') || '',
  };
}

function validateAPIKeys(): { valid: boolean; missing: string[] } {
  const keys = getAPIKeys();
  const missing: string[] = [];
  
  if (!keys.GOOGLE_SOLAR_API_KEY) {
    missing.push('GOOGLE_SOLAR_API_KEY');
  }
  
  const hasFootprintSource = keys.MAPBOX_ACCESS_TOKEN || keys.REGRID_API_KEY;
  if (!hasFootprintSource) {
    missing.push('MAPBOX_ACCESS_TOKEN or REGRID_API_KEY');
  }
  
  return {
    valid: missing.length === 0,
    missing
  };
}

// ============================================
// HELPERS
// ============================================

function pitchRatioToDegrees(ratio: string): number {
  if (ratio === 'flat') return 0;
  const match = ratio.match(/^(\d+)\/(\d+)$/);
  if (!match) return 20;
  return Math.atan(parseInt(match[1]) / parseInt(match[2])) * (180 / Math.PI);
}

/**
 * Extract ridge points from topology for terrain elevation sampling.
 */
function extractRidgePoints(topology: RoofTopology): [number, number][] {
  const ridgeEdges = topology.skeleton.filter(e => e.edgeType === 'ridge');
  const points: [number, number][] = [];
  for (const edge of ridgeEdges) {
    points.push(edge.start);
    points.push(edge.end);
  }
  // Deduplicate by proximity
  const unique: [number, number][] = [];
  for (const p of points) {
    const isDup = unique.some(u => Math.abs(u[0] - p[0]) < 0.0001 && Math.abs(u[1] - p[1]) < 0.0001);
    if (!isDup) unique.push(p);
  }
  return unique;
}

/**
 * Convert skeleton edges to DetectedEdge format for snapping.
 */
function skeletonToDetectedEdges(topology: RoofTopology): DetectedEdge[] {
  return topology.skeleton.map(e => ({
    start: e.start,
    end: e.end,
    type: (e.edgeType as DetectedEdge['type']) || 'unknown',
    confidence: 0.8,
    source: 'skeleton',
  }));
}

// ============================================
// MAIN PIPELINE
// ============================================

export async function runUnifiedMeasurementPipeline(
  request: UnifiedMeasurementRequest
): Promise<UnifiedMeasurementResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  const timing = {
    totalMs: 0,
    solarFetchMs: 0,
    footprintResolveMs: 0,
    terrainFetchMs: 0,
    topologyBuildMs: 0,
    areaCalcMs: 0,
    fusionMs: 0,
    qaGateMs: 0,
    calibrationMs: 0,
  };

  const debug = request.enableDebugLogs ?? false;
  const log = (msg: string) => { if (debug) console.log(msg); };
  
  log(`🚀 Starting unified measurement pipeline v2 for (${request.lat.toFixed(6)}, ${request.lng.toFixed(6)})`);
  
  const keyValidation = validateAPIKeys();
  if (!keyValidation.valid) {
    warnings.push(`Missing API keys: ${keyValidation.missing.join(', ')}`);
    log(`⚠️ ${warnings[warnings.length - 1]}`);
  }
  
  const keys = getAPIKeys();
  
  // -------------------------------------------
  // Step 1: Fetch Solar API data + Footprint (parallel)
  // -------------------------------------------
  log('📡 Step 1: Fetching Solar API + Footprint in parallel...');
  const step1Start = Date.now();
  
  let solarData: SolarAPIData | null = null;
  let footprint: ResolvedFootprint | null = null;
  
  const [solarResult, footprintResult] = await Promise.allSettled([
    // Solar fetch
    (async () => {
      const t = Date.now();
      const data = await fetchGoogleSolarData(request.lat, request.lng, keys.GOOGLE_SOLAR_API_KEY);
      timing.solarFetchMs = Date.now() - t;
      return data;
    })(),
    // Footprint fetch
    (async () => {
      const t = Date.now();
      const fp = await resolveFootprint({
        lat: request.lat,
        lng: request.lng,
        mapboxToken: keys.MAPBOX_ACCESS_TOKEN,
        regridApiKey: keys.REGRID_API_KEY,
        eaveOverhangFt: request.eaveOverhangFt || 1.0,
      });
      timing.footprintResolveMs = Date.now() - t;
      return fp;
    })(),
  ]);
  
  if (solarResult.status === 'fulfilled') {
    solarData = solarResult.value;
    log(`✅ Solar API: ${solarData.available ? 'available' : 'unavailable'}`);
  } else {
    warnings.push(`Solar API fetch failed: ${solarResult.reason}`);
    log(`⚠️ Solar API error: ${solarResult.reason}`);
  }
  
  if (footprintResult.status === 'fulfilled') {
    footprint = footprintResult.value;
    if (footprint) {
      // Re-resolve with solar data if we got it and footprint needs it
      if (solarData && !footprint.validation.warnings.length) {
        // Solar data available — footprint already resolved, just log
      }
      log(`✅ Footprint: ${footprint.source} (${footprint.qaMetrics.vertexCount} vertices, ${footprint.qaMetrics.areaSqFt.toFixed(0)} sqft)`);
      if (footprint.validation.warnings.length > 0) {
        warnings.push(...footprint.validation.warnings);
      }
    } else {
      errors.push('No valid footprint found from any source');
      log('❌ Footprint resolution failed');
    }
  } else {
    errors.push(`Footprint resolution error: ${footprintResult.reason}`);
    log(`❌ Footprint error: ${footprintResult.reason}`);
  }
  
  // Cannot continue without footprint
  if (!footprint) {
    timing.totalMs = Date.now() - startTime;
    return {
      success: false,
      footprint: null, topology: null, areas: null, qa: null,
      solarData, solarDataLayers: null, terrain: null, fused: null, snapResult: null,
      vendorTruthUsed: false, finalReport: null,
      apiSources: { footprint: 'none', ridgeDirection: 'none', solar: solarData?.available ?? false, terrain: false, pitch: 'unknown', fusionUsed: false, vendorTruth: false, vendorGeometry: false },
      timing, errors, warnings,
    };
  }
  
  // -------------------------------------------
  // Step 2: Build roof topology
  // -------------------------------------------
  log('🏗️ Step 2: Building roof topology...');
  const topologyStart = Date.now();
  
  let topology: RoofTopology | null = null;
  try {
    topology = buildRoofTopology({
      footprintVertices: footprint.vertices,
      solarSegments: solarData?.roofSegments,
      eaveOffsetFt: request.eaveOverhangFt || 1.0,
    });
    log(`✅ Topology: ${topology.ridgeSource} (${topology.skeleton.length} skeleton edges)`);
    if (topology.warnings.length > 0) warnings.push(...topology.warnings);
  } catch (err) {
    errors.push(`Topology build error: ${err}`);
    log(`❌ Topology error: ${err}`);
  }
  
  timing.topologyBuildMs = Date.now() - topologyStart;
  
  if (!topology) {
    timing.totalMs = Date.now() - startTime;
    return {
      success: false,
      footprint, topology: null, areas: null, qa: null,
      solarData, solarDataLayers: null, terrain: null, fused: null, snapResult: null,
      vendorTruthUsed: false, finalReport: null,
      apiSources: { footprint: footprint.source, ridgeDirection: 'none', solar: solarData?.available ?? false, terrain: false, pitch: 'unknown', fusionUsed: false, vendorTruth: false, vendorGeometry: false },
      timing, errors, warnings,
    };
  }
  
  // -------------------------------------------
  // Step 2.5: Snap skeleton edges to footprint
  // -------------------------------------------
  log('📎 Step 2.5: Snapping edges to footprint...');
  let snapResult: SnapResult | null = null;
  try {
    const detectedEdges = skeletonToDetectedEdges(topology);
    snapResult = snapEdgesToFootprint(detectedEdges, footprint.vertices, 3.0, 5.0);
    log(`✅ Snapping: ${snapResult.snapStats.edgesSnapped}/${snapResult.snapStats.totalEdges} edges snapped, ${snapResult.discardedCount} discarded`);
    if (snapResult.discardedCount > 0) {
      warnings.push(`${snapResult.discardedCount} detected edges discarded (outside footprint)`);
    }
  } catch (err) {
    warnings.push(`Edge snapping error: ${err}`);
    log(`⚠️ Snapping error: ${err}`);
  }
  
  // -------------------------------------------
  // Step 3: Fetch terrain elevation (parallel with area calc)
  // -------------------------------------------
  log('🏔️ Step 3: Fetching terrain elevation...');
  const terrainStart = Date.now();
  
  let terrain: TerrainElevationResult | null = null;
  
  // Extract ridge points from topology for elevation sampling
  const ridgePoints = extractRidgePoints(topology);
  
  // Run terrain fetch and area calc in parallel
  const effectivePitch = request.pitchOverride || 
    (solarData?.available ? getPredominantPitchFromSolar(solarData) : '6/12');
  
  const [terrainResult, areaCalcResult] = await Promise.allSettled([
    // Terrain fetch
    (async () => {
      if (!keys.MAPBOX_ACCESS_TOKEN) return null;
      return await fetchTerrainElevation(
        footprint!.vertices as [number, number][],
        ridgePoints,
        keys.MAPBOX_ACCESS_TOKEN
      );
    })(),
    // Area calculation
    (async () => {
      return computeFacetsAndAreas(topology!, solarData?.roofSegments, effectivePitch);
    })(),
  ]);
  
  if (terrainResult.status === 'fulfilled' && terrainResult.value) {
    terrain = terrainResult.value;
    timing.terrainFetchMs = Date.now() - terrainStart;
    log(`✅ Terrain: ${terrain.available ? `pitch=${terrain.estimatedPitchRatio || 'N/A'}` : 'unavailable'}`);
  } else {
    timing.terrainFetchMs = Date.now() - terrainStart;
    if (terrainResult.status === 'rejected') {
      warnings.push(`Terrain fetch failed: ${terrainResult.reason}`);
    }
  }
  
  let areas: AreaCalculationResult | null = null;
  if (areaCalcResult.status === 'fulfilled') {
    areas = areaCalcResult.value;
    timing.areaCalcMs = Date.now() - terrainStart;
    log(`✅ Areas: ${areas.totals.slopedAreaSqft.toFixed(0)} sqft (${areas.facets.length} facets)`);
  } else {
    errors.push(`Area calculation error: ${areaCalcResult.reason}`);
    timing.areaCalcMs = Date.now() - terrainStart;
  }
  
  // -------------------------------------------
  // Step 4: Multi-source fusion
  // -------------------------------------------
  log('🔀 Step 4: Running multi-source fusion...');
  const fusionStart = Date.now();
  
  let fused: FusedMeasurement | null = null;
  try {
    const fusionInput: FusionInput = {
      area: {},
      pitch: {},
      linear: {},
    };
    
    // Populate area sources
    if (footprint.qaMetrics.areaSqFt > 0) {
      fusionInput.area.footprintPlanimetric = {
        value: footprint.qaMetrics.areaSqFt,
        confidence: footprint.source === 'mapbox_vector' ? 0.9 : 0.7,
        source: `footprint_${footprint.source}`,
      };
    }
    if (solarData?.available && solarData.buildingFootprintSqft) {
      fusionInput.area.solarAPI = {
        value: solarData.buildingFootprintSqft,
        confidence: 0.85,
        source: 'google_solar_api',
      };
    }
    if (areas && areas.totals.planAreaSqft > 0) {
      fusionInput.area.skeletonFacetSum = {
        value: areas.totals.planAreaSqft,
        confidence: 0.75,
        source: 'skeleton_facet_sum',
      };
    }
    
    // Populate pitch sources
    if (request.pitchOverride) {
      fusionInput.pitch.userOverride = {
        value: pitchRatioToDegrees(request.pitchOverride),
        confidence: 1.0,
        source: 'user_override',
      };
    }
    if (solarData?.available && solarData.roofSegments && solarData.roofSegments.length > 0) {
      const solarPitch = getPredominantPitchFromSolar(solarData);
      fusionInput.pitch.solarSegments = {
        value: pitchRatioToDegrees(solarPitch),
        confidence: 0.85,
        source: 'google_solar_segments',
      };
    }
    if (terrain?.available && terrain.estimatedPitchDegrees !== undefined) {
      fusionInput.pitch.terrainRGB = {
        value: terrain.estimatedPitchDegrees,
        confidence: terrain.confidence,
        source: 'mapbox_terrain_rgb',
      };
    }
    
    // Populate linear sources from skeleton
    if (areas) {
      fusionInput.linear.ridgeFt = {
        skeleton: { value: areas.linearTotals.ridgeFt, confidence: 0.8, source: 'skeleton' },
      };
      fusionInput.linear.hipFt = {
        skeleton: { value: areas.linearTotals.hipFt, confidence: 0.8, source: 'skeleton' },
      };
      fusionInput.linear.valleyFt = {
        skeleton: { value: areas.linearTotals.valleyFt, confidence: 0.8, source: 'skeleton' },
      };
      fusionInput.linear.eaveFt = {
        skeleton: { value: areas.linearTotals.eaveFt, confidence: 0.85, source: 'skeleton' },
      };
      fusionInput.linear.rakeFt = {
        skeleton: { value: areas.linearTotals.rakeFt, confidence: 0.8, source: 'skeleton' },
      };
    }
    
    // Merge vendor truth if provided
    if (request.vendorTruth) {
      mergeVendorIntoFusion(fusionInput, request.vendorTruth);
      log(`📋 Vendor truth merged: source=${request.vendorTruth.source}, area=${request.vendorTruth.areaSqft || 'N/A'}`);
    }
    
    fused = fuseMeasurements(fusionInput);
    log(`✅ Fusion: ${fused.totalAreaSqft} sqft plan, ${fused.slopedAreaSqft} sqft sloped, pitch=${fused.pitchRatio} (confidence=${fused.confidence.overall.toFixed(2)})`);
    
    if (fused.requiresManualReview) {
      warnings.push(...fused.reviewReasons);
      log(`⚠️ Fusion flagged for review: ${fused.reviewReasons.join(', ')}`);
    }
  } catch (err) {
    warnings.push(`Fusion error: ${err}`);
    log(`⚠️ Fusion error: ${err}`);
  }
  
  timing.fusionMs = Date.now() - fusionStart;
  
  // -------------------------------------------
  // Step 5: Run QA gate
  // -------------------------------------------
  log('✅ Step 5: Running QA gate...');
  const qaStart = Date.now();
  
  let qa: QAGateResult | null = null;
  if (areas) {
    try {
      qa = runQAGate(topology, areas, solarData || undefined);
      log(`✅ QA: ${qa.passed ? 'PASSED' : 'FAILED'} (score: ${qa.overallScore.toFixed(2)})`);
      if (qa.warnings.length > 0) warnings.push(...qa.warnings);
      if (qa.errors.length > 0) errors.push(...qa.errors);
    } catch (err) {
      warnings.push(`QA gate error: ${err}`);
      log(`⚠️ QA error: ${err}`);
    }
  }
  
  timing.qaGateMs = Date.now() - qaStart;
  
  // -------------------------------------------
  // Step 6: Fetch Solar data layers metadata (optional, non-blocking)
  // -------------------------------------------
  let solarDataLayers: SolarDataLayersMetadata | null = null;
  if (request.fetchDataLayers && keys.GOOGLE_SOLAR_API_KEY) {
    try {
      solarDataLayers = await fetchGoogleSolarDataLayers(
        request.lat, request.lng, 35, keys.GOOGLE_SOLAR_API_KEY
      );
      log(`✅ Data layers: ${solarDataLayers.available ? 'available' : 'unavailable'}`);
    } catch (err) {
      warnings.push(`Data layers fetch error: ${err}`);
    }
  }
  
  timing.totalMs = Date.now() - startTime;
  
  log(`🏁 Pipeline v2 complete in ${timing.totalMs}ms`);
  
  const vendorTruthUsed = !!request.vendorTruth;
  
  // -------------------------------------------
  // Return result
  // -------------------------------------------
  return {
    success: (qa?.passed ?? false) && errors.filter(e => !e.includes('QA')).length === 0,
    footprint,
    topology,
    areas,
    qa,
    solarData,
    solarDataLayers,
    terrain,
    fused,
    snapResult,
    vendorTruthUsed,
    apiSources: {
      footprint: footprint.source,
      ridgeDirection: topology.ridgeSource,
      solar: solarData?.available ?? false,
      terrain: terrain?.available ?? false,
      pitch: fused?.pitchRatio || effectivePitch,
      fusionUsed: fused !== null,
      vendorTruth: vendorTruthUsed,
    },
    timing,
    errors,
    warnings,
  };
}

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export type {
  ResolvedFootprint,
  FootprintSource,
  RoofTopology,
  AreaCalculationResult,
  QAGateResult,
  SolarAPIData,
  SolarDataLayersMetadata,
  TerrainElevationResult,
  FusedMeasurement,
  SnapResult,
  VendorTruth,
};
