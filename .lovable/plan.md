

# Plan: Make Shared Modules Fully API-Driven Without Upload Dependencies

## Problem Summary

The newly created shared modules (`footprint-resolver.ts`, `roof-topology-builder.ts`, `facet-area-calculator.ts`, `measurement-qa-gate.ts`) currently require API keys to be passed as parameters, and the Solar API data must be fetched externally. This creates dependencies that prevent the pipeline from being fully self-contained.

## Current State

| Module | Issue |
|--------|-------|
| `footprint-resolver.ts` | Expects `mapboxToken`, `regridApiKey`, `solarData` as parameters |
| `roof-topology-builder.ts` | No API dependencies (works on footprint data) |
| `facet-area-calculator.ts` | No API dependencies (works on topology data) |
| `measurement-qa-gate.ts` | No API dependencies (works on calculated results) |

## Available Secrets (Already Configured)

| Secret Name | Purpose |
|-------------|---------|
| `GOOGLE_SOLAR_API_KEY` | Google Solar API for building data, segments, pitch |
| `MAPBOX_ACCESS_TOKEN` | Mapbox vector tile footprints |
| `REGRID_API_KEY` | Regrid parcel data (paid fallback) |
| `GOOGLE_MAPS_API_KEY` | Satellite imagery |
| `GOOGLE_PLACES_API_KEY` | Address geocoding |

---

## Solution: Create Unified Pipeline Entry Point

### New File: `supabase/functions/_shared/unified-measurement-pipeline.ts`

A single entry point that:
1. Reads all API keys from `Deno.env.get()`
2. Fetches Solar API data automatically
3. Calls `resolveFootprint()` with all keys
4. Calls `buildRoofTopology()`
5. Calls `computeFacetsAndAreas()`
6. Runs `runQAGate()`
7. Returns complete measurement result

```typescript
// Unified Measurement Pipeline
// Single entry point that handles all API integrations

export interface UnifiedMeasurementRequest {
  lat: number;
  lng: number;
  address?: string;
  pitchOverride?: string;
  eaveOverhangFt?: number;
}

export interface UnifiedMeasurementResult {
  success: boolean;
  footprint: ResolvedFootprint;
  topology: RoofTopology;
  areas: AreaCalculationResult;
  qa: QAGateResult;
  solarData?: SolarAPIData;
  apiSources: {
    footprint: FootprintSource;
    ridgeDirection: string;
    solar: boolean;
  };
}

// All API keys read from environment
const API_KEYS = {
  GOOGLE_SOLAR_API_KEY: Deno.env.get('GOOGLE_SOLAR_API_KEY') || '',
  MAPBOX_ACCESS_TOKEN: Deno.env.get('MAPBOX_ACCESS_TOKEN') || '',
  REGRID_API_KEY: Deno.env.get('REGRID_API_KEY') || '',
  GOOGLE_MAPS_API_KEY: Deno.env.get('GOOGLE_MAPS_API_KEY') || '',
};

export async function runUnifiedMeasurementPipeline(
  request: UnifiedMeasurementRequest
): Promise<UnifiedMeasurementResult> {
  
  // Step 1: Fetch Solar API data (includes roof segments for pitch)
  const solarData = await fetchGoogleSolarData(
    request.lat, 
    request.lng, 
    API_KEYS.GOOGLE_SOLAR_API_KEY
  );
  
  // Step 2: Resolve footprint using all available sources
  const footprint = await resolveFootprint({
    lat: request.lat,
    lng: request.lng,
    solarData,
    mapboxToken: API_KEYS.MAPBOX_ACCESS_TOKEN,
    regridApiKey: API_KEYS.REGRID_API_KEY,
    eaveOverhangFt: request.eaveOverhangFt || 1.0,
  });
  
  // Step 3: Build roof topology
  const topology = buildRoofTopology({
    footprintVertices: footprint.vertices,
    solarSegments: solarData?.roofSegments,
    eaveOffsetFt: request.eaveOverhangFt || 1.0,
  });
  
  // Step 4: Compute facets and areas
  const areas = computeFacetsAndAreas(
    topology,
    solarData?.roofSegments,
    request.pitchOverride || '6/12'
  );
  
  // Step 5: Run QA gate
  const qa = runQAGate(topology, areas, solarData);
  
  return {
    success: qa.passed,
    footprint,
    topology,
    areas,
    qa,
    solarData,
    apiSources: {
      footprint: footprint.source,
      ridgeDirection: topology.ridgeSource,
      solar: solarData?.available ?? false,
    }
  };
}
```

---

## Modification: `footprint-resolver.ts`

Add environment-based API key defaults while keeping parameter override capability:

