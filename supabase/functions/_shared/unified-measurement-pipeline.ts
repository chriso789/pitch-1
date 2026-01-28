// Unified Measurement Pipeline
// Single entry point that handles all API integrations automatically
// All API keys read from environment - no external dependencies needed

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
  type SolarAPIData 
} from './google-solar-api.ts';

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
}

export interface UnifiedMeasurementResult {
  success: boolean;
  measurementId?: string;
  footprint: ResolvedFootprint | null;
  topology: RoofTopology | null;
  areas: AreaCalculationResult | null;
  qa: QAGateResult | null;
  solarData: SolarAPIData | null;
  apiSources: {
    footprint: FootprintSource | 'none';
    ridgeDirection: string;
    solar: boolean;
    pitch: string;
  };
  timing: {
    totalMs: number;
    solarFetchMs: number;
    footprintResolveMs: number;
    topologyBuildMs: number;
    areaCalcMs: number;
    qaGateMs: number;
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
  
  // GOOGLE_SOLAR_API_KEY is required for best results
  if (!keys.GOOGLE_SOLAR_API_KEY) {
    missing.push('GOOGLE_SOLAR_API_KEY');
  }
  
  // At least one footprint source must be available
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
    topologyBuildMs: 0,
    areaCalcMs: 0,
    qaGateMs: 0,
  };
  
  const debug = request.enableDebugLogs ?? false;
  const log = (msg: string) => { if (debug) console.log(msg); };
  
  log(`🚀 Starting unified measurement pipeline for (${request.lat.toFixed(6)}, ${request.lng.toFixed(6)})`);
  
  // Validate API keys
  const keyValidation = validateAPIKeys();
  if (!keyValidation.valid) {
    warnings.push(`Missing API keys: ${keyValidation.missing.join(', ')}`);
    log(`⚠️ ${warnings[warnings.length - 1]}`);
  }
  
  const keys = getAPIKeys();
  
  // -------------------------------------------
  // Step 1: Fetch Solar API data
  // -------------------------------------------
  log('📡 Step 1: Fetching Solar API data...');
  const solarStart = Date.now();
  
  let solarData: SolarAPIData | null = null;
  try {
    solarData = await fetchGoogleSolarData(
      request.lat, 
      request.lng, 
      keys.GOOGLE_SOLAR_API_KEY
    );
    log(`✅ Solar API: ${solarData.available ? 'available' : 'unavailable'}`);
  } catch (err) {
    warnings.push(`Solar API fetch failed: ${err}`);
    log(`⚠️ Solar API error: ${err}`);
  }
  
  timing.solarFetchMs = Date.now() - solarStart;
  
  // -------------------------------------------
  // Step 2: Resolve footprint
  // -------------------------------------------
  log('📐 Step 2: Resolving footprint...');
  const footprintStart = Date.now();
  
  let footprint: ResolvedFootprint | null = null;
  try {
    footprint = await resolveFootprint({
      lat: request.lat,
      lng: request.lng,
      solarData: solarData || undefined,
      mapboxToken: keys.MAPBOX_ACCESS_TOKEN,
      regridApiKey: keys.REGRID_API_KEY,
      eaveOverhangFt: request.eaveOverhangFt || 1.0,
    });
    
    if (footprint) {
      log(`✅ Footprint resolved: ${footprint.source} (${footprint.qaMetrics.vertexCount} vertices, ${footprint.qaMetrics.areaSqFt.toFixed(0)} sqft)`);
      
      // Collect validation warnings
      if (footprint.validation.warnings.length > 0) {
        warnings.push(...footprint.validation.warnings);
      }
    } else {
      errors.push('No valid footprint found from any source');
      log('❌ Footprint resolution failed');
    }
  } catch (err) {
    errors.push(`Footprint resolution error: ${err}`);
    log(`❌ Footprint error: ${err}`);
  }
  
  timing.footprintResolveMs = Date.now() - footprintStart;
  
  // Cannot continue without footprint
  if (!footprint) {
    timing.totalMs = Date.now() - startTime;
    return {
      success: false,
      footprint: null,
      topology: null,
      areas: null,
      qa: null,
      solarData,
      apiSources: {
        footprint: 'none',
        ridgeDirection: 'none',
        solar: solarData?.available ?? false,
        pitch: 'unknown',
      },
      timing,
      errors,
      warnings,
    };
  }
  
  // -------------------------------------------
  // Step 3: Build roof topology
  // -------------------------------------------
  log('🏗️ Step 3: Building roof topology...');
  const topologyStart = Date.now();
  
  let topology: RoofTopology | null = null;
  try {
    topology = buildRoofTopology({
      footprintVertices: footprint.vertices,
      solarSegments: solarData?.roofSegments,
      eaveOffsetFt: request.eaveOverhangFt || 1.0,
    });
    
    log(`✅ Topology built: ${topology.ridgeSource} (${topology.skeleton.length} skeleton edges)`);
    
    if (topology.warnings.length > 0) {
      warnings.push(...topology.warnings);
    }
  } catch (err) {
    errors.push(`Topology build error: ${err}`);
    log(`❌ Topology error: ${err}`);
  }
  
  timing.topologyBuildMs = Date.now() - topologyStart;
  
  // Cannot continue without topology
  if (!topology) {
    timing.totalMs = Date.now() - startTime;
    return {
      success: false,
      footprint,
      topology: null,
      areas: null,
      qa: null,
      solarData,
      apiSources: {
        footprint: footprint.source,
        ridgeDirection: 'none',
        solar: solarData?.available ?? false,
        pitch: 'unknown',
      },
      timing,
      errors,
      warnings,
    };
  }
  
  // -------------------------------------------
  // Step 4: Compute facets and areas
  // -------------------------------------------
  log('📊 Step 4: Computing facets and areas...');
  const areaStart = Date.now();
  
  // Determine pitch: override > solar > default
  const effectivePitch = request.pitchOverride || 
    (solarData?.available ? getPredominantPitchFromSolar(solarData) : '6/12');
  
  let areas: AreaCalculationResult | null = null;
  try {
    areas = computeFacetsAndAreas(
      topology,
      solarData?.roofSegments,
      effectivePitch
    );
    
    log(`✅ Areas computed: ${areas.totals.slopedAreaSqft.toFixed(0)} sqft (${areas.facets.length} facets)`);
  } catch (err) {
    errors.push(`Area calculation error: ${err}`);
    log(`❌ Area error: ${err}`);
  }
  
  timing.areaCalcMs = Date.now() - areaStart;
  
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
      
      if (qa.warnings.length > 0) {
        warnings.push(...qa.warnings);
      }
      if (qa.errors.length > 0) {
        errors.push(...qa.errors);
      }
    } catch (err) {
      warnings.push(`QA gate error: ${err}`);
      log(`⚠️ QA error: ${err}`);
    }
  }
  
  timing.qaGateMs = Date.now() - qaStart;
  timing.totalMs = Date.now() - startTime;
  
  log(`🏁 Pipeline complete in ${timing.totalMs}ms`);
  
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
    apiSources: {
      footprint: footprint.source,
      ridgeDirection: topology.ridgeSource,
      solar: solarData?.available ?? false,
      pitch: effectivePitch,
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
};
