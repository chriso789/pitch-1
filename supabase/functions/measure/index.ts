// Supabase Edge Function: measure
// Production-ready measurement orchestrator with multi-provider support
// Handles: Regrid (sync), OSM (sync), EagleView/Nearmap/HOVER (async ready)
// Generates vendor-agnostic Smart Tags for estimate templates
// NEW: Full AI Measurement Agent pipeline with DSM refinement and QA validation
// Phase 5: Self-evaluation with overlay-evaluator
// Phase 6: Continuous learning with correction-tracker

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { computeStraightSkeleton } from "./straight-skeleton.ts";
import { classifyBoundaryEdges } from "./gable-detector.ts";
import { analyzeDSM, fetchDSMFromGoogleSolar, detectRidgeLinesFromDSM, detectValleyLinesFromDSM } from "./dsm-analyzer.ts";
import { splitFootprintIntoFacets } from "./facet-splitter.ts";
import { validateMeasurements } from "./qa-validator.ts";
import { transformToOutputSchema, type MeasurementOutputSchema } from "./output-schema.ts";
import { analyzeSegmentTopology, topologyToLinearFeatures, topologyToTotals } from "./segment-topology-analyzer.ts";
import { evaluateOverlay, applyCorrections, type EvaluationResult } from "./overlay-evaluator.ts";
import { storeCorrection, getLearnedPatterns, applyLearnedAdjustments, type CorrectionRecord } from "./correction-tracker.ts";
import { calibrateRidgePosition, type RidgeCalibrationResult } from "./ridge-calibrator.ts";

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

