// Unified Footprint Resolver
// Consolidates all footprint fetching with consistent PLANIMETER_THRESHOLDS validation
// Priority: Mapbox Vector > Microsoft/Esri > OSM > Regrid (paid) > Solar bbox

import { PLANIMETER_THRESHOLDS } from './roof-analysis-helpers.ts';

export type FootprintSource = 
  | 'mapbox_vector'
  | 'microsoft_buildings'
  | 'osm_buildings'
  | 'regrid_parcel'
  | 'solar_bbox_fallback'
  | 'ai_detected';

export interface FootprintVertex {
  lat: number;
  lng: number;
}

export interface ResolvedFootprint {
  vertices: FootprintVertex[];
  source: FootprintSource;
  confidence: number;
  validation: FootprintValidation;
  qaMetrics: FootprintQAMetrics;
  solarData?: SolarAPIData;
}

export interface FootprintValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface FootprintQAMetrics {
  areaSqFt: number;
  perimeterFt: number;
  vertexCount: number;
  longestSegmentFt: number;
  spanXPct: number;
  spanYPct: number;
  expectedMinVertices: number;
  meetsThresholds: boolean;
}

export interface SolarAPIData {
  available: boolean;
  buildingFootprintSqft?: number;
  estimatedPerimeterFt?: number;
  roofSegments?: SolarSegment[];
  boundingBox?: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
}

export interface SolarSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2?: number;
  stats?: { areaMeters2: number };
  boundingBox?: {
    sw: { longitude: number; latitude: number };
    ne: { longitude: number; latitude: number };
  };
}

export interface FootprintResolverOptions {
  lat: number;
  lng: number;
  solarData?: SolarAPIData;
  mapboxToken?: string;
  regridApiKey?: string;
  enableAIFallback?: boolean;
  imageUrl?: string;
  eaveOverhangFt?: number;
}

// Meters per degree at given latitude
function getMetersPerDegree(lat: number): { metersPerDegLat: number; metersPerDegLng: number } {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);
  return { metersPerDegLat, metersPerDegLng };
}

// Calculate distance in feet between two vertices
function distanceFt(v1: FootprintVertex, v2: FootprintVertex): number {
  const midLat = (v1.lat + v2.lat) / 2;
  const { metersPerDegLat, metersPerDegLng } = getMetersPerDegree(midLat);
  const dx = (v2.lng - v1.lng) * metersPerDegLng;
  const dy = (v2.lat - v1.lat) * metersPerDegLat;
  return Math.sqrt(dx * dx + dy * dy) * 3.28084;
}

// Calculate polygon perimeter in feet
export function calculatePerimeterFt(vertices: FootprintVertex[]): number {
  let perimeter = 0;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    perimeter += distanceFt(v1, v2);
  }
  return perimeter;
}

// Calculate polygon area using Shoelace formula
export function calculateAreaSqFt(vertices: FootprintVertex[]): number {
  if (vertices.length < 3) return 0;
  
  const midLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length;
  const { metersPerDegLat, metersPerDegLng } = getMetersPerDegree(midLat);
  
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const x1 = vertices[i].lng * metersPerDegLng;
    const y1 = vertices[i].lat * metersPerDegLat;
    const x2 = vertices[j].lng * metersPerDegLng;
    const y2 = vertices[j].lat * metersPerDegLat;
    sum += (x1 * y2 - x2 * y1);
  }
  
  const areaSqM = Math.abs(sum) / 2;
  return areaSqM * 10.7639;
}

// Find longest segment in polygon
function findLongestSegmentFt(vertices: FootprintVertex[]): number {
  let longest = 0;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    const len = distanceFt(v1, v2);
    if (len > longest) longest = len;
  }
  return longest;
}

