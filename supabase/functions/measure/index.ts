// Supabase Edge Function: measure
// Production-ready measurement orchestrator with multi-provider support
// Handles: Regrid (sync), OSM (sync), EagleView/Nearmap/HOVER (async ready)
// Generates vendor-agnostic Smart Tags for estimate templates
// NEW: Full AI Measurement Agent pipeline with DSM refinement and QA validation

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeStraightSkeleton } from "./straight-skeleton.ts";
import { classifyBoundaryEdges } from "./gable-detector.ts";
import { analyzeDSM, fetchDSMFromGoogleSolar } from "./dsm-analyzer.ts";
import { splitFootprintIntoFacets } from "./facet-splitter.ts";
import { validateMeasurements } from "./qa-validator.ts";
import { transformToOutputSchema, type MeasurementOutputSchema } from "./output-schema.ts";

// Environment
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
const OSM_ENABLED = true;
const OSM_OVERPASS_URL = Deno.env.get("OSM_OVERPASS_URL") || "https://overpass-api.de/api/interpreter";
const OPENBUILDINGS_FGB_TEMPLATE = Deno.env.get("OPENBUILDINGS_FGB_TEMPLATE") || "";
const FOOTPRINT_BUFFER_M = Number(Deno.env.get("FOOTPRINT_BUFFER_M") || "25");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Types
type EdgeFeatureType = 'ridge'|'hip'|'valley'|'eave'|'rake'|'step'|'wall'|'unknown';

interface LinearFeature {
  id: string;
  wkt: string;
  length_ft: number;
  type: EdgeFeatureType;
  label?: string;
}

interface RoofFace {
  id: string;
  wkt: string;
  plan_area_sqft: number;
  pitch?: string;
  area_sqft: number;
  linear_features?: LinearFeature[];
}

interface MeasureSummary {
  total_area_sqft: number;
  total_squares: number;
  waste_pct: number;
  pitch_method: 'manual'|'vendor'|'assumed';
  perimeter_ft?: number;
  ridge_ft?: number;
  hip_ft?: number;
  valley_ft?: number;
  eave_ft?: number;
  rake_ft?: number;
  roof_age_years?: number | null;
  roof_age_source?: 'user'|'permit'|'assessor'|'unknown';
}

interface MeasureResult {
  id?: string;
  property_id: string;
  source: string;
  faces: RoofFace[];
  linear_features?: LinearFeature[];
  summary: MeasureSummary;
  created_at?: string;
  geom_wkt?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Geometry utilities
function degToMeters(latDeg: number) {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(latDeg * Math.PI / 180);
  return { metersPerDegLat, metersPerDegLng };
}

function polygonAreaSqftFromLngLat(coords: [number, number][]) {
  if (coords.length < 4) return 0;
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const x1 = lng1 * metersPerDegLng, y1 = lat1 * metersPerDegLat;
    const x2 = lng2 * metersPerDegLng, y2 = lat2 * metersPerDegLat;
    sum += (x1 * y2 - x2 * y1);
  }
  const area_m2 = Math.abs(sum) / 2;
  return area_m2 * 10.7639;
}

function pitchFactor(pitch?: string) {
  if (!pitch || pitch === 'flat') return 1;
  const m = pitch.match(/^(\d+)\/(\d+)$/);
  if (!m) return 1;
  const rise = Number(m[1]), run = Number(m[2] || 12);
  const factor = Math.sqrt(rise * rise + run * run) / run;
  return isFinite(factor) && factor > 0 ? factor : 1;
}

function toPolygonWKT(coords: [number, number][]) {
  const inner = coords.map(c => `${c[0]} ${c[1]}`).join(', ');
  return `POLYGON((${inner}))`;
}

function polygonWKT(coords: [number, number][]) {
  const inner = coords.map(c => `${c[0]} ${c[1]}`).join(', ');
  return `POLYGON((${inner}))`;
}

function isClosed(r: [number, number][]) {
  const a = r[0], b = r[r.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

function metersToDeg(lat: number, m: number) {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(lat * Math.PI / 180);
  return { dx: m / mPerDegLng, dy: m / mPerDegLat };
}

function pointInPolygon(p: [number, number], ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceMetersToCentroid(lat: number, lng: number, ring: [number, number][]) {
  const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const R = 6371000;
  const φ1 = lat * Math.PI / 180, φ2 = cy * Math.PI / 180;
  const dφ = (cy - lat) * Math.PI / 180, dλ = (cx - lng) * Math.PI / 180;
  const a = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pickISO(address?: any): string | null {
  const c = address?.country_iso || address?.countryCode || address?.country || null;
  if (!c) return null;
  const up = String(c).toUpperCase().trim();
  if (up.length === 2) return up;
  if (up.length === 3) return up;
  if (up.startsWith("UNITED STATES")) return "USA";
  if (up.startsWith("CANADA")) return "CAN";
  if (up.startsWith("AUSTRALIA")) return "AUS";
  return null;
}

function wktToCoords(wkt: string): [number, number][] {
  const match = wkt.match(/POLYGON\(\(([^)]+)\)\)/);
  if (!match) return [];
  
  return match[1]
    .split(',')
    .map(pair => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return [lng, lat] as [number, number];
    });
}

// ============= FOOTPRINT QA GATE =============
// Validates footprint geometry before processing to prevent bad measurements

interface FootprintQAResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  planAreaSqft: number;
  circularity: number;
  vertexCount: number;
}

function validateFootprintGeometry(coords: [number, number][], lat: number, lng: number): FootprintQAResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  
  // Calculate plan area
  const planAreaSqft = polygonAreaSqftFromLngLat(coords);
  const vertexCount = coords.length;
  
  // Calculate circularity (1.0 = perfect circle, lower = more angular)
  // Circularity = 4 * PI * Area / Perimeter^2
  let perimeter = 0;
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
  
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = (coords[i + 1][0] - coords[i][0]) * metersPerDegLng;
    const dy = (coords[i + 1][1] - coords[i][1]) * metersPerDegLat;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  
  const areaM2 = planAreaSqft / 10.7639;
  const circularity = perimeter > 0 ? (4 * Math.PI * areaM2) / (perimeter * perimeter) : 0;
  
  // QA Check 1: Area bounds
  if (planAreaSqft < 200) {
    errors.push(`Footprint too small: ${Math.round(planAreaSqft)} sqft (min: 200)`);
  }
  if (planAreaSqft > 50000) {
    errors.push(`Footprint too large: ${Math.round(planAreaSqft)} sqft (max: 50,000). May not be a single building.`);
  }
  if (planAreaSqft > 10000) {
    warnings.push(`Large footprint: ${Math.round(planAreaSqft)} sqft. Verify this is the correct building.`);
  }
  
  // QA Check 2: Circularity (detect non-building shapes)
  if (circularity > 0.85) {
    errors.push(`Footprint is too circular (${(circularity * 100).toFixed(0)}%). This may not be a building.`);
  }
  if (circularity > 0.7) {
    warnings.push(`Footprint appears rounded. Verify this is the correct building outline.`);
  }
  
  // QA Check 3: Vertex count (detect oversimplified or overly complex)
  if (vertexCount < 4) {
    errors.push(`Too few vertices: ${vertexCount} (min: 4)`);
  }
  if (vertexCount > 50) {
    warnings.push(`High vertex count: ${vertexCount}. This may indicate a non-standard footprint.`);
  }
  
  // QA Check 4: Contains the target point
  const targetPoint: [number, number] = [lng, lat];
  if (!pointInPolygon(targetPoint, coords)) {
    warnings.push('Target coordinates are outside the footprint boundary.');
  }
  
  // QA Check 5: Self-intersection check (simplified - just count very close vertices)
  const closeVertexPairs = checkForCloseVertices(coords);
  if (closeVertexPairs > 0) {
    warnings.push(`Footprint may have overlapping edges (${closeVertexPairs} close vertex pairs).`);
  }
  
  return {
    isValid: errors.length === 0,
    warnings,
    errors,
    planAreaSqft,
    circularity,
    vertexCount,
  };
}

function checkForCloseVertices(coords: [number, number][]): number {
  const threshold = 0.00001; // ~1 meter
  let closeCount = 0;
  
  for (let i = 0; i < coords.length - 2; i++) {
    for (let j = i + 2; j < coords.length - 1; j++) {
      const dx = Math.abs(coords[i][0] - coords[j][0]);
      const dy = Math.abs(coords[i][1] - coords[j][1]);
      if (dx < threshold && dy < threshold) {
        closeCount++;
      }
    }
  }
  
  return closeCount;
}

function unionFacesWKT(faces: RoofFace[]): string | undefined {
  if (!faces.length) return undefined;
  const polys = faces.map(f => f.wkt.replace(/^POLYGON/,'')).join(',');
  return `MULTIPOLYGON(${polys})`;
}

// Calculate geodesic line length in feet
function calculateGeodesicLength(start: [number, number], end: [number, number], midLat: number): number {
  const { metersPerDegLat, metersPerDegLng } = degToMeters(midLat);
  const dx = (end[0] - start[0]) * metersPerDegLng;
  const dy = (end[1] - start[1]) * metersPerDegLat;
  const length_m = Math.sqrt(dx * dx + dy * dy);
  return length_m * 3.28084;
}