```typescript
// Lines 68-78: Update FootprintResolverOptions interface

export interface FootprintResolverOptions {
  lat: number;
  lng: number;
  solarData?: SolarAPIData;
  // API keys - now have environment defaults
  mapboxToken?: string;   // Falls back to Deno.env.get('MAPBOX_ACCESS_TOKEN')
  regridApiKey?: string;  // Falls back to Deno.env.get('REGRID_API_KEY')
  enableAIFallback?: boolean;
  imageUrl?: string;
  eaveOverhangFt?: number;
}

// Update resolveFootprint to use environment defaults
export async function resolveFootprint(options: FootprintResolverOptions): Promise<ResolvedFootprint | null> {
  // Use environment defaults if not provided
  const effectiveOptions = {
    ...options,
    mapboxToken: options.mapboxToken || Deno.env.get('MAPBOX_ACCESS_TOKEN') || '',
    regridApiKey: options.regridApiKey || Deno.env.get('REGRID_API_KEY') || '',
  };
  
  // ... rest of function unchanged
}
```

---

## New File: Add Solar API Fetcher to Shared

**File**: `supabase/functions/_shared/google-solar-api.ts`

```typescript
// Google Solar API Client
// Centralized Solar API fetching for all measurement functions

export interface SolarAPIData {
  available: boolean;
  buildingFootprintSqft?: number;
  estimatedPerimeterFt?: number;
  roofSegments?: SolarSegment[];
  boundingBox?: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  imageryQuality?: string;
  imageryDate?: string;
}

export interface SolarSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2?: number;
  stats?: { areaMeters2: number };
}

export async function fetchGoogleSolarData(
  lat: number,
  lng: number,
  apiKey?: string
): Promise<SolarAPIData | null> {
  const key = apiKey || Deno.env.get('GOOGLE_SOLAR_API_KEY') || '';
  
  if (!key) {
    console.warn('⚠️ GOOGLE_SOLAR_API_KEY not configured');
    return { available: false };
  }
  
  try {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${key}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn(`Solar API error: ${response.status}`);
      return { available: false };
    }
    
    const data = await response.json();
    
    // Extract relevant data
    const roofSegments = data.solarPotential?.roofSegmentStats?.map((seg: any) => ({
      pitchDegrees: seg.pitchDegrees ?? 20,
      azimuthDegrees: seg.azimuthDegrees ?? 0,
      areaMeters2: seg.stats?.areaMeters2,
      stats: seg.stats,
    })) || [];
    
    return {
      available: true,
      buildingFootprintSqft: data.solarPotential?.wholeRoofStats?.areaMeters2 
        ? data.solarPotential.wholeRoofStats.areaMeters2 * 10.7639 
        : undefined,
      roofSegments,
      boundingBox: data.boundingBox,
      imageryQuality: data.imageryQuality,
    };
    
  } catch (error) {
    console.error('Solar API fetch failed:', error);
    return { available: false };
  }
}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/_shared/unified-measurement-pipeline.ts` | Single entry point that orchestrates entire pipeline with auto API key loading |
| `supabase/functions/_shared/google-solar-api.ts` | Centralized Solar API client with environment key fallback |

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/_shared/footprint-resolver.ts` | Add `Deno.env.get()` fallbacks for API keys at lines 378-384, 490-492, and 519 |

---

## Usage After Changes

### Before (Required External API Key Management)
```typescript
// Caller must manage all API keys and fetch Solar data
const solarData = await fetchGoogleSolarData(lat, lng, apiKey);
const footprint = await resolveFootprint({
  lat, lng,
  solarData,
  mapboxToken: Deno.env.get('MAPBOX_ACCESS_TOKEN'),
  regridApiKey: Deno.env.get('REGRID_API_KEY'),
});
const topology = buildRoofTopology({ footprintVertices: footprint.vertices, solarSegments: solarData.roofSegments });
// ... more manual orchestration
```

### After (Fully Self-Contained)
```typescript
// Single call - all API keys read from environment automatically
const result = await runUnifiedMeasurementPipeline({
  lat: 27.9506,
  lng: -82.4572,
});

// Result contains everything:
// - footprint (with source: 'mapbox_vector' | 'microsoft_buildings' | etc)
// - topology (with ridgeSource: 'solar_segments' | 'skeleton_derived')
// - areas (facets, totals, linear measurements)
// - qa (passed/failed, errors, warnings)
```

---

## Expected Results

1. **Zero Upload Dependencies**: Pipeline works purely from lat/lng coordinates
2. **Auto API Key Loading**: All keys read from environment, no manual passing required
3. **Single Entry Point**: `runUnifiedMeasurementPipeline()` handles everything
4. **Transparent Source Tracking**: Result shows which API provided each piece of data
5. **Graceful Degradation**: If Solar API unavailable, uses skeleton-derived topology

---

## Testing Verification

After implementation, test with:
```typescript
const result = await runUnifiedMeasurementPipeline({
  lat: 27.9506,
  lng: -82.4572,
  address: '123 Test St, Tampa, FL'
});

console.log('Sources used:', result.apiSources);
// Expected: { footprint: 'mapbox_vector', ridgeDirection: 'solar_segments', solar: true }

console.log('Area:', result.areas.totals.slopedAreaSqft, 'sqft');
console.log('QA Passed:', result.qa.passed);
```