// Calculate span percentages
function calculateSpans(vertices: FootprintVertex[]): { spanXPct: number; spanYPct: number } {
  const lats = vertices.map(v => v.lat);
  const lngs = vertices.map(v => v.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  
  // Calculate building spans
  const midLat = (minLat + maxLat) / 2;
  const { metersPerDegLat, metersPerDegLng } = getMetersPerDegree(midLat);
  const widthM = (maxLng - minLng) * metersPerDegLng;
  const heightM = (maxLat - minLat) * metersPerDegLat;
  
  // Span percentage relative to a 100m reference box
  const refSize = 100; // meters
  return {
    spanXPct: (widthM / refSize) * 100,
    spanYPct: (heightM / refSize) * 100
  };
}

// Validate footprint against PLANIMETER_THRESHOLDS
export function validateFootprint(
  vertices: FootprintVertex[],
  source: FootprintSource,
  solarData?: SolarAPIData
): { validation: FootprintValidation; qaMetrics: FootprintQAMetrics } {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const areaSqFt = calculateAreaSqFt(vertices);
  const perimeterFt = calculatePerimeterFt(vertices);
  const vertexCount = vertices.length;
  const longestSegmentFt = findLongestSegmentFt(vertices);
  const { spanXPct, spanYPct } = calculateSpans(vertices);
  
  // MIN_VERTICES_PER_100FT check
  const expectedMinVertices = Math.ceil(perimeterFt * PLANIMETER_THRESHOLDS.MIN_VERTICES_PER_100FT / 100);
  
  let meetsThresholds = true;
  
  // Check vertex count
  if (vertexCount < 4) {
    errors.push(`Too few vertices: ${vertexCount} (min: 4)`);
    meetsThresholds = false;
  }
  
  // Check span percentage
  if (spanXPct < PLANIMETER_THRESHOLDS.MIN_SPAN_PCT && spanYPct < PLANIMETER_THRESHOLDS.MIN_SPAN_PCT) {
    errors.push(`Footprint too small: span ${spanXPct.toFixed(0)}% x ${spanYPct.toFixed(0)}%`);
    meetsThresholds = false;
  }
  
  // Check longest segment
  if (longestSegmentFt > PLANIMETER_THRESHOLDS.MAX_SEGMENT_LENGTH_FT) {
    warnings.push(`Long segment: ${longestSegmentFt.toFixed(0)}ft (may be missing corners)`);
    // Don't fail validation, just warn
  }
  
  // Check vertex density
  if (vertexCount < expectedMinVertices) {
    warnings.push(`Low vertex density: ${vertexCount} vertices for ${perimeterFt.toFixed(0)}ft perimeter (expected ${expectedMinVertices})`);
  }
  
  // RE_DETECT_THRESHOLD against Solar perimeter
  if (solarData?.estimatedPerimeterFt && solarData.estimatedPerimeterFt > 0) {
    const ratio = perimeterFt / solarData.estimatedPerimeterFt;
    if (ratio < PLANIMETER_THRESHOLDS.RE_DETECT_THRESHOLD) {
      errors.push(`Perimeter too small vs Solar: ${(ratio * 100).toFixed(0)}% (threshold: ${(PLANIMETER_THRESHOLDS.RE_DETECT_THRESHOLD * 100).toFixed(0)}%)`);
      meetsThresholds = false;
    }
  }
  
  // Area sanity checks
  if (areaSqFt < 200) {
    errors.push(`Footprint too small: ${areaSqFt.toFixed(0)} sqft (min: 200)`);
    meetsThresholds = false;
  }
  if (areaSqFt > 50000) {
    errors.push(`Footprint too large: ${areaSqFt.toFixed(0)} sqft (max: 50,000)`);
    meetsThresholds = false;
  }
  
  // Check against Solar area if available
  if (solarData?.buildingFootprintSqft && solarData.buildingFootprintSqft > 0) {
    const areaDiff = Math.abs(areaSqFt - solarData.buildingFootprintSqft) / solarData.buildingFootprintSqft;
    if (areaDiff > PLANIMETER_THRESHOLDS.AREA_TOLERANCE) {
      warnings.push(`Area differs from Solar by ${(areaDiff * 100).toFixed(1)}%`);
    }
  }
  
  return {
    validation: {
      isValid: errors.length === 0,
      errors,
      warnings
    },
    qaMetrics: {
      areaSqFt,
      perimeterFt,
      vertexCount,
      longestSegmentFt,
      spanXPct,
      spanYPct,
      expectedMinVertices,
      meetsThresholds
    }
  };
}

// Expand footprint for roof overhang
export function expandFootprintForOverhang(
  vertices: FootprintVertex[],
  overhangFt: number = 1.0
): FootprintVertex[] {
  if (vertices.length < 3 || overhangFt <= 0) return vertices;
  
  // Calculate centroid
  const centroid = {
    lat: vertices.reduce((s, v) => s + v.lat, 0) / vertices.length,
    lng: vertices.reduce((s, v) => s + v.lng, 0) / vertices.length
  };
  
  const { metersPerDegLat, metersPerDegLng } = getMetersPerDegree(centroid.lat);
  const overhangM = overhangFt / 3.28084;
  
  return vertices.map(v => {
    const dx = v.lng - centroid.lng;
    const dy = v.lat - centroid.lat;
    const dist = Math.sqrt(
      (dx * metersPerDegLng) ** 2 + 
      (dy * metersPerDegLat) ** 2
    );
    
    if (dist === 0) return v;
    
    const scale = (dist + overhangM) / dist;
    return {
      lat: centroid.lat + dy * scale,
      lng: centroid.lng + dx * scale
    };
  });
}

// Create fallback from Solar bounding box
function createSolarBboxFallback(solarData: SolarAPIData): ResolvedFootprint | null {
  if (!solarData.boundingBox) return null;
  
  const { sw, ne } = solarData.boundingBox;
  const vertices: FootprintVertex[] = [
    { lat: sw.latitude, lng: sw.longitude },
    { lat: sw.latitude, lng: ne.longitude },
    { lat: ne.latitude, lng: ne.longitude },
    { lat: ne.latitude, lng: sw.longitude }
  ];
  
  // Apply shape correction factor for rectangular bbox
  // Most residential roofs fill ~78% of bounding box
  const correctionFactor = 0.78;
  
  const { validation, qaMetrics } = validateFootprint(vertices, 'solar_bbox_fallback', solarData);
  
  // Adjust area estimate
  qaMetrics.areaSqFt *= correctionFactor;
  
  validation.warnings.push('Using Solar bounding box - area may be over-estimated');
  validation.warnings.push(`Applied ${((1 - correctionFactor) * 100).toFixed(0)}% shape correction`);
  
  return {
    vertices,
    source: 'solar_bbox_fallback',
    confidence: 0.5,
    validation,
    qaMetrics,
    solarData
  };
}

// Select best candidate from multiple footprint sources
function selectBestCandidate(
  candidates: Array<{
    vertices: FootprintVertex[];
    source: FootprintSource;
    confidence: number;
  }>,
  solarData?: SolarAPIData
): ResolvedFootprint | null {
  if (candidates.length === 0) return null;
  
  // Score each candidate
  const scored = candidates.map(candidate => {
    const { validation, qaMetrics } = validateFootprint(candidate.vertices, candidate.source, solarData);
    
    let score = candidate.confidence;
    
    // Penalize validation errors
    if (!validation.isValid) score -= 0.3;
    if (!qaMetrics.meetsThresholds) score -= 0.2;
    
    // Bonus for matching Solar area
    if (solarData?.buildingFootprintSqft && qaMetrics.areaSqFt > 0) {
      const areaDiff = Math.abs(qaMetrics.areaSqFt - solarData.buildingFootprintSqft) / solarData.buildingFootprintSqft;
      if (areaDiff <= 0.03) score += 0.1;
      else if (areaDiff <= 0.05) score += 0.05;
      else if (areaDiff > 0.2) score -= 0.15;
    }
    
    // Prefer higher vertex counts (more detail)
    if (qaMetrics.vertexCount >= 6) score += 0.05;
    
    return {
      ...candidate,
      validation,
      qaMetrics,
      score,
      solarData
    };
  });
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  const best = scored[0];
  if (!best.validation.isValid) {
    console.log(`⚠️ Best candidate has validation errors: ${best.validation.errors.join(', ')}`);
  }
  
  return {
    vertices: best.vertices,
    source: best.source,
    confidence: best.confidence,
    validation: best.validation,
    qaMetrics: best.qaMetrics,
    solarData
  };
}

// Try fetching from Mapbox Vector tiles
async function tryMapboxVector(options: FootprintResolverOptions): Promise<{
  vertices: FootprintVertex[];
  source: FootprintSource;
  confidence: number;
} | null> {
  // Use environment fallback if token not provided
  const mapboxToken = options.mapboxToken || Deno.env.get('MAPBOX_ACCESS_TOKEN') || '';
  if (!mapboxToken) return null;
  
  try {
    // Dynamic import to avoid bundling issues
    const { fetchMapboxVectorFootprint } = await import('./mapbox-footprint-extractor.ts');
    
    const result = await fetchMapboxVectorFootprint(
      options.lat,
      options.lng,
      mapboxToken,
      { radius: 50 }
    );
    
    if (result.footprint && result.footprint.vertexCount >= 4) {
      const vertices = result.footprint.coordinates.map(coord => ({
        lat: coord[1],
        lng: coord[0]
      }));
      
      return {
        vertices: expandFootprintForOverhang(vertices, options.eaveOverhangFt || 0.5),
        source: 'mapbox_vector',
        confidence: result.footprint.confidence
      };
    }
  } catch (err) {
    console.warn('Mapbox footprint fetch failed:', err);
  }
  
  return null;
}

// Try fetching from Microsoft/Esri Buildings
async function tryMicrosoftBuildings(options: FootprintResolverOptions): Promise<{
  vertices: FootprintVertex[];
  source: FootprintSource;
  confidence: number;
} | null> {
  try {
    const { fetchMicrosoftBuildingFootprint } = await import('./microsoft-footprint-extractor.ts');
    
    const result = await fetchMicrosoftBuildingFootprint(
      options.lat,
      options.lng,
      { searchRadius: 50 }
    );
    
    if (result.footprint && result.footprint.vertexCount >= 4) {
      const vertices = result.footprint.coordinates.map(coord => ({
        lat: coord[1],
        lng: coord[0]
      }));
      
      return {
        vertices: expandFootprintForOverhang(vertices, options.eaveOverhangFt || 0.5),
        source: 'microsoft_buildings',
        confidence: result.footprint.confidence
      };
    }
  } catch (err) {
    console.warn('Microsoft footprint fetch failed:', err);
  }
  
  return null;
}

// Try fetching from OSM Overpass
async function tryOSMBuildings(options: FootprintResolverOptions): Promise<{
  vertices: FootprintVertex[];
  source: FootprintSource;
  confidence: number;
} | null> {
  try {
    const { fetchOSMBuildingFootprint } = await import('./osm-footprint-extractor.ts');
    
    const result = await fetchOSMBuildingFootprint(
      options.lat,
      options.lng,
      { searchRadius: 50 }
    );
    
    if (result.footprint && result.footprint.vertexCount >= 4) {
      const vertices = result.footprint.coordinates.map(coord => ({
        lat: coord[1],
        lng: coord[0]
      }));
      
      return {
        vertices: expandFootprintForOverhang(vertices, options.eaveOverhangFt || 0.5),
        source: 'osm_buildings',
        confidence: result.footprint.confidence
      };
    }
  } catch (err) {
    console.warn('OSM footprint fetch failed:', err);
  }
  
  return null;
}

// Try fetching from Regrid (paid)
async function tryRegridParcel(options: FootprintResolverOptions): Promise<{
  vertices: FootprintVertex[];
  source: FootprintSource;
  confidence: number;
} | null> {
  // Use environment fallback if key not provided
  const regridApiKey = options.regridApiKey || Deno.env.get('REGRID_API_KEY') || '';
  if (!regridApiKey) return null;
  
  try {
    const { fetchRegridFootprint } = await import('./regrid-footprint-extractor.ts');
    
    const result = await fetchRegridFootprint(
      options.lat,
      options.lng,
      regridApiKey
    );
    
    if (result && result.vertices.length >= 4) {
      return {
        vertices: expandFootprintForOverhang(result.vertices, options.eaveOverhangFt || 0.5),
        source: 'regrid_parcel',
        confidence: result.confidence || 0.8
      };
    }
  } catch (err) {
    console.warn('Regrid footprint fetch failed:', err);
  }
  
  return null;
}

/**
 * Main footprint resolver - tries sources in priority order
 * Priority: Mapbox Vector > Microsoft/Esri > OSM > Regrid (paid) > Solar bbox
 */
export async function resolveFootprint(options: FootprintResolverOptions): Promise<ResolvedFootprint | null> {
  const candidates: Array<{
    vertices: FootprintVertex[];
    source: FootprintSource;
    confidence: number;
  }> = [];
  
  console.log(`📍 Resolving footprint for ${options.lat.toFixed(6)}, ${options.lng.toFixed(6)}`);
  
  // 1. Mapbox Vector (highest fidelity, included with subscription)
  const mapbox = await tryMapboxVector(options);
  if (mapbox) {
    console.log(`✓ Mapbox Vector: ${mapbox.vertices.length} vertices, ${(mapbox.confidence * 100).toFixed(0)}% confidence`);
    candidates.push(mapbox);
  }
  
  // 2. Microsoft/Esri Buildings (FREE, 92% accuracy)
  const microsoft = await tryMicrosoftBuildings(options);
  if (microsoft) {
    console.log(`✓ Microsoft Buildings: ${microsoft.vertices.length} vertices, ${(microsoft.confidence * 100).toFixed(0)}% confidence`);
    candidates.push(microsoft);
  }
  
  // 3. OSM Overpass (FREE)
  const osm = await tryOSMBuildings(options);
  if (osm) {
    console.log(`✓ OSM Buildings: ${osm.vertices.length} vertices, ${(osm.confidence * 100).toFixed(0)}% confidence`);
    candidates.push(osm);
  }
  
  // 4. Regrid (PAID - only if free sources fail or env key is available)
  const hasRegridKey = options.regridApiKey || Deno.env.get('REGRID_API_KEY');
  if (candidates.length === 0 && hasRegridKey) {
    const regrid = await tryRegridParcel(options);
    if (regrid) {
      console.log(`✓ Regrid Parcel: ${regrid.vertices.length} vertices, ${(regrid.confidence * 100).toFixed(0)}% confidence`);
      candidates.push(regrid);
    }
  }
  
  // Select best candidate using PLANIMETER_THRESHOLDS
  const best = selectBestCandidate(candidates, options.solarData);
  
  if (best) {
    console.log(`✅ Selected: ${best.source} - ${best.qaMetrics.areaSqFt.toFixed(0)} sqft, ${best.vertices.length} vertices`);
    return best;
  }
  
  // 5. Solar bbox as last resort
  if (options.solarData?.boundingBox) {
    console.log(`⚠️ Using Solar bounding box fallback`);
    return createSolarBboxFallback(options.solarData);
  }
  
  console.log(`❌ No footprint source available`);
  return null;
}