// Calculate bounding box from coordinates
function getBoundsFromCoords(coords: [number, number][]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = coords.map(c => c[0]);
  const ys = coords.map(c => c[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

// Convert skeleton edges and boundary edges to LinearFeature array
// IMPROVED: Better facet counting based on skeleton topology
function buildLinearFeaturesFromTopology(
  coords: [number, number][],
  midLat: number
): { features: LinearFeature[]; totals: Record<string, number>; derivedFacetCount: number } {
  try {
    // Compute straight skeleton
    const skeleton = computeStraightSkeleton(coords);
    
    // Classify boundary edges
    const boundaryClass = classifyBoundaryEdges(coords, skeleton);
    
    const features: LinearFeature[] = [];
    let featureId = 1;
    
    // Count skeleton features for facet derivation
    const ridgeCount = skeleton.filter(e => e.type === 'ridge').length;
    const hipCount = skeleton.filter(e => e.type === 'hip').length;
    const valleyCount = skeleton.filter(e => e.type === 'valley').length;
    
    // Add skeleton-derived features (ridge, hip, valley)
    for (const edge of skeleton) {
      const length_ft = calculateGeodesicLength(edge.start, edge.end, midLat);
      
      // Skip very short edges (noise)
      if (length_ft < 3) continue;
      
      features.push({
        id: `LF${featureId++}`,
        wkt: `LINESTRING(${edge.start[0]} ${edge.start[1]}, ${edge.end[0]} ${edge.end[1]})`,
        length_ft,
        type: edge.type,
        label: `${edge.type.charAt(0).toUpperCase() + edge.type.slice(1)} ${featureId - 1}`
      });
    }
    
    // Add boundary features (eave)
    for (const edge of boundaryClass.eaveEdges) {
      const length_ft = calculateGeodesicLength(edge[0], edge[1], midLat);
      if (length_ft < 3) continue;
      
      features.push({
        id: `LF${featureId++}`,
        wkt: `LINESTRING(${edge[0][0]} ${edge[0][1]}, ${edge[1][0]} ${edge[1][1]})`,
        length_ft,
        type: 'eave',
        label: `Eave ${featureId - 1}`
      });
    }
    
    // Add boundary features (rake)
    for (const edge of boundaryClass.rakeEdges) {
      const length_ft = calculateGeodesicLength(edge[0], edge[1], midLat);
      if (length_ft < 3) continue;
      
      features.push({
        id: `LF${featureId++}`,
        wkt: `LINESTRING(${edge[0][0]} ${edge[0][1]}, ${edge[1][0]} ${edge[1][1]})`,
        length_ft,
        type: 'rake',
        label: `Rake ${featureId - 1}`
      });
    }
    
    // Calculate totals
    const totals = {
      perimeter_ft: boundaryClass.eaveEdges.concat(boundaryClass.rakeEdges)
        .reduce((sum, e) => sum + calculateGeodesicLength(e[0], e[1], midLat), 0),
      ridge_ft: features.filter(f => f.type === 'ridge').reduce((s, f) => s + f.length_ft, 0),
      hip_ft: features.filter(f => f.type === 'hip').reduce((s, f) => s + f.length_ft, 0),
      valley_ft: features.filter(f => f.type === 'valley').reduce((s, f) => s + f.length_ft, 0),
      eave_ft: features.filter(f => f.type === 'eave').reduce((s, f) => s + f.length_ft, 0),
      rake_ft: features.filter(f => f.type === 'rake').reduce((s, f) => s + f.length_ft, 0),
    };
    
    // IMPROVED: Derive facet count from skeleton topology
    // Facet count formula based on roof topology:
    // - Simple hip: 4 facets (1 ridge, 4 hips, 0 valleys)
    // - Cross-gable: 4-8 facets depending on valleys
    // - L-shape with valleys: 6-10 facets
    // General formula: facets = hipCount + valleyCount + 2 (for main roof planes)
    let derivedFacetCount = 4; // Minimum for any pitched roof
    
    if (hipCount >= 4 && valleyCount === 0) {
      // Standard hip roof: 4 facets
      derivedFacetCount = 4;
    } else if (hipCount >= 4 && valleyCount > 0) {
      // Hip roof with valleys (cross-gable, L-shape)
      // Each valley adds 2 more facets typically
      derivedFacetCount = 4 + (valleyCount * 2);
    } else if (ridgeCount >= 1 && hipCount === 0) {
      // Gable roof: 2 facets
      derivedFacetCount = 2;
    } else if (ridgeCount >= 2) {
      // Multiple ridges (complex cross-gable)
      derivedFacetCount = ridgeCount * 2 + valleyCount * 2;
    }
    
    // Clamp to reasonable range
    derivedFacetCount = Math.max(2, Math.min(20, derivedFacetCount));
    
    console.log('Topology extracted:', { 
      featureCount: features.length,
      skeleton: `${ridgeCount} ridges, ${hipCount} hips, ${valleyCount} valleys`,
      derivedFacetCount,
      totals: Object.entries(totals).map(([k, v]) => `${k}=${Math.round(v)}`).join(', ')
    });
    
    // RIDGE LENGTH VALIDATION: Compare ridge to footprint's longest dimension
    const bounds = getBoundsFromCoords(coords);
    const longestDimFt = Math.max(
      calculateGeodesicLength([bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], midLat),
      calculateGeodesicLength([bounds.minX, bounds.minY], [bounds.minX, bounds.maxY], midLat)
    );
    const ridgeRatio = longestDimFt > 0 ? totals.ridge_ft / longestDimFt : 0;
    
    if (ridgeRatio < 0.3 || ridgeRatio > 1.5) {
      console.warn(`⚠️ Ridge length suspicious: ${totals.ridge_ft.toFixed(1)}ft vs longest dimension ${longestDimFt.toFixed(1)}ft (ratio: ${ridgeRatio.toFixed(2)})`);
    } else {
      console.log(`✓ Ridge length plausible: ${totals.ridge_ft.toFixed(1)}ft / ${longestDimFt.toFixed(1)}ft = ${ridgeRatio.toFixed(2)}`);
    }
    
    return { features, totals, derivedFacetCount };
  } catch (error) {
    console.warn('Skeleton extraction failed, falling back to simple perimeter:', error);
    // Fallback to simple perimeter estimation
    return {
      features: estimateLinearFeatures([{
        id: 'A',
        wkt: toPolygonWKT(coords),
        plan_area_sqft: 0,
        area_sqft: 0
      }]),
      totals: {
        perimeter_ft: 0,
        ridge_ft: 0,
        hip_ft: 0,
        valley_ft: 0,
        eave_ft: 0,
        rake_ft: 0
      },
      derivedFacetCount: 4
    };
  }
}

// Smart Tags builder - Expanded to 100+ tags
function buildSmartTags(meas: MeasureResult) {
  const tags: Record<string, number|string> = {};
  const sum = meas.summary;
  const faces = meas.faces || [];
  
  // Handle linear_features as either array or object format
  let linear: any[] = [];
  const rawLinear = meas.linear_features;
  if (Array.isArray(rawLinear)) {
    // Array format from edge function
    linear = rawLinear.concat(...faces.map(f => f.linear_features || []));
  } else if (rawLinear && typeof rawLinear === 'object') {
    // Object format from database: {hip: 140, eave: 130, ...} -> convert to array
    linear = Object.entries(rawLinear)
      .filter(([_, v]) => typeof v === 'number' && v > 0)
      .map(([type, length_ft]) => ({ type, length_ft }));
    // Also add face linear features
    faces.forEach(f => {
      if (Array.isArray(f.linear_features)) {
        linear.push(...f.linear_features);
      }
    });
  }

  const total_plan_sqft = faces.reduce((s, f) => s + (f.plan_area_sqft || 0), 0);
  const total_adj_sqft = sum.total_area_sqft;
  const total_squares = sum.total_squares;
  const face_count = faces.length;
  const avg_pitch_factor = faces.length
    ? faces.reduce((s, f) => s + pitchFactor(f.pitch), 0) / faces.length
    : 1;

  const lfBy = (types: EdgeFeatureType[]) =>
    linear.filter(l => types.includes((l.type as EdgeFeatureType) || 'unknown'))
          .reduce((s, l) => s + (l.length_ft || 0), 0);

  // ============= ROOF BASIC MEASUREMENTS =============
  tags["roof.plan_sqft"] = round(total_plan_sqft);
  tags["roof.total_sqft"] = round(total_adj_sqft);
  tags["roof.squares"] = round(total_squares, 2);
  tags["roof.faces_count"] = face_count;
  tags["roof.waste_pct"] = sum.waste_pct || 10;
  tags["roof.pitch_factor"] = round(avg_pitch_factor, 3);
  tags["roof.complexity"] = calculateComplexity(faces, linear);
  tags["roof.perimeter_ft"] = round(sum.perimeter_ft || 0);

  // ============= INDIVIDUAL ROOF FACETS (up to 20) =============
  faces.slice(0, 20).forEach((face, i) => {
    const num = i + 1;
    const facet_plan_sqft = face.plan_area_sqft || 0;
    const facet_area_sqft = face.area_sqft || 0;
    const facet_pitch = face.pitch || 'unknown';
    const facet_pitch_degrees = pitchToDegrees(facet_pitch);
    
    tags[`facet.${num}.area_sqft`] = round(facet_area_sqft);
    tags[`facet.${num}.plan_area_sqft`] = round(facet_plan_sqft);
    tags[`facet.${num}.pitch`] = facet_pitch;
    tags[`facet.${num}.pitch_degrees`] = round(facet_pitch_degrees, 2);
    tags[`facet.${num}.direction`] = getDirection(face.azimuth_degrees);
    tags[`facet.${num}.squares`] = round(facet_area_sqft / 100, 2);
  });

  // ============= PITCH-SPECIFIC MEASUREMENTS =============
  const pitchBreakdown = getPitchBreakdown(faces);
  const pitches = ['2/12', '3/12', '4/12', '5/12', '6/12', '7/12', '8/12', '9/12', '10/12', '12/12', 'flat'];
  pitches.forEach(pitch => {
    const key = pitch.replace('/', '_');
    tags[`pitch.${key}.sqft`] = round(pitchBreakdown[pitch] || 0);
  });

  // ============= WASTE-ADJUSTED CALCULATIONS =============
  const wastePercentages = [0, 8, 10, 12, 15, 17, 20];
  wastePercentages.forEach(pct => {
    const adjusted_sqft = total_adj_sqft * (1 + pct / 100);
    const adjusted_squares = adjusted_sqft / 100;
    tags[`waste.${pct}pct.sqft`] = round(adjusted_sqft);
    tags[`waste.${pct}pct.squares`] = round(adjusted_squares, 2);
  });

  // ============= LINEAR FEATURES =============
  tags["lf.ridge"] = round(lfBy(['ridge']));
  tags["lf.hip"] = round(lfBy(['hip']));
  tags["lf.valley"] = round(lfBy(['valley']));
  tags["lf.eave"] = round(lfBy(['eave']));
  tags["lf.rake"] = round(lfBy(['rake']));
  tags["lf.step"] = round(lfBy(['step']));
  tags["lf.perimeter"] = round(sum.perimeter_ft || 0);

  // ============= COMBINED LINEAR MEASUREMENTS =============
  tags["lf.ridge_hip_total"] = tags["lf.ridge"] as number + tags["lf.hip"] as number;
  tags["lf.eave_rake_total"] = tags["lf.eave"] as number + tags["lf.rake"] as number;
  tags["lf.valley_step_total"] = tags["lf.valley"] as number + tags["lf.step"] as number;

  // ============= PENETRATIONS =============
  const pens = (meas as any).penetrations || [];
  tags["pen.total"] = pens.reduce((s: number, p: any) => s + (p.count || 0), 0);
  tags["pen.pipe_vent"] = pens.find((p: any) => p.type === 'pipe_vent')?.count || 0;
  tags["pen.skylight"] = pens.find((p: any) => p.type === 'skylight')?.count || 0;
  tags["pen.chimney"] = pens.find((p: any) => p.type === 'chimney')?.count || 0;
  tags["pen.hvac"] = pens.find((p: any) => p.type === 'hvac')?.count || 0;
  tags["pen.other"] = pens.find((p: any) => p.type === 'other')?.count || 0;

  // ============= BASE MATERIAL QUANTITIES =============
  tags["bundles.shingles"] = Math.ceil(total_squares * 3);
  tags["bundles.ridge_cap"] = Math.ceil((tags["lf.ridge"] as number + tags["lf.hip"] as number) / 33);
  tags["rolls.valley"] = Math.ceil((tags["lf.valley"] as number) / 50);
  tags["rolls.ice_water"] = Math.ceil((tags["lf.valley"] as number + tags["lf.eave"] as number * 0.25) / 65); // First 3ft of eaves
  tags["rolls.underlayment"] = Math.ceil(total_squares);
  tags["sticks.drip_edge"] = Math.ceil((tags["lf.eave"] as number + tags["lf.rake"] as number) / 10);
  tags["boots.pipe"] = tags["pen.pipe_vent"];
  tags["kits.skylight"] = tags["pen.skylight"];
  tags["kits.chimney"] = tags["pen.chimney"];

  // ============= WASTE-ADJUSTED MATERIALS =============
  [8, 10, 12, 15, 20].forEach(pct => {
    const adj_squares = total_squares * (1 + pct / 100);
    tags[`bundles.shingles.waste_${pct}pct`] = Math.ceil(adj_squares * 3);
    tags[`rolls.underlayment.waste_${pct}pct`] = Math.ceil(adj_squares);
  });
  [10, 15].forEach(pct => {
    const adj_lf = (tags["lf.eave"] as number + tags["lf.rake"] as number) * (1 + pct / 100);
    tags[`sticks.drip_edge.waste_${pct}pct`] = Math.ceil(adj_lf / 10);
  });

  // ============= PROPERTY METADATA =============
  tags["age.years"] = sum.roof_age_years || 0;
  tags["age.source"] = sum.roof_age_source || 'unknown';
  tags["measure.date"] = new Date().toISOString().split('T')[0];
  tags["measure.source"] = meas.source || 'unknown';
  tags["measure.confidence"] = (meas as any).confidence || 0.85;

  // ============= DERIVED CALCULATIONS =============
  tags["calc.labor_hours"] = calculateLaborHours(total_squares, avg_pitch_factor, tags["roof.complexity"] as number);
  tags["calc.crew_days"] = Math.ceil((tags["calc.labor_hours"] as number) / (4 * 8)); // 4-person crew, 8-hour days
  tags["calc.dump_runs"] = Math.ceil(total_squares / 15); // ~15 squares per dump run
  tags["calc.dumpster_size"] = total_squares <= 15 ? 10 : total_squares <= 30 ? 20 : 30;

  return tags;
}

// Unified measurement summary builder
// Construct an augmented summary with unified keys used by the new roof_measurements schema
function buildUnifiedSummary(meas: MeasureResult): MeasureSummary & Record<string, any> {
  const summary = meas.summary || {} as MeasureSummary;
  const faces = meas.faces || [];

  // Collect linear features from measurement-level and per-face
  let linear: any[] = [];
  const rawLinear = meas.linear_features;
  if (Array.isArray(rawLinear)) {
    linear = rawLinear.concat(...faces.map(f => f.linear_features || []));
  } else if (rawLinear && typeof rawLinear === 'object') {
    linear = Object.entries(rawLinear)
      .filter(([_, v]) => typeof v === 'number' && v > 0)
      .map(([type, length_ft]) => ({ type, length_ft }));
    faces.forEach(f => {
      if (Array.isArray(f.linear_features)) {
        linear.push(...f.linear_features);
      }
    });
  }

  // Calculate totals from faces
  const totalPlanSqft = faces.reduce((s, f) => s + (f.plan_area_sqft || 0), 0);
  const totalAdjustedSqft = faces.reduce((s, f) => s + (f.area_sqft || 0), 0);
  const totalSquares = totalAdjustedSqft / 100;
  const wastePct = summary.waste_pct || 10;
  const totalSquaresWithWaste = totalSquares * (1 + wastePct / 100);

  // Calculate average pitch factor
  const avgPitchFactor = faces.length
    ? faces.reduce((s, f) => s + pitchFactor(f.pitch), 0) / faces.length
    : 1;

  // Determine predominant pitch (most area)
  const pitchAreas: Record<string, number> = {};
  faces.forEach(f => {
    const p = f.pitch || 'unknown';
    pitchAreas[p] = (pitchAreas[p] || 0) + (f.area_sqft || 0);
  });
  const predominantPitch = Object.entries(pitchAreas).sort((a, b) => b[1] - a[1])[0]?.[0] || '4/12';

  // Calculate linear feature totals
  const lfBy = (types: string[]) =>
    linear.filter(l => types.includes(l.type || 'unknown'))
          .reduce((s, l) => s + (l.length_ft || 0), 0);

  const totalEave = lfBy(['eave']);
  const totalRake = lfBy(['rake']);
  const totalHip = lfBy(['hip']);
  const totalValley = lfBy(['valley']);
  const totalRidge = lfBy(['ridge']);

  return {
    ...summary,
    // New unified keys for roof_measurements schema
    total_area_flat_sqft: round(totalPlanSqft),
    total_area_adjusted_sqft: round(totalAdjustedSqft),
    total_squares: round(totalSquares, 2),
    waste_factor_percent: round(wastePct, 2),
    total_squares_with_waste: round(totalSquaresWithWaste, 2),
    predominant_pitch: predominantPitch,
    pitch_factor: round(avgPitchFactor, 3),
    facet_count: faces.length,
    total_eave_length: round(totalEave, 2),
    total_rake_length: round(totalRake, 2),
    total_hip_length: round(totalHip, 2),
    total_valley_length: round(totalValley, 2),
    total_ridge_length: round(totalRidge, 2),
  };
}

// Helper: Calculate roof complexity (1-5 scale)
function calculateComplexity(faces: RoofFace[], linear: LinearFeature[]): number {
  let score = 1;
  
  // More facets = more complex
  if (faces.length > 8) score += 2;
  else if (faces.length > 4) score += 1;
  
  // Valleys and hips add complexity
  const valleys = linear.filter(l => l.type === 'valley').length;
  const hips = linear.filter(l => l.type === 'hip').length;
  if (valleys + hips > 6) score += 1;
  if (valleys + hips > 3) score += 0.5;
  
  // Steep pitches add complexity
  const steepFaces = faces.filter(f => pitchToDegrees(f.pitch) > 30).length;
  if (steepFaces > 0) score += 0.5;
  
  return Math.min(Math.round(score * 2) / 2, 5); // Round to nearest 0.5, max 5
}

// Helper: Calculate estimated labor hours
function calculateLaborHours(squares: number, pitchFactor: number, complexity: number): number {
  const baseHours = squares * 1.5; // 1.5 hours per square baseline
  const pitchMultiplier = 0.5 + (pitchFactor - 1) * 2; // Steeper = more time
  const complexityMultiplier = 0.8 + (complexity / 5) * 0.4; // 0.8 to 1.2
  return Math.ceil(baseHours * pitchMultiplier * complexityMultiplier);
}

// Helper: Convert pitch to degrees
function pitchToDegrees(pitch: string): number {
  if (pitch === 'flat') return 0;
  const match = pitch.match(/(\d+)\/12/);
  if (!match) return 18.4; // Default to 4/12
  const rise = parseInt(match[1]);
  return Math.atan(rise / 12) * (180 / Math.PI);
}

// Helper: Get compass direction from azimuth
function getDirection(azimuthDegrees?: number): string {
  if (azimuthDegrees === undefined) return 'unknown';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(azimuthDegrees / 45) % 8;
  return dirs[index];
}

// Helper: Get pitch breakdown
function getPitchBreakdown(faces: RoofFace[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  faces.forEach(face => {
    const pitch = face.pitch || 'unknown';
    breakdown[pitch] = (breakdown[pitch] || 0) + (face.area_sqft || 0);
  });
  return breakdown;
}

function round(n: number, p = 1) {
  return Math.round(n * (10 ** p)) / (10 ** p);
}

// Helper: Convert Google's bounding box to polygon coordinates
function boundingBoxToPolygon(box: any): [number, number][] {
  const { sw, ne } = box;
  return [
    [sw.longitude, sw.latitude],
    [ne.longitude, sw.latitude],
    [ne.longitude, ne.latitude],
    [sw.longitude, ne.latitude],
    [sw.longitude, sw.latitude], // Close the polygon
  ];
}

// Helper: Convert degrees to roof pitch format (18.5° → "4/12")
function degreesToRoofPitch(degrees: number): string {
  if (degrees < 2) return 'flat';
  const rise = Math.round(Math.tan(degrees * Math.PI / 180) * 12);
  return `${rise}/12`;
}

// Helper: Estimate linear features from roof geometry
function estimateLinearFeatures(faces: RoofFace[]): LinearFeature[] {
  const features: LinearFeature[] = [];
  let featureId = 1;

  faces.forEach(face => {
    // Parse WKT to get coordinates
    const coords = face.wkt.match(/[\d.-]+/g)?.map(Number) || [];
    if (coords.length < 8) return; // Need at least 4 points (8 numbers)

    // Calculate perimeter edges
    for (let i = 0; i < coords.length - 2; i += 2) {
      const x1 = coords[i], y1 = coords[i + 1];
      const x2 = coords[i + 2], y2 = coords[i + 3];
      
      const { metersPerDegLat, metersPerDegLng } = degToMeters(y1);
      const dx = (x2 - x1) * metersPerDegLng;
      const dy = (y2 - y1) * metersPerDegLat;
      const length_m = Math.sqrt(dx * dx + dy * dy);
      const length_ft = length_m * 3.28084;

      if (length_ft > 5) { // Only add significant edges
        features.push({
          id: `LF${featureId++}`,
          wkt: `LINESTRING(${x1} ${y1}, ${x2} ${y2})`,
          length_ft,
          type: face.pitch === 'flat' ? 'eave' : 'rake',
          label: `Edge ${featureId - 1}`
        });
      }
    }
  });

  return features;
}

// Provider: Google Solar API (sync, US coverage, actual pitch data)
async function providerGoogleSolar(supabase: any, lat: number, lng: number) {
  if (!GOOGLE_PLACES_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY not configured");

  // Check cache first (within 10m, <90 days old)
  const { data: cached } = await supabase.rpc('nearby_buildings', {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: 10,
    p_max_age_days: 90
  });

  if (cached && cached.length > 0) {
    console.log('Using cached building data from', cached[0].source);
    const building = cached[0];
    
    // Convert cached data to MeasureResult
    const polygon = building.building_polygon;
    const coords: [number, number][] = polygon.coordinates[0];
    const plan_sqft = polygonAreaSqftFromLngLat(coords);
    const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    
    // Extract roof topology
    const topology = buildLinearFeaturesFromTopology(coords, midLat);
    
    const faces: RoofFace[] = [];
    if (building.roof_segments && building.roof_segments.length > 0) {
      building.roof_segments.forEach((seg: any, idx: number) => {
        const pitch = degreesToRoofPitch(seg.pitchDegrees || 18.5);
        const pf = pitchFactor(pitch);
        const segArea = seg.stats?.areaMeters2 * 10.7639 || (plan_sqft / building.roof_segments.length);
        
        faces.push({
          id: String.fromCharCode(65 + idx),
          wkt: toPolygonWKT(coords),
          plan_area_sqft: segArea / pf,
          pitch,
          area_sqft: segArea
        });
      });
    } else {
      const defaultPitch = '4/12';
      const pf = pitchFactor(defaultPitch);
      faces.push({
        id: 'A',
        wkt: toPolygonWKT(coords),
        plan_area_sqft: plan_sqft,
        pitch: defaultPitch,
        area_sqft: plan_sqft * pf
      });
    }

    const wastePct = 12;
    const totalArea = faces.reduce((s, f) => s + f.area_sqft, 0) * (1 + wastePct / 100);

    return {
      property_id: "",
      source: building.source,
      faces,
      linear_features: topology.features,
      summary: {
        total_area_sqft: totalArea,
        total_squares: totalArea / 100,
        waste_pct: wastePct,
        pitch_method: building.roof_segments ? 'vendor' : 'assumed',
        ...topology.totals,
        roof_age_years: null,
        roof_age_source: 'unknown'
      },
      geom_wkt: unionFacesWKT(faces)
    };
  }

  // Fetch fresh from Google Solar API
  console.log('Fetching fresh data from Google Solar API');
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_PLACES_API_KEY}`;
  
  const resp = await fetch(url);
  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`Google Solar HTTP ${resp.status}: ${error}`);
  }

  const json = await resp.json();
  
  if (!json.boundingBox) {
    throw new Error("No building data from Google Solar");
  }

  // TRY OSM FOOTPRINT FIRST for actual building shape
  // Priority: 1) OSM (real shape) → 2) Google Solar bounding box (rectangle fallback)
  let coords: [number, number][];
  let footprintSource: string;
  let footprintConfidence: number;

  const osmResult = await osmOverpassFootprint(lat, lng).catch(() => null);
  
  if (osmResult && osmResult.plan_sqft > 100) {
    // Use actual OSM building footprint
    coords = wktToCoords(osmResult.faceWKT);
    footprintSource = 'osm';
    footprintConfidence = 0.95;
    console.log(`✓ Using OSM footprint: ${coords.length} vertices, ${Math.round(osmResult.plan_sqft)} sqft`);
  } else {
    // Fallback to Google's bounding box (rectangular)
    coords = boundingBoxToPolygon(json.boundingBox);
    footprintSource = 'google_solar_bbox';
    footprintConfidence = 0.70;
    console.log(`⚠️ Using Google Solar bounding box (rectangular approximation)`);
  }

  // Validate footprint geometry
  const qaResult = validateFootprintGeometry(coords, lat, lng);
  if (!qaResult.isValid) {
    console.error('Footprint QA failed:', qaResult.errors);
    // Don't throw - use the footprint anyway but log warning
    console.warn('Proceeding with potentially problematic footprint');
  }

  const plan_sqft = polygonAreaSqftFromLngLat(coords);
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  
  // Extract roof topology (ridge, hip, valley, eave, rake)
  const topology = buildLinearFeaturesFromTopology(coords, midLat);
  
  // Process roof segments
  const faces: RoofFace[] = [];
  const roofSegments = json.solarPotential?.roofSegmentStats || [];
  
  if (roofSegments.length > 0) {
    roofSegments.forEach((segment: any, idx: number) => {
      const pitchDeg = segment.pitchDegrees || 18.5;
      const pitch = degreesToRoofPitch(pitchDeg);
      const pf = pitchFactor(pitch);
      const segmentArea = segment.stats?.areaMeters2 * 10.7639 || (plan_sqft / roofSegments.length);
      
      faces.push({
        id: String.fromCharCode(65 + idx), // A, B, C...
        wkt: toPolygonWKT(coords),
        plan_area_sqft: segmentArea / pf,
        pitch,
        area_sqft: segmentArea
      });
    });
  } else {
    // No segment data, use building footprint with assumed pitch
    const defaultPitch = '4/12';
    const pf = pitchFactor(defaultPitch);
    faces.push({
      id: 'A',
      wkt: toPolygonWKT(coords),
      plan_area_sqft: plan_sqft,
      pitch: defaultPitch,
      area_sqft: plan_sqft * pf
    });
  }

  const wastePct = 12;
  const totalArea = faces.reduce((s, f) => s + f.area_sqft, 0) * (1 + wastePct / 100);

  // Calculate meters per pixel for frontend transformation
  const metersPerPixelAtEquator = 156543.03392 / Math.pow(2, 20); // zoom 20
  const metersPerPixel = metersPerPixelAtEquator * Math.cos(lat * Math.PI / 180);

  const result: MeasureResult & { 
    buildingFootprint?: any; 
    transformConfig?: any;
    footprintSource?: string;
    footprintConfidence?: number;
  } = {
    property_id: "",
    source: 'google_solar',
    faces,
    linear_features: topology.features,
    summary: {
      total_area_sqft: totalArea,
      total_squares: totalArea / 100,
      waste_pct: wastePct,
      pitch_method: roofSegments.length > 0 ? 'vendor' : 'assumed',
      ...topology.totals,
      roof_age_years: null,
      roof_age_source: 'unknown'
    },
    geom_wkt: unionFacesWKT(faces),
    // NEW: Include actual footprint coordinates for frontend rendering
    buildingFootprint: {
      type: 'Polygon',
      coordinates: [coords.map(c => ({ lng: c[0], lat: c[1] }))],
    },
    footprintSource,
    footprintConfidence,
    // NEW: Include transformation config for accurate geo-to-pixel conversion
    transformConfig: {
      centerLng: lng,
      centerLat: lat,
      zoom: 20,
      metersPerPixel,
    },
  };

  // Cache for future use
  try {
    await supabase.from('building_footprints').insert({
      lat,
      lng,
      geom_geog: `SRID=4326;POLYGON((${coords.map(c => `${c[0]} ${c[1]}`).join(', ')}))`,
      source: 'google_solar',
      building_polygon: {
        type: 'Polygon',
        coordinates: [coords]
      },
      roof_segments: roofSegments.length > 0 ? roofSegments : null,
      imagery_date: json.imageryDate ? new Date(json.imageryDate) : null,
      confidence_score: json.imageryQuality === 'HIGH' ? 0.95 : 0.80
    });
    console.log('Cached building data for future use');
  } catch (cacheError) {
    console.warn('Failed to cache building:', cacheError);
    // Continue even if caching fails
  }

  return result;
}

// --- FREE DEFAULT PROVIDER ---
async function getFootprintFromYourProvider(
  lat: number,
  lng: number,
  address?: any
): Promise<{ faceWKT: string; plan_sqft: number; pitch?: string; waste_pct?: number; source: string }> {
  // 1) OSM / Overpass
  try {
    const osm = await osmOverpassFootprint(lat, lng);
    if (osm) return { ...osm, source: "osm" };
  } catch (_e) {
    // ignore, fall through
  }

  // 2) Open Buildings via FlatGeobuf (optional)
  if (OPENBUILDINGS_FGB_TEMPLATE) {
    try {
      const iso = pickISO(address) || "USA";
      const ob = await openBuildingsFGBFootprint(lat, lng, iso);
      if (ob) return { ...ob, source: "openbuildings" };
    } catch (_e) {
      // ignore, fall through
    }
  }

  // 3) Nothing found
  return { faceWKT: "", plan_sqft: 0, source: "none" };
}

async function osmOverpassFootprint(
  lat: number,
  lng: number
): Promise<{ faceWKT: string; plan_sqft: number } | null> {
  const { dx, dy } = metersToDeg(lat, FOOTPRINT_BUFFER_M);
  const south = lat - dy, west = lng - dx, north = lat + dy, east = lng + dx;
  const bbox = `${south},${west},${north},${east}`;

  const query = `
    [out:json][timeout:25];
    (
      way["building"](${bbox});
      relation["building"](${bbox});
    );
    out body;
    >;
    out skel qt;`;

  const resp = await fetch(OSM_OVERPASS_URL, { method: "POST", body: query });
  if (!resp.ok) throw new Error(`OSM ${resp.status}`);
  const data = await resp.json();

  // index nodes
  const nodes: Record<string, { lat: number; lon: number }> = {};
  for (const e of data.elements) if (e.type === "node") nodes[e.id] = { lat: e.lat, lon: e.lon };

  // collect candidate rings from ways and relations
  const rings: Array<[number, number][]> = [];

  // ways with building tag
  for (const e of data.elements) {
    if (e.type === "way" && e.nodes?.length >= 4 && (e.tags?.building || e.tags?.["building:part"])) {
      const ring = e.nodes.map((id: string) => [nodes[id].lon, nodes[id].lat] as [number, number]);
      if (!isClosed(ring)) ring.push(ring[0]);
      rings.push(ring);
    }
  }

  // relations (multipolygons with role=outer)
  for (const e of data.elements) {
    if (e.type === "relation" && (e.tags?.type === "multipolygon" || e.tags?.type === "building")) {
      const outerWayIds = (e.members || []).filter((m: any) => m.role === "outer" && m.type === "way").map((m: any) => m.ref);
      const wayIndex: Record<string, any> = {};
      for (const w of data.elements) if (w.type === "way") wayIndex[w.id] = w;
      for (const wid of outerWayIds) {
        const w = wayIndex[wid];
        if (w?.nodes?.length >= 4) {
          const ring = w.nodes.map((id: string) => [nodes[id].lon, nodes[id].lat] as [number, number]);
          if (!isClosed(ring)) ring.push(ring[0]);
          rings.push(ring);
        }
      }
    }
  }

  if (!rings.length) return null;

  // choose best ring: prefer one that contains the point; else nearest centroid
  const p: [number, number] = [lng, lat];
  let best: [number, number][] | null = null;
  let bestScore = Infinity;

  for (const r of rings) {
    const contains = pointInPolygon(p, r);
    const d = distanceMetersToCentroid(lat, lng, r);
    const score = contains ? 0 : d;
    if (score < bestScore) { best = r; bestScore = score; }
  }

  if (!best) return null;

  const plan_sqft = polygonAreaSqftFromLngLat(best);
  const faceWKT = polygonWKT(best);
  return { faceWKT, plan_sqft };
}

async function openBuildingsFGBFootprint(
  lat: number,
  lng: number,
  iso: string
): Promise<{ faceWKT: string; plan_sqft: number } | null> {
  try {
    // Dynamic import to avoid boot failure if package isn't available
    const fgb = await import("npm:flatgeobuf@4.3.1/geojson");
    
    const url = OPENBUILDINGS_FGB_TEMPLATE.replace("${ISO}", iso.toUpperCase());
    const { dx, dy } = metersToDeg(lat, FOOTPRINT_BUFFER_M);
    const rect = { minX: lng - dx, minY: lat - dy, maxX: lng + dx, maxY: lat + dy };

    const feats: any[] = [];
    for await (const f of fgb.deserialize(url, rect)) feats.push(f);
    if (!feats.length) return null;

    // choose best polygon ring
    const p: [number, number] = [lng, lat];
    let best: [number, number][] | null = null;
    let bestScore = Infinity;

    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;

      const ring: [number, number][] =
        g.type === "Polygon" ? g.coordinates[0] :
        g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
      if (!ring) continue;

      const r = ring.map((c: number[]) => [c[0], c[1]] as [number, number]);
      if (!isClosed(r)) r.push(r[0]);

      const contains = pointInPolygon(p, r);
      const d = distanceMetersToCentroid(lat, lng, r);
      const score = contains ? 0 : d;
      if (score < bestScore) { best = r; bestScore = score; }
    }

    if (!best) return null;

    const plan_sqft = polygonAreaSqftFromLngLat(best);
    const faceWKT = polygonWKT(best);
    return { faceWKT, plan_sqft };
  } catch (error) {
    console.warn('OpenBuildings FGB not available:', error.message);
    return null;
  }
}

async function providerFreeFootprint(supabase: any, lat: number, lng: number, address?: any) {
  // 1. Get footprint from free provider
  const footprint = await getFootprintFromYourProvider(lat, lng, address);
  
  if (footprint.plan_sqft === 0) {
    throw new Error("No building footprint found");
  }
  
  // 2. Parse WKT to coordinates
  const coords = wktToCoords(footprint.faceWKT);
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  
  // 3. Extract roof topology (ridge/hip/valley/eave/rake)
  const topology = buildLinearFeaturesFromTopology(coords, midLat);
  
  // 4. Build face with assumed pitch
  const defaultPitch = "4/12";
  const wastePct = 12;
  const pf = pitchFactor(defaultPitch);
  const adjusted = footprint.plan_sqft * pf * (1 + wastePct / 100);
  
  const face: RoofFace = {
    id: "A",
    wkt: footprint.faceWKT,
    plan_area_sqft: footprint.plan_sqft,
    pitch: defaultPitch,
    area_sqft: adjusted,
  };
  
  // 5. Return MeasureResult
  const result: MeasureResult = {
    property_id: "",
    source: footprint.source,
    faces: [face],
    linear_features: topology.features,
    summary: {
      total_area_sqft: adjusted,
      total_squares: adjusted / 100,
      waste_pct: wastePct,
      pitch_method: "assumed",
      ...topology.totals,
      roof_age_years: null,
      roof_age_source: "unknown"
    },
    geom_wkt: `MULTIPOLYGON((${footprint.faceWKT.replace(/^POLYGON/, "")}))`
  };
  
  return result;
}

// Provider: OpenStreetMap (sync, global coverage) - LEGACY
async function providerOSM(lat: number, lng: number) {
  if (!OSM_ENABLED) throw new Error("OSM disabled");
  
  const delta = 0.0005;
  const bbox = `${lat-delta},${lng-delta},${lat+delta},${lng+delta}`;
  const query = `
    [out:json][timeout:15];
    (
      way["building"](${bbox});
      relation["building"](${bbox});
    );
    out body;
    >; out skel qt;
  `.trim();

  const resp = await fetch("https://overpass-api.de/api/interpreter", { 
    method: "POST", 
    body: query 
  });
  
  if (!resp.ok) throw new Error(`OSM HTTP ${resp.status}`);
  const data = await resp.json();

  const nodes: Record<string,{lat:number,lon:number}> = {};
  data.elements.filter((e:any) => e.type === 'node').forEach((n:any) => {
    nodes[n.id] = {lat: n.lat, lon: n.lon};
  });
  
  const way = data.elements.find((e:any) => e.type === 'way' && e.nodes?.length > 3);
  if (!way) throw new Error("No OSM building");

  const coords: [number, number][] = way.nodes.map((id:string) => [nodes[id].lon, nodes[id].lat]);
  if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1]) {
    coords.push(coords[0]);
  }

  const plan_sqft = polygonAreaSqftFromLngLat(coords);
  const defaultPitch = '4/12', wastePct = 12;
  const pf = pitchFactor(defaultPitch);
  const adjusted = plan_sqft * pf * (1 + wastePct/100);

  const face: RoofFace = {
    id: "A",
    wkt: toPolygonWKT(coords),
    plan_area_sqft: plan_sqft,
    pitch: defaultPitch,
    area_sqft: adjusted,
  };

  const result: MeasureResult = {
    property_id: "",
    source: 'osm',
    faces: [face],
    summary: {
      total_area_sqft: adjusted,
      total_squares: adjusted / 100,
      waste_pct: wastePct,
      pitch_method: 'assumed'
    },
    geom_wkt: `MULTIPOLYGON((${toPolygonWKT(coords).replace(/^POLYGON/, '')}))`
  };

  return result;
}

// Analysis parameters interface for overlay alignment
interface AnalysisParams {
  lat: number;
  lng: number;
  zoom?: number;
  imageSize?: { width: number; height: number };
}

// Persistence helpers
async function persistMeasurement(
  supabase: any, 
  m: MeasureResult, 
  userId?: string,
  analysisParams?: AnalysisParams
) {
  const { data, error } = await supabase.rpc('insert_measurement', {
    p_property_id: m.property_id,
    p_source: m.source,
    p_faces: m.faces,
    p_linear_features: m.linear_features || [],
    p_summary: m.summary,
    p_created_by: userId || null,
    p_geom_wkt: m.geom_wkt || null,
    // Store analysis parameters for overlay alignment
    p_gps_coordinates: analysisParams ? { lat: analysisParams.lat, lng: analysisParams.lng } : null,
    p_analysis_zoom: analysisParams?.zoom || 20,
    p_analysis_image_size: analysisParams?.imageSize || { width: 640, height: 640 }
  });

  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return data;
}

async function persistFacets(supabase: any, measurementId: string, faces: RoofFace[]) {
  const facetRecords = faces.slice(0, 20).map((face, i) => ({
    measurement_id: measurementId,
    facet_number: i + 1,
    area_sqft: face.area_sqft || 0,
    plan_area_sqft: face.plan_area_sqft || 0,
    pitch: face.pitch || 'unknown',
    pitch_degrees: pitchToDegrees(face.pitch || '4/12'),
    pitch_factor: pitchFactor(face.pitch || '4/12'),
    direction: getDirection(face.azimuth_degrees),
    azimuth_degrees: face.azimuth_degrees,
    is_flat: face.pitch === 'flat',
    geometry_wkt: face.wkt,
  }));

  if (facetRecords.length === 0) return;

  const { error } = await supabase
    .from('roof_facets')
    .insert(facetRecords);

  if (error) console.error('Failed to persist facets:', error.message);
}

async function persistWasteCalculations(supabase: any, measurementId: string, baseAreaSqft: number, baseSquares: number, linearFeatures: any) {
  const wastePercentages = [0, 8, 10, 12, 15, 17, 20];
  const ridgeHipTotal = (linearFeatures['lf.ridge'] || 0) + (linearFeatures['lf.hip'] || 0);
  const eaveRakeTotal = (linearFeatures['lf.eave'] || 0) + (linearFeatures['lf.rake'] || 0);

  const wasteRecords = wastePercentages.map(pct => {
    const wasteArea = baseAreaSqft * (pct / 100);
    const totalArea = baseAreaSqft + wasteArea;
    const wasteSquares = wasteArea / 100;
    const totalSquares = totalArea / 100;

    return {
      measurement_id: measurementId,
      waste_percentage: pct,
      base_area_sqft: baseAreaSqft,
      waste_area_sqft: wasteArea,
      total_area_sqft: totalArea,
      base_squares: baseSquares,
      waste_squares: wasteSquares,
      total_squares: totalSquares,
      shingle_bundles: Math.ceil(totalSquares * 3),
      starter_lf: eaveRakeTotal,
      ridge_cap_bundles: Math.ceil(ridgeHipTotal / 33),
    };
  });

  const { error } = await supabase
    .from('roof_waste_calculations')
    .insert(wasteRecords);

  if (error) console.error('Failed to persist waste calculations:', error.message);
}

async function persistTags(supabase: any, measurementId: string, propertyId: string, tags: Record<string,any>, userId?: string) {
  const { data, error } = await supabase
    .from('measurement_tags')
    .insert({
      measurement_id: measurementId,
      property_id: propertyId,
      tags,
      created_by: userId || null
    })
    .select()
    .single();

  if (error) throw new Error(`Tags insert failed: ${error.message}`);
  return data;
}

// Main router
serve(async (req) => {
  const url = new URL(req.url);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('authorization');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    global: { headers: { Authorization: authHeader || '' } }
  });

  try {
    // Handle body-based routing (for supabase.functions.invoke())
    if (req.method === 'POST') {
      const body = await req.json();
      const { action } = body;
      
      console.log('Measure request:', { action, pathname, body: JSON.stringify(body).substring(0, 200) });

      // Route: action=latest
      if (action === 'latest') {
        const { propertyId } = body;
        if (!propertyId) {
          return json({ ok: false, error: 'propertyId required' }, corsHeaders, 400);
        }
        
        const { data: measurements } = await supabase
          .from('measurements')
          .select('*')
          .eq('property_id', propertyId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1);

        const measurement = measurements?.[0] || null;
        let tags = null;

        if (measurement?.id) {
          const { data: tagRows } = await supabase
            .from('measurement_tags')
            .select('*')
            .eq('measurement_id', measurement.id)
            .order('created_at', { ascending: false })
            .limit(1);
          
          tags = tagRows?.[0]?.tags || null;
          
          // If no tags found in DB, generate them from measurement data
          if (!tags && measurement) {
            tags = buildSmartTags(measurement);
          }
        }

        return json({ ok: true, data: { measurement, tags } }, corsHeaders);
      }

      // Route: action=pull
      if (action === 'pull') {
        const { propertyId, lat, lng, address } = body;

        if (!propertyId) {
          return json({ 
            ok: false, 
            error: 'Missing propertyId',
            details: 'propertyId is required' 
          }, corsHeaders, 400);
        }

        if (!lat || !lng || (lat === 0 && lng === 0)) {
          return json({ 
            ok: false, 
            error: 'Missing coordinates',
            details: 'lat and lng must be provided and non-zero. Verify the property address first.' 
          }, corsHeaders, 400);
        }

        console.log('Pull request:', { propertyId, lat, lng, address });

        // Get user ID
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;

        // Provider chain: Google Solar (primary) → Free Footprint (OSM + Open Buildings fallback)
        let meas: MeasureResult | null = null;
        const tryOrder = [
          async () => await providerGoogleSolar(supabase, lat, lng),
          async () => await providerFreeFootprint(supabase, lat, lng, address),
        ];

        for (const fn of tryOrder) {
          try {
            const r = await fn();
            meas = { ...r, property_id: propertyId };
            console.log(`Provider success: ${meas.source}`);
            break;
          } catch (err) {
            console.log(`Provider failed: ${err}`);
          }
        }

        if (!meas) {
          return json({ 
            ok: false, 
            error: 'No provider available. Please use manual measurements.' 
          }, corsHeaders, 404);
        }

        // Save measurement with analysis coordinates for overlay alignment
        const row = await persistMeasurement(supabase, meas, userId, { lat, lng, zoom: 20 });
        
        // Generate and save Smart Tags
        const tags = buildSmartTags({ ...meas, id: row.id });
        await persistTags(supabase, row.id, propertyId, tags, userId);

        // Persist facets and waste calculations
        await persistFacets(supabase, row.id, meas.faces || []);
        await persistWasteCalculations(supabase, row.id, meas.summary.total_area_sqft, meas.summary.total_squares, tags);

        // Fix: Recalculate and update summary totals from faces (RPC may not persist correctly)
        const totalAreaFromFaces = (meas.faces || []).reduce((sum, f) => sum + (f.area_sqft || 0), 0);
        const wastePct = meas.summary.waste_pct || 10;
        const adjustedTotal = totalAreaFromFaces * (1 + wastePct / 100);
        
        await supabase.from('measurements').update({
          summary: {
            ...meas.summary,
            total_area_sqft: adjustedTotal,
            total_squares: adjustedTotal / 100,
          }
        }).eq('id', row.id);

        console.log('Measurement saved with corrected totals:', { 
          id: row.id, 
          source: meas.source, 
          total_area_sqft: adjustedTotal,
          squares: adjustedTotal / 100 
        });

        // Fetch verified address coordinates from contact record (Google-verified)
        let verifiedLat: number | undefined;
        let verifiedLng: number | undefined;
        
        try {
          const { data: pipelineData } = await supabase
            .from('pipeline_entries')
            .select('contact_id, metadata, contacts(verified_address, latitude, longitude)')
            .eq('id', propertyId)
            .single();
          
          const contact = (pipelineData as any)?.contacts;
          
          if (contact?.verified_address?.lat && contact?.verified_address?.lng) {
            // Priority 1: Google-verified coordinates (most accurate)
            // Round to 7 decimal places to prevent Google Maps API errors
            verifiedLat = Math.round(contact.verified_address.lat * 10000000) / 10000000;
            verifiedLng = Math.round(contact.verified_address.lng * 10000000) / 10000000;
            console.log('✅ Using Google-verified coordinates from contact:', { verifiedLat, verifiedLng });
          } else if (contact?.latitude && contact?.longitude) {
            // Priority 2: Legacy contact coordinates
            verifiedLat = Math.round(contact.latitude * 10000000) / 10000000;
            verifiedLng = Math.round(contact.longitude * 10000000) / 10000000;
            console.log('⚠️ Using legacy contact coordinates:', { verifiedLat, verifiedLng });
          } else {
            // Priority 3: Pipeline metadata (fallback only)
            const metadata = (pipelineData as any)?.metadata;
            if (metadata?.verified_address?.geometry?.location) {
              verifiedLat = Math.round(metadata.verified_address.geometry.location.lat * 10000000) / 10000000;
              verifiedLng = Math.round(metadata.verified_address.geometry.location.lng * 10000000) / 10000000;
              console.log('⚠️ Using pipeline metadata coordinates (fallback):', { verifiedLat, verifiedLng });
            } else if (metadata?.verified_address?.lat && metadata?.verified_address?.lng) {
              verifiedLat = Math.round(metadata.verified_address.lat * 10000000) / 10000000;
              verifiedLng = Math.round(metadata.verified_address.lng * 10000000) / 10000000;
              console.log('⚠️ Using pipeline metadata coordinates (alt format):', { verifiedLat, verifiedLng });
            }
          }
        } catch (error) {
          console.error('❌ Could not fetch verified address:', error);
        }

        // Generate Mapbox visualization (non-blocking)
        try {
          console.log('Generating Mapbox visualization for measurement:', row.id);
          const { data: vizData, error: vizError } = await supabase.functions.invoke('generate-measurement-visualization', {
            body: {
              measurement_id: row.id,
              property_id: propertyId,
              center_lat: lat,
              center_lng: lng,
              verified_address_lat: verifiedLat,
              verified_address_lng: verifiedLng,
            }
          });
          
          if (vizError) {
            console.error('Visualization generation error:', vizError);
          } else if (vizData?.ok) {
            console.log('Visualization generated successfully:', vizData.data?.visualization_url);
          } else {
            console.warn('Visualization returned error:', vizData?.error);
          }
        } catch (vizError) {
          console.error('Visualization generation exception:', vizError);
          // Don't fail the pull request if visualization fails
        }

        return json({ 
          ok: true, 
          data: { measurement: row, tags } 
        }, corsHeaders);
      }

      // Route: action=manual
      if (action === 'manual') {
        const { propertyId, faces, linear_features, waste_pct = 12 } = body;

        if (!propertyId || !faces || faces.length === 0) {
          return json({ ok: false, error: 'propertyId and faces required' }, corsHeaders, 400);
        }

        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;

        const total = faces.reduce((s: number, f: any) => s + (f.area_sqft || 0), 0);
        
        const result: MeasureResult = {
          property_id: propertyId,
          source: 'manual',
          faces,
          linear_features: linear_features || [],
          summary: {
            total_area_sqft: total,
            total_squares: total / 100,
            waste_pct,
            pitch_method: 'manual'
          },
          geom_wkt: unionFacesWKT(faces)
        };

        const row = await persistMeasurement(supabase, result, userId, lat && lng ? { lat, lng, zoom: 20 } : undefined);
        const tags = buildSmartTags({ ...result, id: row.id });
        await persistTags(supabase, row.id, propertyId, tags, userId);

        // Persist facets and waste calculations
        await persistFacets(supabase, row.id, result.faces || []);
        await persistWasteCalculations(supabase, row.id, result.summary.total_area_sqft, result.summary.total_squares, tags);

        // Generate Mapbox visualization (non-blocking)
        try {
          const { data: vizData, error: vizError } = await supabase.functions.invoke('generate-measurement-visualization', {
            body: {
              measurement_id: row.id,
              property_id: propertyId,
              center_lat: lat,
              center_lng: lng,
            }
          });
          
          if (vizError) {
            console.error('Visualization generation error:', vizError);
          } else if (vizData?.ok) {
            console.log('Visualization generation successful:', row.id, vizData.data?.visualization_url);
          } else {
            console.warn('Visualization generation returned error:', vizData?.error);
          }
        } catch (vizError) {
          console.error('Visualization generation exception:', vizError instanceof Error ? vizError.message : String(vizError));
        }

        return json({ 
          ok: true, 
          data: { measurement: row, tags } 
        }, corsHeaders);
      }

      // Route: action=generate-overlay (NEW: Full AI Measurement Agent pipeline)
      if (action === 'generate-overlay') {
        const { propertyId, lat, lng, footprintCoords } = body;

        if (!propertyId) {
          return json({ ok: false, error: 'propertyId required' }, corsHeaders, 400);
        }
        if (!lat || !lng) {
          return json({ ok: false, error: 'lat and lng required' }, corsHeaders, 400);
        }

        console.log('Generate overlay request:', { propertyId, lat, lng, hasFootprint: !!footprintCoords });

        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;

        try {
          // Step 1: Get footprint (from provided coords or fetch from providers)
          let coords: [number, number][] = footprintCoords || [];
          let source = 'provided';
          let googleSolarSegments: any[] = [];

          if (coords.length === 0) {
            // Try Google Solar first for footprint + segments
            if (GOOGLE_PLACES_API_KEY) {
              const solarUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_PLACES_API_KEY}`;
              const resp = await fetch(solarUrl);
              if (resp.ok) {
                const json = await resp.json();
                if (json.boundingBox) {
                  coords = boundingBoxToPolygon(json.boundingBox);
                  source = 'google_solar';
                  googleSolarSegments = json.solarPotential?.roofSegmentStats || [];
                  console.log('Got footprint from Google Solar with', googleSolarSegments.length, 'segments');
                }
              }
            }
            
            // Fallback to OSM if no Google data
            if (coords.length === 0) {
              const osmResult = await osmOverpassFootprint(lat, lng);
              if (osmResult) {
                coords = wktToCoords(osmResult.faceWKT);
                source = 'osm';
              }
            }
          }

          if (coords.length < 4) {
            return json({ 
              ok: false, 
              error: 'Could not determine building footprint',
              manualReviewRecommended: true 
            }, corsHeaders, 404);
          }

          // Step 1.5: FOOTPRINT QA GATE - Validate geometry before processing
          const footprintQA = validateFootprintGeometry(coords, lat, lng);
          console.log('Footprint QA:', {
            valid: footprintQA.isValid,
            planAreaSqft: Math.round(footprintQA.planAreaSqft),
            circularity: footprintQA.circularity.toFixed(2),
            vertices: footprintQA.vertexCount,
            warnings: footprintQA.warnings.length,
            errors: footprintQA.errors.length
          });

          // If footprint QA fails, return error with details
          if (!footprintQA.isValid) {
            return json({ 
              ok: false, 
              error: 'Footprint geometry failed QA validation',
              details: footprintQA.errors.join('; '),
              warnings: footprintQA.warnings,
              footprintQA,
              manualReviewRecommended: true 
            }, corsHeaders, 400);
          }

          // Step 2: Compute straight skeleton for initial geometry
          const skeleton = computeStraightSkeleton(coords);
          const boundaryClass = classifyBoundaryEdges(coords, skeleton);
          console.log('Skeleton computed:', skeleton.length, 'edges');

          // Step 3: Fetch DSM and refine geometry (optional, requires API key)
          let dsmGrid = null;
          let dsmAvailable = false;
          if (GOOGLE_PLACES_API_KEY) {
            try {
              dsmGrid = await fetchDSMFromGoogleSolar(lat, lng, GOOGLE_PLACES_API_KEY);
              dsmAvailable = dsmGrid !== null;
              console.log('DSM available:', dsmAvailable);
            } catch (dsmError) {
              console.warn('DSM fetch failed:', dsmError);
            }
          }

          // Step 4: Refine edges with DSM (if available)
          const dsmAnalysis = analyzeDSM(dsmGrid, skeleton, coords);
          console.log('DSM analysis complete, facet pitches:', dsmAnalysis.facetPitches.size);

          // Step 5: Split footprint into facets
          const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
          const splitResult = splitFootprintIntoFacets(
            coords, 
            skeleton, 
            googleSolarSegments.length > 0 ? googleSolarSegments : undefined
          );
          console.log('Facets split:', splitResult.facets.length, 'quality:', splitResult.splitQuality);

          // Step 6: Build edge arrays for validation
          const edges = {
            ridges: dsmAnalysis.refinedEdges.filter(e => e.type === 'ridge').map(e => ({ start: e.start, end: e.end })),
            hips: dsmAnalysis.refinedEdges.filter(e => e.type === 'hip').map(e => ({ start: e.start, end: e.end })),
            valleys: dsmAnalysis.refinedEdges.filter(e => e.type === 'valley').map(e => ({ start: e.start, end: e.end })),
            eaves: boundaryClass.eaveEdges.map(e => ({ start: e[0], end: e[1] })),
            rakes: boundaryClass.rakeEdges.map(e => ({ start: e[0], end: e[1] })),
          };

          // Step 7: Run QA validation
          const googleSolarTotalArea = googleSolarSegments.reduce((s, seg) => s + (seg.stats?.areaMeters2 || 0) * 10.7639, 0);
          const totalRoofArea = splitResult.facets.reduce((s, f) => s + f.area, 0);
          
          const validationResult = validateMeasurements({
            footprintCoords: coords,
            facets: splitResult.facets.map(f => ({
              polygon: f.polygon,
              area: f.area,
            })),
            edges,
            totals: {
              roofArea: totalRoofArea,
              eaveLength: edges.eaves.reduce((s, e) => s + calculateGeodesicLength(e.start, e.end, midLat), 0),
              rakeLength: edges.rakes.reduce((s, e) => s + calculateGeodesicLength(e.start, e.end, midLat), 0),
            },
            googleSolarTotalArea: googleSolarTotalArea > 0 ? googleSolarTotalArea : undefined,
          });
          console.log('QA validation:', validationResult.overallScore, 'manual review:', validationResult.manualReviewRecommended);

          // Step 8: Transform to output schema
          const internalMeasurement = {
            faces: splitResult.facets.map((f, i) => ({
              id: String.fromCharCode(65 + i),
              wkt: toPolygonWKT(f.polygon),
              plan_area_sqft: f.planArea,
              pitch: degreesToRoofPitch(f.pitch),
              area_sqft: f.area,
              azimuth_degrees: f.azimuth,
            })),
            linear_features: [
              ...edges.ridges.map((e, i) => ({ id: `R${i}`, wkt: `LINESTRING(${e.start[0]} ${e.start[1]}, ${e.end[0]} ${e.end[1]})`, length_ft: calculateGeodesicLength(e.start, e.end, midLat), type: 'ridge' as const })),
              ...edges.hips.map((e, i) => ({ id: `H${i}`, wkt: `LINESTRING(${e.start[0]} ${e.start[1]}, ${e.end[0]} ${e.end[1]})`, length_ft: calculateGeodesicLength(e.start, e.end, midLat), type: 'hip' as const })),
              ...edges.valleys.map((e, i) => ({ id: `V${i}`, wkt: `LINESTRING(${e.start[0]} ${e.start[1]}, ${e.end[0]} ${e.end[1]})`, length_ft: calculateGeodesicLength(e.start, e.end, midLat), type: 'valley' as const })),
              ...edges.eaves.map((e, i) => ({ id: `E${i}`, wkt: `LINESTRING(${e.start[0]} ${e.start[1]}, ${e.end[0]} ${e.end[1]})`, length_ft: calculateGeodesicLength(e.start, e.end, midLat), type: 'eave' as const })),
              ...edges.rakes.map((e, i) => ({ id: `K${i}`, wkt: `LINESTRING(${e.start[0]} ${e.start[1]}, ${e.end[0]} ${e.end[1]})`, length_ft: calculateGeodesicLength(e.start, e.end, midLat), type: 'rake' as const })),
            ],
            summary: {
              total_area_sqft: totalRoofArea,
              total_squares: totalRoofArea / 100,
              waste_pct: 12,
              pitch_method: googleSolarSegments.length > 0 ? 'vendor' : dsmAvailable ? 'dsm' : 'assumed',
            },
          };

          const outputSchema = transformToOutputSchema(
            internalMeasurement,
            validationResult,
            coords
          );

          // Step 9: Persist to database
          const measureResult: MeasureResult = {
            property_id: propertyId,
            source,
            faces: internalMeasurement.faces,
            linear_features: internalMeasurement.linear_features,
            summary: {
              ...internalMeasurement.summary,
              perimeter_ft: outputSchema.totals['lf.eave'] + outputSchema.totals['lf.rake'],
              ridge_ft: outputSchema.totals['lf.ridge'],
              hip_ft: outputSchema.totals['lf.hip'],
              valley_ft: outputSchema.totals['lf.valley'],
              eave_ft: outputSchema.totals['lf.eave'],
              rake_ft: outputSchema.totals['lf.rake'],
            },
            geom_wkt: toPolygonWKT(coords),
          };

          const row = await persistMeasurement(supabase, measureResult, userId, { lat, lng, zoom: 20 });
          const tags = buildSmartTags({ ...measureResult, id: row.id });
          await persistTags(supabase, row.id, propertyId, tags, userId);

          // Persist facets with review flags
          const facetRecords = splitResult.facets.slice(0, 20).map((facet, i) => ({
            measurement_id: row.id,
            facet_number: i + 1,
            area_sqft: facet.area,
            plan_area_sqft: facet.planArea,
            pitch: degreesToRoofPitch(facet.pitch),
            pitch_degrees: facet.pitch,
            pitch_factor: pitchFactor(degreesToRoofPitch(facet.pitch)),
            direction: getDirection(facet.azimuth),
            azimuth_degrees: facet.azimuth,
            is_flat: facet.pitch < 2,
            geometry_wkt: toPolygonWKT(facet.polygon),
            requires_review: facet.requiresReview || false,
            review_reason: facet.reviewReason || null,
            dsm_confidence: dsmAvailable ? 0.85 : null,
          }));

          if (facetRecords.length > 0) {
            await supabase.from('roof_measurement_facets').insert(facetRecords);
          }

          // Update measurement with QA results
          await supabase.from('roof_measurements').update({
            manual_review_recommended: validationResult.manualReviewRecommended,
            quality_checks: validationResult,
            dsm_available: dsmAvailable,
            overlay_schema: outputSchema,
          }).eq('id', row.id);

          console.log('Generate overlay complete:', { 
            id: row.id, 
            facets: splitResult.facets.length,
            manualReview: validationResult.manualReviewRecommended,
            qaScore: validationResult.overallScore
          });

          return json({ 
            ok: true, 
            data: outputSchema 
          }, corsHeaders);

        } catch (err) {
          console.error('Generate overlay error:', err);
          return json({ 
            ok: false, 
            error: err instanceof Error ? err.message : String(err),
            manualReviewRecommended: true
          }, corsHeaders, 500);
        }
      }

      // Route: action=manual-verify
      if (action === 'manual-verify') {
        const { propertyId, measurement: manualMeasurement, tags: manualTags, lat, lng } = body;

        if (!propertyId || !manualMeasurement || !manualTags) {
          return json({ ok: false, error: 'propertyId, measurement, and tags required' }, corsHeaders, 400);
        }

        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;

        // Mark as manually verified with high confidence
        const verifiedMeasurement = {
          ...manualMeasurement,
          property_id: propertyId,
          source: manualMeasurement.source === 'manual' ? 'manual' : `${manualMeasurement.source}_verified`,
          confidence: 0.95,
          manually_verified: true,
          verified_by: userId,
          verified_at: new Date().toISOString()
        };

        // Build unified summary to include new measurement fields
        const unifiedSummary = buildUnifiedSummary(verifiedMeasurement as MeasureResult);
        const verifiedWithSummary = { ...verifiedMeasurement, summary: unifiedSummary };

        // Save to database with analysis coordinates for overlay alignment
        const row = await persistMeasurement(
          supabase, 
          verifiedWithSummary as MeasureResult, 
          userId,
          lat && lng ? { lat, lng, zoom: 20 } : undefined
        );
        
        // Update tags with verified status
        const updatedTags = {
          ...manualTags,
          'meta.manually_verified': true,
          'meta.verified_by': userId,
          'meta.verified_at': new Date().toISOString()
        };
        
        await persistTags(supabase, row.id, propertyId, updatedTags, userId);

        // Persist facets and waste calculations with unified summary fields
        await persistFacets(supabase, row.id, verifiedWithSummary.faces || []);
        await persistWasteCalculations(
          supabase, 
          row.id, 
          unifiedSummary.total_area_flat_sqft || unifiedSummary.total_area_sqft, 
          unifiedSummary.total_squares, 
          updatedTags
        );

        // Generate Mapbox visualization (non-blocking)
        try {
          // Try to extract coordinates from measurement data
          const centerLat = manualMeasurement.center_lat;
          const centerLng = manualMeasurement.center_lng;
          
          if (centerLat && centerLng) {
            const { data: vizData, error: vizError } = await supabase.functions.invoke('generate-measurement-visualization', {
              body: {
                measurement_id: row.id,
                property_id: propertyId,
                center_lat: centerLat,
                center_lng: centerLng,
              }
            });
            
            if (vizError) {
              console.error('Manual verification visualization error:', vizError);
            } else if (vizData?.ok) {
              console.log('Manual verification visualization successful:', row.id, vizData.data?.visualization_url);
            } else {
              console.warn('Manual verification visualization returned error:', vizData?.error);
            }
          } else {
            console.warn('Cannot generate visualization: missing coordinates');
          }
        } catch (vizError) {
          console.error('Manual verification visualization exception:', vizError instanceof Error ? vizError.message : String(vizError));
        }

        console.log('Manual verification saved:', { id: row.id, propertyId, userId });

        return json({ 
          ok: true, 
          data: { measurement: row, tags: updatedTags } 
        }, corsHeaders);
      }

      return json({ ok: false, error: 'Invalid action. Use: latest, pull, manual, or manual-verify' }, corsHeaders, 400);
    }

    // Fallback for GET requests (legacy path-based routing)
    if (req.method === 'GET') {
      const latestMatch = pathname.match(/^\/measure\/([^/]+)\/latest$/);
      if (latestMatch) {
        const propertyId = latestMatch[1];
        
        const { data: measurements } = await supabase
          .from('measurements')
          .select('*')
          .eq('property_id', propertyId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1);

        const measurement = measurements?.[0] || null;
        let tags = null;

        if (measurement?.id) {
          const { data: tagRows } = await supabase
            .from('measurement_tags')
            .select('*')
            .eq('measurement_id', measurement.id)
            .order('created_at', { ascending: false })
            .limit(1);
          
          tags = tagRows?.[0]?.tags || null;
          
          // If no tags found in DB, generate them from measurement data
          if (!tags && measurement) {
            tags = buildSmartTags(measurement);
          }
        }

        return json({ ok: true, data: { measurement, tags } }, corsHeaders);
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });

  } catch (err) {
    console.error('Measure error:', err);
    return json({ 
      ok: false, 
      error: err instanceof Error ? err.message : String(err),
      details: err instanceof Error ? err.stack : undefined
    }, corsHeaders, 400);
  }
});

function json(payload: unknown, headers: Record<string,string>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