// Ensure a WKT geometry is always MULTIPOLYGON format for DB column compatibility
function ensureMultiPolygon(wkt: string | undefined): string | undefined {
  if (!wkt) return undefined;
  // Already MULTIPOLYGON
  if (wkt.toUpperCase().startsWith('MULTIPOLYGON')) {
    return wkt;
  }
  // Convert POLYGON to MULTIPOLYGON
  if (wkt.toUpperCase().startsWith('POLYGON')) {
    // Extract the polygon content (everything after "POLYGON")
    const polygonContent = wkt.replace(/^POLYGON\s*/i, '');
    return `MULTIPOLYGON(${polygonContent})`;
  }
  // Unknown format, return as-is
  return wkt;
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

// Ridge override type for manual calibration from traced lines
interface RidgeOverride {
  start: [number, number]; // [lng, lat]
  end: [number, number];   // [lng, lat]
}

// Convert skeleton edges and boundary edges to LinearFeature array
// IMPROVED: Only use straight-skeleton for simple rectangular buildings
// For L/T/U-shapes, only extract eave/rake edges from skeleton, NOT ridge/hip/valley
// NEW: Accepts ridgeOverride for manual calibration from traced lines
function buildLinearFeaturesFromTopology(
  coords: [number, number][],
  midLat: number,
  skipSkeletonForRidges: boolean = false,
  ridgeOverride?: RidgeOverride
): { features: LinearFeature[]; totals: Record<string, number>; derivedFacetCount: number; isComplexShape: boolean; confidenceWarning?: string } {
  try {
    // Detect building shape complexity
    // RELAXED: Only skip skeleton for VERY complex shapes (>10 vertices AND >2 reflex corners)
    const vertexCount = coords.length;
    const reflexCount = countReflexVertices(coords);
    const isVeryComplex = vertexCount > 10 && reflexCount > 2;
    const isComplexShape = vertexCount > 6 || reflexCount > 0;
    
    if (isComplexShape) {
      console.log(`ℹ️ Complex building shape detected: ${vertexCount} vertices, ${reflexCount} reflex corners`);
      console.log(`   → Attempting skeleton anyway (only skip if >10 vertices AND >2 reflex corners)`);
    }
    
    // ONLY skip for VERY complex shapes - otherwise always try skeleton first
    if (isVeryComplex && skipSkeletonForRidges) {
      console.log(`⚠️ Very complex shape - falling back to perimeter-only`);
      return buildEaveRakeOnlyFromPerimeter(coords, midLat, true);
    }
    
    // Only run full straight skeleton for simple rectangular buildings
    const skeleton = computeStraightSkeleton(coords);
    
    // Pass ridge override to boundary classifier for correct eave/rake classification
    const boundaryClass = classifyBoundaryEdges(coords, skeleton, ridgeOverride);
    
    if (ridgeOverride) {
      console.log(`🎯 Using manual ridge override for topology calculation`);
    }
    
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
    
    // Derive facet count from skeleton topology
    let derivedFacetCount = 4;
    if (hipCount >= 4 && valleyCount === 0) {
      derivedFacetCount = 4;
    } else if (hipCount >= 4 && valleyCount > 0) {
      derivedFacetCount = 4 + (valleyCount * 2);
    } else if (ridgeCount >= 1 && hipCount === 0) {
      derivedFacetCount = 2;
    } else if (ridgeCount >= 2) {
      derivedFacetCount = ridgeCount * 2 + valleyCount * 2;
    }
    derivedFacetCount = Math.max(2, Math.min(20, derivedFacetCount));
    
    console.log('Topology extracted:', { 
      featureCount: features.length,
      skeleton: `${ridgeCount} ridges, ${hipCount} hips, ${valleyCount} valleys`,
      derivedFacetCount,
      totals: Object.entries(totals).map(([k, v]) => `${k}=${Math.round(v)}`).join(', ')
    });
    
    // SANITY CHECK: Ridge should be reasonable relative to building dimensions
    const bounds = getBoundsFromCoords(coords);
    const longestDimFt = Math.max(
      calculateGeodesicLength([bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], midLat),
      calculateGeodesicLength([bounds.minX, bounds.minY], [bounds.minX, bounds.maxY], midLat)
    );
    
    // FIXED: Don't discard valid skeleton data - just add a warning
    // If ridge exceeds 200% of longest dimension, flag it but KEEP the features
    let confidenceWarning: string | undefined;
    if (totals.ridge_ft > longestDimFt * 2) {
      console.warn(`⚠️ SANITY CHECK WARNING: Ridge ${totals.ridge_ft.toFixed(0)}ft >> longest dim ${longestDimFt.toFixed(0)}ft`);
      console.warn(`   → Flagging with confidence warning but KEEPING skeleton features`);
      confidenceWarning = `Ridge length (${Math.round(totals.ridge_ft)}ft) exceeds expected max (${Math.round(longestDimFt)}ft). Manual verification recommended.`;
    }
    
    // Log final feature counts for debugging
    console.log(`✓ Skeleton features preserved: ${features.filter(f => f.type === 'ridge').length} ridges, ${features.filter(f => f.type === 'hip').length} hips, ${features.filter(f => f.type === 'valley').length} valleys`);
    
    return { features, totals, derivedFacetCount, isComplexShape: false, confidenceWarning };
  } catch (error) {
    console.warn('Skeleton extraction failed, falling back to perimeter-only:', error);
    return buildEaveRakeOnlyFromPerimeter(coords, midLat, true);
  }
}

// Helper: Count reflex (concave) vertices in a polygon
function countReflexVertices(coords: [number, number][]): number {
  const n = coords.length;
  let count = 0;
  
  for (let i = 0; i < n; i++) {
    const prev = coords[(i - 1 + n) % n];
    const curr = coords[i];
    const next = coords[(i + 1) % n];
    
    // Cross product to determine convexity
    const ax = prev[0] - curr[0];
    const ay = prev[1] - curr[1];
    const bx = next[0] - curr[0];
    const by = next[1] - curr[1];
    const cross = ax * by - ay * bx;
    
    if (cross < 0) count++; // Reflex in CCW orientation
  }
  
  return count;
}

// Helper: Build only eave/rake features from perimeter (no ridge/hip/valley)
function buildEaveRakeOnlyFromPerimeter(
  coords: [number, number][],
  midLat: number,
  isComplexShape: boolean
): { features: LinearFeature[]; totals: Record<string, number>; derivedFacetCount: number; isComplexShape: boolean } {
  const features: LinearFeature[] = [];
  let featureId = 1;
  let totalPerimeter = 0;
  
  // Simple edge classification: all perimeter edges are either eave or rake
  // Use orientation heuristic: longer edges tend to be eaves, shorter are rakes
  const edges: { start: [number, number]; end: [number, number]; length: number }[] = [];
  
  for (let i = 0; i < coords.length - 1; i++) {
    const start = coords[i];
    const end = coords[i + 1];
    const length = calculateGeodesicLength(start, end, midLat);
    if (length > 2) edges.push({ start, end, length });
  }
  
  // Calculate average edge length
  const avgLength = edges.reduce((s, e) => s + e.length, 0) / edges.length;
  
  let eave_ft = 0;
  let rake_ft = 0;
  
  for (const edge of edges) {
    // Heuristic: edges longer than average are eaves, shorter are rakes
    const type = edge.length >= avgLength * 0.7 ? 'eave' : 'rake';
    
    features.push({
      id: `LF${featureId++}`,
      wkt: `LINESTRING(${edge.start[0]} ${edge.start[1]}, ${edge.end[0]} ${edge.end[1]})`,
      length_ft: edge.length,
      type,
      label: `${type.charAt(0).toUpperCase() + type.slice(1)} ${featureId - 1}`
    });
    
    if (type === 'eave') eave_ft += edge.length;
    else rake_ft += edge.length;
    
    totalPerimeter += edge.length;
  }
  
  console.log(`   Perimeter-only extraction: ${features.length} edges, ${eave_ft.toFixed(0)}ft eave, ${rake_ft.toFixed(0)}ft rake`);
  
  return {
    features,
    totals: {
      perimeter_ft: totalPerimeter,
      ridge_ft: 0, // Will be filled by segment topology
      hip_ft: 0,
      valley_ft: 0,
      eave_ft,
      rake_ft,
    },
    derivedFacetCount: 4,
    isComplexShape,
  };
}

// ============= ENHANCED DEDUPLICATION HELPER =============
// Removes duplicate linear features using multiple strategies:
// 1. Exact endpoint matching (A→B == A→B or B→A)
// 2. Overlap detection (lines parallel within 5° and >50% overlap)
// 3. Midpoint proximity (midpoints within 3m = likely same feature)
function deduplicateLinearFeatures(features: LinearFeature[]): LinearFeature[] {
  const ENDPOINT_EPSILON = 0.00005; // ~5 meters in lat/lng degrees (increased from 1m)
  const MIDPOINT_EPSILON = 0.00003; // ~3 meters for midpoint proximity
  const PARALLEL_ANGLE_THRESHOLD = 0.09; // ~5 degrees in radians
  const OVERLAP_THRESHOLD = 0.5; // 50% overlap required
  
  const parseLineString = (wkt: string): [[number, number], [number, number]] | null => {
    const match = wkt.match(/LINESTRING\(([^)]+)\)/i);
    if (!match) return null;
    
    const coords = match[1].split(',').map((pair: string) => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return [lng, lat] as [number, number];
    });
    
    if (coords.length < 2) return null;
    return [coords[0], coords[coords.length - 1]];
  };
  
  const distance = (p1: [number, number], p2: [number, number]): number => {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    return Math.sqrt(dx * dx + dy * dy);
  };
  
  const midpoint = (p1: [number, number], p2: [number, number]): [number, number] => {
    return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  };
  
  const lineLength = (line: [[number, number], [number, number]]): number => {
    return distance(line[0], line[1]);
  };
  
  const lineAngle = (line: [[number, number], [number, number]]): number => {
    return Math.atan2(line[1][1] - line[0][1], line[1][0] - line[0][0]);
  };
  
  const pointsMatch = (p1: [number, number], p2: [number, number], epsilon: number = ENDPOINT_EPSILON): boolean => {
    return Math.abs(p1[0] - p2[0]) < epsilon && Math.abs(p1[1] - p2[1]) < epsilon;
  };
  
  // Check if two lines match by endpoints (direction-agnostic)
  const endpointsMatch = (
    line1: [[number, number], [number, number]], 
    line2: [[number, number], [number, number]]
  ): boolean => {
    const forwardMatch = pointsMatch(line1[0], line2[0]) && pointsMatch(line1[1], line2[1]);
    const reverseMatch = pointsMatch(line1[0], line2[1]) && pointsMatch(line1[1], line2[0]);
    return forwardMatch || reverseMatch;
  };
  
  // Check if two lines are parallel (within angle threshold)
  const areLinesParallel = (
    line1: [[number, number], [number, number]], 
    line2: [[number, number], [number, number]]
  ): boolean => {
    const angle1 = lineAngle(line1);
    const angle2 = lineAngle(line2);
    let angleDiff = Math.abs(angle1 - angle2);
    // Normalize to [0, PI/2] since lines can point opposite directions
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
    if (angleDiff > Math.PI / 2) angleDiff = Math.PI - angleDiff;
    return angleDiff < PARALLEL_ANGLE_THRESHOLD;
  };
  
  // Calculate overlap ratio between two parallel lines projected onto same axis
  const calculateOverlap = (
    line1: [[number, number], [number, number]], 
    line2: [[number, number], [number, number]]
  ): number => {
    // Project both lines onto the dominant axis
    const len1 = lineLength(line1);
    const len2 = lineLength(line2);
    if (len1 === 0 || len2 === 0) return 0;
    
    // Calculate parametric overlap
    const angle = lineAngle(line1);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    // Project all 4 endpoints onto line1's direction
    const proj1Start = line1[0][0] * cos + line1[0][1] * sin;
    const proj1End = line1[1][0] * cos + line1[1][1] * sin;
    const proj2Start = line2[0][0] * cos + line2[0][1] * sin;
    const proj2End = line2[1][0] * cos + line2[1][1] * sin;
    
    const min1 = Math.min(proj1Start, proj1End);
    const max1 = Math.max(proj1Start, proj1End);
    const min2 = Math.min(proj2Start, proj2End);
    const max2 = Math.max(proj2Start, proj2End);
    
    const overlapStart = Math.max(min1, min2);
    const overlapEnd = Math.min(max1, max2);
    const overlapLength = Math.max(0, overlapEnd - overlapStart);
    
    const shorterLength = Math.min(max1 - min1, max2 - min2);
    return shorterLength > 0 ? overlapLength / shorterLength : 0;
  };
  
  // Check if midpoints are close (likely same feature)
  const midpointsClose = (
    line1: [[number, number], [number, number]], 
    line2: [[number, number], [number, number]]
  ): boolean => {
    const mid1 = midpoint(line1[0], line1[1]);
    const mid2 = midpoint(line2[0], line2[1]);
    return pointsMatch(mid1, mid2, MIDPOINT_EPSILON);
  };
  
  // Comprehensive duplicate check using all three strategies
  const areDuplicates = (
    line1: [[number, number], [number, number]], 
    line2: [[number, number], [number, number]]
  ): { isDupe: boolean; reason: string } => {
    // Strategy 1: Endpoint matching
    if (endpointsMatch(line1, line2)) {
      return { isDupe: true, reason: 'endpoint-match' };
    }
    
    // Strategy 2: Parallel lines with significant overlap
    if (areLinesParallel(line1, line2)) {
      const overlap = calculateOverlap(line1, line2);
      if (overlap >= OVERLAP_THRESHOLD) {
        return { isDupe: true, reason: `parallel-overlap-${(overlap * 100).toFixed(0)}%` };
      }
    }
    
    // Strategy 3: Close midpoints (catch nearly-identical lines with slight endpoint differences)
    if (midpointsClose(line1, line2) && areLinesParallel(line1, line2)) {
      return { isDupe: true, reason: 'midpoint-proximity' };
    }
    
    return { isDupe: false, reason: '' };
  };
  
  const deduplicated: LinearFeature[] = [];
  const usedIndices = new Set<number>();
  
  // Sort by length descending - keep longer lines when deduplicating
  const sortedFeatures = features
    .map((f, idx) => ({ feature: f, originalIdx: idx }))
    .sort((a, b) => b.feature.length_ft - a.feature.length_ft);
  
  for (const { feature, originalIdx } of sortedFeatures) {
    if (usedIndices.has(originalIdx)) continue;
    
    const line1 = parseLineString(feature.wkt);
    if (!line1) {
      deduplicated.push(feature);
      usedIndices.add(originalIdx);
      continue;
    }
    
    // Check against already-kept features
    let isDuplicate = false;
    for (const keptFeature of deduplicated) {
      if (keptFeature.type !== feature.type) continue;
      
      const line2 = parseLineString(keptFeature.wkt);
      if (!line2) continue;
      
      const { isDupe, reason } = areDuplicates(line1, line2);
      if (isDupe) {
        isDuplicate = true;
        console.log(`   🗑️ Duplicate ${feature.type}: ${feature.id} → ${keptFeature.id} (${reason})`);
        break;
      }
    }
    
    if (!isDuplicate) {
      deduplicated.push(feature);
    }
    usedIndices.add(originalIdx);
  }
  
  // Restore original order
  deduplicated.sort((a, b) => {
    const aIdx = features.findIndex(f => f.id === a.id);
    const bIdx = features.findIndex(f => f.id === b.id);
    return aIdx - bIdx;
  });
  
  return deduplicated;
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
    
    // Get footprint bounds for segment topology analysis (minX=lng, minY=lat)
    const footprintBounds = {
      minY: Math.min(...coords.map(c => c[1])),
      maxY: Math.max(...coords.map(c => c[1])),
      minX: Math.min(...coords.map(c => c[0])),
      maxX: Math.max(...coords.map(c => c[0]))
    };
    
    // Use segment topology analyzer if roof_segments available for ridge/hip/valley
    let topologyFeatures: LinearFeature[] = [];
    let topologyTotals: Record<string, number> = {};
    const hasRoofSegments = building.roof_segments && building.roof_segments.length > 0;
    
    if (hasRoofSegments) {
      console.log(`🔍 Analyzing ${building.roof_segments.length} cached roof segments for topology`);
      const segmentTopology = analyzeSegmentTopology(
        building.roof_segments, 
        { lat, lng }, 
        footprintBounds
      );
      topologyFeatures = topologyToLinearFeatures(segmentTopology);
      topologyTotals = topologyToTotals(segmentTopology);
      console.log(`📊 Segment topology results: ridge=${topologyTotals.ridge_ft?.toFixed(0)}ft, hip=${topologyTotals.hip_ft?.toFixed(0)}ft, valley=${topologyTotals.valley_ft?.toFixed(0)}ft`);
    }
    
    // Get eave/rake from perimeter (skip skeleton for ridge/hip/valley if we have segments)
    const skeletonTopology = buildLinearFeaturesFromTopology(coords, midLat, hasRoofSegments);
    
    // Merge: segment topology for ridge/hip/valley + skeleton for eave/rake
    const eaveRakeFeatures = skeletonTopology.features.filter(f => 
      f.type === 'eave' || f.type === 'rake'
    );
    const ridgeHipValleyFeatures = topologyFeatures.filter(f => 
      f.type === 'ridge' || f.type === 'hip' || f.type === 'valley'
    );
    
    // If segment topology didn't produce ridge/hip/valley, fall back to skeleton
    const skeletonRHV = skeletonTopology.features.filter(f => 
      f.type === 'ridge' || f.type === 'hip' || f.type === 'valley'
    );
    const finalRHV = ridgeHipValleyFeatures.length > 0 ? ridgeHipValleyFeatures : skeletonRHV;
    
    const mergedFeatures = [...finalRHV, ...eaveRakeFeatures];
    const mergedTotals = {
      perimeter_ft: skeletonTopology.totals.perimeter_ft,
      eave_ft: skeletonTopology.totals.eave_ft,
      rake_ft: skeletonTopology.totals.rake_ft,
      ridge_ft: topologyTotals.ridge_ft || skeletonTopology.totals.ridge_ft || 0,
      hip_ft: topologyTotals.hip_ft || skeletonTopology.totals.hip_ft || 0,
      valley_ft: topologyTotals.valley_ft || skeletonTopology.totals.valley_ft || 0,
    };
    
    console.log(`📏 Final cached totals: ridge=${mergedTotals.ridge_ft?.toFixed(0)}ft, hip=${mergedTotals.hip_ft?.toFixed(0)}ft, valley=${mergedTotals.valley_ft?.toFixed(0)}ft, eave=${mergedTotals.eave_ft?.toFixed(0)}ft`);
    
    const faces: RoofFace[] = [];
    if (hasRoofSegments) {
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
      linear_features: mergedFeatures,
      summary: {
        total_area_sqft: totalArea,
        total_squares: totalArea / 100,
        waste_pct: wastePct,
        pitch_method: hasRoofSegments ? 'vendor' : 'assumed',
        ...mergedTotals,
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
  
  // Get roof segments from Google Solar
  const roofSegments = json.solarPotential?.roofSegmentStats || [];
  
  // NEW: Use segment topology analyzer for accurate ridge/hip/valley detection
  // This extracts topology from actual segment azimuths instead of straight skeleton
  let topologyFeatures: LinearFeature[] = [];
  let topologyTotals: Record<string, number> = {};
  let derivedFacetCount = roofSegments.length || 4;
  let roofType = 'hip';
  
  // Get footprint bounds for segment topology analyzer
  const footprintBounds = getBoundsFromCoords(coords);
  
  if (roofSegments.length > 0) {
    console.log(`🔍 Analyzing ${roofSegments.length} roof segments for topology`);
    const segmentTopology = analyzeSegmentTopology(roofSegments, { lat, lng }, footprintBounds);
    topologyFeatures = topologyToLinearFeatures(segmentTopology);
    topologyTotals = topologyToTotals(segmentTopology);
    derivedFacetCount = segmentTopology.facetCount;
    roofType = segmentTopology.roofType;
    console.log(`   → ${segmentTopology.ridges.length} ridges, ${segmentTopology.hips.length} hips, ${segmentTopology.valleys.length} valleys (${roofType})`);
  }
  
  // Run skeleton ONLY for eave/rake edges - skip ridge/hip/valley for complex shapes
  // Pass true to skip skeleton ridges since we have segment topology
  const skeletonTopology = buildLinearFeaturesFromTopology(coords, midLat, roofSegments.length > 0);
  
  // Merge: PRIORITIZE segment-derived ridges/hips/valleys + use skeleton-derived eaves/rakes
  const eaveRakeFeatures = skeletonTopology.features.filter(f => f.type === 'eave' || f.type === 'rake');
  
  // Only include segment topology features for ridge/hip/valley (NOT skeleton ones for complex shapes)
  const ridgeHipValleyFeatures = topologyFeatures.filter(f => 
    f.type === 'ridge' || f.type === 'hip' || f.type === 'valley'
  );
  
  const mergedFeatures = [...ridgeHipValleyFeatures, ...eaveRakeFeatures];
  
  // Merge totals - prioritize segment topology for ridge/hip/valley
  const mergedTotals = {
    perimeter_ft: skeletonTopology.totals.perimeter_ft,
    eave_ft: skeletonTopology.totals.eave_ft,
    rake_ft: skeletonTopology.totals.rake_ft,
    // Use segment topology for ridge/hip/valley (more accurate for complex shapes)
    ridge_ft: topologyTotals.ridge_ft || skeletonTopology.totals.ridge_ft || 0,
    hip_ft: topologyTotals.hip_ft || skeletonTopology.totals.hip_ft || 0,
    valley_ft: topologyTotals.valley_ft || skeletonTopology.totals.valley_ft || 0,
  };
  
  console.log(`📊 Final merged totals: ridge=${mergedTotals.ridge_ft?.toFixed(0)}ft, hip=${mergedTotals.hip_ft?.toFixed(0)}ft, valley=${mergedTotals.valley_ft?.toFixed(0)}ft, eave=${mergedTotals.eave_ft?.toFixed(0)}ft, rake=${mergedTotals.rake_ft?.toFixed(0)}ft`);
  
  // Process roof segments into faces
  const faces: RoofFace[] = [];
  
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
    roofType?: string;
    derivedFacetCount?: number;
  } = {
    property_id: "",
    source: 'google_solar',
    faces,
    linear_features: mergedFeatures,
    summary: {
      total_area_sqft: totalArea,
      total_squares: totalArea / 100,
      waste_pct: wastePct,
      pitch_method: roofSegments.length > 0 ? 'vendor' : 'assumed',
      ...mergedTotals,
      roof_age_years: null,
      roof_age_source: 'unknown'
    },
    geom_wkt: unionFacesWKT(faces),
    // Include actual footprint coordinates for frontend rendering
    buildingFootprint: {
      type: 'Polygon',
      coordinates: [coords.map(c => ({ lng: c[0], lat: c[1] }))],
    },
    footprintSource,
    footprintConfidence,
    roofType,
    derivedFacetCount,
    // Include transformation config for accurate geo-to-pixel conversion
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
      
      // Infer action if not provided (backwards compatibility)
      let action = body.action;
      if (!action) {
        if (body.measurement && body.tags) {
          action = 'manual-verify';
        } else if (body.lat && body.lng && body.propertyId) {
          action = 'pull';
        } else if (body.propertyId && !body.lat && !body.lng) {
          action = 'latest';
        }
        if (action) {
          console.log(`Action inferred as '${action}' from body fields`);
        }
      }
      
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
        // Phase 1: Added 'engine' parameter for baseline detection method
        // 'skeleton' = geometric straight-skeleton algorithm (default, fast)
        // 'vision' = AI vision-based detection from satellite imagery (more accurate)
        let { propertyId, lat, lng, address, apply_corrections, training_session_id, engine = 'skeleton' } = body;

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

        // Phase 10: Auto-detect training session if apply_corrections is true but no session provided
        if (apply_corrections && !training_session_id) {
          const { data: trainingSession } = await supabase
            .from('roof_training_sessions')
            .select('id')
            .eq('pipeline_entry_id', propertyId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          
          if (trainingSession?.id) {
            training_session_id = trainingSession.id;
            console.log(`[pull] Auto-detected training session ${training_session_id} for property ${propertyId}`);
          }
        }
        
        // Track which engine was actually used (may fallback)
        let engineUsed = engine;

        console.log('[pull] Request:', { propertyId, lat, lng, address, apply_corrections, training_session_id, engine });

        // Get user ID
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;

        // Load correction factors AND feature injections if apply_corrections is true
        let corrections: Record<string, number> = {};
        let featureInjections: Array<{ type: string; wkt: string; length_ft: number }> = [];
        
        if (apply_corrections) {
          // Get auth user's tenant for filtering
          const { data: { user: authUser } } = await supabase.auth.getUser();
          const tenantId = authUser?.user_metadata?.tenant_id;
          
          if (tenantId) {
            // Build query for regular corrections (multipliers based on deviation)
            let correctionQuery = supabase
              .from('measurement_corrections')
              .select('original_line_type, deviation_ft, is_feature_injection, corrected_line_wkt')
              .eq('tenant_id', tenantId)
              .eq('is_feature_injection', false);
            
            // If training_session_id provided, scope to that session for property-specific corrections
            if (training_session_id) {
              correctionQuery = correctionQuery.eq('training_session_id', training_session_id);
              console.log(`[pull] Scoping corrections to training session: ${training_session_id}`);
            }
            
            const { data: correctionRows } = await correctionQuery.order('created_at', { ascending: false });
            
            if (correctionRows && correctionRows.length > 0) {
              // Calculate multipliers from deviation data (group by type, average deviation)
              const typeDeviations: Record<string, number[]> = {};
              for (const row of correctionRows) {
                const type = row.original_line_type || 'unknown';
                if (!typeDeviations[type]) typeDeviations[type] = [];
                typeDeviations[type].push(row.deviation_ft || 0);
              }
              
              // Simple correction: if average deviation is X%, apply inverse
              for (const [type, devs] of Object.entries(typeDeviations)) {
                const avgDev = devs.reduce((a, b) => a + b, 0) / devs.length;
                // If avg deviation is 10ft on a 100ft line, apply 1.1 multiplier
                corrections[type] = avgDev > 0 ? 1 + (avgDev / 100) : 1;
              }
              console.log('[pull] Applying corrections from training:', corrections);
            }
            
            // Build query for feature injections (user-traced geometry when AI produced nothing)
            let injectionQuery = supabase
              .from('measurement_corrections')
              .select('original_line_type, corrected_line_wkt, deviation_ft')
              .eq('tenant_id', tenantId)
              .eq('is_feature_injection', true);
            
            // Scope to training session if provided
            if (training_session_id) {
              injectionQuery = injectionQuery.eq('training_session_id', training_session_id);
            }
            
            const { data: injectionRows } = await injectionQuery.order('created_at', { ascending: false });
            
            if (injectionRows && injectionRows.length > 0) {
              console.log(`[pull] Found ${injectionRows.length} feature injections to apply`);
              
              for (const injection of injectionRows) {
                if (injection.corrected_line_wkt) {
                  // Calculate length from WKT
                  const lengthFt = injection.deviation_ft || 0; // deviation_ft stores the traced length for injections
                  featureInjections.push({
                    type: injection.original_line_type || 'unknown',
                    wkt: injection.corrected_line_wkt,
                    length_ft: lengthFt
                  });
                }
              }
              console.log('[pull] Feature injections loaded:', featureInjections.map(f => `${f.type}: ${f.length_ft}ft`));
            }
          }
        }

        // ============= ENGINE SELECTION (Phase 1) =============
        // Vision engine: Uses AI-based detection from satellite imagery (more accurate for complex roofs)
        // Skeleton engine: Uses geometric straight-skeleton algorithm (default, fast, works offline)
        
        let meas: MeasureResult | null = null;
        
        if (engine === 'vision') {
          console.log('[pull] 🔭 Using VISION engine (AI-based detection from satellite imagery)');
          
          try {
            // Call the vision-based overlay generator
            const { data: overlayData, error: overlayError } = await supabase.functions.invoke('generate-roof-overlay', {
              body: { lat, lng, address }
            });
            
            if (overlayError) {
              console.error('[pull] Vision engine failed:', overlayError);
              console.log('[pull] Falling back to skeleton engine');
              engineUsed = 'skeleton';
            } else if (overlayData?.success && overlayData?.data) {
              const overlay = overlayData.data;
              console.log(`[pull] Vision engine success: ${overlay.ridges?.length || 0} ridges, ${overlay.hips?.length || 0} hips, ${overlay.valleys?.length || 0} valleys`);
              
              // Convert vision overlay to MeasureResult format
              meas = convertVisionOverlayToMeasureResult(overlay, propertyId, lat, lng);
              
              if (meas) {
                console.log('[pull] Vision-based measurement ready:', {
                  ridge_ft: meas.summary?.ridge_ft || 0,
                  hip_ft: meas.summary?.hip_ft || 0,
                  valley_ft: meas.summary?.valley_ft || 0,
                  linear_features: meas.linear_features?.length || 0,
                  source: meas.source
                });
              }
            } else {
              console.log('[pull] Vision engine returned no data, falling back to skeleton');
              engineUsed = 'skeleton';
            }
          } catch (visionErr) {
            console.error('[pull] Vision engine exception:', visionErr);
            engineUsed = 'skeleton';
          }
        }
        
        // Skeleton engine (default or fallback from vision failure)
        if (!meas) {
          console.log('[pull] 📐 Using SKELETON engine (geometric detection)');
          engineUsed = 'skeleton';
          
          // Provider chain: Google Solar (primary) → Free Footprint (OSM + Open Buildings fallback)
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
        }

        if (!meas) {
          return json({ 
            ok: false, 
            error: 'No provider available. Please use manual measurements.',
            engineAttempted: engine,
            engineUsed: engineUsed
          }, corsHeaders, 404);
        }
        
        // Add engine info to measurement source
        meas.source = `${meas.source}_${engineUsed}`;

        // ============= AI LEARNING PIPELINE =============
        // When training_session_id is provided, LEARN from user traces (not copy them)
        // Phase 1: Compare AI features vs user traces
        // Phase 2: Store corrections for pattern learning  
        // Phase 3: Adjust AI lines toward user traces (not replace)
        // Phase 4: Inject missing features that AI failed to detect
        let trainingOverrideApplied = false;
        let originalMeasBeforeOverride: typeof meas | null = null;
        let learningMetrics: {
          evaluationScore: number;
          correctionsStored: number;
          featuresAdjusted: number;
          featuresInjected: number;
          deviations: Array<{ type: string; deviationFt: number }>;
        } | null = null;
        
        if (apply_corrections && training_session_id && meas) {
          console.log(`🎓 AI LEARNING PIPELINE: Processing session ${training_session_id}`);
          
          // CRITICAL: Deep clone the original AI measurement BEFORE any modifications
          originalMeasBeforeOverride = JSON.parse(JSON.stringify(meas));
          
          try {
            // Load all training traces for this session
            const { data: trainingTraces, error: tracesError } = await supabase
              .from('roof_training_traces')
              .select('id, trace_type, length_ft, wkt_geometry')
              .eq('session_id', training_session_id)
              .not('wkt_geometry', 'is', null);
            
            if (tracesError) {
              console.error('Failed to load training traces:', tracesError);
            } else if (trainingTraces && trainingTraces.length > 0) {
              console.log(`📐 Found ${trainingTraces.length} training traces for learning`);
              
              // ============= PHASE 1: COMPARE AI VS USER TRACES =============
              // Convert AI features and user traces to evaluator format
              const aiFeatures = (meas.linear_features || []).map((f: LinearFeature, idx: number) => ({
                id: f.id || `ai-${idx}`,
                wkt: f.wkt,
                length_ft: f.length_ft,
                type: f.type as 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'perimeter',
                source: 'ai_vision' as const,
                confidence: 0.7
              }));
              
              type XY = [number, number];
              const userTraces: Array<{
                type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'perimeter';
                points: XY[];
                length_ft: number;
              }> = [];
              
              for (const trace of trainingTraces) {
                if (!trace.wkt_geometry || !trace.trace_type) continue;
                
                // Parse WKT to points
                const match = trace.wkt_geometry.match(/LINESTRING\(([^)]+)\)/i);
                if (!match) continue;
                
                const points: XY[] = match[1].split(',').map((pair: string) => {
                  const [lng, lat] = pair.trim().split(' ').map(Number);
                  return [lng, lat] as XY;
                });
                
                // FIXED: Keep perimeter as perimeter, don't convert to eave (causes doubling)
                // Only include roof feature types in learning pipeline
                const traceType = trace.trace_type?.toLowerCase() || 'unknown';
                if (traceType === 'perimeter') {
                  // Skip perimeter traces - they're not edge features for learning
                  continue;
                }
                
                userTraces.push({
                  type: traceType as 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'perimeter',
                  points,
                  length_ft: trace.length_ft || 0
                });
              }
              
              // Get footprint coords for evaluation context
              const footprintCoords: XY[] = meas.geom_wkt ? wktToCoords(meas.geom_wkt) as XY[] : [];
              
              // Run evaluation to get deviations
              const evaluation = evaluateOverlay(aiFeatures, userTraces, footprintCoords);
              console.log(`📊 Evaluation: ${evaluation.overallScore}% accuracy, ${evaluation.autoCorrections.length} corrections needed, ${evaluation.missingFeatures.length} missing types`);
              
              // ============= PHASE 2: STORE CORRECTIONS FOR LEARNING =============
              let correctionsStored = 0;
              const tenantIdForCorrections = tenantId || 'default';
              
              for (const correction of evaluation.autoCorrections) {
                // Find original feature type
                const originalFeature = aiFeatures.find(f => f.id === correction.originalId);
                const featureType = originalFeature?.type || 'ridge';
                const originalLength = originalFeature?.length_ft || 1;
                const isInjection = !correction.originalWkt || correction.originalWkt.trim() === '';
                
                const correctionRecord: CorrectionRecord = {
                  tenantId: tenantIdForCorrections,
                  originalLineWkt: correction.originalWkt || '',
                  originalLineType: featureType,
                  correctedLineWkt: correction.correctedWkt,
                  deviationFt: correction.deviationFt,
                  deviationPct: originalLength > 0 ? (correction.deviationFt / originalLength) * 100 : 100,
                  correctionSource: 'user_trace',
                  trainingSessionId: training_session_id,
                  propertyId: property_id,
                  isFeatureInjection: isInjection,
                  lat,
                  lng,
                };
                
                const result = await storeCorrection(supabase, correctionRecord);
                if (result.success) {
                  correctionsStored++;
                  console.log(`   ✓ Stored ${isInjection ? 'injection' : 'correction'} for ${featureType}: ${correction.deviationFt.toFixed(1)}ft deviation`);
                }
              }
              
              // ============= PHASE 3: FILTER + ADJUST AI LINES =============
              // CRITICAL: Only keep AI lines that have a matching user trace
              // Remove any AI lines the user did NOT trace (false positives)
              const blendFactor = 0.8; // 80% toward user position (learning, not copying)
              let featuresAdjusted = 0;
              let featuresRemoved = 0;
              
              // Build set of matched AI feature IDs from corrections
              const matchedAiIds = new Set<string>();
              for (const correction of evaluation.autoCorrections) {
                if (correction.originalId && correction.originalWkt) {
                  matchedAiIds.add(correction.originalId);
                }
              }
              
              console.log(`📊 AI features: ${(meas.linear_features || []).length}, Matched by user traces: ${matchedAiIds.size}`);
              
              // First, FILTER: only keep AI features that have matching user traces
              const adjustedFeatures: LinearFeature[] = [];
              
              for (let idx = 0; idx < (meas.linear_features || []).length; idx++) {
                const ai = (meas.linear_features as LinearFeature[])[idx];
                const aiId = ai.id || `ai-${idx}`;
                
                // Find matching correction for this AI feature
                const correction = evaluation.autoCorrections.find(c => 
                  c.originalId === aiId && c.originalWkt && c.correctedWkt
                );
                
                if (!correction) {
                  // NO matching user trace - REMOVE this AI feature
                  console.log(`   ✖ Removing unmatched AI ${ai.type}: ${ai.length_ft.toFixed(0)}ft (no user trace)`);
                  featuresRemoved++;
                  continue; // Skip this feature - don't add to adjustedFeatures
                }
                
                // Has matching trace - ADJUST toward user position
                // Parse AI coords
                const aiMatch = ai.wkt.match(/LINESTRING\(([^)]+)\)/i);
                if (!aiMatch) {
                  adjustedFeatures.push(ai);
                  continue;
                }
                
                type XY = [number, number];
                const aiCoords: XY[] = aiMatch[1].split(',').map((p: string) => {
                  const [lng, lat] = p.trim().split(' ').map(Number);
                  return [lng, lat] as XY;
                });
                
                // Parse user correction coords
                const userMatch = correction.correctedWkt.match(/LINESTRING\(([^)]+)\)/i);
                if (!userMatch) {
                  adjustedFeatures.push(ai);
                  continue;
                }
                
                const userCoords: XY[] = userMatch[1].split(',').map((p: string) => {
                  const [lng, lat] = p.trim().split(' ').map(Number);
                  return [lng, lat] as XY;
                });
                
                if (aiCoords.length < 2 || userCoords.length < 2) {
                  adjustedFeatures.push(ai);
                  continue;
                }
                
                // BLEND AI toward user (not replace)
                const aiStart = aiCoords[0];
                const aiEnd = aiCoords[aiCoords.length - 1];
                const userStart = userCoords[0];
                const userEnd = userCoords[userCoords.length - 1];
                
                const adjustedStart: XY = [
                  aiStart[0] + (userStart[0] - aiStart[0]) * blendFactor,
                  aiStart[1] + (userStart[1] - aiStart[1]) * blendFactor
                ];
                const adjustedEnd: XY = [
                  aiEnd[0] + (userEnd[0] - aiEnd[0]) * blendFactor,
                  aiEnd[1] + (userEnd[1] - aiEnd[1]) * blendFactor
                ];
                
                // Calculate new length
                const { metersPerDegLat, metersPerDegLng } = degToMeters((adjustedStart[1] + adjustedEnd[1]) / 2);
                const dx = (adjustedEnd[0] - adjustedStart[0]) * metersPerDegLng;
                const dy = (adjustedEnd[1] - adjustedStart[1]) * metersPerDegLat;
                const newLengthFt = Math.sqrt(dx * dx + dy * dy) * 3.28084;
                
                featuresAdjusted++;
                console.log(`   ↔ Adjusted ${ai.type} ${aiId}: ${ai.length_ft.toFixed(0)}ft → ${newLengthFt.toFixed(0)}ft`);
                
                adjustedFeatures.push({
                  ...ai,
                  wkt: `LINESTRING(${adjustedStart[0]} ${adjustedStart[1]}, ${adjustedEnd[0]} ${adjustedEnd[1]})`,
                  length_ft: newLengthFt,
                  label: `${ai.type} (AI adjusted)`
                });
              }
              
              console.log(`📊 Filtering complete: Removed ${featuresRemoved} unmatched, Adjusted ${featuresAdjusted}, Kept ${adjustedFeatures.length}`);
              
              // ============= PHASE 4: INJECT MISSING FEATURES (ONLY WHEN AI HAD ZERO) =============
              // FIXED: Only inject when AI detected 0 of a type AND user traced some
              // Do NOT inject if AI already has features of that type (prevents doubling)
              let featuresInjected = 0;
              
              // Count how many of each type are already in adjustedFeatures
              const existingTypeCounts: Record<string, number> = {};
              for (const f of adjustedFeatures) {
                existingTypeCounts[f.type] = (existingTypeCounts[f.type] || 0) + 1;
              }
              
              for (const missing of evaluation.missingFeatures) {
                if (missing.count <= 0) continue;
                
                // CRITICAL FIX: Only inject if AI has ZERO of this type
                const existingCount = existingTypeCounts[missing.type] || 0;
                if (existingCount > 0) {
                  console.log(`   ⊘ Skipping ${missing.type} injection: AI already has ${existingCount} features`);
                  continue;
                }
                
                // Get user traces for this type
                const userTracesOfType = userTraces.filter(t => t.type === missing.type);
                
                for (const trace of userTracesOfType) {
                  if (!trace.points || trace.points.length < 2) continue;
                  
                  const traceWkt = `LINESTRING(${trace.points.map(p => `${p[0]} ${p[1]}`).join(', ')})`;
                  
                  adjustedFeatures.push({
                    id: `injected-${missing.type}-${featuresInjected}`,
                    wkt: traceWkt,
                    length_ft: trace.length_ft,
                    type: missing.type as EdgeFeatureType,
                    label: `${missing.type} (AI learned)`
                  });
                  
                  featuresInjected++;
                  console.log(`   + Injected ${missing.type}: ${trace.length_ft.toFixed(0)}ft (AI had 0)`);
                }
              }
              
              // ============= DEDUPLICATION STEP =============
              // Remove duplicate line segments (same type + matching endpoints within tolerance)
              const deduplicatedFeatures = deduplicateLinearFeatures(adjustedFeatures);
              const removedDupes = adjustedFeatures.length - deduplicatedFeatures.length;
              if (removedDupes > 0) {
                console.log(`🧹 Removed ${removedDupes} duplicate features`);
              }
              
              // Apply deduplicated features to measurement
              meas.linear_features = deduplicatedFeatures;
              console.log(`🎓 Final result: ${deduplicatedFeatures.length} features (was ${(originalMeasBeforeOverride?.linear_features || []).length})`);
              
              // Recalculate summary totals from deduplicated features
              const newTotals: Record<string, number> = {
                ridge_ft: 0, hip_ft: 0, valley_ft: 0, eave_ft: 0, rake_ft: 0, perimeter_ft: 0
              };
              
              for (const f of deduplicatedFeatures) {
                const key = `${f.type}_ft`;
                if (key in newTotals) {
                  newTotals[key] += f.length_ft;
                }
              }
              newTotals.perimeter_ft = newTotals.eave_ft + newTotals.rake_ft;
              
              // Update summary
              if (meas.summary) {
                const oldSummary = { ...meas.summary };
                meas.summary.ridge_ft = newTotals.ridge_ft;
                meas.summary.hip_ft = newTotals.hip_ft;
                meas.summary.valley_ft = newTotals.valley_ft;
                meas.summary.eave_ft = newTotals.eave_ft;
                meas.summary.rake_ft = newTotals.rake_ft;
                meas.summary.perimeter_ft = newTotals.perimeter_ft;
                
                console.log('📊 AI LEARNING RESULTS:');
                console.log(`   Evaluation score: ${evaluation.overallScore}%`);
                console.log(`   Corrections stored: ${correctionsStored}`);
                console.log(`   Features adjusted: ${featuresAdjusted}`);
                console.log(`   Features injected: ${featuresInjected}`);
                console.log(`   Duplicates removed: ${removedDupes}`);
                console.log(`   Ridge: ${oldSummary.ridge_ft?.toFixed(0) || 0} → ${newTotals.ridge_ft.toFixed(0)} ft`);
                console.log(`   Hip: ${oldSummary.hip_ft?.toFixed(0) || 0} → ${newTotals.hip_ft.toFixed(0)} ft`);
                console.log(`   Valley: ${oldSummary.valley_ft?.toFixed(0) || 0} → ${newTotals.valley_ft.toFixed(0)} ft`);
              }
              
              // Store learning metrics for response
              learningMetrics = {
                evaluationScore: evaluation.overallScore,
                correctionsStored,
                featuresAdjusted,
                featuresInjected,
                deviations: evaluation.deviations.map(d => ({ type: d.featureType, deviationFt: d.avgDeviationFt }))
              };
              
              // Mark source as AI learned (not training override/copy)
              meas.source = `${meas.source.replace(/_corrected|_injected|_training_override/g, '')}_ai_learned`;
              trainingOverrideApplied = true;
              
              console.log('✅ AI Learning complete - features adjusted, NOT copied');
            } else {
              console.log('⚠️ No training traces found for session - falling back to corrections');
            }
          } catch (err) {
            console.error('AI Learning pipeline failed:', err);
          }
        }
        
        // Apply multiplier corrections only if training truth was NOT applied
        if (apply_corrections && !trainingOverrideApplied && Object.keys(corrections).length > 0) {
          // Log pre-correction state for debugging
          console.log('Pre-correction linear features:', {
            ridge: meas.summary?.ridge_ft,
            hip: meas.summary?.hip_ft,
            valley: meas.summary?.valley_ft,
            linear_features_count: meas.linear_features?.length || 0
          });
          
          // FIXED: Only apply corrections if we have actual values to correct
          if (meas.linear_features && meas.linear_features.length > 0) {
            meas.linear_features = meas.linear_features.map(lf => ({
              ...lf,
              length_ft: lf.length_ft * (corrections[lf.type] || 1)
            }));
          }
          
          if (meas.summary) {
            // FIXED: Warn if values are 0 - indicates upstream problem
            if ((meas.summary.ridge_ft || 0) === 0 && (meas.summary.hip_ft || 0) === 0) {
              console.warn('⚠️ CORRECTION WARNING: Ridge and hip are 0 - skeleton may have been discarded upstream');
            }
            
            meas.summary.ridge_ft = (meas.summary.ridge_ft || 0) * (corrections['ridge'] || 1);
            meas.summary.hip_ft = (meas.summary.hip_ft || 0) * (corrections['hip'] || 1);
            meas.summary.valley_ft = (meas.summary.valley_ft || 0) * (corrections['valley'] || 1);
            meas.summary.eave_ft = (meas.summary.eave_ft || 0) * (corrections['eave'] || 1);
            meas.summary.rake_ft = (meas.summary.rake_ft || 0) * (corrections['rake'] || 1);
          }
          
          meas.source = `${meas.source}_corrected`;
          console.log('Post-correction linear features:', {
            ridge: meas.summary?.ridge_ft,
            hip: meas.summary?.hip_ft,
            valley: meas.summary?.valley_ft
          });
        }
        
        // FEATURE INJECTION: Apply user-traced geometry when AI produced nothing
        // SKIP if training override was already applied (it already uses user traces)
        if (apply_corrections && !trainingOverrideApplied && featureInjections.length > 0 && meas.summary) {
          console.log('Applying feature injections...');
          
          // Group injections by type
          const injectionsByType: Record<string, typeof featureInjections> = {};
          for (const inj of featureInjections) {
            if (!injectionsByType[inj.type]) injectionsByType[inj.type] = [];
            injectionsByType[inj.type].push(inj);
          }
          
          // For each feature type, if AI produced 0, inject stored user traces
          const featureTypeMap: Record<string, keyof typeof meas.summary> = {
            'ridge': 'ridge_ft',
            'hip': 'hip_ft',
            'valley': 'valley_ft',
            'eave': 'eave_ft',
            'rake': 'rake_ft'
          };
          
          for (const [type, injections] of Object.entries(injectionsByType)) {
            const summaryKey = featureTypeMap[type];
            if (!summaryKey) continue;
            
            const currentValue = (meas.summary as any)[summaryKey] || 0;
            
            // Only inject if AI produced 0 for this feature type
            if (currentValue === 0) {
              let totalInjectedLength = 0;
              
              for (const injection of injections) {
                // Add to linear_features array
                if (!meas.linear_features) meas.linear_features = [];
                meas.linear_features.push({
                  id: `injected-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  type: type as any,
                  wkt: injection.wkt,
                  length_ft: injection.length_ft,
                  source: 'training_injection',
                  confidence: 0.95 // High confidence - user traced
                });
                
                totalInjectedLength += injection.length_ft;
              }
              
              // Update summary
              (meas.summary as any)[summaryKey] = totalInjectedLength;
              console.log(`✅ INJECTED ${injections.length} ${type}(s) totaling ${totalInjectedLength.toFixed(1)}ft (AI had 0)`);
            } else {
              console.log(`Skipping ${type} injection - AI already has ${currentValue}ft`);
            }
          }
          
          // Mark source as having injections
          if (!meas.source.includes('_injected')) {
            meas.source = `${meas.source}_injected`;
          }
          
          console.log('Post-injection summary:', {
            ridge: meas.summary.ridge_ft,
            hip: meas.summary.hip_ft,
            valley: meas.summary.valley_ft,
            eave: meas.summary.eave_ft,
            rake: meas.summary.rake_ft
          });
        }

        // ============= SAVE MEASUREMENTS =============
        // When training override was applied, we save TWO measurements:
        // 1. Original AI measurement (preserved for comparison)
        // 2. Corrected measurement (with user traces applied)
        
        let originalMeasurementRow: any = null;
        let correctedMeasurementRow: any = null;
        
        if (trainingOverrideApplied && originalMeasBeforeOverride) {
          // STEP 1: Save the ORIGINAL AI measurement first (untouched)
          console.log('📊 Saving ORIGINAL AI measurement (before training override)...');
          originalMeasurementRow = await persistMeasurement(supabase, originalMeasBeforeOverride, userId, { lat, lng, zoom: 20 });
          
          // Generate tags for original
          const originalTags = buildSmartTags({ ...originalMeasBeforeOverride, id: originalMeasurementRow.id });
          await persistTags(supabase, originalMeasurementRow.id, propertyId, originalTags, userId);
          await persistFacets(supabase, originalMeasurementRow.id, originalMeasBeforeOverride.faces || []);
          
          console.log(`✅ Original AI measurement saved: ${originalMeasurementRow.id}`);
          
          // STEP 2: Save the CORRECTED measurement (with training truth)
          console.log('📊 Saving CORRECTED measurement (with training override)...');
          correctedMeasurementRow = await persistMeasurement(supabase, meas, userId, { lat, lng, zoom: 20 });
          
          // Generate tags for corrected
          const correctedTags = buildSmartTags({ ...meas, id: correctedMeasurementRow.id });
          await persistTags(supabase, correctedMeasurementRow.id, propertyId, correctedTags, userId);
          await persistFacets(supabase, correctedMeasurementRow.id, meas.faces || []);
          await persistWasteCalculations(supabase, correctedMeasurementRow.id, meas.summary.total_area_sqft, meas.summary.total_squares, correctedTags);
          
          console.log(`✅ Corrected measurement saved: ${correctedMeasurementRow.id}`);
          
          // Update training session with BOTH measurement IDs
          if (training_session_id) {
            const { error: sessionUpdateError } = await supabase
              .from('roof_training_sessions')
              .update({
                original_ai_measurement_id: originalMeasurementRow.id,
                corrected_ai_measurement_id: correctedMeasurementRow.id,
                // Keep ai_measurement_id pointing to original for backwards compatibility
                ai_measurement_id: originalMeasurementRow.id
              } as any)
              .eq('id', training_session_id);
            
            if (sessionUpdateError) {
              console.error('Failed to update training session with measurement IDs:', sessionUpdateError);
            } else {
              console.log(`✅ Training session ${training_session_id} updated with both measurement IDs`);
            }
          }
          
          // Return the CORRECTED measurement as the primary result (for backwards compatibility)
          // But include original_measurement_id for frontend to use
          return json({ 
            ok: true, 
            data: { 
              measurement: correctedMeasurementRow, 
              original_measurement_id: originalMeasurementRow.id,
              corrected_measurement_id: correctedMeasurementRow.id,
              tags: correctedTags 
            } 
          }, corsHeaders);
        }
        
        // Standard flow (no training override) - save measurement normally
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
          data: { measurement: row, tags, engine_used: engineUsed } 
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
            geom_wkt: ensureMultiPolygon(toPolygonWKT(coords)),
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

      // Route: action=evaluate-overlay (Phase 1: Compare AI features vs user traces)
      if (action === 'evaluate-overlay') {
        const { aiFeatures, userTraces, sessionId } = body;

        if (!aiFeatures || !userTraces) {
          return json({ ok: false, error: 'aiFeatures and userTraces required' }, corsHeaders, 400);
        }

        console.log('Evaluate overlay:', { aiCount: aiFeatures.length, traceCount: userTraces.length });

        try {
          // Parse user traces - they come as WKT from the frontend, convert to points for evaluator
          const parsedUserTraces = (userTraces as any[]).map((trace: any) => {
            // If trace already has points, use them
            if (trace.points && Array.isArray(trace.points)) {
              return trace;
            }
            // If trace has WKT, parse it to points
            if (trace.wkt && typeof trace.wkt === 'string') {
              const match = trace.wkt.match(/LINESTRING\(([^)]+)\)/i);
              if (match) {
                const points = match[1].split(',').map((pair: string) => {
                  const [lng, lat] = pair.trim().split(' ').map(Number);
                  return [lng, lat] as [number, number];
                });
                return {
                  type: trace.type || 'unknown',
                  points,
                  length_ft: trace.length_ft || 0,
                  id: trace.id,
                };
              }
            }
            // Fallback - return trace as-is with empty points
            return {
              type: trace.type || 'unknown',
              points: [],
              length_ft: trace.length_ft || 0,
              id: trace.id,
            };
          }).filter((t: any) => t.points && t.points.length >= 2);

          // Use empty footprint since we don't have it for this evaluation
          const result = evaluateOverlay(aiFeatures, parsedUserTraces, []);
          
          // Map missingFeatures/extraFeatures to unmatchedAiLines/unmatchedTraces for the UI
          // missingFeatures = features user traced but AI missed → these are "unmatched traces"
          // extraFeatures = features AI detected but user didn't trace → these are "unmatched AI lines"
          const unmatchedAiLines: string[] = [];
          const unmatchedTraces: string[] = [];

          // Populate unmatched AI lines from extraFeatures
          if (Array.isArray(result.extraFeatures)) {
            for (const extra of result.extraFeatures) {
              for (let i = 0; i < extra.count; i++) {
                unmatchedAiLines.push(`${extra.type}-${i + 1}`);
              }
            }
          }

          // Populate unmatched traces from missingFeatures
          if (Array.isArray(result.missingFeatures)) {
            for (const missing of result.missingFeatures) {
              for (let i = 0; i < missing.count; i++) {
                unmatchedTraces.push(`${missing.type}-${i + 1}`);
              }
            }
          }

          // Create a lookup for original WKT from autoCorrections
          const originalWktLookup = new Map<string, string>();
          for (const corr of result.autoCorrections || []) {
            originalWktLookup.set(corr.originalId, corr.originalWkt);
          }
          
          // Also create lookup from aiFeatures input
          const aiWktLookup = new Map<string, string>();
          for (const ai of aiFeatures) {
            if (ai.id && ai.wkt) {
              aiWktLookup.set(ai.id, ai.wkt);
            }
          }

          // Map deviations to include both old and new field names for compatibility
          const mappedDeviations = (result.deviations || []).map(dev => {
            // Check if this is a missing feature (AI had 0 of this type)
            const isMissingFeature = Boolean(
              dev.isMissingFeature || 
              dev.featureId?.startsWith('missing-') || 
              dev.featureId?.startsWith('injected-')
            );
            
            // Try to find original AI WKT: first from autoCorrections, then from original aiFeatures
            // For missing features, AI WKT should be empty
            const aiWkt = isMissingFeature 
              ? '' 
              : (originalWktLookup.get(dev.featureId) || aiWktLookup.get(dev.featureId) || '');
            
            // For missing features, traceWkt is the user's traced geometry
            const traceWkt = dev.correctedWkt || '';
            
            return {
              // Old format fields (for backward compat)
              aiLineId: dev.featureId,
              traceLineId: dev.featureId,
              lineType: dev.featureType,
              aiWkt,
              traceWkt,
              deviationFt: dev.avgDeviationFt,
              deviationPct: dev.alignmentScore != null ? (1 - dev.alignmentScore) * 100 : 0,
              // New format fields
              featureId: dev.featureId,
              featureType: dev.featureType,
              avgDeviationFt: dev.avgDeviationFt,
              maxDeviationFt: dev.maxDeviationFt,
              alignmentScore: dev.alignmentScore,
              needsCorrection: dev.needsCorrection,
              correctedWkt: dev.correctedWkt,
              // CRITICAL: Explicit missing feature flag for frontend
              isMissingFeature,
              tracedLengthFt: dev.tracedLengthFt || dev.maxDeviationFt || 0,
            };
          });
          
          // Log deviation summary for debugging
          console.log('[evaluate-overlay] Returning deviations:', JSON.stringify({
            total: mappedDeviations.length,
            byType: mappedDeviations.reduce((acc: Record<string, number>, d: any) => {
              acc[d.lineType || 'unknown'] = (acc[d.lineType || 'unknown'] || 0) + 1;
              return acc;
            }, {}),
            withTraceWkt: mappedDeviations.filter((d: any) => d.traceWkt).length,
            missingCount: mappedDeviations.filter((d: any) => !d.aiWkt && d.traceWkt).length,
            needsCorrectionCount: mappedDeviations.filter((d: any) => d.needsCorrection).length,
          }));
          
          return json({
            ok: true,
            data: {
              overallScore: result.overallScore || 0,
              deviations: mappedDeviations,
              unmatchedAiLines,
              unmatchedTraces,
              autoCorrectionsAvailable: result.autoCorrections?.length || 0,
            }
          }, corsHeaders);
        } catch (err) {
          console.error('Evaluate overlay error:', err);
          return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, corsHeaders, 500);
        }
      }

      // Route: action=store-corrections (Phase 2: Store line-by-line corrections for learning)
      if (action === 'store-corrections') {
        const { sessionId, corrections } = body;

        if (!corrections || !Array.isArray(corrections)) {
          return json({ ok: false, error: 'corrections array required' }, corsHeaders, 400);
        }

        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;

        // Get session details for context (including pipeline_entry_id for property scoping)
        const { data: sessionData } = await supabase
          .from('roof_training_sessions')
          .select('tenant_id, property_address, lat, lng, pipeline_entry_id')
          .eq('id', sessionId)
          .single();

        if (!sessionData) {
          return json({ ok: false, error: 'Session not found' }, corsHeaders, 404);
        }

        console.log('[store-corrections] Session data:', {
          sessionId,
          tenantId: sessionData.tenant_id,
          propertyId: sessionData.pipeline_entry_id,
          address: sessionData.property_address,
        });

        console.log('Storing', corrections.length, 'corrections for session', sessionId);

        const storedCount = { success: 0, failed: 0, skipped: 0 };
        const failureReasons: string[] = [];
        const skippedReasons: string[] = [];

        for (const correction of corrections) {
          // Validate correction data before attempting insert
          if (!correction.corrected_line_wkt || correction.corrected_line_wkt.trim() === '') {
            storedCount.skipped++;
            skippedReasons.push(`Skipped: empty corrected_line_wkt for ${correction.original_line_type}`);
            console.warn('Skipping correction with empty corrected_line_wkt:', correction.original_line_type);
            continue;
          }
          
          // Log warning if original_line_wkt is empty (but still proceed - it's useful partial data)
          if (!correction.original_line_wkt || correction.original_line_wkt.trim() === '') {
            console.warn('Correction has empty original_line_wkt (AI line not found):', correction.original_line_type);
          }

          try {
            const result = await storeCorrection(supabase, {
              tenantId: sessionData.tenant_id,
              originalLineWkt: correction.original_line_wkt || '',
              originalLineType: correction.original_line_type,
              correctedLineWkt: correction.corrected_line_wkt,
              deviationFt: correction.deviation_ft,
              deviationPct: correction.deviation_pct,
              correctionSource: correction.correction_source || 'user_trace',
              buildingShape: correction.building_shape || 'complex',
              roofType: correction.roof_type || 'complex',
              propertyAddress: sessionData.property_address,
              lat: sessionData.lat,
              lng: sessionData.lng,
              createdBy: userId,
              isFeatureInjection: correction.is_feature_injection || false,
              trainingSessionId: sessionId,
              propertyId: sessionData.pipeline_entry_id || null,
            });

            if (result.success) {
              storedCount.success++;
              console.log(`✓ Stored correction: ${correction.original_line_type}, deviation: ${correction.deviation_ft?.toFixed(1)}ft`);
            } else {
              storedCount.failed++;
              const reason = `Failed ${correction.original_line_type}: ${result.error}`;
              failureReasons.push(reason);
              console.warn('Failed to store correction:', result.error);
            }
          } catch (err) {
            storedCount.failed++;
            const reason = `Exception ${correction.original_line_type}: ${err instanceof Error ? err.message : String(err)}`;
            failureReasons.push(reason);
            console.error('Correction store error:', err);
          }
        }

        console.log('Corrections stored:', storedCount, 'failures:', failureReasons.length, 'skipped:', skippedReasons.length);

        return json({
          ok: true,
          data: {
            stored: storedCount.success,
            failed: storedCount.failed,
            skipped: storedCount.skipped,
            sessionId,
            failureReasons: failureReasons.slice(0, 5), // Return first 5 failure reasons
            skippedReasons: skippedReasons.slice(0, 5), // Return first 5 skip reasons
          }
        }, corsHeaders);
      }

      // Route: action=get-learned-patterns (Phase 3: Retrieve patterns for a building type)
      if (action === 'get-learned-patterns') {
        const { tenantId, buildingShape, roofType, limit = 10 } = body;

        if (!tenantId) {
          return json({ ok: false, error: 'tenantId required' }, corsHeaders, 400);
        }

        try {
          const patterns = await getLearnedPatterns(
            supabase,
            tenantId,
            buildingShape || 'any',
            roofType || 'any',
            limit
          );

          return json({
            ok: true,
            data: {
              patterns,
              count: patterns.length,
            }
          }, corsHeaders);
        } catch (err) {
          console.error('Get patterns error:', err);
          return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, corsHeaders, 500);
        }
      }

      // Route: action=apply-corrections (Phase 3: Apply learned corrections to features)
      if (action === 'apply-corrections') {
        const { tenantId, buildingShape, roofType, features } = body;

        if (!tenantId || !features) {
          return json({ ok: false, error: 'tenantId and features required' }, corsHeaders, 400);
        }

        try {
          // Get learned patterns
          const patterns = await getLearnedPatterns(
            supabase,
            tenantId,
            buildingShape || 'any',
            roofType || 'any',
            20
          );

          // Apply adjustments to features
          const adjustedFeatures = applyLearnedAdjustments(features, patterns);

          return json({
            ok: true,
            data: {
              features: adjustedFeatures,
              patternsApplied: patterns.length,
            }
          }, corsHeaders);
        } catch (err) {
          console.error('Apply corrections error:', err);
          return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, corsHeaders, 500);
        }
      }

      return json({ ok: false, error: 'Invalid action. Use: latest, pull, manual, manual-verify, generate-overlay, evaluate-overlay, store-corrections, get-learned-patterns, or apply-corrections' }, corsHeaders, 400);
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

// ============= VISION OVERLAY CONVERTER (Phase 1) =============
// Converts the output from generate-roof-overlay to MeasureResult format
function convertVisionOverlayToMeasureResult(
  overlay: {
    perimeter: [number, number][];
    ridges: Array<{ start: [number, number]; end: [number, number]; confidence: number }>;
    hips: Array<{ start: [number, number]; end: [number, number]; confidence: number }>;
    valleys: Array<{ start: [number, number]; end: [number, number]; confidence: number }>;
    metadata: {
      roofType?: string;
      qualityScore?: number;
      totalAreaSqft?: number;
    };
  },
  propertyId: string,
  lat: number,
  lng: number
): MeasureResult | null {
  try {
    const { perimeter, ridges, hips, valleys, metadata } = overlay;
    
    if (!perimeter || perimeter.length < 4) {
      console.error('[convertVisionOverlay] Invalid perimeter');
      return null;
    }
    
    // Helper: Calculate line length in feet from geo coordinates
    const calcLengthFt = (start: [number, number], end: [number, number]): number => {
      const midLat = (start[1] + end[1]) / 2;
      const metersPerDegLat = 111320;
      const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
      const dx = (end[0] - start[0]) * metersPerDegLng;
      const dy = (end[1] - start[1]) * metersPerDegLat;
      const lengthM = Math.sqrt(dx * dx + dy * dy);
      return lengthM * 3.28084;
    };
    
    // Convert perimeter to WKT
    const perimeterWkt = `POLYGON((${perimeter.map(p => `${p[0]} ${p[1]}`).join(', ')}))`;
    
    // Calculate area from perimeter (shoelace formula)
    const midLat = perimeter.reduce((sum, p) => sum + p[1], 0) / perimeter.length;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
    let areaSum = 0;
    for (let i = 0; i < perimeter.length - 1; i++) {
      const x1 = perimeter[i][0] * metersPerDegLng;
      const y1 = perimeter[i][1] * metersPerDegLat;
      const x2 = perimeter[i + 1][0] * metersPerDegLng;
      const y2 = perimeter[i + 1][1] * metersPerDegLat;
      areaSum += (x1 * y2 - x2 * y1);
    }
    const areaSqM = Math.abs(areaSum) / 2;
    const areaSqFt = areaSqM * 10.7639;
    
    // Build linear features
    const linearFeatures: LinearFeature[] = [];
    let featureId = 1;
    let ridgeTotalFt = 0, hipTotalFt = 0, valleyTotalFt = 0;
    
    // Add ridges
    for (const ridge of ridges || []) {
      const lengthFt = calcLengthFt(ridge.start, ridge.end);
      ridgeTotalFt += lengthFt;
      linearFeatures.push({
        id: `vision-ridge-${featureId++}`,
        type: 'ridge',
        wkt: `LINESTRING(${ridge.start[0]} ${ridge.start[1]}, ${ridge.end[0]} ${ridge.end[1]})`,
        length_ft: lengthFt,
        label: `Ridge ${featureId - 1} (vision)`
      });
    }
    
    // Add hips
    for (const hip of hips || []) {
      const lengthFt = calcLengthFt(hip.start, hip.end);
      hipTotalFt += lengthFt;
      linearFeatures.push({
        id: `vision-hip-${featureId++}`,
        type: 'hip',
        wkt: `LINESTRING(${hip.start[0]} ${hip.start[1]}, ${hip.end[0]} ${hip.end[1]})`,
        length_ft: lengthFt,
        label: `Hip ${featureId - 1} (vision)`
      });
    }
    
    // Add valleys
    for (const valley of valleys || []) {
      const lengthFt = calcLengthFt(valley.start, valley.end);
      valleyTotalFt += lengthFt;
      linearFeatures.push({
        id: `vision-valley-${featureId++}`,
        type: 'valley',
        wkt: `LINESTRING(${valley.start[0]} ${valley.start[1]}, ${valley.end[0]} ${valley.end[1]})`,
        length_ft: lengthFt,
        label: `Valley ${featureId - 1} (vision)`
      });
    }
    
    // Calculate eave/rake from perimeter (simplified - assume all edges are eave)
    let perimeterTotalFt = 0;
    for (let i = 0; i < perimeter.length - 1; i++) {
      perimeterTotalFt += calcLengthFt(perimeter[i], perimeter[i + 1]);
    }
    
    // Build single face from perimeter
    const faces: RoofFace[] = [{
      id: 'vision-face-1',
      wkt: perimeterWkt,
      plan_area_sqft: areaSqFt,
      pitch: '5/12', // Default pitch
      area_sqft: areaSqFt * 1.08, // Apply ~5/12 pitch factor
      linear_features: linearFeatures
    }];
    
    // Create MeasureResult
    const result: MeasureResult = {
      property_id: propertyId,
      source: 'vision_overlay',
      faces,
      linear_features: linearFeatures,
      summary: {
        total_area_sqft: metadata?.totalAreaSqft || areaSqFt,
        total_squares: (metadata?.totalAreaSqft || areaSqFt) / 100,
        waste_pct: 10,
        pitch_method: 'assumed',
        perimeter_ft: perimeterTotalFt,
        ridge_ft: ridgeTotalFt,
        hip_ft: hipTotalFt,
        valley_ft: valleyTotalFt,
        eave_ft: perimeterTotalFt * 0.7, // Rough split
        rake_ft: perimeterTotalFt * 0.3,
      },
      geom_wkt: ensureMultiPolygon(perimeterWkt)
    };
    
    console.log('[convertVisionOverlay] Created MeasureResult:', {
      source: result.source,
      areaSqft: result.summary.total_area_sqft,
      ridgeFt: result.summary.ridge_ft,
      hipFt: result.summary.hip_ft,
      valleyFt: result.summary.valley_ft,
      linearFeatures: linearFeatures.length
    });
    
    return result;
  } catch (err) {
    console.error('[convertVisionOverlay] Error:', err);
    return null;
  }
}
