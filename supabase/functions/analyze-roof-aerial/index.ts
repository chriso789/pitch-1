// NOTE: Avoid remote std/esm.sh imports where possible to prevent Supabase bundle timeouts.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

// Import worksheet engine - single source of truth for calculations
import {
  parsePitch,
  getSlopeFactorFromPitch,
  calculateSurfaceArea,
  sumLinearSegments,
  recommendWaste,
  calculateOrder,
  runQCChecks,
  buildWorksheetFromAI,
  convertPerimeterToPlane,
  convertAILinesToSegments,
  deriveComplexityFromSegments,
  type PitchInfo,
  type LinearSegment,
  type WorksheetJSON,
} from '../_shared/roofWorksheetEngine.ts'

// Import straight skeleton algorithm for mathematically-correct roof topology
import { computeStraightSkeleton } from '../_shared/straight-skeleton.ts'

// Import new roof geometry reconstructor for cleaner, connected roof diagrams
import { reconstructRoofGeometry, roofToLinearFeaturesWKT } from '../_shared/roof-geometry-reconstructor.ts'

// Import solar segment assembler for accurate facet positioning from Google Solar data
import { assembleFacetsFromSolarSegments, type AssembledGeometry, type SolarSegment } from '../_shared/solar-segment-assembler.ts'

// Import authoritative footprint extractors - prioritize ground-truth data over AI guessing
import { 
  fetchSolarFootprint, 
  expandFootprintForOverhang, 
  boundingBoxToFootprint,
  validateSolarFootprint,
  type SolarFootprint 
} from '../_shared/solar-footprint-extractor.ts'
import { fetchRegridFootprint, type RegridFootprint } from '../_shared/regrid-footprint-extractor.ts'
// NEW: Mapbox vector footprint for high-fidelity perimeters in Solar Fast Path
import { 
  fetchMapboxVectorFootprint, 
  selectBestFootprint,
  type MapboxFootprint,
  type MapboxFootprintResult 
} from '../_shared/mapbox-footprint-extractor.ts'
// NEW: Microsoft Buildings fallback (uses Esri/Overture data - no API key needed)
import { 
  fetchMicrosoftBuildingFootprint, 
  type MicrosoftFootprint,
  type MicrosoftFootprintResult 
} from '../_shared/microsoft-footprint-extractor.ts'
// NEW: OSM Building Footprints (Overpass API - no API key needed)
import { 
  fetchOSMBuildingFootprint, 
  type OSMFootprint,
  type OSMFootprintResult 
} from '../_shared/osm-footprint-extractor.ts'
import { 
  validateGeometry, 
  calculateAreaSqFt, 
  calculatePerimeterFt,
  formatValidationResult,
  type ValidationResult,
  type FootprintSource 
} from '../_shared/geometry-validator.ts'

// Import shared helper functions
import {
  type StructureAnalysis,
  type SolarSegmentOrientation,
  analyzeSegmentOrientation,
  createDefaultStructureAnalysis,
  mergeOrientationData,
  isFloridaAddress,
  safeParseJSON,
  distance,
  findNearestPoint,
  findFourMainCorners,
  calculateDistanceFt,
  pixelToGeo,
  geoToPixel,
  isValidPixelCoord,
  getDirectionFromAngle,
  PLANIMETER_THRESHOLDS,
} from '../_shared/roof-analysis-helpers.ts'

// Import interior line detector for optimized detection when authoritative footprint is available
import { 
  detectInteriorRoofLines, 
  combineFootprintWithInteriorLines,
  type InteriorLinesResult 
} from '../_shared/interior-line-detector.ts'

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY')!
const GOOGLE_SOLAR_API_KEY = Deno.env.get('GOOGLE_SOLAR_API_KEY')!
const MAPBOX_PUBLIC_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const IMAGE_ZOOM = 20
const IMAGE_SIZE = 640
const AI_CALL_TIMEOUT_MS = 45000 // 45 second timeout per AI call
const OVERALL_BUDGET_MS = 85000 // 85 second hard budget to avoid connection drops

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Base64 encode without importing std modules (keeps bundle graph smaller).
function base64FromBytes(bytes: Uint8Array): string {
  // Chunked conversion prevents call stack / memory spikes.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// Helper: Fetch with timeout for AI calls
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = AI_CALL_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

interface Vertex {
  x: number;
  y: number;
  type: 'perimeter' | 'ridge-end' | 'hip-junction' | 'valley-junction' | 'corner';
}

interface DerivedLine {
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  source: string;
}

// PLANIMETER_THRESHOLDS and safeParseJSON are now imported from roof-analysis-helpers.ts

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()
  
  try {
    const { address, coordinates, customerId, userId } = await req.json()
    console.log('🏠 Analyzing roof:', address)
    console.log('📍 Coordinates:', coordinates.lat, coordinates.lng)

    // Initialize Supabase client early for historical lookup
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    // STREAMLINED: Fetch imagery and Solar API data in parallel
    const [googleImage, solarDataRaw, mapboxImage] = await Promise.all([
      fetchGoogleStaticMap(coordinates),
      fetchGoogleSolarData(coordinates),
      fetchMapboxSatellite(coordinates)
    ])
    
    console.log(`⏱️ Image fetch complete: ${Date.now() - startTime}ms`)
    
    // PHASE 1: Historical Solar API Fallback when current Solar API fails
    let solarData = solarDataRaw
    if (!solarData.available && customerId) {
      console.log(`⚠️ Solar API unavailable, checking for historical data...`)
      
      try {
        const { data: historicalMeasurement, error: histError } = await supabaseClient
          .from('roof_measurements')
          .select('solar_building_footprint_sqft, solar_api_response, created_at')
          .eq('customer_id', customerId)
          .not('solar_building_footprint_sqft', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
        
        if (histError) {
          console.log(`📐 No historical Solar data found for customer: ${histError.message}`)
        } else if (historicalMeasurement?.solar_building_footprint_sqft) {
          const historicalDate = new Date(historicalMeasurement.created_at).toLocaleDateString()
          console.log(`📐 ✅ Using HISTORICAL Solar data from ${historicalDate}: ${historicalMeasurement.solar_building_footprint_sqft.toFixed(0)} sqft`)
          
          solarData = {
            available: true,
            buildingFootprintSqft: historicalMeasurement.solar_building_footprint_sqft,
            estimatedPerimeterFt: 4 * Math.sqrt(historicalMeasurement.solar_building_footprint_sqft),
            roofSegmentCount: 0,
            roofSegments: [],
            boundingBox: null,
            isHistorical: true,
            historicalDate
          }
        }
      } catch (histErr) {
        console.error('Historical lookup error:', histErr)
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 🚀 SOLAR-FIRST FAST PATH: Skip expensive AI passes when Solar data is good
    // Target: Complete in <15 seconds when Solar segments are available
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (solarData?.available && solarData?.roofSegments?.length >= 2 && solarData?.buildingFootprintSqft > 0) {
      console.log(`🚀 SOLAR FAST PATH: ${solarData.roofSegments.length} segments, ${solarData.buildingFootprintSqft.toFixed(0)} sqft`)
      
      try {
        const fastResult = await processSolarFastPath(
          solarData,
          coordinates,
          address,
          customerId,
          userId,
          googleImage,
          mapboxImage,
          supabaseClient,
          startTime
        )
        
        if (fastResult.success) {
          console.log(`✅ Solar Fast Path complete in ${Date.now() - startTime}ms!`)
          return new Response(JSON.stringify(fastResult.response), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        } else {
          console.log(`⚠️ Solar Fast Path incomplete, falling back to AI: ${fastResult.reason}`)
        }
      } catch (fastPathErr) {
        console.error('⚠️ Solar Fast Path error, falling back to AI:', fastPathErr)
      }
    }
    // ═══════════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════════
    // 🏢 AUTHORITATIVE FOOTPRINT EXTRACTION - ENHANCED PRIORITY ORDER:
    // 1. Mapbox Vector (highest fidelity - detailed polygon with many vertices)
    // 2. Regrid parcel data (accurate building outlines)
    // 3. OSM Overpass API (community-mapped buildings - no API key)
    // 4. Microsoft/Esri Buildings (global coverage - no API key)  
    // 5. Solar API bounding box (rectangular, 4 vertices - LAST RESORT)
    // 6. AI Detection (fallback when all else fails)
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Performance tracking for visibility
    const timings: Record<string, number> = {};
    let footprintFetchStart = Date.now();
    
    let authoritativeFootprint: {
      vertices: Array<{ lat: number; lng: number }>;
      confidence: number;
      source: FootprintSource;
      requiresManualReview: boolean;
      validation?: ValidationResult;
    } | null = null;

    // STEP 1: Try Mapbox Vector footprint FIRST (highest fidelity - detailed polygon)
    if (MAPBOX_PUBLIC_TOKEN) {
      console.log('🗺️ STEP 1: Attempting Mapbox vector footprint (highest priority)...');
      
      try {
        const mapboxResult = await fetchMapboxVectorFootprint(
          coordinates.lat, 
          coordinates.lng, 
          MAPBOX_PUBLIC_TOKEN,
          { radius: 50 }
        );
        
        if (mapboxResult.footprint && mapboxResult.footprint.vertexCount >= 4) {
          // Convert Mapbox coordinates [lng, lat][] to {lat, lng}[]
          const mapboxVertices = mapboxResult.footprint.coordinates.map(coord => ({
            lat: coord[1],
            lng: coord[0]
          }));
          
          // Use selectBestFootprint to compare against Solar area if available
          const solarAreaSqft = solarData?.buildingFootprintSqft || 0;
          const selected = selectBestFootprint(
            mapboxResult.footprint,
            solarData?.boundingBox || null,
            solarAreaSqft
          );
          
          // Only apply minimal overhang for vector footprints (already accurate)
          const expandedVertices = selected.source === 'mapbox_vector' 
            ? expandFootprintForOverhang(mapboxVertices, 0.5) // 0.5ft for vector sources
            : expandFootprintForOverhang(mapboxVertices, 1.5); // 1.5ft for non-vector
          
          const validation = validateGeometry(expandedVertices, 'mapbox_vector' as FootprintSource);
          
          if (validation.valid) {
            authoritativeFootprint = {
              vertices: expandedVertices,
              confidence: selected.confidence,
              source: 'mapbox_vector' as FootprintSource,
              requiresManualReview: false,
              validation,
            };
            console.log(`✅ Mapbox footprint: ${validation.metrics.areaSqFt.toFixed(0)} sqft, ${selected.vertexCount} vertices, ${(selected.confidence * 100).toFixed(0)}% confidence`);
            console.log(`   Reason: ${selected.reasoning}`);
          }
        } else {
          console.log(`⚠️ Mapbox returned no usable footprint: ${mapboxResult.fallbackReason || mapboxResult.error || 'unknown'}`);
        }
      } catch (mapboxErr) {
        console.warn('⚠️ Mapbox lookup failed:', mapboxErr);
      }
    }
    timings.footprint_mapbox = Date.now() - footprintFetchStart;

    // STEP 2: Fallback to Regrid parcel data (high-quality building outlines)
    const REGRID_API_KEY = Deno.env.get('REGRID_API_KEY');
    if (!authoritativeFootprint && REGRID_API_KEY) {
      console.log('🗺️ STEP 2: Trying Regrid parcel data...');
      
      try {
        const regridFootprint = await fetchRegridFootprint(coordinates.lat, coordinates.lng, REGRID_API_KEY);
        
        if (regridFootprint) {
          // Use 0.5ft overhang for Regrid (vector-quality data)
          const expandedVertices = expandFootprintForOverhang(regridFootprint.vertices, 0.5);
          const validation = validateGeometry(expandedVertices, 'regrid_parcel');
          
          if (validation.valid) {
            authoritativeFootprint = {
              vertices: expandedVertices,
              confidence: validation.confidence,
              source: 'regrid_parcel',
              requiresManualReview: false,
              validation,
            };
            console.log(`✅ Regrid footprint: ${validation.metrics.areaSqFt.toFixed(0)} sqft, ${regridFootprint.vertices.length} vertices, ${(validation.confidence * 100).toFixed(0)}% confidence`);
          }
        }
      } catch (regridErr) {
        console.warn('⚠️ Regrid lookup failed:', regridErr);
      }
    }
    timings.footprint_regrid = Date.now() - footprintFetchStart - (timings.footprint_mapbox || 0);

    // STEP 3: Try OSM Overpass API (community-mapped buildings - free, no API key)
    if (!authoritativeFootprint) {
      console.log('🗺️ STEP 3: Trying OSM Overpass API for building footprint...');
      
      try {
        const osmResult = await fetchOSMBuildingFootprint(coordinates.lat, coordinates.lng, { searchRadius: 50 });
        
        if (osmResult.footprint && osmResult.footprint.vertexCount >= 4) {
          const osmVertices = osmResult.footprint.coordinates.map(coord => ({
            lat: coord[1],
            lng: coord[0]
          }));
          
          // Use 0.5ft overhang for OSM (vector-quality data)
          const expandedVertices = expandFootprintForOverhang(osmVertices, 0.5);
          const validation = validateGeometry(expandedVertices, 'osm_buildings' as FootprintSource);
          
          if (validation.valid) {
            authoritativeFootprint = {
              vertices: expandedVertices,
              confidence: osmResult.footprint.confidence,
              source: 'osm_buildings' as FootprintSource,
              requiresManualReview: false,
              validation,
            };
            console.log(`✅ OSM footprint: ${validation.metrics.areaSqFt.toFixed(0)} sqft, ${osmResult.footprint.vertexCount} vertices, ${(osmResult.footprint.confidence * 100).toFixed(0)}% confidence`);
          }
        } else {
          console.log(`⚠️ OSM returned no usable footprint: ${osmResult.fallbackReason || osmResult.error || 'unknown'}`);
        }
      } catch (osmErr) {
        console.warn('⚠️ OSM Overpass lookup failed:', osmErr);
      }
    }
    timings.footprint_osm = Date.now() - footprintFetchStart - (timings.footprint_mapbox || 0) - (timings.footprint_regrid || 0);

    // STEP 4: Try Microsoft/Esri Buildings (global coverage - free, no API key)
    if (!authoritativeFootprint) {
      console.log('🏢 STEP 4: Trying Microsoft/Esri Buildings API...');
      
      try {
        const msResult = await fetchMicrosoftBuildingFootprint(coordinates.lat, coordinates.lng, { searchRadius: 50 });
        
        if (msResult.footprint && msResult.footprint.vertexCount >= 4) {
          const msVertices = msResult.footprint.coordinates.map(coord => ({
            lat: coord[1],
            lng: coord[0]
          }));
          
          // Use 0.5ft overhang for Microsoft data
          const expandedVertices = expandFootprintForOverhang(msVertices, 0.5);
          const validation = validateGeometry(expandedVertices, 'microsoft_buildings' as FootprintSource);
          
          if (validation.valid) {
            authoritativeFootprint = {
              vertices: expandedVertices,
              confidence: msResult.footprint.confidence,
              source: 'microsoft_buildings' as FootprintSource,
              requiresManualReview: false,
              validation,
            };
            console.log(`✅ Microsoft footprint: ${validation.metrics.areaSqFt.toFixed(0)} sqft, ${msResult.footprint.vertexCount} vertices, ${(msResult.footprint.confidence * 100).toFixed(0)}% confidence`);
          }
        } else {
          console.log(`⚠️ Microsoft returned no usable footprint: ${msResult.fallbackReason || msResult.error || 'unknown'}`);
        }
      } catch (msErr) {
        console.warn('⚠️ Microsoft Buildings lookup failed:', msErr);
      }
    }
    timings.footprint_microsoft = Date.now() - footprintFetchStart - (timings.footprint_mapbox || 0) - (timings.footprint_regrid || 0) - (timings.footprint_osm || 0);

    // STEP 5: LAST RESORT - Solar API bounding box (rectangular - lowest fidelity)
    // ⚠️ This creates a simple rectangle which often OVERESTIMATES area by 15-25%
    if (!authoritativeFootprint && solarData?.available && solarData?.boundingBox) {
      console.log('🌞 STEP 5: LAST RESORT - Solar API bounding box (4 vertices, rectangular)...');
      console.warn('⚠️ Using solar_bbox_fallback - area will likely be 15-25% OVERESTIMATED');
      
      const solarVertices = boundingBoxToFootprint(solarData.boundingBox);
      // Use 1.5ft overhang for Solar bbox (reduced from 2ft)
      const expandedVertices = expandFootprintForOverhang(solarVertices, 1.5);
      const validation = validateGeometry(expandedVertices, 'solar_bbox_fallback' as FootprintSource);
      
      if (validation.valid) {
        authoritativeFootprint = {
          vertices: expandedVertices,
          confidence: validation.confidence * 0.55, // Heavily reduce confidence for rectangular bbox
          source: 'solar_bbox_fallback' as FootprintSource, // Explicitly mark as fallback
          requiresManualReview: true, // ALWAYS require manual review for bbox fallback
          validation,
        };
        console.log(`⚠️ Solar bbox fallback: ${validation.metrics.areaSqFt.toFixed(0)} sqft, 4 vertices (RECTANGLE), ${(validation.confidence * 55).toFixed(0)}% confidence - REQUIRES MANUAL REVIEW`);
      } else {
        console.warn(`⚠️ Solar footprint failed validation: ${validation.errors.join(', ')}`);
      }
    }
    timings.footprint_solar = Date.now() - footprintFetchStart - (timings.footprint_mapbox || 0) - (timings.footprint_regrid || 0) - (timings.footprint_osm || 0) - (timings.footprint_microsoft || 0);
    timings.footprint_total = Date.now() - footprintFetchStart;

    // Determine if we have a vector footprint (for conditional Florida shrinkage)
    const hasVectorFootprint = authoritativeFootprint && 
      ['mapbox_vector', 'regrid_parcel', 'osm_buildings', 'microsoft_buildings'].includes(authoritativeFootprint.source);
    const usingSolarBboxFallback = authoritativeFootprint?.source === 'solar_bbox_fallback';

    // Log footprint source for tracking
    if (authoritativeFootprint) {
      console.log(`🎯 Using ${authoritativeFootprint.source} footprint (${(authoritativeFootprint.confidence * 100).toFixed(0)}% confidence, vector=${hasVectorFootprint})`);
    } else {
      console.log('⚠️ No authoritative footprint available - will use AI detection');
    }
    // ═══════════════════════════════════════════════════════════════════════════

    // Select best image (prefer Google Maps for better measurement accuracy)
    const selectedImage = googleImage.url ? googleImage : mapboxImage
    const imageSource = selectedImage.source
    const imageYear = new Date().getFullYear()
    
    // CRITICAL FIX: For coordinate conversion, we use LOGICAL size (what the zoom level represents)
    const logicalImageSize = 640
    const actualImageSize = selectedImage.source === 'mapbox' ? 1280 : 640
    
    console.log(`✅ Using: ${imageSource} (${actualImageSize}x${actualImageSize} pixels, ${logicalImageSize}x${logicalImageSize} logical)`)

    // NEW VERTEX-BASED DETECTION APPROACH (Roofr-quality)
    // Pass 1: Isolate target building with EXPANDED bounds for larger roofs
    let buildingIsolation = await isolateTargetBuilding(selectedImage.url, address, coordinates, solarData)
    console.log(`⏱️ Pass 1 (building isolation) complete: ${Date.now() - startTime}ms`)
    
    // PHASE 6: Apply Florida bounds shrinkage ONLY when using AI bounding-box isolation
    // Skip shrinkage when we have authoritative vector footprint (already accurate)
    const isFlorida = isFloridaAddress(address)
    if (isFlorida && !hasVectorFootprint) {
      const shrinkPct = 5 // 5% shrinkage for Florida properties
      const oldBounds = { ...buildingIsolation.bounds }
      buildingIsolation.bounds = {
        topLeftX: Math.min(95, buildingIsolation.bounds.topLeftX + shrinkPct / 2),
        topLeftY: Math.min(95, buildingIsolation.bounds.topLeftY + shrinkPct / 2),
        bottomRightX: Math.max(5, buildingIsolation.bounds.bottomRightX - shrinkPct / 2),
        bottomRightY: Math.max(5, buildingIsolation.bounds.bottomRightY - shrinkPct / 2)
      }
      console.log(`🌴 Florida property: Applied ${shrinkPct}% bounds shrinkage (AI bounding-box mode)`)
      console.log(`   Old bounds: (${oldBounds.topLeftX.toFixed(1)}%, ${oldBounds.topLeftY.toFixed(1)}%) to (${oldBounds.bottomRightX.toFixed(1)}%, ${oldBounds.bottomRightY.toFixed(1)}%)`)
      console.log(`   New bounds: (${buildingIsolation.bounds.topLeftX.toFixed(1)}%, ${buildingIsolation.bounds.topLeftY.toFixed(1)}%) to (${buildingIsolation.bounds.bottomRightX.toFixed(1)}%, ${buildingIsolation.bounds.bottomRightY.toFixed(1)}%)`)
    } else if (isFlorida && hasVectorFootprint) {
      console.log(`🌴 Florida property: Skipping shrinkage (using authoritative ${authoritativeFootprint?.source} footprint)`)
    }
    
    // Pass 2: Detect perimeter vertices with FULL IMAGE TRACING
    let perimeterResult = await detectPerimeterVertices(selectedImage.url, buildingIsolation.bounds, solarData, coordinates, logicalImageSize)
    console.log(`⏱️ Pass 2 (perimeter vertices) complete: ${Date.now() - startTime}ms`)
    
    // NEW: FOOTPRINT SANITY CHECK - verify vertices span the full roof
    const footprintCheck = validateFootprintCoverage(perimeterResult.vertices, buildingIsolation.bounds, solarData, coordinates, logicalImageSize)
    console.log(`📐 Footprint check: span=${footprintCheck.spanXPct.toFixed(1)}% x ${footprintCheck.spanYPct.toFixed(1)}%, perimeter=${footprintCheck.estimatedPerimeterFt.toFixed(0)}ft, ${footprintCheck.longSegments.length} long segments`)
    
    // If footprint check fails, run CORNER COMPLETION PASS
    if (!footprintCheck.isValid) {
      console.warn(`⚠️ FOOTPRINT CHECK FAILED: ${footprintCheck.failureReason}`)
      console.log(`🔄 Running corner completion pass...`)
      
      // Expand bounds and re-detect
      const expandedBounds = {
        topLeftX: Math.max(5, buildingIsolation.bounds.topLeftX - 10),
        topLeftY: Math.max(5, buildingIsolation.bounds.topLeftY - 10),
        bottomRightX: Math.min(95, buildingIsolation.bounds.bottomRightX + 10),
        bottomRightY: Math.min(95, buildingIsolation.bounds.bottomRightY + 10)
      }
      
      // Re-detect with expanded bounds and explicit instructions to find missing corners
      const redetectedResult = await detectPerimeterVerticesWithCornerFocus(
        selectedImage.url, 
        expandedBounds, 
        perimeterResult.vertices,
        footprintCheck.longSegments,
        solarData,
        coordinates,
        logicalImageSize
      )
      
      // Use re-detected result if it has more vertices and better coverage
      if (redetectedResult.vertices.length > perimeterResult.vertices.length) {
        console.log(`✅ Corner completion found ${redetectedResult.vertices.length - perimeterResult.vertices.length} additional vertices`)
        perimeterResult = redetectedResult
      }
    }
    
    // NEW: Pass 2.5 - Clean up perimeter vertices (remove collinear points, smooth eyebrows)
    const cleanupResult = cleanupPerimeterVertices(
      perimeterResult.vertices,
      coordinates,
      logicalImageSize,
      {
        collinearThresholdDeg: 10,  // Remove vertices on lines within 10° of straight
        minBumpOutFt: 3,            // Smooth eyebrows smaller than 3ft deviation
        preserveCornerTypes: ['valley-entry', 'gable-peak', 'hip-corner']  // Never remove these
      }
    );
    
    if (cleanupResult.removed > 0) {
      console.log(`🧹 Perimeter cleanup: removed ${cleanupResult.removed} collinear/eyebrow vertices`);
      perimeterResult.vertices = cleanupResult.cleaned;
    }
    
// Pass 3 & 3.5: Run in PARALLEL for speed optimization
    console.log(`⏱️ Starting Pass 3 & 3.5 in parallel...`)
    const [interiorVertices, aiRidgeDetection] = await Promise.all([
      // Pass 3: Detect interior junction vertices (where ridges/hips/valleys meet)
      detectInteriorJunctions(selectedImage.url, perimeterResult.vertices, buildingIsolation.bounds),
      // Pass 3.5: AI Vision Ridge Detection - detect ACTUAL ridge positions from satellite image
      detectRidgeLinesFromImage(
        selectedImage.url,
        perimeterResult.vertices,
        buildingIsolation.bounds,
        coordinates,
        logicalImageSize,
        IMAGE_ZOOM
      )
    ])
    console.log(`⏱️ Pass 3 & 3.5 (parallel) complete: ${Date.now() - startTime}ms`)
    console.log(`📏 AI Ridge Detection: ${aiRidgeDetection.ridgeLines.length} ridges, confidence=${aiRidgeDetection.averageConfidence.toFixed(0)}%, source=${aiRidgeDetection.source}`)
    
    // Derive lines from vertices using STRAIGHT SKELETON for mathematically correct topology
    // NOW with AI-detected ridge positions for accurate placement
    const derivedLines = deriveLinesToPerimeter(
      perimeterResult.vertices, 
      interiorVertices.junctions,
      interiorVertices.ridgeEndpoints,
      buildingIsolation.bounds,
      coordinates,       // Pass coordinates for skeleton geo-conversion
      logicalImageSize,  // Image size for coordinate conversion
      IMAGE_ZOOM,        // Zoom level for coordinate conversion
      aiRidgeDetection   // NEW: Pass AI-detected ridge positions
    )
    console.log(`⏱️ Line derivation complete: ${derivedLines.length} lines from vertices`)
    
    // Calculate actual roof area from perimeter vertices using Shoelace formula
    const actualAreaSqft = calculateAreaFromPerimeterVertices(
      perimeterResult.vertices,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM,
      solarData,
      address
    )
    console.log(`📐 Validated area from perimeter: ${actualAreaSqft.toFixed(0)} sqft`)
    
    // Derive facet count from roof geometry AND detected lines
    const preLinearFeaturesForFacets = convertDerivedLinesToWKT(
      derivedLines,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    const hipLineCount = preLinearFeaturesForFacets.filter((f: any) => f.type === 'hip').length
    const ridgeLineCount = preLinearFeaturesForFacets.filter((f: any) => f.type === 'ridge').length
    
    const derivedFacetCount = deriveFacetCountFromGeometry(
      perimeterResult.vertices,
      interiorVertices.junctions,
      perimeterResult.roofType,
      hipLineCount,
      ridgeLineCount
    )
    console.log(`📐 Derived facet count: ${derivedFacetCount} (from ${hipLineCount} hips, ${ridgeLineCount} ridges)`)
    
    // Convert legacy AI analysis format for backward compatibility
    const aiAnalysis = {
      roofType: perimeterResult.roofType || 'complex',
      facets: [{
        facetNumber: 1,
        shape: 'complex',
        estimatedPitch: '5/12',
        pitchConfidence: 'medium',
        estimatedAreaSqft: actualAreaSqft,
        edges: { eave: 0, rake: 0, hip: 0, valley: 0, ridge: 0 },
        features: { chimneys: 0, skylights: 0, vents: 0 },
        orientation: 'mixed'
      }],
      boundingBox: buildingIsolation.bounds,
      roofPerimeter: perimeterResult.vertices,
      edgeSegments: [],
      overallComplexity: perimeterResult.complexity || 'moderate',
      shadowAnalysis: { estimatedPitchRange: '4/12 to 7/12', confidence: 'medium' },
      detectionNotes: 'Vertex-based detection with corner completion',
      derivedFacetCount,
      footprintValidation: footprintCheck
    }
    
    const scale = calculateScale(solarData, selectedImage, aiAnalysis)
    
    // Pre-calculate linear features to use in measurements
    const preLinearFeatures = convertDerivedLinesToWKT(
      derivedLines,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    
    // Calculate linear totals from WKT features
    const linearTotalsFromWKT = calculateLinearTotalsFromWKT(preLinearFeatures)
    console.log(`📐 Linear totals from WKT:`, linearTotalsFromWKT)
    
    const measurements = calculateDetailedMeasurements(aiAnalysis, scale, solarData, linearTotalsFromWKT)
    const confidence = calculateConfidenceScore(aiAnalysis, measurements, solarData, selectedImage)
    
    // Convert derived lines to WKT
    const linearFeatures = convertDerivedLinesToWKT(
      derivedLines,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    
    // Convert perimeter to WKT polygon
    const perimeterWkt = convertPerimeterToWKT(
      perimeterResult.vertices,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )

    console.log(`📏 Generated ${linearFeatures.length} vertex-derived linear features`)

    // Re-use supabase client created earlier
    const supabase = supabaseClient
    
    // Extract vertex stats from perimeter detection
    const vertexStats = perimeterResult.vertexStats || {
      hipCornerCount: perimeterResult.vertices.filter((v: any) => v.cornerType === 'hip-corner').length,
      valleyEntryCount: perimeterResult.vertices.filter((v: any) => v.cornerType === 'valley-entry').length,
      gablePeakCount: perimeterResult.vertices.filter((v: any) => v.cornerType === 'gable-peak').length,
      totalCount: perimeterResult.vertices.length
    }
    
    // PHASE 4: Assess image quality and shadow risk
    const shadowRiskAssessment = assessShadowRisk(solarData, perimeterResult, footprintCheck)
    console.log(`🌓 Shadow risk assessment:`, shadowRiskAssessment)
    
    // Build metadata with quality metrics
    const measurementMetadata = {
      shadow_risk: shadowRiskAssessment.risk,
      image_quality_score: shadowRiskAssessment.qualityScore,
      shrinkage_applied: false,
      shrinkage_reason: null,
      footprint_validation: footprintCheck,
      detection_method: 'vertex-based',
      vertex_stats: vertexStats,
    }
    
    const measurementRecord = await saveMeasurementToDatabase(supabase, {
      address, coordinates, customerId, userId, googleImage, mapboxImage,
      selectedImage, solarData, aiAnalysis, scale, measurements, confidence,
      linearFeatures, imageSource, imageYear, perimeterWkt,
      visionEdges: { ridges: [], hips: [], valleys: [] },
      imageSize: logicalImageSize,
      vertexStats,
      footprintValidation: footprintCheck,
      metadata: measurementMetadata,
      shadowRisk: shadowRiskAssessment,
      authoritativeFootprint, // NEW: Pass footprint data for database storage
    })
    
    // Save vertices and edges to dedicated tables
    await saveVerticesToDatabase(
      supabase,
      measurementRecord.id,
      perimeterResult.vertices,
      interiorVertices.junctions,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    
    await saveEdgesToDatabase(
      supabase,
      measurementRecord.id,
      derivedLines,
      coordinates,
      logicalImageSize,
      IMAGE_ZOOM
    )
    
    // Generate and save facet polygons - PREFER Solar Segment Assembler for accurate positioning
    let facetPolygons: any[] = [];
    let facetSource = 'legacy';
    
    // Convert perimeter vertices to XY format for Solar assembler
    const perimeterXY = convertPerimeterVerticesToXY(perimeterResult.vertices, coordinates, logicalImageSize, IMAGE_ZOOM);
    
    // PRIORITY: Use Solar Segment Assembler if we have segment data with positioning
    if (solarData?.available && solarData?.roofSegments?.length >= 2) {
      console.log(`🛰️ Attempting Solar Segment Assembly with ${solarData.roofSegments.length} segments...`);
      
      try {
        const assembledGeometry = assembleFacetsFromSolarSegments(
          perimeterXY,
          solarData.roofSegments as SolarSegment[],
          measurements.predominantPitch
        );
        
        if (assembledGeometry.facets.length >= 2) {
          console.log(`✅ Solar Segment Assembly succeeded: ${assembledGeometry.facets.length} facets (quality: ${assembledGeometry.quality})`);
          
          // Convert assembled facets to database format
          facetPolygons = assembledGeometry.facets.map((facet, index) => ({
            facetNumber: index + 1,
            points: facet.polygon.map(xy => ({ lng: xy[0], lat: xy[1] })),
            centroid: getCentroidFromXY(facet.polygon),
            primaryDirection: facet.direction,
            azimuthDegrees: facet.azimuthDegrees,
            shapeType: 'solar_segment',
            areaEstimate: facet.areaSqft,
            solarSegmentIndex: facet.sourceSegmentIndex
          }));
          facetSource = 'solar_assembler';
        } else {
          console.log(`⚠️ Solar Segment Assembly produced ${assembledGeometry.facets.length} facets, falling back to legacy`);
        }
      } catch (err) {
        console.warn('⚠️ Solar Segment Assembly failed:', err);
      }
    }
    
    // FALLBACK: Use legacy facet generation if Solar assembly didn't work
    if (facetPolygons.length === 0) {
      facetPolygons = generateFacetPolygons(
        perimeterResult.vertices,
        interiorVertices.junctions,
        derivedLines,
        coordinates,
        logicalImageSize,
        IMAGE_ZOOM,
        derivedFacetCount,
        measurements.predominantPitch
      );
      facetSource = 'legacy';
    }
    
    // Track facet generation status
    const facetGenerationStatus = {
      requested: derivedFacetCount,
      generated: facetPolygons.length,
      status: facetPolygons.length >= 1 ? 'ok' : 'failed',
      hasFallback: facetPolygons.some((f: any) => f.isFallback),
      source: facetSource
    }
    console.log(`📐 Facet generation:`, facetGenerationStatus)
    
    // ALWAYS save facets if we have at least 1
    if (facetPolygons.length > 0) {
      await saveFacetsToDatabase(supabase, measurementRecord.id, facetPolygons, measurements)
    } else {
      console.error('⚠️ No facets generated')
    }
    
    const totalTime = Date.now() - startTime
    console.log(`✅ Complete in ${totalTime}ms! Confidence: ${confidence.score}%`)

    return new Response(JSON.stringify({
      success: true,
      measurementId: measurementRecord.id,
      timing: { totalMs: totalTime },
      data: {
        address, coordinates,
        images: { google: googleImage.url ? 'available' : 'unavailable', mapbox: mapboxImage.url ? 'available' : 'unavailable', selected: selectedImage.source },
        solarApiData: {
          available: solarData.available,
          buildingFootprint: solarData.buildingFootprintSqft,
          roofSegments: solarData.roofSegmentCount,
          linearFeatures: linearFeatures.length
        },
        aiAnalysis: {
          roofType: aiAnalysis.roofType,
          facetCount: aiAnalysis.facets.length,
          complexity: aiAnalysis.overallComplexity,
          pitch: measurements.predominantPitch,
          boundingBox: aiAnalysis.boundingBox,
          vertexDetection: {
            perimeterVertices: perimeterResult.vertices.length,
            interiorJunctions: interiorVertices.junctions.length,
            derivedLines: derivedLines.length
          },
          footprintValidation: footprintCheck
        },
        measurements: {
          totalAreaSqft: measurements.totalAdjustedArea,
          totalSquares: measurements.totalSquares,
          wasteFactor: measurements.wasteFactor,
          facets: measurements.facets,
          linear: measurements.linearMeasurements,
          materials: measurements.materials,
          predominantPitch: measurements.predominantPitch,
          linearFeaturesWkt: linearFeatures,
          analysisZoom: IMAGE_ZOOM,
          analysisImageSize: { width: IMAGE_SIZE, height: IMAGE_SIZE }
        },
        linearFeaturesWkt: linearFeatures,
        perimeterWkt,
        analysisZoom: IMAGE_ZOOM,
        analysisImageSize: { width: IMAGE_SIZE, height: IMAGE_SIZE },
        confidence: {
          score: confidence.score,
          rating: confidence.rating,
          factors: confidence.factors,
          requiresReview: confidence.requiresReview
        },
        scale: {
          pixelsPerFoot: scale.pixelsPerFoot,
          method: scale.method,
          confidence: scale.confidence
        },
        // NEW: Footprint tracking for frontend badge display
        footprint: {
          source: authoritativeFootprint?.source || 'ai_detection',
          confidence: authoritativeFootprint?.confidence || 0.5,
          vertexCount: authoritativeFootprint?.vertices?.length || perimeterResult.vertices.length,
          dsmAvailable: false,
          requiresReview: !authoritativeFootprint
        },
        // NEW: Performance metrics for transparency
        performance: {
          path_used: 'ai_fallback',
          fast_path_skipped_reason: solarData?.available ? 'segment_count_insufficient' : 'solar_unavailable',
          timings_ms: {
            imagery_fetch: 0, // Would need to track from image fetch start
            footprint_total: timings.footprint_total || 0,
            building_isolation: 0,
            perimeter_detection: 0,
            ridge_detection: 0,
            skeleton_generation: 0,
            total: totalTime
          },
          footprint_source: authoritativeFootprint?.source || 'ai_detection'
        }
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('❌ Error:', error)
    return new Response(JSON.stringify({ success: false, error: error.message, stack: error.stack }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

async function fetchGoogleStaticMap(coords: any) {
  try {
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${coords.lat},${coords.lng}&zoom=20&size=640x640&maptype=satellite&key=${GOOGLE_MAPS_API_KEY}`
    const response = await fetch(url)
    if (!response.ok) {
      console.error('Google Maps fetch failed:', response.status)
      return { url: null, source: 'google_maps', resolution: '640x640', quality: 0 }
    }
    const buffer = await response.arrayBuffer()
    const base64 = base64FromBytes(new Uint8Array(buffer))
    return { url: `data:image/png;base64,${base64}`, source: 'google_maps', resolution: '640x640', quality: 8 }
  } catch (err) {
    console.error('Google Maps error:', err)
    return { url: null, source: 'google_maps', resolution: '640x640', quality: 0 }
  }
}

async function fetchGoogleSolarData(coords: any) {
  try {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${coords.lat}&location.longitude=${coords.lng}&key=${GOOGLE_SOLAR_API_KEY}`
    const response = await fetch(url)
    
    // ENHANCED: Better error logging for 403/quota issues
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error body')
      console.error(`❌ Google Solar API error: ${response.status} - ${errorText}`)
      
      // Log specific error types for debugging
      if (response.status === 403) {
        console.error('🔑 403 Forbidden - Check: API key validity, billing status, or quota exceeded')
      } else if (response.status === 429) {
        console.error('⏱️ 429 Rate Limited - Too many requests')
      }
      
      return { available: false, buildingFootprintSqft: null, roofSegmentCount: 0, linearFeatures: [], error: `${response.status}` }
    }
    
    const data = await response.json()
    const buildingFootprintSqm = data.solarPotential?.buildingStats?.areaMeters2 || 0
    const buildingFootprintSqft = buildingFootprintSqm * 10.764
    const roofSegments = data.solarPotential?.roofSegmentStats || []
    const boundingBox = data.boundingBox || null
    
    // Calculate expected perimeter from Solar API footprint (for validation)
    // Rough estimate: perimeter ≈ 4 * sqrt(area) for rectangular shapes
    const estimatedPerimeterFt = 4 * Math.sqrt(buildingFootprintSqft)
    
    console.log(`✅ Solar API: ${buildingFootprintSqft.toFixed(0)} sqft footprint, ${roofSegments.length} segments`)
    
    return {
      available: true,
      buildingFootprintSqft,
      estimatedPerimeterFt,
      roofSegmentCount: roofSegments.length,
      roofSegments: roofSegments.map((s: any) => ({ 
        pitchDegrees: s.pitchDegrees, 
        azimuthDegrees: s.azimuthDegrees, 
        areaMeters2: s.stats?.areaMeters2,
        planeHeightAtCenter: s.planeHeightAtCenterMeters,
        boundingBox: s.boundingBox
      })),
      boundingBox,
      rawData: data,
      isHistorical: false
    }
  } catch (err) {
    console.error('Google Solar API error:', err)
    return { available: false, buildingFootprintSqft: null, roofSegmentCount: 0, linearFeatures: [] }
  }
}

async function fetchMapboxSatellite(coords: any) {
  try {
    const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${coords.lng},${coords.lat},20,0/640x640@2x?access_token=${MAPBOX_PUBLIC_TOKEN}`
    const response = await fetch(url)
    if (!response.ok) {
      console.error('Mapbox fetch failed:', response.status)
      return { url: null, source: 'mapbox', resolution: '1280x1280', quality: 0 }
    }
    const buffer = await response.arrayBuffer()
    const base64 = base64FromBytes(new Uint8Array(buffer))
    return { url: `data:image/png;base64,${base64}`, source: 'mapbox', resolution: '1280x1280', quality: 9 }
  } catch (err) {
    console.error('Mapbox error:', err)
    return { url: null, source: 'mapbox', resolution: '1280x1280', quality: 0 }
  }
}

// ============================================================================
// PERIMETER CLEANUP - Remove collinear vertices and smooth eyebrow features
// ============================================================================

/**
 * Clean up perimeter vertices by:
 * 1. Removing collinear vertices (points on straight lines)
 * 2. Smoothing "eyebrow" features (small bump-outs under threshold)
 * 
 * An "eyebrow" is a small architectural feature like a dormer that can cause
 * the AI to add extra vertices. For schematic purposes, we smooth these out
 * unless they're significant (>3ft deviation from baseline).
 */
function cleanupPerimeterVertices(
  vertices: any[],
  coordinates: { lat: number; lng: number },
  imageSize: number = 640,
  options: {
    collinearThresholdDeg?: number;  // Angle threshold for collinear detection (default 12°)
    minBumpOutFt?: number;           // Minimum bump-out to keep (default 3ft)
    preserveCornerTypes?: string[];  // Corner types to never remove
  } = {}
): { cleaned: any[]; removed: number; eyebrowsSmoothed: number } {
  const {
    collinearThresholdDeg = 12,  // Increased from 8° to be more aggressive on straight lines
    minBumpOutFt = 3,
    preserveCornerTypes = ['valley-entry', 'gable-peak']
  } = options;
  
  if (!vertices || vertices.length < 5) {
    return { cleaned: vertices || [], removed: 0, eyebrowsSmoothed: 0 };
  }
  
  // Convert degrees to radians for threshold
  const collinearThresholdRad = collinearThresholdDeg * (Math.PI / 180);
  
  // Meters per pixel at this zoom level
  const metersPerPixel = (156543.03392 * Math.cos(coordinates.lat * Math.PI / 180)) / Math.pow(2, IMAGE_ZOOM);
  const feetPerPixelPct = (metersPerPixel * imageSize / 100) * 3.28084;
  
  let cleaned = [...vertices];
  let removed = 0;
  let eyebrowsSmoothed = 0;
  
  // Pass 1: More aggressive collinear vertex removal (straighten eaves)
  // Do multiple passes until no more vertices are removed
  let passRemoved = 0;
  let passCount = 0;
  do {
    passRemoved = 0;
    let i = 0;
    while (i < cleaned.length && cleaned.length > 4) {
      const prev = cleaned[(i - 1 + cleaned.length) % cleaned.length];
      const curr = cleaned[i];
      const next = cleaned[(i + 1) % cleaned.length];
      
      // Skip protected corner types
      if (preserveCornerTypes.includes(curr.cornerType)) {
        i++;
        continue;
      }
      
      // Calculate angle at this vertex
      const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
      const v2 = { x: next.x - curr.x, y: next.y - curr.y };
      
      const dot = v1.x * v2.x + v1.y * v2.y;
      const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
      const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
      
      if (mag1 === 0 || mag2 === 0) {
        i++;
        continue;
      }
      
      const cosAngle = dot / (mag1 * mag2);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
      
      // If nearly straight (angle close to 180° / π radians)
      if (Math.abs(angle - Math.PI) < collinearThresholdRad) {
        // This vertex is on a straight line - remove it
        console.log(`🧹 Removing collinear vertex at (${curr.x.toFixed(1)}%, ${curr.y.toFixed(1)}%) - angle: ${(angle * 180 / Math.PI).toFixed(1)}°`);
        cleaned.splice(i, 1);
        removed++;
        passRemoved++;
        // Don't increment i - check the new vertex at this position
      } else {
        i++;
      }
    }
    passCount++;
  } while (passRemoved > 0 && passCount < 5); // Multiple passes for cascading removals
  
  // Pass 2: Smooth "eyebrow" features (small bump-outs < minBumpOutFt deviation)
  let i = 0;
  while (i < cleaned.length && cleaned.length > 4) {
    const curr = cleaned[i];
    
    // Skip protected corner types
    if (preserveCornerTypes.includes(curr.cornerType)) {
      i++;
      continue;
    }
    
    // Check if this is a potential eyebrow - look for pattern: prev -> curr -> next -> afterNext
    // where curr and next form a small protrusion
    const prev = cleaned[(i - 1 + cleaned.length) % cleaned.length];
    const next = cleaned[(i + 1) % cleaned.length];
    const afterNext = cleaned[(i + 2) % cleaned.length];
    
    // Check if prev->curr->next->afterNext forms a small bump
    // by seeing if the direct line prev->afterNext is close to the path
    
    // Distance from curr to line prev->afterNext
    const lineLen = Math.sqrt(Math.pow(afterNext.x - prev.x, 2) + Math.pow(afterNext.y - prev.y, 2));
    if (lineLen < 0.1) {
      i++;
      continue;
    }
    
    // Perpendicular distance of curr from line prev->afterNext
    const distCurr = Math.abs(
      (afterNext.y - prev.y) * curr.x - (afterNext.x - prev.x) * curr.y + 
      afterNext.x * prev.y - afterNext.y * prev.x
    ) / lineLen;
    
    // Perpendicular distance of next from line prev->afterNext  
    const distNext = Math.abs(
      (afterNext.y - prev.y) * next.x - (afterNext.x - prev.x) * next.y + 
      afterNext.x * prev.y - afterNext.y * prev.x
    ) / lineLen;
    
    // Convert to feet
    const distCurrFt = distCurr * feetPerPixelPct;
    const distNextFt = distNext * feetPerPixelPct;
    
    // If both curr and next are close to the line and form a small bump, remove both
    if (distCurrFt < minBumpOutFt && distNextFt < minBumpOutFt) {
      // Check that the bump is truly small (not a significant protrusion)
      const bumpWidth = Math.sqrt(Math.pow(next.x - curr.x, 2) + Math.pow(next.y - curr.y, 2));
      const bumpWidthFt = bumpWidth * feetPerPixelPct;
      
      if (bumpWidthFt < 8) { // Small eyebrow - smooth it
        console.log(`🧹 Smoothing eyebrow at (${curr.x.toFixed(1)}%, ${curr.y.toFixed(1)}%) - deviation: ${distCurrFt.toFixed(1)}ft, width: ${bumpWidthFt.toFixed(1)}ft`);
        // Remove curr and next (the bump vertices)
        cleaned.splice(i, 2);
        eyebrowsSmoothed += 2;
        removed += 2;
        // Don't increment - check the new vertex at this position
        continue;
      }
    }
    
    i++;
  }
  
  // Pass 3: Final check for any remaining near-collinear vertices (use stricter 15° threshold)
  const strictThresholdRad = 15 * (Math.PI / 180);
  i = 0;
  while (i < cleaned.length && cleaned.length > 4) {
    const prev = cleaned[(i - 1 + cleaned.length) % cleaned.length];
    const curr = cleaned[i];
    const next = cleaned[(i + 1) % cleaned.length];
    
    if (preserveCornerTypes.includes(curr.cornerType)) {
      i++;
      continue;
    }
    
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    
    if (mag1 > 0 && mag2 > 0) {
      const cosAngle = dot / (mag1 * mag2);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
      
      if (Math.abs(angle - Math.PI) < strictThresholdRad) {
        console.log(`🧹 Final pass: removing near-collinear vertex at (${curr.x.toFixed(1)}%, ${curr.y.toFixed(1)}%) - angle: ${(angle * 180 / Math.PI).toFixed(1)}°`);
        cleaned.splice(i, 1);
        removed++;
        continue;
      }
    }
    i++;
  }
  
  console.log(`🧹 Perimeter cleanup: removed ${removed} vertices (${eyebrowsSmoothed} from eyebrows), ${cleaned.length} remaining`);
  
  return { cleaned, removed, eyebrowsSmoothed };
}

// NEW: Validate that detected footprint covers the full roof
function validateFootprintCoverage(
  vertices: any[],
  bounds: any,
  solarData: any,
  coordinates: { lat: number; lng: number },
  imageSize: number
): {
  isValid: boolean;
  failureReason: string | null;
  spanXPct: number;
  spanYPct: number;
  estimatedPerimeterFt: number;
  expectedPerimeterFt: number;
  longSegments: { index: number; lengthFt: number }[];
  vertexCount: number;
  expectedMinVertices: number;
} {
  if (!vertices || vertices.length < 4) {
    return {
      isValid: false,
      failureReason: 'Too few vertices detected',
      spanXPct: 0,
      spanYPct: 0,
      estimatedPerimeterFt: 0,
      expectedPerimeterFt: 0,
      longSegments: [],
      vertexCount: vertices?.length || 0,
      expectedMinVertices: 8
    }
  }
  
  // Calculate span in percentage
  const xValues = vertices.map(v => v.x)
  const yValues = vertices.map(v => v.y)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)
  const spanXPct = maxX - minX
  const spanYPct = maxY - minY
  
  // Calculate perimeter in feet
  const metersPerPixel = (156543.03392 * Math.cos(coordinates.lat * Math.PI / 180)) / Math.pow(2, IMAGE_ZOOM)
  let perimeterFt = 0
  const segmentLengths: { index: number; lengthFt: number }[] = []
  
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i]
    const v2 = vertices[(i + 1) % vertices.length]
    const dx = ((v2.x - v1.x) / 100) * imageSize * metersPerPixel
    const dy = ((v2.y - v1.y) / 100) * imageSize * metersPerPixel
    const segmentFt = Math.sqrt(dx * dx + dy * dy) * 3.28084
    perimeterFt += segmentFt
    segmentLengths.push({ index: i, lengthFt: segmentFt })
  }
  
  // Flag long segments (potential missed corners)
  const longSegments = segmentLengths.filter(s => s.lengthFt > PLANIMETER_THRESHOLDS.MAX_SEGMENT_LENGTH_FT)
  
  // Expected perimeter from Solar API or estimate from bounds
  const expectedPerimeterFt = solarData?.estimatedPerimeterFt || 
    (2 * (spanXPct / 100 * imageSize * metersPerPixel * 3.28084) + 
     2 * (spanYPct / 100 * imageSize * metersPerPixel * 3.28084))
  
  // Expected vertex count based on perimeter
  const expectedMinVertices = Math.max(8, Math.ceil(perimeterFt * PLANIMETER_THRESHOLDS.MIN_VERTICES_PER_100FT / 100))
  
  // Validation checks
  let isValid = true
  let failureReason: string | null = null
  
  // Check 1: Span must cover reasonable portion of bounds
  if (spanXPct < PLANIMETER_THRESHOLDS.MIN_SPAN_PCT || spanYPct < PLANIMETER_THRESHOLDS.MIN_SPAN_PCT) {
    isValid = false
    failureReason = `Span too small: ${spanXPct.toFixed(1)}% x ${spanYPct.toFixed(1)}% (min ${PLANIMETER_THRESHOLDS.MIN_SPAN_PCT}%)`
  }
  
  // Check 2: Perimeter should match expected (Solar API comparison)
  if (solarData?.available && solarData?.estimatedPerimeterFt) {
    const perimeterRatio = perimeterFt / solarData.estimatedPerimeterFt
    if (perimeterRatio < PLANIMETER_THRESHOLDS.RE_DETECT_THRESHOLD) {
      isValid = false
      failureReason = `Perimeter ${perimeterFt.toFixed(0)}ft is only ${(perimeterRatio * 100).toFixed(0)}% of expected ${solarData.estimatedPerimeterFt.toFixed(0)}ft`
    }
  }
  
  // Check 3: Too many long segments indicates missed corners
  if (longSegments.length >= 3) {
    isValid = false
    failureReason = `${longSegments.length} segments > ${PLANIMETER_THRESHOLDS.MAX_SEGMENT_LENGTH_FT}ft - likely missing corners`
  }
  
  // Check 4: Vertex count should match expected
  if (vertices.length < expectedMinVertices * 0.6) {
    isValid = false
    failureReason = `Only ${vertices.length} vertices, expected at least ${expectedMinVertices} for ${perimeterFt.toFixed(0)}ft perimeter`
  }
  
  return {
    isValid,
    failureReason,
    spanXPct,
    spanYPct,
    estimatedPerimeterFt: perimeterFt,
    expectedPerimeterFt,
    longSegments,
    vertexCount: vertices.length,
    expectedMinVertices
  }
}

// PASS 1: Isolate target building - EXPANDED for larger/complex roofs
// Now accepts Solar API data to estimate expected building size
async function isolateTargetBuilding(
  imageUrl: string, 
  address: string, 
  coordinates: { lat: number; lng: number },
  solarData?: any
) {
  if (!imageUrl) {
    return { bounds: { topLeftX: 30, topLeftY: 30, bottomRightX: 70, bottomRightY: 70 }, confidence: 'low' }
  }

  // Estimate expected bounds from Solar API
  let solarSizeHint = ''
  if (solarData?.available && solarData?.buildingFootprintSqft) {
    const estWidthFt = Math.sqrt(solarData.buildingFootprintSqft * 1.3) // Account for elongated shapes
    // At zoom 20, 1% of 640px image ≈ 1 meter ≈ 3.28 ft
    // So a 60ft wide building is about 60/3.28 = 18.3 meters = ~18% of image
    const estWidthPct = (estWidthFt / 3.28) / 6.4 * 100
    solarSizeHint = `
Solar API indicates building is approximately ${solarData.buildingFootprintSqft.toFixed(0)} sqft.
Expected roof width: ~${estWidthFt.toFixed(0)}ft which is approximately ${estWidthPct.toFixed(0)}% of image width.
For this size building, expect bounds of roughly ${Math.max(20, 50 - estWidthPct/2).toFixed(0)}% to ${Math.min(80, 50 + estWidthPct/2).toFixed(0)}%.`
  }

  // Detect Florida addresses (high screen enclosure rate)
  const isFlorida = isFloridaAddress(address)
  const floridaWarning = isFlorida ? `
⚠️ FLORIDA PROPERTY - CRITICAL WARNINGS:
1. Many Florida homes have LARGE SCREEN ENCLOSURES over pools/patios - these appear as metal grid structures
2. DO NOT include screen enclosures in the roof bounds - they are NOT part of the roof
3. Adjacent lanai structures with FLAT or METAL roofs are NOT the main roof
4. Only trace the MAIN SHINGLED/TILED residential roof structure
5. If you see a large rectangular metal grid structure, that is a POOL ENCLOSURE - exclude it!` : ''

  const prompt = `You are a roof measurement expert. Analyze this satellite image.

TASK: Find the MAIN RESIDENTIAL BUILDING at the EXACT CENTER of the image.
The GPS coordinates point to the center of this image, so the target house is in the middle.
${solarSizeHint}
${floridaWarning}

CRITICAL - SINGLE BUILDING RULE:
You must trace ONLY ONE building - the PRIMARY residential structure with a shingled/tiled roof.
If you detect multiple separate roof structures, trace ONLY the CENTER one (the main house).
NEVER combine two separate buildings into one trace - this causes 100% measurement error!

Return a bounding box that FULLY ENCOMPASSES the SHINGLED/TILED ROOF - trace to the OUTERMOST EAVE EDGES.

CRITICAL: Do NOT make the box too tight! Include:
- All roof overhangs and eaves
- Attached garages (with shingled roof)
- All bump-outs, dormers, and extensions
- The COMPLETE L-shape or T-shape if applicable

ABSOLUTELY DO NOT INCLUDE:
- Detached garages or carports (SEPARATE buildings)
- Sheds or outbuildings
- Swimming pools or patios
- Screen enclosures (metal grid structures) - VERY common in Florida
- Covered patios with flat/metal roofs
- Adjacent guest houses or casitas
- Any structure that is PHYSICALLY SEPARATED from the main house

{
  "targetBuildingBounds": {
    "topLeftX": 32.0,
    "topLeftY": 28.0,
    "bottomRightX": 68.0,
    "bottomRightY": 72.0
  },
  "estimatedRoofWidthFt": 55,
  "estimatedRoofLengthFt": 70,
  "roofShape": "L-shaped|rectangular|T-shaped|complex",
  "otherBuildingsDetected": 1,
  "screenEnclosureDetected": false,
  "targetBuildingType": "residential",
  "confidenceTargetIsCorrect": "high",
  "multipleStructuresWarning": false
}

SIZING RULES:
1. The main house is CENTERED in the image (around 35-65% x and y range typically)
2. LARGER roofs (3000+ sqft) can span 35-45% of image width
3. Complex L-shaped or T-shaped roofs need WIDER bounds
4. Better to be slightly too large than miss roof edges
5. Minimum bounds width: 20% (for small homes)
6. Maximum bounds width: 50% (for large/complex homes)
7. If you detect 2+ buildings, set multipleStructuresWarning: true
8. Use DECIMAL precision (e.g., 32.5, not 33)
9. Return ONLY valid JSON, no explanation`

  console.log('🏠 Pass 1: Isolating target building with expanded bounds...')
  
  try {
    const response = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 1200
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Building isolation failed:', data)
      return { bounds: { topLeftX: 30, topLeftY: 30, bottomRightX: 70, bottomRightY: 70 }, confidence: 'low' }
    }
    
    const content = data.choices[0].message?.content || ''
    const defaultBounds = { topLeftX: 30, topLeftY: 30, bottomRightX: 70, bottomRightY: 70 }
    const result = safeParseJSON(content, { targetBuildingBounds: defaultBounds }, 'Building isolation')
    let bounds = result.targetBuildingBounds || defaultBounds
    
    // VALIDATION: More permissive for larger roofs
    const width = bounds.bottomRightX - bounds.topLeftX
    const height = bounds.bottomRightY - bounds.topLeftY
    
    // If Solar API indicates large building, allow larger bounds
    const maxAllowedSize = solarData?.buildingFootprintSqft > 3000 ? 50 : 45
    
    // Only reduce if clearly too large
    if (width > maxAllowedSize || height > maxAllowedSize) {
      console.warn(`⚠️ Detected bounds large (${width.toFixed(1)}% x ${height.toFixed(1)}%), capping at ${maxAllowedSize}%`)
      const detectedCenterX = (bounds.topLeftX + bounds.bottomRightX) / 2
      const detectedCenterY = (bounds.topLeftY + bounds.bottomRightY) / 2
      bounds = {
        topLeftX: detectedCenterX - maxAllowedSize / 2,
        topLeftY: detectedCenterY - maxAllowedSize / 2,
        bottomRightX: detectedCenterX + maxAllowedSize / 2,
        bottomRightY: detectedCenterY + maxAllowedSize / 2
      }
    }
    
    // Ensure minimum size
    const minSize = 18
    if (width < minSize) {
      const centerX = (bounds.topLeftX + bounds.bottomRightX) / 2
      bounds.topLeftX = centerX - minSize / 2
      bounds.bottomRightX = centerX + minSize / 2
    }
    if (height < minSize) {
      const centerY = (bounds.topLeftY + bounds.bottomRightY) / 2
      bounds.topLeftY = centerY - minSize / 2
      bounds.bottomRightY = centerY + minSize / 2
    }
    
    // Ensure building is roughly centered (within 25-75% range)
    const centerX = (bounds.topLeftX + bounds.bottomRightX) / 2
    const centerY = (bounds.topLeftY + bounds.bottomRightY) / 2
    if (centerX < 30 || centerX > 70 || centerY < 30 || centerY > 70) {
      console.warn(`⚠️ Building not centered (center at ${centerX.toFixed(1)}%, ${centerY.toFixed(1)}%), adjusting`)
      const shiftX = 50 - centerX
      const shiftY = 50 - centerY
      bounds = {
        topLeftX: bounds.topLeftX + shiftX,
        topLeftY: bounds.topLeftY + shiftY,
        bottomRightX: bounds.bottomRightX + shiftX,
        bottomRightY: bounds.bottomRightY + shiftY
      }
    }
    
    const finalWidth = bounds.bottomRightX - bounds.topLeftX
    const finalHeight = bounds.bottomRightY - bounds.topLeftY
    console.log(`✅ Pass 1 complete: bounds (${bounds.topLeftX.toFixed(1)}%, ${bounds.topLeftY.toFixed(1)}%) to (${bounds.bottomRightX.toFixed(1)}%, ${bounds.bottomRightY.toFixed(1)}%), size: ${finalWidth.toFixed(1)}% x ${finalHeight.toFixed(1)}%`)
    
    return { 
      bounds, 
      otherBuildings: result.otherBuildingsDetected || 0,
      confidence: result.confidenceTargetIsCorrect || 'medium',
      roofShape: result.roofShape || 'rectangular',
      estimatedDimensions: {
        widthFt: result.estimatedRoofWidthFt || 50,
        lengthFt: result.estimatedRoofLengthFt || 60
      }
    }
  } catch (err) {
    console.error('Building isolation error:', err)
    return { bounds: { topLeftX: 30, topLeftY: 30, bottomRightX: 70, bottomRightY: 70 }, confidence: 'low' }
  }
}

// PASS 2: Detect perimeter vertices - FULL IMAGE TRACING for Planimeter accuracy
async function detectPerimeterVertices(
  imageUrl: string, 
  bounds: any,
  solarData?: any,
  coordinates?: { lat: number; lng: number },
  imageSize: number = 640
) {
  if (!imageUrl) {
    return { vertices: [], roofType: 'unknown', complexity: 'moderate', vertexStats: {}, perimeterValidation: null }
  }

  // Calculate expected metrics from Solar API
  let expectedMetrics = ''
  if (solarData?.available && solarData?.buildingFootprintSqft) {
    const expectedAreaSqft = solarData.buildingFootprintSqft
    const expectedPerimeterFt = solarData.estimatedPerimeterFt || 4 * Math.sqrt(expectedAreaSqft)
    const expectedVertices = Math.ceil(expectedPerimeterFt / 20)
    expectedMetrics = `
VALIDATION TARGETS (from satellite data):
- Expected flat area: ~${expectedAreaSqft.toFixed(0)} sqft
- Expected perimeter: ~${expectedPerimeterFt.toFixed(0)} ft
- Expected vertices: ${expectedVertices} or more
- If your perimeter is < ${(expectedPerimeterFt * 0.85).toFixed(0)} ft, you're MISSING CORNERS`
  }

  const boundsWidth = bounds.bottomRightX - bounds.topLeftX
  const boundsHeight = bounds.bottomRightY - bounds.topLeftY
  
  // Detect if this is a Florida property (high likelihood of screen enclosures)
  const addressStr = JSON.stringify(coordinates || {})
  const isFlorida = isFloridaAddress(addressStr)
  
  const screenEnclosureWarning = isFlorida ? `
════════════════════════════════════════════════════════════════════════════════
🌴 FLORIDA PROPERTY - SCREEN ENCLOSURE WARNING - CRITICAL!
════════════════════════════════════════════════════════════════════════════════

Florida properties commonly have SCREEN ENCLOSURES (pool cages, lanais) that are 
NOT part of the main roof. These MUST be EXCLUDED from your trace!

HOW TO IDENTIFY SCREEN ENCLOSURES:
- GRID PATTERN of thin metal frames (aluminum)
- Usually rectangular shape attached to back of house
- Covers pool, patio, or outdoor living area
- Flat or very low slope (not shingled/tiled)
- Lighter color than main roof (often white/silver aluminum)
- May have panels missing or irregular grid lines

TRACE ONLY THE SHINGLED/TILED MAIN ROOF!
Do NOT trace:
- Pool cages or screen enclosures
- Covered lanais with metal/flat roofs
- Carports or attached pergolas
- Any structure with visible grid pattern

If you see a rectangular structure at the back of the house with a grid pattern,
that is a SCREEN ENCLOSURE - DO NOT INCLUDE IT!
` : ''

  const prompt = `You are a PROFESSIONAL ROOF MEASUREMENT EXPERT matching PLANIMETER/EAGLEVIEW accuracy (98%+).

CRITICAL MISSION: Trace the COMPLETE roof boundary as a CLOSED POLYGON with EVERY SINGLE VERTEX.
This measurement will be used for a real roofing estimate - missing even ONE corner causes 5-15% area error!

The target building is within bounds: top-left (${bounds.topLeftX.toFixed(1)}%, ${bounds.topLeftY.toFixed(1)}%) to bottom-right (${bounds.bottomRightX.toFixed(1)}%, ${bounds.bottomRightY.toFixed(1)}%)
Approximate building size: ${boundsWidth.toFixed(1)}% x ${boundsHeight.toFixed(1)}% of image
${expectedMetrics}
${screenEnclosureWarning}
════════════════════════════════════════════════════════════════════════════════
⚠️ CRITICAL ACCURACY RULES - STAY ON THE ROOF!
════════════════════════════════════════════════════════════════════════════════

1. Trace ONLY where shingles/tiles meet the sky (the EAVE EDGE/drip line)
2. Stay INSIDE the roof - do NOT trace shadows, ground, or landscaping
3. For hip corners, trace the EXACT corner vertex where edges meet
4. If unsure about a corner location, place it CLOSER to center, NOT further out
5. Over-estimating is WORSE than under-estimating!
6. EXCLUDE all screen enclosures, pool cages, lanais, carports, pergolas!

════════════════════════════════════════════════════════════════════════════════
🎯 VERTEX PLACEMENT - ACCURATE TRACING (NOT BIASED)
════════════════════════════════════════════════════════════════════════════════

TRACE THE ACTUAL DRIP EDGE PRECISELY - DO NOT BIAS INWARD OR OUTWARD:
- Trace the EXACT drip edge/eave line where shingles/tiles meet the sky
- Do NOT add artificial shrinkage or padding
- Do NOT trace shadows - trace the ROOF EDGE ITSELF
- If shadow obscures the edge, use ridge alignment + neighboring edges to estimate
- Accuracy is the goal - not under-estimating or over-estimating

VERTEX COUNT REFERENCE (for validation):
- 1500 sqft home: 4-8 vertices
- 2000 sqft home: 6-12 vertices  
- 2500 sqft home: 8-14 vertices
- 3000 sqft home: 10-16 vertices
- 3500+ sqft home: 12-20+ vertices

If your trace seems too SMALL compared to the satellite reference, you may be:
- Missing bump-outs, garage extensions, or L-shaped sections
- Tracing too far INSIDE the actual roof edge

════════════════════════════════════════════════════════════════════════════════
PLANIMETER-STYLE SEGMENT-BY-SEGMENT TRACING
════════════════════════════════════════════════════════════════════════════════

STEP 1: Find the OUTERMOST roof edges (the drip edge/eave line) - EXCLUDE screen enclosures!
STEP 2: Start at the TOPMOST (northernmost) point of the MAIN ROOF
STEP 3: Trace CLOCKWISE around the ENTIRE roof perimeter
STEP 4: Place a vertex at EVERY direction change - even small 3-4 foot jogs
STEP 5: Return to starting point
STEP 6: VERIFY you did NOT include any screen enclosures or pool cages!

VERTEX REQUIREMENTS (NON-NEGOTIABLE):
- Minimum 12 vertices for any residential roof
- L-shaped homes: 8+ vertices minimum (2 corners per jog)
- T-shaped homes: 12+ vertices minimum  
- Complex/cross-gable: 16-30+ vertices
- Each straight wall segment should be 15-40 feet (if longer, you're missing a corner!)

COMMON MISTAKES TO AVOID:
❌ Cutting corners by simplifying to a rectangle (4-6 vertices)
❌ Missing small bump-outs for bay windows, chimneys, or dormers
❌ Tracing BEYOND the visible shingle line (including ground/shadows)
❌ Missing garage extensions or step-downs
❌ Segments > 50 feet without a vertex = MISSING A CORNER
❌ Tracing OUTSIDE the roof edge - this causes OVER-ESTIMATION
❌ INCLUDING SCREEN ENCLOSURES OR POOL CAGES (Florida properties!)
❌ Adding extra vertices on STRAIGHT EAVES - keep straight edges straight!
❌ Creating zigzag patterns where the eave is actually a SINGLE STRAIGHT LINE

════════════════════════════════════════════════════════════════════════════════
🏠 STRAIGHT EDGES & EYEBROW FEATURES - CRITICAL!
════════════════════════════════════════════════════════════════════════════════

*** STRAIGHT EAVES (MOST IMPORTANT) ***
Look carefully at each eave edge. If it runs in a STRAIGHT LINE from corner to corner 
with no visible bends or direction changes, trace it with ONLY TWO VERTICES (start and end).

DO NOT add intermediate vertices on straight edges! This creates artificial "zigzag" 
patterns that corrupt the measurement. The southern eave is especially likely to be 
one straight line - verify it before adding extra vertices.

BAD EXAMPLE (do NOT do this):
  Eave with 5 vertices creating zigzag: (10,80) -> (20,81) -> (30,79) -> (40,80) -> (50,80)
  
GOOD EXAMPLE:
  Straight eave with 2 vertices: (10,80) -> (50,80)

*** EYEBROW/DORMER FEATURES (SKIP SMALL ONES) ***
"Eyebrows" are small bump-out features that deviate less than 3-4 feet from the main 
roof line. These include:
- Small decorative dormers
- Minor step-backs in the roofline  
- Shadow artifacts that look like small indentations
- Architectural details that don't affect roof area

RULE: If a feature deviates LESS than 4 feet from the main roof line, SKIP IT entirely!
Continue tracing the main roof edge as if the eyebrow doesn't exist. This prevents
chaotic linear feature generation.

CORNER TYPES (classify each):
- "hip-corner": Diagonal 45° corner where hip meets eave
- "valley-entry": Interior corner where roof goes inward (concave)
- "gable-peak": Top point of triangular gable end
- "eave-corner": 90° convex corner where two eaves meet
- "rake-corner": Bottom corner where rake meets eave
- "bump-out-corner": Small extension corner (garage, bay window)

EXCLUDE FROM TRACING:
- Screen enclosures (metal grid structures) - CRITICAL for Florida!
- Covered patios with flat/metal roofs
- Carports, awnings, pergolas
- Adjacent outbuildings
- Pool cages (aluminum frame structures)
- Small dormers/eyebrows under 4ft deviation from main roof line

════════════════════════════════════════════════════════════════════════════════
RESPONSE FORMAT (JSON only)
════════════════════════════════════════════════════════════════════════════════

{
  "roofType": "hip|gable|cross-gable|cross-hip|hip-with-dormers|dutch-gable|complex",
  "complexity": "simple|moderate|complex|very-complex",
  "estimatedFacetCount": 6,
  "roofMaterial": "shingle|tile|metal",
  "screenEnclosureDetected": false,
  "screenEnclosureExcluded": false,
  "vertices": [
    {"x": 32.50, "y": 28.00, "cornerType": "hip-corner", "edgeLengthToNextFt": 35},
    {"x": 48.20, "y": 27.50, "cornerType": "eave-corner", "edgeLengthToNextFt": 18},
    {"x": 52.00, "y": 30.00, "cornerType": "bump-out-corner", "edgeLengthToNextFt": 8},
    ...continue clockwise tracing ALL corners...
  ],
  "segmentValidation": {
    "totalVertexCount": 16,
    "estimatedPerimeterFt": 310,
    "avgSegmentLengthFt": 19.4,
    "longestSegmentFt": 38,
    "shortestSegmentFt": 6,
    "segmentLengths": [35, 18, 8, 22, 15, 28, 12, 35, 20, 22, 10, 8, 25, 18, 12, 22]
  },
  "qualityCheck": {
    "allCornersIdentified": true,
    "noSegmentsOver50ft": true,
    "perimeterMatchesExpected": true,
    "areaWillBeAccurate": true,
    "screenEnclosuresExcluded": true
  }
}

ACCURACY REQUIREMENTS:
- DECIMAL PRECISION required (34.72 not 35)
- Each vertex accurate to within 1-2 feet
- Total area from these vertices must be within 5% of actual
- Perimeter should match expected ±15%
- NO SCREEN ENCLOSURES INCLUDED!

Return ONLY valid JSON, no explanation.`

  console.log('📐 Pass 2: Full-image Planimeter-quality vertex detection...')
  
  try {
    const response = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 6000
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Perimeter detection failed:', data)
      return { vertices: createFallbackPerimeter(bounds), roofType: 'unknown', complexity: 'moderate', vertexStats: {}, perimeterValidation: null }
    }
    
    const content = data.choices[0].message?.content || ''
    const result = safeParseJSON(content, { vertices: [] }, 'Perimeter detection')
    const vertices = result.vertices || []
    
    // Validate vertices are within reasonable bounds (expanded tolerance)
    const validVertices = vertices.filter((v: any) => 
      v.x >= 5 && v.x <= 95 && v.y >= 5 && v.y <= 95
    )
    
    // Extract vertex statistics
    const vertexStats = {
      hipCornerCount: validVertices.filter((v: any) => v.cornerType === 'hip-corner').length,
      valleyEntryCount: validVertices.filter((v: any) => v.cornerType === 'valley-entry').length,
      gablePeakCount: validVertices.filter((v: any) => v.cornerType === 'gable-peak').length,
      eaveCornerCount: validVertices.filter((v: any) => v.cornerType === 'eave-corner').length,
      rakeCornerCount: validVertices.filter((v: any) => v.cornerType === 'rake-corner').length,
      bumpOutCornerCount: validVertices.filter((v: any) => v.cornerType === 'bump-out-corner').length,
      totalCount: validVertices.length,
      estimatedFacetCount: result.estimatedFacetCount || 4
    }
    
    const segmentValidation = result.segmentValidation || {
      totalVertexCount: validVertices.length,
      estimatedPerimeterFt: 0,
      segmentLengths: []
    }
    
    console.log(`✅ Pass 2 complete: ${validVertices.length} perimeter vertices detected`)
    console.log(`   Breakdown: ${vertexStats.hipCornerCount} hip, ${vertexStats.valleyEntryCount} valley, ${vertexStats.gablePeakCount} gable, ${vertexStats.eaveCornerCount} eave, ${vertexStats.bumpOutCornerCount} bump-out`)
    console.log(`   Perimeter estimate: ~${segmentValidation.estimatedPerimeterFt || 'unknown'} ft`)
    
    if (segmentValidation.segmentLengths?.length > 0) {
      console.log(`   Segments (ft): ${segmentValidation.segmentLengths.join(', ')}`)
      const longSegments = segmentValidation.segmentLengths.filter((len: number) => len > 50)
      if (longSegments.length > 0) {
        console.warn(`   ⚠️ ${longSegments.length} segments > 50ft: ${longSegments.join(', ')} ft`)
      }
    }
    
    // PHASE 6: ADAPTIVE shrinkage - ONLY apply if we detect over-tracing
    // Compare detected area to Solar API footprint - only shrink if we're significantly OVER
    let finalVertices = validVertices.length >= 4 ? validVertices : createFallbackPerimeter(bounds)
    let shrinkageApplied = false
    
    if (solarData?.available && solarData?.buildingFootprintSqft) {
      // Calculate rough area from vertices (using simplified polygon area calculation)
      const detectedArea = calculatePolygonAreaFromPixelVertices(validVertices, bounds)
      const solarFootprint = solarData.buildingFootprintSqft
      const overageRatio = detectedArea / solarFootprint
      
      // Only shrink if we're MORE than 10% OVER the Solar footprint
      if (overageRatio > 1.10) {
        const shrinkFactor = Math.min(0.03, (overageRatio - 1.0) * 0.15) // Max 3% shrink
        console.log(`📐 Over-trace detected: ${detectedArea.toFixed(0)} sqft vs Solar ${solarFootprint.toFixed(0)} sqft (${((overageRatio - 1) * 100).toFixed(1)}% over) - applying ${(shrinkFactor * 100).toFixed(1)}% shrinkage`)
        finalVertices = applyVertexShrinkage(validVertices, shrinkFactor)
        shrinkageApplied = true
      } else if (overageRatio < 0.90) {
        // We're UNDER - log warning but do NOT shrink
        console.warn(`⚠️ Under-trace detected: ${detectedArea.toFixed(0)} sqft vs Solar ${solarFootprint.toFixed(0)} sqft (${((1 - overageRatio) * 100).toFixed(1)}% under) - NO shrinkage applied`)
      } else {
        console.log(`✅ Trace within tolerance: ${detectedArea.toFixed(0)} sqft vs Solar ${solarFootprint.toFixed(0)} sqft (${((overageRatio - 1) * 100).toFixed(1)}% variance)`)
      }
    } else {
      console.log(`📐 No Solar reference available - skipping shrinkage validation`)
    }
    
    // PHASE 6: Validate vertices aren't too far from bounds
    const distanceValidation = validateVertexDistances(finalVertices, bounds)
    if (!distanceValidation.valid) {
      console.warn(`⚠️ ${distanceValidation.outliers} vertices flagged as outliers`)
    }
    
    return { 
      vertices: finalVertices,
      roofType: result.roofType || 'complex',
      complexity: result.complexity || 'moderate',
      vertexStats,
      estimatedFacetCount: result.estimatedFacetCount,
      qualityCheck: result.qualityCheck,
      segmentValidation,
      perimeterValidation: {
        estimatedPerimeterFt: segmentValidation.estimatedPerimeterFt,
        vertexCount: finalVertices.length,
        avgSegmentLength: segmentValidation.avgSegmentLengthFt,
        longestSegment: segmentValidation.longestSegmentFt,
        segmentLengths: segmentValidation.segmentLengths
      },
      vertexShrinkageApplied: shrinkageApplied
    }
  } catch (err) {
    console.error('Perimeter detection error:', err)
    return { vertices: createFallbackPerimeter(bounds), roofType: 'unknown', complexity: 'moderate', vertexStats: {}, perimeterValidation: null }
  }
}

// NEW: Corner completion pass - focuses on finding missing corners along long segments
async function detectPerimeterVerticesWithCornerFocus(
  imageUrl: string,
  expandedBounds: any,
  previousVertices: any[],
  longSegments: { index: number; lengthFt: number }[],
  solarData?: any,
  coordinates?: { lat: number; lng: number },
  imageSize: number = 640
) {
  // Build context about what's missing
  const longSegmentInfo = longSegments.map(s => {
    const v1 = previousVertices[s.index]
    const v2 = previousVertices[(s.index + 1) % previousVertices.length]
    return `Segment ${s.index}: (${v1.x.toFixed(1)}%, ${v1.y.toFixed(1)}%) to (${v2.x.toFixed(1)}%, ${v2.y.toFixed(1)}%) = ${s.lengthFt.toFixed(0)}ft`
  }).join('\n')

  const prompt = `You are a ROOF MEASUREMENT EXPERT performing a CORNER COMPLETION CHECK.

A previous measurement detected ${previousVertices.length} vertices, but analysis shows MISSING CORNERS.

PROBLEM AREAS - These segments are TOO LONG and likely have undetected corners:
${longSegmentInfo}

TASK: Re-trace the roof perimeter and ADD any missing vertices, especially:
1. Small bump-outs (garage extensions, bay windows)
2. Step-downs where roof levels change
3. L-shape or T-shape corners that were simplified
4. Interior angles (valley entries)

Current vertices (for reference):
${previousVertices.slice(0, 5).map((v, i) => `${i}: (${v.x.toFixed(1)}%, ${v.y.toFixed(1)}%) ${v.cornerType || ''}`).join('\n')}
...and ${previousVertices.length - 5} more

Search area: (${expandedBounds.topLeftX.toFixed(1)}%, ${expandedBounds.topLeftY.toFixed(1)}%) to (${expandedBounds.bottomRightX.toFixed(1)}%, ${expandedBounds.bottomRightY.toFixed(1)}%)

Return the COMPLETE vertex list with ALL corners, including the ones previously detected plus any new ones found.

{
  "vertices": [
    {"x": 32.00, "y": 28.50, "cornerType": "hip-corner", "edgeLengthToNextFt": 28},
    {"x": 42.50, "y": 28.00, "cornerType": "bump-out-corner", "edgeLengthToNextFt": 12, "isNewlyDetected": true},
    ...complete list clockwise...
  ],
  "roofType": "L-shaped",
  "complexity": "complex",
  "newVerticesFound": 3,
  "segmentValidation": {
    "totalVertexCount": 19,
    "estimatedPerimeterFt": 305,
    "longestSegmentFt": 35
  }
}

Return ONLY valid JSON.`

  console.log('🔄 Corner completion pass: Looking for ${longSegments.length} missing corners...')
  
  try {
    const response = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 6000
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Corner completion failed:', data)
      return { vertices: previousVertices, roofType: 'unknown', complexity: 'moderate', vertexStats: {}, perimeterValidation: null }
    }
    
    const content = data.choices[0].message?.content || ''
    const result = safeParseJSON(content, { vertices: previousVertices }, 'Corner completion')
    const vertices = result.vertices || []
    
    const validVertices = vertices.filter((v: any) => 
      v.x >= 5 && v.x <= 95 && v.y >= 5 && v.y <= 95
    )
    
    const newlyDetected = validVertices.filter((v: any) => v.isNewlyDetected).length
    console.log(`✅ Corner completion: ${validVertices.length} total vertices (${newlyDetected} newly detected)`)
    
    const vertexStats = {
      hipCornerCount: validVertices.filter((v: any) => v.cornerType === 'hip-corner').length,
      valleyEntryCount: validVertices.filter((v: any) => v.cornerType === 'valley-entry').length,
      gablePeakCount: validVertices.filter((v: any) => v.cornerType === 'gable-peak').length,
      eaveCornerCount: validVertices.filter((v: any) => v.cornerType === 'eave-corner').length,
      bumpOutCornerCount: validVertices.filter((v: any) => v.cornerType === 'bump-out-corner').length,
      totalCount: validVertices.length
    }
    
    return { 
      vertices: validVertices,
      roofType: result.roofType || 'complex',
      complexity: result.complexity || 'complex',
      vertexStats,
      segmentValidation: result.segmentValidation,
      newVerticesFound: result.newVerticesFound || newlyDetected
    }
  } catch (err) {
    console.error('Corner completion error:', err)
    return { vertices: previousVertices, roofType: 'unknown', complexity: 'moderate', vertexStats: {}, perimeterValidation: null }
  }
}

function createFallbackPerimeter(bounds: any): Vertex[] {
  return [
    { x: bounds.topLeftX, y: bounds.topLeftY, type: 'corner' },
    { x: bounds.bottomRightX, y: bounds.topLeftY, type: 'corner' },
    { x: bounds.bottomRightX, y: bounds.bottomRightY, type: 'corner' },
    { x: bounds.topLeftX, y: bounds.bottomRightY, type: 'corner' }
  ]
}

// PASS 3: Detect interior junction points
async function detectInteriorJunctions(imageUrl: string, perimeterVertices: any[], bounds: any) {
  if (!imageUrl || perimeterVertices.length < 4) {
    return { junctions: [], ridgeEndpoints: [], valleyJunctions: [] }
  }

  const hipCorners = perimeterVertices.filter((v: any) => v.cornerType === 'hip-corner').length
  const valleyEntries = perimeterVertices.filter((v: any) => v.cornerType === 'valley-entry').length
  const gablePeaks = perimeterVertices.filter((v: any) => v.cornerType === 'gable-peak').length
  
  const prompt = `You are a professional roof measurement expert. Detect ALL INTERIOR JUNCTION POINTS where roof features meet.

The roof perimeter has ${perimeterVertices.length} vertices including ${hipCorners} hip-corners, ${valleyEntries} valley-entries, and ${gablePeaks} gable-peaks.

TASK: Identify every INTERIOR vertex where roof lines intersect:

INTERIOR JUNCTION TYPES:
- "ridge-hip-junction": Where the main ridge line terminates and hips branch out
- "ridge-valley-junction": Where ridge meets a valley (T-intersection)  
- "hip-hip-junction": Where two hip lines meet at the apex
- "valley-hip-junction": Where a valley line meets a hip line
- "ridge-termination": Where a ridge ends
- "hip-peak": Central peak where multiple hips converge

RESPONSE FORMAT:
{
  "junctions": [
    {"x": 38.50, "y": 48.00, "type": "ridge-hip-junction", "connectedHipCount": 2},
    {"x": 62.20, "y": 47.50, "type": "ridge-hip-junction", "connectedHipCount": 2}
  ],
  "ridgeEndpoints": [
    {"x": 38.50, "y": 48.00},
    {"x": 62.20, "y": 47.50}
  ],
  "valleyJunctions": [],
  "roofPeakType": "single-ridge",
  "ridgeCount": 1,
  "estimatedHipLineCount": 4
}

Return ONLY valid JSON.`

  try {
    const response = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 3000
      })
    })

    const data = await response.json()
    if (!response.ok || !data.choices?.[0]) {
      console.error('Interior junction detection failed:', data)
      return { junctions: [], ridgeEndpoints: [], valleyJunctions: [] }
    }
    
    const content = data.choices[0].message?.content || ''
    const result = safeParseJSON(content, { junctions: [], ridgeEndpoints: [], valleyJunctions: [] }, 'Interior junctions')
    
    // Validate junctions are within bounds
    const validJunctions = (result.junctions || []).filter((j: any) =>
      j.x >= bounds.topLeftX - 5 && j.x <= bounds.bottomRightX + 5 &&
      j.y >= bounds.topLeftY - 5 && j.y <= bounds.bottomRightY + 5
    )
    
    console.log(`✅ Pass 3 complete: ${validJunctions.length} interior junctions detected`)
    
    return { 
      junctions: validJunctions,
      ridgeEndpoints: result.ridgeEndpoints || [],
      valleyJunctions: result.valleyJunctions || [],
      roofPeakType: result.roofPeakType,
      ridgeCount: result.ridgeCount,
      estimatedHipLineCount: result.estimatedHipLineCount
    }
  } catch (err) {
    console.error('Interior junction detection error:', err)
    return { junctions: [], ridgeEndpoints: [], valleyJunctions: [] }
  }
}

// NEW: AI Vision Ridge Detection - detect ACTUAL ridge line positions from satellite image
interface AIRidgeLine {
  startX: number; // % of image
  startY: number;
  endX: number;
  endY: number;
  confidence: number;
  lengthFt?: number;
}

interface AIRidgeDetectionResult {
  ridgeLines: AIRidgeLine[];
  roofType: string;
  ridgeDirection: 'horizontal' | 'vertical' | 'diagonal' | 'multiple';
  averageConfidence: number;
  source: 'ai_vision' | 'geometric_fallback';
}

async function detectRidgeLinesFromImage(
  imageUrl: string,
  perimeterVertices: any[],
  bounds: any,
  coordinates: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): Promise<AIRidgeDetectionResult> {
  const fallbackResult: AIRidgeDetectionResult = {
    ridgeLines: [],
    roofType: 'unknown',
    ridgeDirection: 'horizontal',
    averageConfidence: 0,
    source: 'geometric_fallback'
  };
  
  if (!imageUrl || perimeterVertices.length < 4) {
    return fallbackResult;
  }

  // Build perimeter context for AI
  const perimeterInfo = perimeterVertices.slice(0, 8).map((v: any, i: number) => 
    `${i}: (${v.x.toFixed(1)}%, ${v.y.toFixed(1)}%) ${v.cornerType || ''}`
  ).join('\n');

  const prompt = `You are an expert roof analyst with advanced pattern recognition skills. Your CRITICAL task is to VISUALLY TRACE the exact ridge and hip line positions from this satellite/aerial imagery.

## WHAT TO LOOK FOR - VISUAL CUES:
1. **SHADOW PATTERNS**: Ridges create a distinct LIGHT/DARK boundary. One side catches sun, the other is shadowed.
2. **COLOR TRANSITIONS**: Ridge lines often show as a subtle color change where two roof planes meet.
3. **SHINGLE DIRECTION CHANGES**: Where shingle rows change direction indicates a ridge or hip.
4. **ROOF PEAK LINES**: The HIGHEST points form continuous lines across the roof.

## RIDGE vs HIP:
- **RIDGE**: Runs along the TOP of the roof, parallel to building length. Both sides slope DOWN from it.
- **HIP**: Diagonal lines from building CORNERS to ridge ENDPOINTS. Slopes DOWN on both sides.

PERIMETER CONTEXT (${perimeterVertices.length} vertices):
${perimeterInfo}
${perimeterVertices.length > 8 ? `...and ${perimeterVertices.length - 8} more vertices` : ''}

Bounds: (${bounds.topLeftX.toFixed(1)}%, ${bounds.topLeftY.toFixed(1)}%) to (${bounds.bottomRightX.toFixed(1)}%, ${bounds.bottomRightY.toFixed(1)}%)

## CRITICAL DETECTION RULES:
1. **TRACE WHAT YOU SEE** - Follow the actual visible ridge/shadow line, NOT theoretical geometry
2. Ridge should be INSIDE the perimeter by 10-20% from edges (not at the perimeter itself)
3. For rectangular buildings: ridge typically at 50% of width, running parallel to length
4. For hip roofs: ridge is SHORTER than building - it stops where hips connect (inset from corners)
5. Look for the characteristic "X" or "Y" pattern where hips meet the ridge endpoints
6. **EVEN IF UNCERTAIN**, provide your best estimate with lower confidence (50-70%)

## RESPONSE FORMAT (JSON only):
{
  "ridgeLines": [
    {
      "startX": 25.0,
      "startY": 48.0,
      "endX": 75.0,
      "endY": 48.5,
      "confidence": 85,
      "notes": "Main ridge - clear shadow boundary running E-W"
    }
  ],
  "hipLines": [
    {
      "startX": 15.0,
      "startY": 20.0,
      "endX": 25.0,
      "endY": 48.0,
      "confidence": 80,
      "notes": "NW hip from corner to ridge start"
    }
  ],
  "roofType": "hip" | "gable" | "cross-hip" | "L-shaped" | "complex",
  "ridgeDirection": "horizontal" | "vertical" | "diagonal" | "multiple",
  "ridgeCount": 1,
  "qualityNotes": "Description of imagery quality and detection confidence"
}

IMPORTANT: Return ONLY valid JSON. Detect ALL visible ridges and hips.`;

  try {
    const response = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        max_completion_tokens: 2000
      })
    });

    const data = await response.json();
    if (!response.ok || !data.choices?.[0]) {
      console.error('AI ridge detection failed:', data);
      return fallbackResult;
    }
    
    const content = data.choices[0].message?.content || '';
    const result = safeParseJSON(content, { ridgeLines: [] }, 'AI Ridge detection');
    const ridgeLines = (result.ridgeLines || []).filter((r: any) =>
      r.startX >= 5 && r.startX <= 95 && r.startY >= 5 && r.startY <= 95 &&
      r.endX >= 5 && r.endX <= 95 && r.endY >= 5 && r.endY <= 95 &&
      r.confidence >= 60
    );
    
    // Calculate average confidence
    const avgConfidence = ridgeLines.length > 0
      ? ridgeLines.reduce((sum: number, r: any) => sum + r.confidence, 0) / ridgeLines.length
      : 0;
    
    // Calculate ridge lengths in feet
    const ridgeLinesWithLength = ridgeLines.map((ridge: any) => {
      const startGeo = pixelToGeoInternal(ridge.startX, ridge.startY, coordinates, imageSize, zoom);
      const endGeo = pixelToGeoInternal(ridge.endX, ridge.endY, coordinates, imageSize, zoom);
      const lengthFt = calculateDistanceFt(startGeo.lat, startGeo.lng, endGeo.lat, endGeo.lng);
      return { ...ridge, lengthFt };
    });
    
    console.log(`🎯 AI Ridge Detection: Found ${ridgeLinesWithLength.length} ridge(s), avg confidence ${avgConfidence.toFixed(0)}%`);
    ridgeLinesWithLength.forEach((r: any, i: number) => {
      console.log(`   Ridge ${i + 1}: (${r.startX.toFixed(1)}%, ${r.startY.toFixed(1)}%) to (${r.endX.toFixed(1)}%, ${r.endY.toFixed(1)}%) = ${r.lengthFt?.toFixed(0) || '?'}ft, conf=${r.confidence}%`);
    });
    
    return {
      ridgeLines: ridgeLinesWithLength,
      roofType: result.roofType || 'unknown',
      ridgeDirection: result.ridgeDirection || 'horizontal',
      averageConfidence: avgConfidence,
      source: 'ai_vision'
    };
  } catch (err) {
    console.error('AI ridge detection error:', err);
    return fallbackResult;
  }
}

// calculateDistanceFt is now imported from roof-analysis-helpers.ts

// Derive lines from vertices - PRIMARY: Use new roof geometry reconstructor for clean topology
// NOW accepts AI-detected ridge positions for accurate placement
function deriveLinesToPerimeter(
  perimeterVertices: any[],
  junctions: any[],
  ridgeEndpoints: any[],
  bounds: any,
  coordinates?: { lat: number; lng: number },
  imageSize: number = 640,
  zoom: number = 20,
  aiRidgeDetection?: AIRidgeDetectionResult
): DerivedLine[] {
  const lines: DerivedLine[] = []
  
  if (!perimeterVertices || perimeterVertices.length < 3) {
    return lines
  }
  
  // PRIORITY 1: Use AI-detected ridge lines if confidence is high enough
  // LOWERED from 75% to 55% to reduce skeleton fallback rate
  if (aiRidgeDetection && aiRidgeDetection.ridgeLines.length > 0 && aiRidgeDetection.averageConfidence >= 55) {
    console.log(`🎯 Using AI-detected ridge positions (confidence: ${aiRidgeDetection.averageConfidence.toFixed(0)}%)`);
    
    // Add AI-detected ridge lines
    aiRidgeDetection.ridgeLines.forEach((ridge, i) => {
      lines.push({
        type: 'ridge',
        startX: ridge.startX,
        startY: ridge.startY,
        endX: ridge.endX,
        endY: ridge.endY,
        source: 'ai_vision_detected'
      });
    });
    
    // Connect hip corners to NEAREST AI-detected ridge endpoint
    const ridgePoints: { x: number; y: number }[] = [];
    aiRidgeDetection.ridgeLines.forEach(ridge => {
      ridgePoints.push({ x: ridge.startX, y: ridge.startY });
      ridgePoints.push({ x: ridge.endX, y: ridge.endY });
    });
    
    const hipCorners = perimeterVertices.filter((v: any) => 
      v.cornerType === 'hip-corner' || v.type === 'hip-corner'
    );
    
    // If no hip corners detected, use the 4 farthest corners from center
    const cornersToConnect = hipCorners.length >= 3 ? hipCorners : findFourMainCorners(perimeterVertices);
    
    cornersToConnect.forEach((corner: any) => {
      const nearestRidge = findNearestPoint(corner, ridgePoints);
      if (nearestRidge) {
        const hipLength = distance(corner, nearestRidge);
        if (hipLength > 3 && hipLength < 50) {
          lines.push({
            type: 'hip',
            startX: corner.x,
            startY: corner.y,
            endX: nearestRidge.x,
            endY: nearestRidge.y,
            source: 'ai_ridge_connected'
          });
        }
      }
    });
    
    // Add valleys from valley-entry vertices to ridge
    const valleyEntries = perimeterVertices.filter((v: any) => 
      v.cornerType === 'valley-entry' || v.type === 'valley-entry'
    );
    
    valleyEntries.forEach((entry: any) => {
      const nearestRidge = findNearestPoint(entry, ridgePoints);
      if (nearestRidge) {
        lines.push({
          type: 'valley',
          startX: entry.x,
          startY: entry.y,
          endX: nearestRidge.x,
          endY: nearestRidge.y,
          source: 'ai_ridge_connected'
        });
      }
    });
    
    // Add perimeter edges as eaves/rakes
    addPerimeterEdges(lines, perimeterVertices);
    
    const dedupedLines = removeDuplicateLines(lines);
    console.log(`📐 AI Ridge mode: ${dedupedLines.filter(l => l.type === 'ridge').length} ridges, ${dedupedLines.filter(l => l.type === 'hip').length} hips`);
    return dedupedLines;
  }
  
  // FALLBACK: Geometric estimation when AI ridge detection unavailable or low confidence
  // PRIMARY: Use new roof geometry reconstructor for clean, connected topology
  let usedReconstructor = false
  
  if (coordinates) {
    try {
      console.log(`🔧 Using roof geometry reconstructor for ${perimeterVertices.length} vertices...`)
      
      // Convert perimeter vertices (pixel %) to lat/lng
      const geoRing = perimeterVerticesToGeo(perimeterVertices, coordinates, imageSize, zoom)
      
      if (geoRing.length >= 3) {
        // Use reconstructor for clean, connected roof geometry
        const roofGeometry = reconstructRoofGeometry(geoRing, [], '6/12')
        
        const totalLines = roofGeometry.ridges.length + roofGeometry.hips.length + roofGeometry.valleys.length
        console.log(`📏 Reconstructor: ${roofGeometry.ridges.length} ridges, ${roofGeometry.hips.length} hips, ${roofGeometry.valleys.length} valleys (quality: ${roofGeometry.diagramQuality})`)
        
        // Convert geometry back to pixel coordinates
        roofGeometry.ridges.forEach((ridge, i) => {
          const startPx = geoToPixel(ridge.start[1], ridge.start[0], coordinates, imageSize, zoom)
          const endPx = geoToPixel(ridge.end[1], ridge.end[0], coordinates, imageSize, zoom)
          
          if (isValidPixelCoord(startPx) && isValidPixelCoord(endPx)) {
            lines.push({
              type: 'ridge',
              startX: startPx.x,
              startY: startPx.y,
              endX: endPx.x,
              endY: endPx.y,
              source: 'geometry_reconstructor'
            })
          }
        })
        
        roofGeometry.hips.forEach((hip, i) => {
          const startPx = geoToPixel(hip.start[1], hip.start[0], coordinates, imageSize, zoom)
          const endPx = geoToPixel(hip.end[1], hip.end[0], coordinates, imageSize, zoom)
          
          if (isValidPixelCoord(startPx) && isValidPixelCoord(endPx)) {
            lines.push({
              type: 'hip',
              startX: startPx.x,
              startY: startPx.y,
              endX: endPx.x,
              endY: endPx.y,
              source: 'geometry_reconstructor'
            })
          }
        })
        
        roofGeometry.valleys.forEach((valley, i) => {
          const startPx = geoToPixel(valley.start[1], valley.start[0], coordinates, imageSize, zoom)
          const endPx = geoToPixel(valley.end[1], valley.end[0], coordinates, imageSize, zoom)
          
          if (isValidPixelCoord(startPx) && isValidPixelCoord(endPx)) {
            lines.push({
              type: 'valley',
              startX: startPx.x,
              startY: startPx.y,
              endX: endPx.x,
              endY: endPx.y,
              source: 'geometry_reconstructor'
            })
          }
        })
        
        // Log warnings if any
        if (roofGeometry.warnings.length > 0) {
          console.log(`⚠️ Reconstructor warnings: ${roofGeometry.warnings.join(', ')}`)
        }
        
        if (lines.length > 0) {
          usedReconstructor = true
          console.log(`✅ Using reconstructor for clean ridge/hip/valley topology`)
        }
      }
    } catch (reconstructorErr) {
      console.warn(`⚠️ Roof geometry reconstructor failed, falling back to straight skeleton:`, reconstructorErr)
    }
  }
  
  // FALLBACK: Use straight skeleton if reconstructor failed
  if (!usedReconstructor && coordinates) {
    try {
      console.log(`🔄 Falling back to straight skeleton...`)
      
      const geoRing = perimeterVerticesToGeo(perimeterVertices, coordinates, imageSize, zoom)
      
      if (geoRing.length >= 3) {
        const skeletonEdges = computeStraightSkeleton(geoRing, 0)
        
        skeletonEdges.forEach((edge, i) => {
          const startPx = geoToPixel(edge.start[1], edge.start[0], coordinates, imageSize, zoom)
          const endPx = geoToPixel(edge.end[1], edge.end[0], coordinates, imageSize, zoom)
          
          if (isValidPixelCoord(startPx) && isValidPixelCoord(endPx)) {
            lines.push({
              type: edge.type,
              startX: startPx.x,
              startY: startPx.y,
              endX: endPx.x,
              endY: endPx.y,
              source: 'straight_skeleton_fallback'
            })
          }
        })
        
        console.log(`📏 Skeleton fallback: ${lines.filter(l => l.type === 'ridge').length} ridges, ${lines.filter(l => l.type === 'hip').length} hips`)
      }
    } catch (skeletonErr) {
      console.warn(`⚠️ Straight skeleton also failed:`, skeletonErr)
    }
  }
  
  // FINAL FALLBACK: Use AI-detected junctions if no lines were generated
  if (lines.length === 0) {
    console.log(`🔄 Using AI-detected junctions for ridge/hip/valley lines`)
    
    // 1. RIDGE LINES: Use FARTHEST-PAIR algorithm
    const ridgeCandidates = [...(junctions || []), ...(ridgeEndpoints || [])]
      .filter((j: any) => j.type?.includes('ridge') || !j.type)
    
    if (ridgeCandidates.length >= 2) {
      let maxDist = 0
      let ridgeStart: any = null
      let ridgeEnd: any = null
      
      for (let i = 0; i < ridgeCandidates.length; i++) {
        for (let j = i + 1; j < ridgeCandidates.length; j++) {
          const dist = distance(ridgeCandidates[i], ridgeCandidates[j])
          if (dist > maxDist) {
            maxDist = dist
            ridgeStart = ridgeCandidates[i]
            ridgeEnd = ridgeCandidates[j]
          }
        }
      }
      
      if (ridgeStart && ridgeEnd && maxDist > 5) {
        const clippedRidge = clipLineToPolygon(
          { startX: ridgeStart.x, startY: ridgeStart.y, endX: ridgeEnd.x, endY: ridgeEnd.y },
          perimeterVertices
        )
        if (clippedRidge) {
          lines.push({
            type: 'ridge',
            startX: clippedRidge.startX,
            startY: clippedRidge.startY,
            endX: clippedRidge.endX,
            endY: clippedRidge.endY,
            source: 'vertex_derived_farthest_pair'
          })
        }
      }
    }
    
    // Get ridge endpoints for hip connections
    const ridgeLines = lines.filter(l => l.type === 'ridge')
    const ridgePoints: any[] = []
    ridgeLines.forEach(ridge => {
      ridgePoints.push({ x: ridge.startX, y: ridge.startY })
      ridgePoints.push({ x: ridge.endX, y: ridge.endY })
    })
    
    // 2. HIP LINES: Connect hip-corners to NEAREST RIDGE ENDPOINT
    const hipCorners = perimeterVertices.filter((v: any) => 
      v.cornerType === 'hip-corner' || v.type === 'hip-corner'
    )
    
    const ridgeEndpointConnections: Map<string, number> = new Map()
    
    hipCorners.forEach((corner: any) => {
      if (ridgePoints.length === 0) return
      
      const nearestRidge = findNearestPoint(corner, ridgePoints)
      if (!nearestRidge) return
      
      const ridgeKey = `${nearestRidge.x.toFixed(1)},${nearestRidge.y.toFixed(1)}`
      const currentConnections = ridgeEndpointConnections.get(ridgeKey) || 0
      
      if (currentConnections >= 2) return
      
      const clippedHip = clipLineToPolygon(
        { startX: nearestRidge.x, startY: nearestRidge.y, endX: corner.x, endY: corner.y },
        perimeterVertices
      )
      
      if (clippedHip) {
        const hipLength = distance(
          { x: clippedHip.startX, y: clippedHip.startY },
          { x: clippedHip.endX, y: clippedHip.endY }
        )
        
        if (hipLength > 3 && hipLength < 40) {
          lines.push({
            type: 'hip',
            startX: clippedHip.startX,
            startY: clippedHip.startY,
            endX: clippedHip.endX,
            endY: clippedHip.endY,
            source: 'vertex_derived_constrained'
          })
          ridgeEndpointConnections.set(ridgeKey, currentConnections + 1)
        }
      }
    })
    
    // 3. VALLEY LINES
    const valleyEntries = perimeterVertices.filter((v: any) => 
      v.cornerType === 'valley-entry' || v.type === 'valley-entry'
    )
    const valleyJunctions = junctions.filter((j: any) => j.type?.includes('valley'))
    const concaveVertices = findConcaveVertices(perimeterVertices)
    const allValleyStarts = [...valleyEntries, ...concaveVertices.filter(cv => 
      !valleyEntries.some(ve => distance(ve, cv) < 3)
    )]
    
    allValleyStarts.forEach((entry: any) => {
      let target: any = null
      
      if (valleyJunctions.length > 0) {
        target = findNearestPoint(entry, valleyJunctions)
      }
      
      if (!target) {
        const centroidX = perimeterVertices.reduce((s, v) => s + v.x, 0) / perimeterVertices.length
        const centroidY = perimeterVertices.reduce((s, v) => s + v.y, 0) / perimeterVertices.length
        const dx = centroidX - entry.x
        const dy = centroidY - entry.y
        target = { x: entry.x + dx * 0.7, y: entry.y + dy * 0.7 }
      }
      
      if (target) {
        const clippedValley = clipLineToPolygon(
          { startX: entry.x, startY: entry.y, endX: target.x, endY: target.y },
          perimeterVertices
        )
        
        if (clippedValley) {
          const valleyLength = distance(
            { x: clippedValley.startX, y: clippedValley.startY },
            { x: clippedValley.endX, y: clippedValley.endY }
          )
          
          if (valleyLength > 3) {
            lines.push({
              type: 'valley',
              startX: clippedValley.startX,
              startY: clippedValley.startY,
              endX: clippedValley.endX,
              endY: clippedValley.endY,
              source: 'vertex_derived_valley'
            })
          }
        }
      }
    })
  } // End of if (lines.length === 0) fallback block
  
  // 4 & 5. EAVE and RAKE LINES: Classify perimeter edges based on ridge intersection
  const allRidgeLines = lines.filter(l => l.type === 'ridge')
  const allHipLines = lines.filter(l => l.type === 'hip')
  
  const pointNearLineEndpoint = (p: {x: number, y: number}, line: DerivedLine, threshold = 5): boolean => {
    const distToStart = distance(p, { x: line.startX, y: line.startY })
    const distToEnd = distance(p, { x: line.endX, y: line.endY })
    return distToStart < threshold || distToEnd < threshold
  }
  
  for (let i = 0; i < perimeterVertices.length; i++) {
    const v1 = perimeterVertices[i]
    const v2 = perimeterVertices[(i + 1) % perimeterVertices.length]
    
    const ridgeTerminatesAtEdge = allRidgeLines.some(ridge => 
      pointNearLineEndpoint(v1, ridge) || pointNearLineEndpoint(v2, ridge)
    )
    
    const hipTerminatesAtEdge = allHipLines.some(hip => 
      pointNearLineEndpoint(v1, hip) || pointNearLineEndpoint(v2, hip)
    )
    
    const isRakeEdge = ridgeTerminatesAtEdge && !hipTerminatesAtEdge
    
    lines.push({
      type: isRakeEdge ? 'rake' : 'eave',
      startX: v1.x,
      startY: v1.y,
      endX: v2.x,
      endY: v2.y,
      source: 'perimeter_edge'
    })
  }
  
  const dedupedLines = removeDuplicateLines(lines)
  
  // FALLBACK: If no eaves detected after all attempts, compute from perimeter directly
  // This ensures we NEVER return 0 eaves/rakes
  const eaveCount = dedupedLines.filter(l => l.type === 'eave').length
  const rakeCount = dedupedLines.filter(l => l.type === 'rake').length
  
  if (eaveCount === 0 && rakeCount === 0 && perimeterVertices.length >= 4) {
    console.log(`🏠 FALLBACK: No eave/rake classification succeeded, computing from perimeter edges...`)
    
    // All perimeter edges become eaves by default (conservative assumption)
    // Typical residential: ~70% eave, ~30% rake for gable roofs
    // For hip roofs: ~100% eave (no rakes)
    const ridgeCount = dedupedLines.filter(l => l.type === 'ridge').length
    const hasGable = ridgeCount > 0 && dedupedLines.filter(l => l.type === 'hip').length === 0
    
    // Remove any existing empty eave/rake entries and re-add
    const nonPerimeterLines = dedupedLines.filter(l => l.type !== 'eave' && l.type !== 'rake')
    
    for (let i = 0; i < perimeterVertices.length; i++) {
      const v1 = perimeterVertices[i]
      const v2 = perimeterVertices[(i + 1) % perimeterVertices.length]
      
      // For gable roofs, short horizontal edges near ridge ends are rakes
      // For hip roofs, all edges are eaves
      let edgeType: 'eave' | 'rake' = 'eave'
      
      if (hasGable) {
        // Check if edge is roughly vertical (rake) or horizontal (eave)
        const dx = Math.abs(v2.x - v1.x)
        const dy = Math.abs(v2.y - v1.y)
        if (dy > dx * 1.5) {
          edgeType = 'rake' // Vertical-ish edges are rakes on gable roofs
        }
      }
      
      nonPerimeterLines.push({
        type: edgeType,
        startX: v1.x,
        startY: v1.y,
        endX: v2.x,
        endY: v2.y,
        source: 'perimeter_fallback'
      })
    }
    
    console.log(`🏠 Fallback eave/rake: ${nonPerimeterLines.filter(l => l.type === 'eave').length} eaves, ${nonPerimeterLines.filter(l => l.type === 'rake').length} rakes`)
    return nonPerimeterLines
  }
  
  const eaveFt = eaveCount
  const rakeFt = rakeCount
  const hipFt = dedupedLines.filter(l => l.type === 'hip').length
  const valleyFt = dedupedLines.filter(l => l.type === 'valley').length
  const ridgeFt = dedupedLines.filter(l => l.type === 'ridge').length
  console.log(`📐 Derived ${dedupedLines.length} lines: ${ridgeFt} ridge, ${hipFt} hip, ${valleyFt} valley, ${eaveFt} eave, ${rakeFt} rake`)
  
  return dedupedLines
}

// Convert perimeter vertices (pixel %) to geographic coordinates for skeleton algorithm
function perimeterVerticesToGeo(
  vertices: any[],
  center: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): [number, number][] {
  return vertices.map(v => {
    const geo = pixelToGeoInternal(v.x, v.y, center, imageSize, zoom)
    return [geo.lng, geo.lat] as [number, number]
  })
}

// Convert pixel coordinates (%) to geographic coordinates
function pixelToGeoInternal(
  xPct: number,
  yPct: number,
  center: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): { lat: number; lng: number } {
  const metersPerPixel = (156543.03392 * Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180)
  
  // Convert percentage to pixel offset from center
  const pxOffsetX = ((xPct / 100) - 0.5) * imageSize
  const pxOffsetY = ((yPct / 100) - 0.5) * imageSize
  
  // Convert to meters then degrees
  const metersX = pxOffsetX * metersPerPixel
  const metersY = -pxOffsetY * metersPerPixel // Negative because Y increases downward
  
  return {
    lng: center.lng + metersX / metersPerDegLng,
    lat: center.lat + metersY / metersPerDegLat
  }
}

// geoToPixel and isValidPixelCoord are now imported from roof-analysis-helpers.ts

// Find concave (valley-like) vertices in polygon
function findConcaveVertices(vertices: any[]): any[] {
  const concave: any[] = []
  const n = vertices.length
  
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n]
    const curr = vertices[i]
    const next = vertices[(i + 1) % n]
    
    // Cross product to determine turn direction
    const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x)
    
    // Negative cross product indicates concave (interior angle > 180°)
    if (cross < -0.5) {
      concave.push(curr)
    }
  }
  
  return concave
}

// Clip line segment to polygon using Cohen-Sutherland variant
function clipLineToPolygon(
  line: { startX: number; startY: number; endX: number; endY: number },
  polygon: any[]
): { startX: number; startY: number; endX: number; endY: number } | null {
  if (!polygon || polygon.length < 3) return line
  
  const startInside = pointInPolygon({ x: line.startX, y: line.startY }, polygon)
  const endInside = pointInPolygon({ x: line.endX, y: line.endY }, polygon)
  
  // Both inside - return as is
  if (startInside && endInside) {
    return line
  }
  
  // Find intersections with polygon edges
  const intersections: { x: number; y: number; t: number }[] = []
  
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i]
    const p2 = polygon[(i + 1) % polygon.length]
    
    const intersection = lineSegmentIntersection(
      line.startX, line.startY, line.endX, line.endY,
      p1.x, p1.y, p2.x, p2.y
    )
    
    if (intersection) {
      intersections.push(intersection)
    }
  }
  
  // Sort intersections by t (position along the line)
  intersections.sort((a, b) => a.t - b.t)
  
  // Case: Both outside but line crosses polygon
  if (!startInside && !endInside) {
    if (intersections.length >= 2) {
      return {
        startX: intersections[0].x,
        startY: intersections[0].y,
        endX: intersections[intersections.length - 1].x,
        endY: intersections[intersections.length - 1].y
      }
    }
    return null // Line doesn't intersect polygon
  }
  
  // Case: Start inside, end outside
  if (startInside && !endInside && intersections.length >= 1) {
    return {
      startX: line.startX,
      startY: line.startY,
      endX: intersections[0].x,
      endY: intersections[0].y
    }
  }
  
  // Case: Start outside, end inside
  if (!startInside && endInside && intersections.length >= 1) {
    return {
      startX: intersections[intersections.length - 1].x,
      startY: intersections[intersections.length - 1].y,
      endX: line.endX,
      endY: line.endY
    }
  }
  
  return null
}

// Point in polygon test (ray casting)
function pointInPolygon(point: { x: number; y: number }, polygon: any[]): boolean {
  let inside = false
  const n = polygon.length
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    
    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  
  return inside
}

// Line segment intersection
function lineSegmentIntersection(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number
): { x: number; y: number; t: number } | null {
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1)
  
  if (Math.abs(denom) < 0.0001) {
    return null // Parallel lines
  }
  
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom
  
  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return {
      x: x1 + ua * (x2 - x1),
      y: y1 + ua * (y2 - y1),
      t: ua
    }
  }
  
  return null
}

// Remove duplicate and very short lines
function removeDuplicateLines(lines: DerivedLine[]): DerivedLine[] {
  const result: DerivedLine[] = []
  const MIN_LENGTH = 2
  
  for (const line of lines) {
    const length = distance(
      { x: line.startX, y: line.startY },
      { x: line.endX, y: line.endY }
    )
    
    if (length < MIN_LENGTH) continue
    
    // Check for duplicates (same endpoints within tolerance)
    const isDuplicate = result.some(existing => {
      const sameDirection = (
        distance({ x: existing.startX, y: existing.startY }, { x: line.startX, y: line.startY }) < 2 &&
        distance({ x: existing.endX, y: existing.endY }, { x: line.endX, y: line.endY }) < 2
      )
      const reverseDirection = (
        distance({ x: existing.startX, y: existing.startY }, { x: line.endX, y: line.endY }) < 2 &&
        distance({ x: existing.endX, y: existing.endY }, { x: line.startX, y: line.startY }) < 2
      )
      return sameDirection || reverseDirection
    })
    
    if (!isDuplicate) {
      result.push(line)
    }
  }
  
  return result
}

// findNearestPoint and findFourMainCorners are now imported from roof-analysis-helpers.ts

// Add perimeter edges as eaves/rakes
function addPerimeterEdges(lines: DerivedLine[], perimeterVertices: any[]): void {
  const ridgeLines = lines.filter(l => l.type === 'ridge');
  const hipLines = lines.filter(l => l.type === 'hip');
  
  const pointNearLineEndpoint = (p: {x: number, y: number}, line: DerivedLine, threshold = 5): boolean => {
    const distToStart = distance(p, { x: line.startX, y: line.startY });
    const distToEnd = distance(p, { x: line.endX, y: line.endY });
    return distToStart < threshold || distToEnd < threshold;
  };
  
  for (let i = 0; i < perimeterVertices.length; i++) {
    const v1 = perimeterVertices[i];
    const v2 = perimeterVertices[(i + 1) % perimeterVertices.length];
    
    const ridgeTerminatesAtEdge = ridgeLines.some(ridge => 
      pointNearLineEndpoint(v1, ridge) || pointNearLineEndpoint(v2, ridge)
    );
    
    const hipTerminatesAtEdge = hipLines.some(hip => 
      pointNearLineEndpoint(v1, hip) || pointNearLineEndpoint(v2, hip)
    );
    
    const isRakeEdge = ridgeTerminatesAtEdge && !hipTerminatesAtEdge;
    
    lines.push({
      type: isRakeEdge ? 'rake' : 'eave',
      startX: v1.x,
      startY: v1.y,
      endX: v2.x,
      endY: v2.y,
      source: 'perimeter_edge'
    });
  }
}

// distance is now imported from roof-analysis-helpers.ts

// Convert derived lines to WKT format with plan/surface length calculations
function convertDerivedLinesToWKT(
  derivedLines: DerivedLine[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number,
  predominantPitch: string = '5/12'
) {
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  // Get slope factor for pitch-adjusted lengths
  const slopeFactor = getSlopeFactorFromPitch(predominantPitch) || 1.083
  
  const linearFeatures: any[] = []
  let featureId = 1
  
  derivedLines.forEach((line) => {
    const startPixelX = ((line.startX / 100) - 0.5) * imageSize
    const startPixelY = ((line.startY / 100) - 0.5) * imageSize
    const endPixelX = ((line.endX / 100) - 0.5) * imageSize
    const endPixelY = ((line.endY / 100) - 0.5) * imageSize
    
    const startMetersX = startPixelX * metersPerPixel
    const startMetersY = startPixelY * metersPerPixel
    const endMetersX = endPixelX * metersPerPixel
    const endMetersY = endPixelY * metersPerPixel
    
    const startLngOffset = startMetersX / metersPerDegLng
    const startLatOffset = -startMetersY / metersPerDegLat
    const endLngOffset = endMetersX / metersPerDegLng
    const endLatOffset = -endMetersY / metersPerDegLat
    
    const startLng = imageCenter.lng + startLngOffset
    const startLat = imageCenter.lat + startLatOffset
    const endLng = imageCenter.lng + endLngOffset
    const endLat = imageCenter.lat + endLatOffset
    
    const dx = (endLng - startLng) * metersPerDegLng
    const dy = (endLat - startLat) * metersPerDegLat
    const plan_length_ft = Math.sqrt(dx * dx + dy * dy) * 3.28084
    
    // Apply pitch factor based on line type:
    // - ridge, eave: use plan length (horizontal features)
    // - hip, valley, rake: use surface length (sloped features)
    const needsSlopeFactor = ['hip', 'valley', 'rake'].includes(line.type)
    const surface_length_ft = needsSlopeFactor 
      ? plan_length_ft * slopeFactor 
      : plan_length_ft
    
    if (plan_length_ft >= 3) {
      linearFeatures.push({
        id: `VERTEX_${line.type}_${featureId++}`,
        type: line.type,
        wkt: `LINESTRING(${startLng.toFixed(8)} ${startLat.toFixed(8)}, ${endLng.toFixed(8)} ${endLat.toFixed(8)})`,
        length_ft: Math.round(surface_length_ft * 10) / 10, // Default to surface length
        plan_length_ft: Math.round(plan_length_ft * 10) / 10,
        surface_length_ft: Math.round(surface_length_ft * 10) / 10,
        source: line.source
      })
    }
  })
  
  // Calculate totals for both plan and surface
  const planTotals: Record<string, number> = {}
  const surfaceTotals: Record<string, number> = {}
  
  linearFeatures.forEach(f => {
    planTotals[f.type] = (planTotals[f.type] || 0) + f.plan_length_ft
    surfaceTotals[f.type] = (surfaceTotals[f.type] || 0) + f.surface_length_ft
  })
  
  console.log('📏 Linear feature totals (plan):', planTotals)
  console.log('📏 Linear feature totals (surface):', surfaceTotals)
  
  return linearFeatures
}

// Convert perimeter vertices to WKT polygon
function convertPerimeterToWKT(
  vertices: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): string | null {
  if (!vertices || vertices.length < 3) return null
  
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  const wktPoints = vertices.map((pt: any) => {
    const pixelX = ((pt.x / 100) - 0.5) * imageSize
    const pixelY = ((pt.y / 100) - 0.5) * imageSize
    const metersX = pixelX * metersPerPixel
    const metersY = pixelY * metersPerPixel
    const lngOffset = metersX / metersPerDegLng
    const latOffset = -metersY / metersPerDegLat
    return `${(imageCenter.lng + lngOffset).toFixed(8)} ${(imageCenter.lat + latOffset).toFixed(8)}`
  })
  
  wktPoints.push(wktPoints[0])
  
  let totalPerimeterFt = 0
  const segmentLengths: number[] = []
  
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i]
    const v2 = vertices[(i + 1) % vertices.length]
    const dx = ((v2.x - v1.x) / 100) * imageSize * metersPerPixel
    const dy = ((v2.y - v1.y) / 100) * imageSize * metersPerPixel
    const segmentFt = Math.sqrt(dx * dx + dy * dy) * 3.28084
    segmentLengths.push(Math.round(segmentFt * 10) / 10)
    totalPerimeterFt += segmentFt
  }
  
  console.log(`📐 Perimeter WKT: ${vertices.length} vertices, ${totalPerimeterFt.toFixed(1)} ft total`)
  console.log(`📐 Segments (ft): ${segmentLengths.join(', ')}`)
  
  const longSegments = segmentLengths.filter(len => len > 55)
  if (longSegments.length > 0) {
    console.warn(`⚠️ ${longSegments.length} segments > 55ft - check for missed corners`)
  }
  
  return `POLYGON((${wktPoints.join(', ')}))`
}

function calculateScale(solarData: any, image: any, aiAnalysis: any) {
  const methods: any[] = []
  if (solarData.available && solarData.buildingFootprintSqft) {
    const buildingWidthFeet = Math.sqrt(solarData.buildingFootprintSqft)
    const imageWidthPixels = image.resolution === '1280x1280' ? 1280 : 640
    const estimatedBuildingPixels = imageWidthPixels * 0.70
    const pixelsPerFoot = estimatedBuildingPixels / buildingWidthFeet
    methods.push({ value: pixelsPerFoot, confidence: 'high', method: 'solar_api_footprint' })
  }
  const totalEstimatedArea = aiAnalysis.facets.reduce((sum: number, f: any) => sum + f.estimatedAreaSqft, 0)
  const estimatedBuildingWidth = Math.sqrt(totalEstimatedArea / 1.3)
  const imageWidthPixels = image.resolution === '1280x1280' ? 1280 : 640
  const fallbackPixelsPerFoot = (imageWidthPixels * 0.70) / estimatedBuildingWidth
  methods.push({ value: fallbackPixelsPerFoot, confidence: 'medium', method: 'typical_residential_scale' })
  const bestMethod = methods.find(m => m.confidence === 'high') || methods[0]
  let variance = 0
  if (methods.length > 1) {
    const values = methods.map(m => m.value)
    const mean = values.reduce((a, b) => a + b) / values.length
    variance = Math.max(...values.map(v => Math.abs((v - mean) / mean * 100)))
  }
  return { pixelsPerFoot: bestMethod.value, method: bestMethod.method, confidence: variance > 15 ? 'medium' : bestMethod.confidence, variance, allMethods: methods }
}

function calculateDetailedMeasurements(aiAnalysis: any, scale: any, solarData: any, linearTotalsFromWKT?: any) {
  // IMPROVED PITCH DETECTION: Use Solar API segment data, then Florida defaults
  let predominantPitch = '5/12' // Default fallback
  let pitchSource = 'assumed'
  
  // Priority 1: Solar API segment pitch data (most accurate)
  if (solarData?.available && solarData?.roofSegments?.length > 0) {
    // Get pitches from roof segments weighted by area
    const segmentPitches: { pitch: string; area: number }[] = solarData.roofSegments
      .filter((seg: any) => seg.pitchDegrees && seg.area)
      .map((seg: any) => ({
        pitch: degreesToPitch(seg.pitchDegrees),
        area: seg.area
      }))
    
    if (segmentPitches.length > 0) {
      // Weight by area to get predominant pitch
      let maxArea = 0
      segmentPitches.forEach(sp => {
        if (sp.area > maxArea) {
          maxArea = sp.area
          predominantPitch = sp.pitch
        }
      })
      pitchSource = 'solar_api'
      console.log(`📐 Pitch from Solar API segments: ${predominantPitch} (${segmentPitches.length} segments analyzed)`)
    }
  }
  
  // Priority 2: AI-detected pitch
  if (pitchSource === 'assumed') {
    const pitches = aiAnalysis.facets.map((f: any) => f.estimatedPitch).filter((p: string) => p && p !== 'unknown')
    if (pitches.length > 0) {
      predominantPitch = mostCommon(pitches)
      pitchSource = 'ai_detected'
      console.log(`📐 Pitch from AI detection: ${predominantPitch}`)
    }
  }
  
  // Priority 3: Florida tile roof default (6/12 is most common)
  if (pitchSource === 'assumed') {
    const addressStr = JSON.stringify(solarData || {})
    if (isFloridaAddress(addressStr)) {
      predominantPitch = '6/12' // Florida tile roofs are typically 6/12
      pitchSource = 'florida_default'
      console.log(`📐 Using Florida tile roof default pitch: ${predominantPitch}`)
    } else {
      console.log(`📐 Using default pitch: ${predominantPitch}`)
    }
  }
  
  const pitchMultiplier = getSlopeFactorFromPitch(predominantPitch) || 1.083

  const processedFacets = aiAnalysis.facets.map((facet: any) => {
    // Use segment-specific pitch if available, otherwise use predominant
    const facetPitch = facet.estimatedPitch && facet.estimatedPitch !== 'unknown' 
      ? facet.estimatedPitch 
      : predominantPitch
    const facetMultiplier = getSlopeFactorFromPitch(facetPitch) || pitchMultiplier
    const flatAreaSqft = facet.estimatedAreaSqft
    const adjustedAreaSqft = flatAreaSqft * facetMultiplier
    return {
      facetNumber: facet.facetNumber,
      shape: facet.shape,
      flatAreaSqft,
      pitch: facetPitch,
      pitchMultiplier: facetMultiplier,
      adjustedAreaSqft,
      edges: facet.edges,
      features: facet.features,
      orientation: facet.orientation,
      confidence: facet.pitchConfidence
    }
  })

  const totalFlatArea = processedFacets.reduce((sum: number, f: any) => sum + f.flatAreaSqft, 0)
  const totalAdjustedArea = processedFacets.reduce((sum: number, f: any) => sum + f.adjustedAreaSqft, 0)

  const linearMeasurements = {
    eave: linearTotalsFromWKT?.eave || 0,
    rake: linearTotalsFromWKT?.rake || 0,
    hip: linearTotalsFromWKT?.hip || 0,
    valley: linearTotalsFromWKT?.valley || 0,
    ridge: linearTotalsFromWKT?.ridge || 0,
    wallFlashing: 0,
    stepFlashing: 0,
    unspecified: 0
  }

  const complexity = determineComplexity(processedFacets.length, linearMeasurements)
  const wasteFactor = complexity === 'very_complex' ? 1.20 : complexity === 'complex' ? 1.15 : complexity === 'moderate' ? 1.12 : 1.10
  const totalSquares = totalAdjustedArea / 100
  const totalSquaresWithWaste = totalSquares * wasteFactor

  const materials = {
    shingleBundles: Math.ceil(totalSquaresWithWaste * 3),
    underlaymentRolls: Math.ceil((totalSquares * 100) / 400),
    iceWaterShieldFeet: ((linearMeasurements.eave || 0) * 2) + (linearMeasurements.valley || 0),
    iceWaterShieldRolls: Math.ceil((((linearMeasurements.eave || 0) * 2) + (linearMeasurements.valley || 0)) / 65),
    dripEdgeFeet: (linearMeasurements.eave || 0) + (linearMeasurements.rake || 0),
    dripEdgeSheets: Math.ceil(((linearMeasurements.eave || 0) + (linearMeasurements.rake || 0)) / 10),
    starterStripFeet: (linearMeasurements.eave || 0) + (linearMeasurements.rake || 0),
    starterStripBundles: Math.ceil(((linearMeasurements.eave || 0) + (linearMeasurements.rake || 0)) / 105),
    hipRidgeFeet: (linearMeasurements.hip || 0) + (linearMeasurements.ridge || 0),
    hipRidgeBundles: Math.ceil(((linearMeasurements.hip || 0) + (linearMeasurements.ridge || 0)) / 20),
    valleyMetalFeet: linearMeasurements.valley || 0,
    valleyMetalSheets: Math.ceil((linearMeasurements.valley || 0) / 8)
  }

  let verification = null
  if (solarData.available && solarData.buildingFootprintSqft) {
    const variance = Math.abs(totalFlatArea - solarData.buildingFootprintSqft) / solarData.buildingFootprintSqft * 100
    verification = { solarFootprint: solarData.buildingFootprintSqft, aiCalculated: totalFlatArea, variancePercent: variance }
  }

  return {
    facets: processedFacets,
    totalFlatArea,
    totalAdjustedArea,
    totalSquares,
    totalSquaresWithWaste,
    predominantPitch,
    wasteFactor,
    complexity,
    linearMeasurements,
    materials,
    solarVerification: verification
  }
}

function determineComplexity(facetCount: number, linear: any): string {
  const hipValleyLength = (linear.hip || 0) + (linear.valley || 0)
  if (facetCount >= 8 || hipValleyLength > 200) return 'very_complex'
  if (facetCount >= 5 || hipValleyLength > 100) return 'complex'
  if (facetCount >= 3 || hipValleyLength > 50) return 'moderate'
  return 'simple'
}

function mostCommon(arr: string[]): string {
  const counts: Record<string, number> = {}
  arr.forEach(item => { counts[item] = (counts[item] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '5/12'
}

// Convert degrees to pitch ratio (e.g., 26.57° -> 6/12)
function degreesToPitch(degrees: number): string {
  if (!degrees || degrees < 0) return 'flat'
  
  // Common pitch degrees: 
  // 4/12 = 18.43°, 5/12 = 22.62°, 6/12 = 26.57°, 7/12 = 30.26°, 
  // 8/12 = 33.69°, 9/12 = 36.87°, 10/12 = 39.81°, 12/12 = 45°
  const pitchMap = [
    { maxDegrees: 5, pitch: 'flat' },
    { maxDegrees: 12, pitch: '2/12' },
    { maxDegrees: 16, pitch: '3/12' },
    { maxDegrees: 20, pitch: '4/12' },
    { maxDegrees: 24, pitch: '5/12' },
    { maxDegrees: 28, pitch: '6/12' },
    { maxDegrees: 32, pitch: '7/12' },
    { maxDegrees: 35, pitch: '8/12' },
    { maxDegrees: 38, pitch: '9/12' },
    { maxDegrees: 42, pitch: '10/12' },
    { maxDegrees: 48, pitch: '12/12' },
    { maxDegrees: 90, pitch: '14/12' }
  ]
  
  for (const range of pitchMap) {
    if (degrees <= range.maxDegrees) {
      return range.pitch
    }
  }
  
  return '6/12' // Default for Florida tile roofs
}

function calculateConfidenceScore(aiAnalysis: any, measurements: any, solarData: any, image: any) {
  let score = 70
  const factors: string[] = []

  if (solarData.available) {
    score += 10
    factors.push('Solar API validation available')
    
    if (measurements.solarVerification) {
      if (measurements.solarVerification.variancePercent < 10) {
        score += 10
        factors.push('AI area within 10% of Solar API')
      } else if (measurements.solarVerification.variancePercent < 20) {
        score += 5
        factors.push('AI area within 20% of Solar API')
      } else {
        score -= 10
        factors.push('AI area differs significantly from Solar API')
      }
    }
  }

  if (image.quality >= 8) {
    score += 5
    factors.push('High-quality satellite imagery')
  }

  // Penalize if footprint validation failed
  if (aiAnalysis.footprintValidation && !aiAnalysis.footprintValidation.isValid) {
    score -= 15
    factors.push('Footprint validation failed: ' + aiAnalysis.footprintValidation.failureReason)
  }

  score = Math.max(0, Math.min(100, score))
  
  return {
    score,
    rating: score >= 85 ? 'high' : score >= 70 ? 'medium' : 'low',
    factors,
    requiresReview: score < 70
  }
}

// ROOF_AREA_CAPS for validation
// MAX_RESIDENTIAL lowered from 6000 to 5000 to catch double-counting errors
const ROOF_AREA_CAPS = {
  MIN_RESIDENTIAL: 800,
  MAX_RESIDENTIAL: 5000,  // Lowered from 6000 - catches double-tracing errors for 4500sqft roofs
  SOLAR_VARIANCE_THRESHOLD: 0.12,  // 12% variance before override
  FLORIDA_VARIANCE_THRESHOLD: 0.10, // Tighter for Florida (screen enclosures)
  PLANIMETER_TARGET_ACCURACY: 0.05,  // Target 5% accuracy
  AREA_PERIMETER_MAX_RATIO: 20,  // If area/perimeter > 20, likely multi-building trace (lowered from 22)
  DOUBLE_COUNT_WARNING_THRESHOLD: 1.25,  // Warn if AI area > 125% of Solar (lowered from 1.4)
  AI_SOLAR_MAX_VARIANCE: 0.20  // If AI > 20% over Solar, use Solar
}

// isFloridaAddress is now imported from roof-analysis-helpers.ts

// Calculate rough polygon area from pixel-percent vertices (for shrinkage decision)
function calculatePolygonAreaFromPixelVertices(vertices: any[], bounds: any): number {
  if (!vertices || vertices.length < 3) return 0
  
  // Use shoelace formula on pixel coordinates
  // Assume ~50ft per % of image at zoom 20 (rough approximation)
  const FT_PER_PERCENT = 3.28 // Rough conversion at zoom 20
  
  let area = 0
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += vertices[i].x * vertices[j].y
    area -= vertices[j].x * vertices[i].y
  }
  area = Math.abs(area) / 2
  
  return area * FT_PER_PERCENT * FT_PER_PERCENT
}


// NEW PHASE 6: Apply vertex shrinkage toward centroid to counter AI over-tracing
function applyVertexShrinkage(vertices: any[], shrinkFactor: number = 0.025): any[] {
  if (!vertices || vertices.length < 3) return vertices
  
  // Calculate centroid
  const cx = vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length
  const cy = vertices.reduce((sum, v) => sum + v.y, 0) / vertices.length
  
  console.log(`📐 Applying ${(shrinkFactor * 100).toFixed(1)}% vertex shrinkage toward centroid (${cx.toFixed(1)}%, ${cy.toFixed(1)}%)`)
  
  // Shrink each vertex toward centroid
  return vertices.map(v => ({
    ...v,
    x: v.x - (v.x - cx) * shrinkFactor,
    y: v.y - (v.y - cy) * shrinkFactor
  }))
}

// NEW PHASE 6: Validate vertices aren't too far from bounding box center
function validateVertexDistances(vertices: any[], bounds: any): { valid: boolean; outliers: number } {
  const centerX = (bounds.topLeftX + bounds.bottomRightX) / 2
  const centerY = (bounds.topLeftY + bounds.bottomRightY) / 2
  const maxDistance = 45 // % of image from center
  
  const outliers = vertices.filter(v => 
    Math.abs(v.x - centerX) > maxDistance || Math.abs(v.y - centerY) > maxDistance
  )
  
  if (outliers.length > 0) {
    console.warn(`⚠️ VERTEX DISTANCE WARNING: ${outliers.length} vertices appear outside expected bounds (>${maxDistance}% from center)`)
  }
  
  return { valid: outliers.length === 0, outliers: outliers.length }
}

// Calculate area from perimeter vertices with validation
function calculateAreaFromPerimeterVertices(
  vertices: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number,
  solarData?: any,
  address?: string
): number {
  if (!vertices || vertices.length < 3) {
    console.warn('⚠️ Invalid vertices for area calculation')
    return solarData?.buildingFootprintSqft || 1500
  }
  
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  
  const feetVertices = vertices.map(v => {
    if (typeof v.x === 'number' && typeof v.y === 'number' && v.x <= 100 && v.y <= 100) {
      return {
        x: ((v.x / 100) - 0.5) * imageSize * metersPerPixel * 3.28084,
        y: ((v.y / 100) - 0.5) * imageSize * metersPerPixel * 3.28084
      }
    }
    const metersPerDegLat = 111320
    const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
    return {
      x: ((v.lng || 0) - imageCenter.lng) * metersPerDegLng * 3.28084,
      y: ((v.lat || 0) - imageCenter.lat) * metersPerDegLat * 3.28084
    }
  })
  
  // Shoelace formula
  let area = 0
  for (let i = 0; i < feetVertices.length; i++) {
    const j = (i + 1) % feetVertices.length
    area += feetVertices[i].x * feetVertices[j].y
    area -= feetVertices[j].x * feetVertices[i].y
  }
  
  let calculatedArea = Math.abs(area / 2)
  console.log(`📐 Raw calculated area: ${calculatedArea.toFixed(0)} sqft`)
  
  // Calculate perimeter for validation
  let perimeterFt = 0
  for (let i = 0; i < feetVertices.length; i++) {
    const v1 = feetVertices[i]
    const v2 = feetVertices[(i + 1) % feetVertices.length]
    perimeterFt += Math.sqrt(Math.pow(v2.x - v1.x, 2) + Math.pow(v2.y - v1.y, 2))
  }
  
  console.log(`📐 Calculated perimeter: ${perimeterFt.toFixed(1)} ft from ${feetVertices.length} vertices`)
  
  // Area/Perimeter ratio validation - catches multi-building traces
  const areaPerimeterRatio = calculatedArea / perimeterFt
  console.log(`📐 Area/Perimeter ratio: ${areaPerimeterRatio.toFixed(1)} (expect 10-20)`)
  
  // NEW: Check for multi-building trace using Area/Perimeter ratio
  // A single rectangular building has ratio ~10-18, multiple buildings traced as one will have ratio > 22
  if (areaPerimeterRatio > ROOF_AREA_CAPS.AREA_PERIMETER_MAX_RATIO) {
    console.warn(`⚠️ MULTI-BUILDING WARNING: Area/Perimeter ratio ${areaPerimeterRatio.toFixed(1)} > ${ROOF_AREA_CAPS.AREA_PERIMETER_MAX_RATIO} - likely tracing multiple buildings!`)
    
    // If Solar API is available, strongly prefer it
    if (solarData?.available && solarData?.buildingFootprintSqft) {
      console.log(`📐 Using Solar API footprint due to multi-building detection`)
      calculatedArea = solarData.buildingFootprintSqft
    } else {
      // Without Solar API, reduce area by estimated overlap
      const reductionFactor = ROOF_AREA_CAPS.AREA_PERIMETER_MAX_RATIO / areaPerimeterRatio
      calculatedArea = calculatedArea * reductionFactor
      console.log(`📐 Reduced area by ${((1 - reductionFactor) * 100).toFixed(0)}% due to multi-building detection`)
    }
  }
  
  // Solar API validation
  if (solarData?.available && solarData?.buildingFootprintSqft) {
    const solarFootprint = solarData.buildingFootprintSqft
    const variance = Math.abs(calculatedArea - solarFootprint) / solarFootprint
    const overShoot = calculatedArea / solarFootprint
    
    const isFlorida = address ? isFloridaAddress(address) : false
    const varianceThreshold = isFlorida ? ROOF_AREA_CAPS.FLORIDA_VARIANCE_THRESHOLD : ROOF_AREA_CAPS.SOLAR_VARIANCE_THRESHOLD
    
    // PHASE 6: Check if this is historical Solar data - apply tighter override
    const isHistorical = solarData.isHistorical === true
    if (isHistorical) {
      console.log(`📐 HISTORICAL Solar validation: AI=${calculatedArea.toFixed(0)}, Historical Solar=${solarFootprint.toFixed(0)}, variance=${(variance * 100).toFixed(1)}%, ratio=${overShoot.toFixed(2)}x`)
    } else {
      console.log(`📐 Solar validation: AI=${calculatedArea.toFixed(0)}, Solar=${solarFootprint.toFixed(0)}, variance=${(variance * 100).toFixed(1)}%, ratio=${overShoot.toFixed(2)}x`)
    }
    
    // PHASE 6: Historical Solar override - tighter 15% threshold since we have verified ground truth
    if (isHistorical && overShoot > 1.15) {
      console.warn(`⚠️ HISTORICAL OVERRIDE: AI area is ${(overShoot * 100).toFixed(0)}% of historical Solar - using historical as ground truth`)
      calculatedArea = solarFootprint
    }
    // NEW: Double-count detection - if AI is 125%+ of Solar, very likely tracing two buildings
    else if (overShoot > ROOF_AREA_CAPS.DOUBLE_COUNT_WARNING_THRESHOLD) {
      console.warn(`⚠️ DOUBLE-COUNT WARNING: AI area is ${(overShoot * 100).toFixed(0)}% of Solar - using Solar as ground truth`)
      calculatedArea = solarFootprint
    } else if (variance > varianceThreshold) {
      if (calculatedArea < solarFootprint * 0.85) {
        // AI under-detected - use weighted blend
        const blendedArea = (calculatedArea * 0.4) + (solarFootprint * 0.6)
        console.log(`📐 BLEND: ${blendedArea.toFixed(0)} sqft (40% AI + 60% Solar)`)
        calculatedArea = blendedArea
      } else if (isFlorida && calculatedArea > solarFootprint * 1.1) {
        console.log(`📐 FLORIDA: Using Solar to exclude screen enclosure`)
        calculatedArea = solarFootprint
      } else if (calculatedArea > solarFootprint * 1.2) {
        console.log(`📐 OVERRIDE: Using Solar as ground truth`)
        calculatedArea = solarFootprint
      }
    } else {
      console.log(`📐 ✅ AI within ${(variance * 100).toFixed(1)}% of Solar API`)
    }
  }
  
  // Hard caps - lowered to catch errors
  if (calculatedArea < ROOF_AREA_CAPS.MIN_RESIDENTIAL) {
    console.log(`📐 Area below minimum ${ROOF_AREA_CAPS.MIN_RESIDENTIAL}, capping`)
    calculatedArea = ROOF_AREA_CAPS.MIN_RESIDENTIAL
  }
  if (calculatedArea > ROOF_AREA_CAPS.MAX_RESIDENTIAL) {
    console.warn(`⚠️ Area ${calculatedArea.toFixed(0)} exceeds max ${ROOF_AREA_CAPS.MAX_RESIDENTIAL}`)
    if (solarData?.available && solarData?.buildingFootprintSqft) {
      console.log(`📐 Using Solar footprint as fallback`)
      calculatedArea = solarData.buildingFootprintSqft
    } else {
      console.log(`📐 Capping at MAX_RESIDENTIAL`)
      calculatedArea = ROOF_AREA_CAPS.MAX_RESIDENTIAL
    }
  }
  
  console.log(`📐 Final area: ${calculatedArea.toFixed(0)} sqft`)
  return calculatedArea
}

// Derive facet count from geometry
function deriveFacetCountFromGeometry(
  perimeterVertices: any[],
  interiorJunctions: any[],
  roofType: string,
  hipLineCount: number = 0,
  ridgeLineCount: number = 0
): number {
  console.log(`📐 Facet derivation: hipLines=${hipLineCount}, ridgeLines=${ridgeLineCount}, roofType=${roofType}`)
  
  if (hipLineCount >= 4) return hipLineCount
  
  const hipCorners = perimeterVertices?.filter((v: any) => 
    v.cornerType === 'hip-corner' || v.type === 'hip-junction'
  ).length || 0
  
  const interiorCount = interiorJunctions?.length || 0
  
  if (hipCorners >= 4) return hipCorners + Math.floor(interiorCount / 2)
  
  if (roofType === 'gable' || (ridgeLineCount >= 1 && hipLineCount === 0)) {
    return 2 + Math.floor(interiorCount / 2)
  }
  
  if (hipLineCount >= 2) return Math.max(4, hipLineCount + 1)
  
  const vertexCount = perimeterVertices?.length || 0
  if (vertexCount >= 12) return 6
  if (vertexCount >= 8) return 4
  
  return 4
}

// Calculate linear totals from WKT features
function calculateLinearTotalsFromWKT(linearFeatures: any[]): Record<string, number> {
  const totals: Record<string, number> = { eave: 0, rake: 0, hip: 0, valley: 0, ridge: 0 }
  
  if (!linearFeatures || linearFeatures.length === 0) return totals
  
  linearFeatures.forEach((feature: any) => {
    const type = feature.type?.toLowerCase()
    if (type && totals.hasOwnProperty(type)) {
      totals[type] += feature.length_ft || 0
    }
  })
  
  return totals
}
// Map AI roof type to valid database values
function mapRoofTypeToValidValue(aiRoofType: string): string {
  const validTypes = [
    'gable', 'hip', 'flat', 'gambrel', 'mansard', 'complex',
    'hip-with-dormers', 'cross-gable', 'dutch-gable', 'cross-hip',
    'shed', 'butterfly', 'sawtooth', 'dome', 'pyramid'
  ]
  
  // Direct match - already valid
  if (validTypes.includes(aiRoofType?.toLowerCase())) {
    return aiRoofType.toLowerCase()
  }
  
  // Map AI-specific types to valid database values
  const typeMapping: Record<string, string> = {
    'l-shaped': 'complex',
    't-shaped': 'complex',
    'u-shaped': 'complex',
    'cross hip': 'cross-hip',
    'hip with dormers': 'hip-with-dormers',
    'dutch gable': 'dutch-gable',
    'cross gable': 'cross-gable',
  }
  
  const normalized = aiRoofType?.toLowerCase()?.trim()
  return typeMapping[normalized] || 'complex' // Default to 'complex' for unknown types
}

async function saveMeasurementToDatabase(supabase: any, params: any) {
  const {
    address, coordinates, customerId, userId, googleImage, mapboxImage,
    selectedImage, solarData, aiAnalysis, scale, measurements, confidence,
    linearFeatures, imageSource, imageYear, perimeterWkt, visionEdges, imageSize,
    vertexStats, footprintValidation, metadata, shadowRisk, authoritativeFootprint
  } = params

  // Determine if manual review needed based on shadow risk
  const requiresManualReview = confidence.requiresReview || shadowRisk?.recommendManualReview || false

  // Use authoritative footprint for perimeter WKT if available (Solar API or Regrid)
  let finalPerimeterWkt = perimeterWkt;
  if (authoritativeFootprint?.vertices?.length >= 3) {
    const coords = authoritativeFootprint.vertices
      .map((v: { lat: number; lng: number }) => `${v.lng} ${v.lat}`)
      .join(', ');
    const first = authoritativeFootprint.vertices[0];
    finalPerimeterWkt = `POLYGON((${coords}, ${first.lng} ${first.lat}))`;
    console.log(`📐 Using ${authoritativeFootprint.source} footprint for perimeter WKT`);
  }

  const { data, error } = await supabase.from('roof_measurements').insert({
    customer_id: customerId || null,
    measured_by: userId || null,
    property_address: address,
    gps_coordinates: { lat: coordinates.lat, lng: coordinates.lng },
    google_maps_image_url: googleImage.url,
    mapbox_image_url: mapboxImage.url,
    selected_image_source: imageSource,
    image_source: imageSource,
    image_year: imageYear,
    solar_api_available: solarData.available || false,
    solar_building_footprint_sqft: solarData.buildingFootprintSqft || null,
    solar_api_response: solarData.available ? solarData : null,
    ai_detection_data: { ...aiAnalysis, footprintValidation },
    total_area_flat_sqft: measurements.totalFlatArea,
    total_area_adjusted_sqft: measurements.totalAdjustedArea,
    total_squares: measurements.totalSquares,
    waste_factor_percent: (measurements.wasteFactor - 1) * 100,
    total_squares_with_waste: measurements.totalSquaresWithWaste,
    predominant_pitch: measurements.predominantPitch,
    pixels_per_foot: scale.pixelsPerFoot,
    scale_method: scale.method,
    scale_confidence: scale.confidence,
    measurement_confidence: confidence.score,
    requires_manual_review: requiresManualReview,
    roof_type: mapRoofTypeToValidValue(aiAnalysis.roofType),
    complexity_rating: measurements.complexity,
    facet_count: aiAnalysis.derivedFacetCount || aiAnalysis.facets?.length || 1,
    total_eave_length: measurements.linearMeasurements?.eave || 0,
    total_rake_length: measurements.linearMeasurements?.rake || 0,
    total_hip_length: measurements.linearMeasurements?.hip || 0,
    total_valley_length: measurements.linearMeasurements?.valley || 0,
    total_ridge_length: measurements.linearMeasurements?.ridge || 0,
    material_calculations: measurements.materials,
    linear_features_wkt: linearFeatures,
    perimeter_wkt: finalPerimeterWkt, // Use authoritative footprint if available
    vision_edges: visionEdges,
    bounding_box: aiAnalysis.boundingBox,
    roof_perimeter: aiAnalysis.roofPerimeter,
    analysis_zoom: IMAGE_ZOOM,
    analysis_image_size: { width: imageSize, height: imageSize },
    validation_status: 'pending',
    vertex_count: vertexStats?.totalCount || 0,
    perimeter_vertex_count: vertexStats?.totalCount || 0,
    interior_vertex_count: 0,
    hip_corner_count: vertexStats?.hipCornerCount || 0,
    valley_entry_count: vertexStats?.valleyEntryCount || 0,
    gable_peak_count: vertexStats?.gablePeakCount || 0,
    metadata: metadata || {},
    // NEW: Authoritative footprint tracking fields
    footprint_source: authoritativeFootprint?.source || 'ai_detection',
    footprint_confidence: authoritativeFootprint?.confidence || 0.5,
    footprint_vertices_geo: authoritativeFootprint?.vertices || null,
    footprint_requires_review: authoritativeFootprint?.requiresManualReview ?? true,
    footprint_validation: authoritativeFootprint?.validation || null,
  }).select().single()

  if (error) {
    console.error('Failed to save measurement:', error)
    throw new Error(`Database save failed: ${error.message}`)
  }

  console.log('💾 Saved measurement:', data.id)
  return data
}

// Save vertices to database
async function saveVerticesToDatabase(
  supabase: any,
  measurementId: string,
  perimeterVertices: any[],
  interiorJunctions: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): Promise<void> {
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  const toLatLng = (x: number, y: number) => {
    const pixelX = ((x / 100) - 0.5) * imageSize
    const pixelY = ((y / 100) - 0.5) * imageSize
    const metersX = pixelX * metersPerPixel
    const metersY = pixelY * metersPerPixel
    return {
      lat: imageCenter.lat - (metersY / metersPerDegLat),
      lng: imageCenter.lng + (metersX / metersPerDegLng)
    }
  }
  
  const mapCornerType = (cornerType: string): string => {
    const mapping: Record<string, string> = {
      'hip-corner': 'hip-corner',
      'valley-entry': 'valley-entry',
      'gable-peak': 'gable-peak',
      'eave-corner': 'eave-corner',
      'rake-corner': 'rake-corner',
      'dormer-junction': 'dormer-junction',
      'ridge-end': 'gable-peak',
      'corner': 'eave-corner',
      'bump-out-corner': 'eave-corner'
    }
    return mapping[cornerType] || 'unclassified'
  }
  
  const mapJunctionType = (type: string): string => {
    const mapping: Record<string, string> = {
      'ridge-hip-junction': 'ridge-hip-junction',
      'ridge-valley-junction': 'ridge-valley-junction',
      'hip-hip-junction': 'hip-hip-junction',
      'valley-hip-junction': 'valley-hip-junction',
      'ridge-termination': 'ridge-termination',
      'hip-peak': 'hip-peak'
    }
    return mapping[type] || 'ridge-hip-junction'
  }
  
  const vertexRecords: any[] = []
  
  perimeterVertices.forEach((v, index) => {
    const coords = toLatLng(v.x, v.y)
    vertexRecords.push({
      measurement_id: measurementId,
      x_percent: v.x,
      y_percent: v.y,
      lat: coords.lat,
      lng: coords.lng,
      location_type: 'perimeter',
      vertex_type: mapCornerType(v.cornerType || v.type || 'corner'),
      sequence_order: index,
      detection_confidence: 75,
      detection_source: 'ai_vision'
    })
  })
  
  interiorJunctions.forEach((j, index) => {
    const coords = toLatLng(j.x, j.y)
    vertexRecords.push({
      measurement_id: measurementId,
      x_percent: j.x,
      y_percent: j.y,
      lat: coords.lat,
      lng: coords.lng,
      location_type: 'interior',
      vertex_type: mapJunctionType(j.type || 'ridge-hip-junction'),
      sequence_order: index,
      detection_confidence: 70,
      detection_source: 'ai_vision'
    })
  })
  
  if (vertexRecords.length > 0) {
    const { error } = await supabase.from('roof_measurement_vertices').insert(vertexRecords)
    if (error) {
      console.error('⚠️ Failed to save vertices:', error.message)
    } else {
      console.log(`💾 Saved ${vertexRecords.length} vertices`)
    }
  }
  
  if (interiorJunctions.length > 0) {
    await supabase.from('roof_measurements').update({ 
      interior_vertex_count: interiorJunctions.length,
      vertex_count: perimeterVertices.length + interiorJunctions.length,
      edge_count: 0
    }).eq('id', measurementId)
  }
}

// Save edges to database
async function saveEdgesToDatabase(
  supabase: any,
  measurementId: string,
  derivedLines: DerivedLine[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): Promise<void> {
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  const toLatLng = (x: number, y: number) => {
    const pixelX = ((x / 100) - 0.5) * imageSize
    const pixelY = ((y / 100) - 0.5) * imageSize
    const metersX = pixelX * metersPerPixel
    const metersY = pixelY * metersPerPixel
    return {
      lat: imageCenter.lat - (metersY / metersPerDegLat),
      lng: imageCenter.lng + (metersX / metersPerDegLng)
    }
  }
  
  const calculateLengthFt = (startX: number, startY: number, endX: number, endY: number): number => {
    const startPixelX = ((startX / 100) - 0.5) * imageSize
    const startPixelY = ((startY / 100) - 0.5) * imageSize
    const endPixelX = ((endX / 100) - 0.5) * imageSize
    const endPixelY = ((endY / 100) - 0.5) * imageSize
    
    const dx = (endPixelX - startPixelX) * metersPerPixel
    const dy = (endPixelY - startPixelY) * metersPerPixel
    return Math.sqrt(dx * dx + dy * dy) * 3.28084
  }
  
  const edgeRecords: any[] = []
  
  derivedLines.forEach((line, index) => {
    const startCoords = toLatLng(line.startX, line.startY)
    const endCoords = toLatLng(line.endX, line.endY)
    const lengthFt = calculateLengthFt(line.startX, line.startY, line.endX, line.endY)
    
    if (lengthFt >= 3) {
      // Use wkt_geometry column (matches existing schema) instead of individual lat/lng columns
      const wktGeometry = `LINESTRING(${startCoords.lng} ${startCoords.lat}, ${endCoords.lng} ${endCoords.lat})`
      
      edgeRecords.push({
        measurement_id: measurementId,
        edge_type: line.type,
        edge_position: (line.type === 'eave' || line.type === 'rake') ? 'perimeter' : 'interior',
        length_ft: Math.round(lengthFt * 10) / 10,
        wkt_geometry: wktGeometry,
        detection_source: line.source,
        detection_confidence: 70
      })
    }
  })
  
  if (edgeRecords.length > 0) {
    const { error } = await supabase.from('roof_measurement_edges').insert(edgeRecords)
    if (error) {
      console.error('⚠️ Failed to save edges:', error.message)
    } else {
      console.log(`💾 Saved ${edgeRecords.length} edges`)
      await supabase.from('roof_measurements').update({ edge_count: edgeRecords.length }).eq('id', measurementId)
    }
  }
}

// Generate facet polygons - ALWAYS returns at least 1 fallback facet
function generateFacetPolygons(
  perimeterVertices: any[],
  interiorJunctions: any[],
  derivedLines: DerivedLine[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number,
  facetCount: number,
  predominantPitch: string
): any[] {
  // CRITICAL: Always return at least one facet (the full perimeter) if we have vertices
  if (!perimeterVertices || perimeterVertices.length < 3) {
    console.warn('⚠️ Cannot generate facets: insufficient perimeter vertices')
    return []
  }
  
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180)
  
  const toLatLng = (v: any) => {
    const pixelX = ((v.x / 100) - 0.5) * imageSize
    const pixelY = ((v.y / 100) - 0.5) * imageSize
    const metersX = pixelX * metersPerPixel
    const metersY = pixelY * metersPerPixel
    return {
      lat: imageCenter.lat - (metersY / metersPerDegLat),
      lng: imageCenter.lng + (metersX / metersPerDegLng)
    }
  }
  
  const facetPolygons: any[] = []
  
  // Calculate centroid
  const centroidX = perimeterVertices.reduce((sum, v) => sum + v.x, 0) / perimeterVertices.length
  const centroidY = perimeterVertices.reduce((sum, v) => sum + v.y, 0) / perimeterVertices.length
  const centroid = toLatLng({ x: centroidX, y: centroidY })
  
  const totalArea = calculatePolygonAreaFromPercentVertices(perimeterVertices, imageCenter, imageSize, zoom)
  const areaPerFacet = totalArea / Math.max(facetCount, 1)
  
  const ridgeLines = derivedLines.filter(l => l.type === 'ridge')
  const hipLines = derivedLines.filter(l => l.type === 'hip')
  
  const directions = ['north', 'south', 'east', 'west', 'northeast', 'southeast', 'southwest', 'northwest']
  
  // Try to generate multiple facets based on geometry
  if (facetCount >= 4 && (hipLines.length >= 2 || ridgeLines.length >= 1)) {
    const verticesWithAngles = perimeterVertices.map(v => {
      const angle = Math.atan2(v.y - centroidY, v.x - centroidX) * 180 / Math.PI
      return { ...v, angle: (angle + 360) % 360 }
    }).sort((a, b) => a.angle - b.angle)
    
    const segmentSize = Math.ceil(verticesWithAngles.length / facetCount)
    
    for (let i = 0; i < facetCount; i++) {
      const startIdx = i * segmentSize
      const endIdx = Math.min((i + 1) * segmentSize, verticesWithAngles.length)
      const segmentVertices = verticesWithAngles.slice(startIdx, endIdx)
      
      if (segmentVertices.length >= 2) {
        const facetPoints: { lng: number; lat: number }[] = [centroid]
        segmentVertices.forEach(v => facetPoints.push(toLatLng(v)))
        facetPoints.push(centroid)
        
        const facetCentroidLng = facetPoints.reduce((sum, p) => sum + p.lng, 0) / facetPoints.length
        const facetCentroidLat = facetPoints.reduce((sum, p) => sum + p.lat, 0) / facetPoints.length
        
        const avgAngle = segmentVertices.reduce((sum, v) => sum + v.angle, 0) / segmentVertices.length
        const primaryDirection = getDirectionFromAngle(avgAngle)
        
        facetPolygons.push({
          facetNumber: i + 1,
          points: facetPoints,
          centroid: { lng: facetCentroidLng, lat: facetCentroidLat },
          primaryDirection,
          azimuthDegrees: avgAngle,
          shapeType: 'triangular',
          areaEstimate: areaPerFacet
        })
      }
    }
  } else if (facetCount === 2 && ridgeLines.length >= 1) {
    const ridge = ridgeLines[0]
    const ridgeMidY = (ridge.startY + ridge.endY) / 2
    
    const northVertices = perimeterVertices.filter(v => v.y < ridgeMidY)
    const southVertices = perimeterVertices.filter(v => v.y >= ridgeMidY)
    
    if (northVertices.length >= 2) {
      const facetPoints = northVertices.map(toLatLng)
      facetPoints.push(facetPoints[0])
      const facetCentroidLng = facetPoints.reduce((sum, p) => sum + p.lng, 0) / facetPoints.length
      const facetCentroidLat = facetPoints.reduce((sum, p) => sum + p.lat, 0) / facetPoints.length
      
      facetPolygons.push({
        facetNumber: 1,
        points: facetPoints,
        centroid: { lng: facetCentroidLng, lat: facetCentroidLat },
        primaryDirection: 'north',
        azimuthDegrees: 0,
        shapeType: 'rectangular',
        areaEstimate: areaPerFacet
      })
    }
    
    if (southVertices.length >= 2) {
      const facetPoints = southVertices.map(toLatLng)
      facetPoints.push(facetPoints[0])
      const facetCentroidLng = facetPoints.reduce((sum, p) => sum + p.lng, 0) / facetPoints.length
      const facetCentroidLat = facetPoints.reduce((sum, p) => sum + p.lat, 0) / facetPoints.length
      
      facetPolygons.push({
        facetNumber: 2,
        points: facetPoints,
        centroid: { lng: facetCentroidLng, lat: facetCentroidLat },
        primaryDirection: 'south',
        azimuthDegrees: 180,
        shapeType: 'rectangular',
        areaEstimate: areaPerFacet
      })
    }
  }
  
  // CRITICAL FALLBACK: If no facets were generated, create ONE facet = entire perimeter
  if (facetPolygons.length === 0) {
    console.log(`📐 FALLBACK: Creating single facet from entire perimeter (${perimeterVertices.length} vertices)`)
    
    const perimeterPoints = perimeterVertices.map(toLatLng)
    // Close the polygon
    if (perimeterPoints.length > 0) {
      perimeterPoints.push(perimeterPoints[0])
    }
    
    facetPolygons.push({
      facetNumber: 1,
      points: perimeterPoints,
      centroid: centroid,
      primaryDirection: 'mixed',
      azimuthDegrees: 0,
      shapeType: 'irregular',
      areaEstimate: totalArea,
      isFallback: true
    })
    
    console.log(`📐 Fallback facet created with area: ${totalArea.toFixed(0)} sqft`)
  }
  // Fill remaining facets if needed (but only if we got some already)
  else if (facetPolygons.length < facetCount && facetPolygons.length > 0) {
    console.log(`📐 Filling: Creating ${facetCount - facetPolygons.length} additional facet regions`)
    const verticesPerFacet = Math.ceil(perimeterVertices.length / facetCount)
    
    for (let i = facetPolygons.length; i < facetCount; i++) {
      const startIdx = i * verticesPerFacet
      const endIdx = Math.min((i + 1) * verticesPerFacet, perimeterVertices.length)
      const segmentVertices = perimeterVertices.slice(startIdx, endIdx)
      
      if (segmentVertices.length >= 2) {
        const facetPoints = segmentVertices.map(toLatLng)
        facetPoints.push(centroid)
        facetPoints.push(facetPoints[0])
        
        const facetCentroidLng = facetPoints.reduce((sum, p) => sum + p.lng, 0) / facetPoints.length
        const facetCentroidLat = facetPoints.reduce((sum, p) => sum + p.lat, 0) / facetPoints.length
        
        facetPolygons.push({
          facetNumber: i + 1,
          points: facetPoints,
          centroid: { lng: facetCentroidLng, lat: facetCentroidLat },
          primaryDirection: directions[i % directions.length],
          azimuthDegrees: (i * 360 / facetCount),
          shapeType: 'irregular',
          areaEstimate: areaPerFacet
        })
      }
    }
  }
  
  console.log(`📐 Generated ${facetPolygons.length} facet polygons (requested: ${facetCount})`)
  return facetPolygons
}

function calculatePolygonAreaFromPercentVertices(
  vertices: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): number {
  if (!vertices || vertices.length < 3) return 0
  
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom)
  
  const feetVertices = vertices.map(v => ({
    x: ((v.x / 100) - 0.5) * imageSize * metersPerPixel * 3.28084,
    y: ((v.y / 100) - 0.5) * imageSize * metersPerPixel * 3.28084
  }))
  
  let area = 0
  for (let i = 0; i < feetVertices.length; i++) {
    const j = (i + 1) % feetVertices.length
    area += feetVertices[i].x * feetVertices[j].y
    area -= feetVertices[j].x * feetVertices[i].y
  }
  
  return Math.abs(area / 2)
}

// getDirectionFromAngle is now imported from roof-analysis-helpers.ts

async function saveFacetsToDatabase(
  supabase: any,
  measurementId: string,
  facetPolygons: any[],
  measurements: any
): Promise<void> {
  const pitchMultiplier = getSlopeFactorFromPitch(measurements.predominantPitch) || 1.083
  
  // Map any unsupported shape types to 'irregular' to satisfy DB constraint
  const validShapeTypes = ['rectangle', 'triangle', 'irregular', 'trapezoid', 'parallelogram'];
  
  const facetRecords = facetPolygons.map(facet => {
    const shapeType = validShapeTypes.includes(facet.shapeType) ? facet.shapeType : 'irregular';
    return {
      measurement_id: measurementId,
      facet_number: facet.facetNumber,
      polygon_points: facet.points,
      centroid: facet.centroid,
      shape_type: shapeType,
    area_flat_sqft: facet.areaEstimate,
    pitch: measurements.predominantPitch,
    pitch_multiplier: pitchMultiplier,
    area_adjusted_sqft: facet.areaEstimate * pitchMultiplier,
    primary_direction: facet.primaryDirection,
    azimuth_degrees: facet.azimuthDegrees,
    detection_confidence: 70
  };
  });
  
  const { error } = await supabase.from('roof_measurement_facets').insert(facetRecords)
  
  if (error) {
    console.error('⚠️ Failed to save facets:', error.message)
  } else {
    console.log(`💾 Saved ${facetRecords.length} facet records`)
  }
}

// ============= PHASE 4: Shadow Risk Assessment =============

interface ShadowRiskResult {
  risk: 'low' | 'medium' | 'high';
  qualityScore: number; // 0-100
  factors: string[];
  recommendManualReview: boolean;
}

/**
 * Assess shadow risk based on available data signals
 * Since we can't do image brightness analysis in Deno easily without image libs,
 * we use proxy signals from the detection results
 */
function assessShadowRisk(
  solarData: any,
  perimeterResult: any,
  footprintCheck: any
): ShadowRiskResult {
  const factors: string[] = []
  let riskScore = 0 // Higher = more risk
  
  // Signal 1: Large variance between detected area and Solar API footprint
  if (footprintCheck?.percentDifference) {
    const variance = Math.abs(footprintCheck.percentDifference)
    if (variance > 20) {
      riskScore += 30
      factors.push(`High variance vs Solar API: ${variance.toFixed(0)}%`)
    } else if (variance > 10) {
      riskScore += 15
      factors.push(`Moderate variance vs Solar API: ${variance.toFixed(0)}%`)
    }
  } else if (!solarData?.available) {
    // No Solar API reference available - less confident
    riskScore += 10
    factors.push('No Solar API reference for validation')
  }
  
  // Signal 2: Low vertex count relative to perimeter (under-detected edges)
  const vertexCount = perimeterResult?.vertices?.length || 0
  if (vertexCount < 6) {
    riskScore += 25
    factors.push(`Low vertex count: ${vertexCount} (may indicate shadow interference)`)
  } else if (vertexCount < 10) {
    riskScore += 10
    factors.push(`Few vertices detected: ${vertexCount}`)
  }
  
  // Signal 3: Simple roof type detected on what should be complex (possible shadow masking)
  const roofType = perimeterResult?.roofType?.toLowerCase() || ''
  const solarSegmentCount = solarData?.roofSegmentCount || 0
  if (solarSegmentCount >= 4 && (roofType === 'simple' || roofType === 'gable')) {
    riskScore += 15
    factors.push(`Simple detection despite ${solarSegmentCount} Solar segments`)
  }
  
  // Signal 4: Footprint is significantly SMALLER than Solar (shadow causing under-trace)
  if (footprintCheck?.percentDifference && footprintCheck.percentDifference < -15) {
    riskScore += 25
    factors.push(`Under-trace: ${Math.abs(footprintCheck.percentDifference).toFixed(0)}% smaller than Solar`)
  }
  
  // Signal 5: Very few interior junctions detected
  const junctionCount = perimeterResult?.interiorJunctions?.length || 0
  if (junctionCount === 0 && solarSegmentCount >= 3) {
    riskScore += 15
    factors.push('No interior junctions on multi-segment roof')
  }
  
  // Calculate quality score (inverse of risk)
  const qualityScore = Math.max(0, Math.min(100, 100 - riskScore))
  
  // Determine risk level
  let risk: 'low' | 'medium' | 'high' = 'low'
  if (riskScore >= 50) {
    risk = 'high'
  } else if (riskScore >= 25) {
    risk = 'medium'
  }
  
  return {
    risk,
    qualityScore,
    factors,
    recommendManualReview: risk === 'high' || qualityScore < 60
  }
}

// Convert perimeter vertices (percent format) to XY (lng, lat) format for Solar assembler
function convertPerimeterVerticesToXY(
  vertices: any[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): [number, number][] {
  if (!vertices || vertices.length === 0) return [];
  
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(imageCenter.lat * Math.PI / 180);
  
  return vertices.map((v: any) => {
    const pixelX = ((v.x / 100) - 0.5) * imageSize;
    const pixelY = ((v.y / 100) - 0.5) * imageSize;
    const metersX = pixelX * metersPerPixel;
    const metersY = pixelY * metersPerPixel;
    const lng = imageCenter.lng + (metersX / metersPerDegLng);
    const lat = imageCenter.lat - (metersY / metersPerDegLat);
    return [lng, lat] as [number, number];
  });
}

// Get centroid from XY array
function getCentroidFromXY(polygon: [number, number][]): { lng: number; lat: number } {
  if (polygon.length === 0) return { lng: 0, lat: 0 };
  const sumLng = polygon.reduce((sum, p) => sum + p[0], 0);
  const sumLat = polygon.reduce((sum, p) => sum + p[1], 0);
  return { lng: sumLng / polygon.length, lat: sumLat / polygon.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 SOLAR FAST PATH - Skip expensive AI passes when Solar data is sufficient
// Target: Complete in <15 seconds vs 160+ seconds for full AI pipeline
// ═══════════════════════════════════════════════════════════════════════════

interface SolarFastPathResult {
  success: boolean;
  reason?: string;
  response?: any;
}

async function processSolarFastPath(
  solarData: any,
  coordinates: { lat: number; lng: number },
  address: string,
  customerId: string | null,
  userId: string | null,
  googleImage: any,
  mapboxImage: any,
  supabase: any,
  startTime: number
): Promise<SolarFastPathResult> {
  
  console.log('🚀 Solar Fast Path: Starting...')
  
  // Validate we have minimum data
  if (!solarData?.roofSegments?.length || solarData.roofSegments.length < 2) {
    return { success: false, reason: 'Insufficient Solar segments' }
  }
  
  const totalFlatArea = solarData.buildingFootprintSqft
  if (!totalFlatArea || totalFlatArea < 500) {
    return { success: false, reason: 'Invalid Solar footprint area' }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 🗺️ AUTHORITATIVE FOOTPRINT: Mapbox Vector > Solar BBox > Segment Convex Hull
  // Mapbox provides sub-meter accuracy with real building geometry (many vertices)
  // Solar bbox is just a rectangle (4 vertices) - low geometric fidelity
  // ═══════════════════════════════════════════════════════════════════════════
  
  const boundingBox = solarData.boundingBox
  let perimeterXY: [number, number][] = []
  let footprintSource: 'mapbox_vector' | 'regrid_parcel' | 'google_solar_api' | 'solar_bbox_fallback' = 'solar_bbox_fallback'
  let footprintConfidence = 0.75
  let footprintVertexCount = 4
  
  // STEP 1: Try Mapbox Vector Footprint (highest fidelity)
  console.log('🗺️ STEP 1: Attempting Mapbox Vector Footprint...')
  const mapboxResult = await fetchMapboxVectorFootprint(
    coordinates.lat,
    coordinates.lng,
    MAPBOX_PUBLIC_TOKEN,
    { radius: 50 } // Increased radius for better building detection
  )
  
  // Enhanced diagnostics for Mapbox result
  if (mapboxResult.footprint) {
    console.log(`✅ Mapbox returned footprint: ${mapboxResult.footprint.vertexCount} vertices, ${Math.round(mapboxResult.footprint.areaM2 || 0)}m²`)
  } else {
    console.log(`⚠️ Mapbox failed: reason=${mapboxResult.fallbackReason || 'unknown'}, error=${mapboxResult.error || 'none'}`)
  }
  
  if (mapboxResult.footprint && mapboxResult.footprint.vertexCount >= 4) {
    // Compare with Solar API area to validate we got the right building
    try {
      const selected = selectBestFootprint(
        mapboxResult.footprint,
        boundingBox,
        totalFlatArea
      )
      
      perimeterXY = selected.coordinates
      footprintSource = selected.source
      footprintConfidence = selected.confidence
      footprintVertexCount = selected.vertexCount
      
      console.log(`🗺️ Footprint selected: ${footprintSource} with ${footprintVertexCount} vertices (${selected.reasoning})`)
    } catch (err) {
      console.warn('⚠️ Footprint selection failed:', err)
    }
  }
  
  // STEP 2: Fallback to Regrid parcel footprint if Mapbox failed
  const REGRID_API_KEY = Deno.env.get('REGRID_API_KEY')
  if (perimeterXY.length === 0 && REGRID_API_KEY) {
    console.log('🗺️ STEP 2: Mapbox unavailable, trying Regrid parcel footprint...')
    
    try {
      const regridFootprint = await fetchRegridFootprint(coordinates.lat, coordinates.lng, REGRID_API_KEY)
      
      if (regridFootprint && regridFootprint.vertices.length >= 4) {
        // Convert Regrid vertices {lat, lng} to XY coordinates [lng, lat]
        perimeterXY = regridFootprint.vertices.map(v => [v.lng, v.lat] as [number, number])
        footprintSource = 'regrid_parcel' as any
        footprintConfidence = regridFootprint.confidence
        footprintVertexCount = regridFootprint.vertices.length
        
        // Validate area is reasonable compared to Solar
        const regridAreaSqft = regridFootprint.buildingArea || 0
        if (regridAreaSqft > 0 && totalFlatArea > 0) {
          const areaRatio = regridAreaSqft / totalFlatArea
          if (areaRatio < 0.5 || areaRatio > 2.0) {
            console.warn(`⚠️ Regrid area mismatch: ${regridAreaSqft}sqft vs Solar ${totalFlatArea}sqft (ratio: ${areaRatio.toFixed(2)})`)
            // Still use it but reduce confidence
            footprintConfidence = Math.max(0.6, footprintConfidence - 0.15)
          }
        }
        
        console.log(`✅ Regrid footprint: ${footprintVertexCount} vertices, ${regridAreaSqft || 'unknown'}sqft, confidence ${(footprintConfidence * 100).toFixed(0)}%`)
      } else {
        console.log(`⚠️ Regrid returned no usable footprint`)
      }
    } catch (regridErr) {
      console.warn('⚠️ Regrid lookup failed:', regridErr)
    }
  }
  
  // STEP 2.5: NEW - OSM Overpass fallback (free, no API key required)
  if (perimeterXY.length === 0) {
    console.log('🗺️ STEP 2.5: Trying OpenStreetMap Overpass building footprint...')
    
    try {
      const osmFootprint = await fetchOSMBuildingFootprint(coordinates.lat, coordinates.lng)
      
      if (osmFootprint && osmFootprint.vertices.length >= 4) {
        perimeterXY = osmFootprint.vertices.map(v => [v.lng, v.lat] as [number, number])
        footprintSource = 'osm_overpass' as any
        footprintConfidence = osmFootprint.confidence
        footprintVertexCount = osmFootprint.vertices.length
        
        console.log(`✅ OSM Overpass footprint: ${footprintVertexCount} vertices, confidence ${(footprintConfidence * 100).toFixed(0)}%`)
      } else {
        console.log(`⚠️ OSM Overpass returned no usable footprint`)
      }
    } catch (osmErr) {
      console.warn('⚠️ OSM Overpass lookup failed:', osmErr)
    }
  }
  
  // STEP 2.7: NEW - Microsoft/Esri Building Footprints fallback (free, uses Esri ArcGIS service)
  if (perimeterXY.length === 0) {
    console.log('🏢 STEP 2.7: Trying Microsoft/Esri Building Footprints (free, no API key)...')
    
    try {
      const msftFootprint = await fetchMicrosoftBuildingFootprint(coordinates.lat, coordinates.lng)
      
      if (msftFootprint.footprint && msftFootprint.footprint.vertexCount >= 4) {
        perimeterXY = msftFootprint.footprint.coordinates
        footprintSource = 'microsoft_buildings' as any
        footprintConfidence = msftFootprint.footprint.confidence
        footprintVertexCount = msftFootprint.footprint.vertexCount
        
        // Validate area is reasonable compared to Solar
        const msftAreaSqft = (msftFootprint.footprint.areaM2 || 0) * 10.764
        if (msftAreaSqft > 0 && totalFlatArea > 0) {
          const areaRatio = msftAreaSqft / totalFlatArea
          if (areaRatio < 0.5 || areaRatio > 2.0) {
            console.warn(`⚠️ Microsoft area mismatch: ${Math.round(msftAreaSqft)}sqft vs Solar ${Math.round(totalFlatArea)}sqft (ratio: ${areaRatio.toFixed(2)})`)
            footprintConfidence = Math.max(0.6, footprintConfidence - 0.15)
          }
        }
        
        console.log(`✅ Microsoft footprint: ${footprintVertexCount} vertices, ${Math.round(msftAreaSqft)}sqft, confidence ${(footprintConfidence * 100).toFixed(0)}%`)
      } else {
        console.log(`⚠️ Microsoft/Esri returned no usable footprint: ${msftFootprint.fallbackReason || msftFootprint.error || 'unknown'}`)
      }
    } catch (msftErr) {
      console.warn('⚠️ Microsoft/Esri lookup failed:', msftErr)
    }
  }
  
  // STEP 3: Fallback to Solar bounding box (rectangle - lowest fidelity)
  // ⚠️ CRITICAL: Bounding box includes non-roof areas (patios, pools, landscaping)
  // This WILL overestimate area - mark as low confidence and require review
  if (perimeterXY.length === 0 && boundingBox?.sw && boundingBox?.ne) {
    console.log('⚠️ STEP 3: Using Solar API bounding box as perimeter fallback (4 vertices - rectangle)')
    console.log('⚠️ WARNING: Bounding box includes non-roof areas - area may be significantly overestimated!')
    const sw = boundingBox.sw
    const ne = boundingBox.ne
    perimeterXY = [
      [sw.longitude, sw.latitude],
      [ne.longitude, sw.latitude],
      [ne.longitude, ne.latitude],
      [sw.longitude, ne.latitude],
    ]
    footprintSource = 'solar_bbox_fallback' // Explicit name to flag low-quality footprint
    footprintConfidence = 0.60 // Lower confidence - bounding box is unreliable for area
    footprintVertexCount = 4
    
    // Calculate bounding box area vs Solar API area to log the discrepancy
    const bboxWidthDeg = ne.longitude - sw.longitude
    const bboxHeightDeg = ne.latitude - sw.latitude
    const avgLat = (ne.latitude + sw.latitude) / 2
    const metersPerDegLat = 111320
    const metersPerDegLng = 111320 * Math.cos(avgLat * Math.PI / 180)
    const bboxWidthFt = bboxWidthDeg * metersPerDegLng * 3.28084
    const bboxHeightFt = bboxHeightDeg * metersPerDegLat * 3.28084
    const bboxAreaSqft = bboxWidthFt * bboxHeightFt
    
    console.log(`📐 BBox area: ${Math.round(bboxAreaSqft)}sqft vs Solar API: ${Math.round(totalFlatArea)}sqft (ratio: ${(bboxAreaSqft/totalFlatArea).toFixed(2)}x)`)
    console.log('📐 Using Solar API buildingFootprintSqft as authoritative area, NOT recalculating from bbox polygon')
  }
  
  // STEP 4: Last resort - build from segment bounding boxes (convex hull)
  // ⚠️ CRITICAL: This is even less accurate than bbox - will significantly overestimate area
  if (perimeterXY.length === 0) {
    console.log('⚠️ STEP 4: Building perimeter from segment bounding boxes (convex hull - last resort)')
    console.log('⚠️ WARNING: Convex hull from segment boxes will include gaps and overestimate area significantly!')
    const allCorners: [number, number][] = []
    solarData.roofSegments.forEach((seg: any) => {
      if (seg.boundingBox?.sw && seg.boundingBox?.ne) {
        const sw = seg.boundingBox.sw
        const ne = seg.boundingBox.ne
        allCorners.push([sw.longitude, sw.latitude])
        allCorners.push([ne.longitude, sw.latitude])
        allCorners.push([ne.longitude, ne.latitude])
        allCorners.push([sw.longitude, ne.latitude])
      }
    })
    
    if (allCorners.length < 4) {
      return { success: false, reason: 'No segment bounding boxes available' }
    }
    
    // Compute convex hull from all corners
    perimeterXY = computeConvexHull(allCorners)
    footprintSource = 'solar_bbox_fallback'
    footprintConfidence = 0.55 // Very low confidence - convex hull is unreliable
    footprintVertexCount = perimeterXY.length
    console.log(`📐 Built perimeter from ${allCorners.length} segment corners -> ${perimeterXY.length} hull vertices`)
    console.log('📐 Using Solar API buildingFootprintSqft as authoritative area, NOT recalculating from convex hull')
  }
  
  if (perimeterXY.length < 3) {
    return { success: false, reason: 'Could not build valid perimeter' }
  }
  
  // Determine predominant pitch from Solar segments
  let predominantPitch = '6/12'
  const segmentsWithPitch = solarData.roofSegments.filter((s: any) => s.pitchDegrees > 0)
  if (segmentsWithPitch.length > 0) {
    const avgPitchDegrees = segmentsWithPitch.reduce((sum: number, s: any) => sum + s.pitchDegrees, 0) / segmentsWithPitch.length
    predominantPitch = degreesToPitchFast(avgPitchDegrees)
    console.log(`📐 Pitch from Solar: ${avgPitchDegrees.toFixed(1)}° -> ${predominantPitch}`)
  }
  
  // Use Solar Segment Assembler
  let assembledGeometry: any = null
  try {
    assembledGeometry = assembleFacetsFromSolarSegments(
      perimeterXY,
      solarData.roofSegments as SolarSegment[],
      predominantPitch
    )
    console.log(`✅ Solar assembly: ${assembledGeometry.facets.length} facets, quality: ${assembledGeometry.quality}`)
  } catch (err) {
    console.warn('⚠️ Solar assembly failed:', err)
    return { success: false, reason: 'Solar assembly failed' }
  }
  
  // Calculate measurements
  const pitchMultiplier = getSlopeFactorFromPitch(predominantPitch) || 1.083
  const totalAdjustedArea = totalFlatArea * pitchMultiplier
  const totalSquares = totalAdjustedArea / 100
  
  // Get segment count for facet_count field (use Solar API data directly)
  const segmentCount = solarData.roofSegments.length
  
  // Estimate linear measurements from area/perimeter (heuristic approach until topology analysis is improved)
  const estimatedPerimeterFt = solarData.estimatedPerimeterFt || 4 * Math.sqrt(totalFlatArea)
  const ridgeLength = Math.sqrt(totalFlatArea) * 0.6
  const hipLength = segmentCount >= 4 ? ridgeLength * 0.4 : 0
  const valleyLength = 0 // Conservative: valleys detected by AI passes, not fast path
  const eaveLength = estimatedPerimeterFt * 0.35
  const rakeLength = estimatedPerimeterFt * 0.15
  
  const linearMeasurements = {
    eave: Math.round(eaveLength),
    rake: Math.round(rakeLength),
    hip: Math.round(hipLength),
    valley: Math.round(valleyLength),
    ridge: Math.round(ridgeLength)
  }
  
  // Determine roof type from segment count
  const roofTypeFromTopology = segmentCount >= 6 ? 'complex' :
                                segmentCount >= 4 ? 'hip' : 'gable'
  
  // Calculate complexity and waste factor
  const complexity = segmentCount >= 6 ? 'complex' : 
                     segmentCount >= 4 ? 'moderate' : 'simple'
  const wasteFactor = complexity === 'complex' ? 1.15 : complexity === 'moderate' ? 1.12 : 1.10
  const totalSquaresWithWaste = totalSquares * wasteFactor
  
  // Build materials list
  const materials = {
    shingleBundles: Math.ceil(totalSquaresWithWaste * 3),
    underlaymentRolls: Math.ceil(totalSquares),
    iceWaterShieldRolls: Math.ceil((eaveLength * 2) / 65),
    dripEdgeSheets: Math.ceil((eaveLength + rakeLength) / 10),
    starterStripBundles: Math.ceil((eaveLength + rakeLength) / 105),
    hipRidgeBundles: Math.ceil((hipLength + ridgeLength) / 20),
  }
  
  // Build perimeter WKT
  const perimeterWkt = `POLYGON((${perimeterXY.map(p => `${p[0]} ${p[1]}`).join(', ')}, ${perimeterXY[0][0]} ${perimeterXY[0][1]}))`
  
  // Build linear features from assembler output (stable, clean rendering)
  const linearFeatures: any[] = []
  
  if (assembledGeometry.ridges) {
    assembledGeometry.ridges.forEach((r: any) => {
      linearFeatures.push({
        type: 'ridge',
        wkt: `LINESTRING(${r.start[0]} ${r.start[1]}, ${r.end[0]} ${r.end[1]})`,
        length_ft: r.lengthFt,
        plan_length_ft: r.lengthFt,
        surface_length_ft: r.lengthFt * pitchMultiplier,
        source: 'solar_assembler'
      })
    })
  }
  
  if (assembledGeometry.hips) {
    assembledGeometry.hips.forEach((h: any) => {
      linearFeatures.push({
        type: 'hip',
        wkt: `LINESTRING(${h.start[0]} ${h.start[1]}, ${h.end[0]} ${h.end[1]})`,
        length_ft: h.lengthFt,
        plan_length_ft: h.lengthFt,
        surface_length_ft: h.lengthFt * pitchMultiplier,
        source: 'solar_assembler'
      })
    })
  }
  
  if (assembledGeometry.valleys) {
    assembledGeometry.valleys.forEach((v: any) => {
      linearFeatures.push({
        type: 'valley',
        wkt: `LINESTRING(${v.start[0]} ${v.start[1]}, ${v.end[0]} ${v.end[1]})`,
        length_ft: v.lengthFt,
        plan_length_ft: v.lengthFt,
        surface_length_ft: v.lengthFt * pitchMultiplier,
        source: 'solar_assembler'
      })
    })
  }
  
  // Add eaves and rakes from perimeter edges
  if (assembledGeometry.eaves) {
    assembledGeometry.eaves.forEach((e: any) => {
      linearFeatures.push({
        type: 'eave',
        wkt: `LINESTRING(${e.start[0]} ${e.start[1]}, ${e.end[0]} ${e.end[1]})`,
        length_ft: e.lengthFt,
        plan_length_ft: e.lengthFt,
        surface_length_ft: e.lengthFt,
        source: 'solar_assembler'
      })
    })
  }
  
  if (assembledGeometry.rakes) {
    assembledGeometry.rakes.forEach((r: any) => {
      linearFeatures.push({
        type: 'rake',
        wkt: `LINESTRING(${r.start[0]} ${r.start[1]}, ${r.end[0]} ${r.end[1]})`,
        length_ft: r.lengthFt,
        plan_length_ft: r.lengthFt,
        surface_length_ft: r.lengthFt,
        source: 'solar_assembler'
      })
    })
  }
  
  console.log(`📐 Linear features from assembler: ${linearFeatures.length} (${linearFeatures.filter(f => f.type === 'ridge').length} ridges, ${linearFeatures.filter(f => f.type === 'hip').length} hips, ${linearFeatures.filter(f => f.type === 'valley').length} valleys)`)
  
  // Build facet polygons for database
  const facetPolygons = assembledGeometry.facets.map((facet: any, index: number) => ({
    facetNumber: index + 1,
    points: facet.polygon.map((xy: [number, number]) => ({ lng: xy[0], lat: xy[1] })),
    centroid: getCentroidFromXY(facet.polygon),
    primaryDirection: facet.direction,
    azimuthDegrees: facet.azimuthDegrees,
    shapeType: 'irregular',
    areaEstimate: facet.areaSqft,
    solarSegmentIndex: facet.sourceSegmentIndex
  }))
  
  // Select image source
  const selectedImage = googleImage.url ? googleImage : mapboxImage
  const imageSource = selectedImage.source
  const imageYear = new Date().getFullYear()
  
  // Build AI analysis structure (for compatibility)
  const ridgeCount = linearFeatures.filter(f => f.type === 'ridge').length
  const hipCount = linearFeatures.filter(f => f.type === 'hip').length
  const valleyCount = linearFeatures.filter(f => f.type === 'valley').length
  
  const aiAnalysis = {
    roofType: roofTypeFromTopology,
    facets: [{ facetNumber: 1, estimatedAreaSqft: totalFlatArea }],
    boundingBox: { topLeftX: 30, topLeftY: 30, bottomRightX: 70, bottomRightY: 70 },
    roofPerimeter: perimeterXY.map(p => ({ x: 50, y: 50 })), // Simplified
    overallComplexity: complexity,
    derivedFacetCount: segmentCount, // Use actual Solar segment count, not assembler facets
    facetCount: segmentCount,
    linearFeatureCounts: {
      ridges: ridgeCount,
      hips: hipCount,
      valleys: valleyCount
    }
  }
  
  // Build authoritative footprint for Solar Fast Path (now uses Mapbox when available!)
  const solarFastPathFootprint = {
    vertices: perimeterXY.map(p => ({ lat: p[1], lng: p[0] })),
    confidence: footprintConfidence,
    source: footprintSource,
    requiresManualReview: footprintSource === 'solar_bbox_fallback', // Flag if using rectangle fallback
    validation: { valid: true, areaSqFt: totalFlatArea },
  };
  
  // Determine if DSM data was available (for badge display)
  // Solar Fast Path doesn't use DSM currently, but we track for future enhancement
  const dsmAvailable = false;
  
  console.log(`📊 Footprint tracking: source=${footprintSource}, vertices=${footprintVertexCount}, confidence=${(footprintConfidence * 100).toFixed(0)}%`);

  // Save to database
  const { data: measurementRecord, error: saveError } = await supabase.from('roof_measurements').insert({
    customer_id: customerId || null,
    measured_by: userId || null,
    property_address: address,
    gps_coordinates: { lat: coordinates.lat, lng: coordinates.lng },
    google_maps_image_url: googleImage.url,
    mapbox_image_url: mapboxImage.url,
    selected_image_source: imageSource,
    image_source: imageSource,
    image_year: imageYear,
    solar_api_available: true,
    solar_building_footprint_sqft: totalFlatArea,
    solar_api_response: solarData,
    ai_detection_data: { ...aiAnalysis, source: 'solar_fast_path', footprint_source: footprintSource },
    total_area_flat_sqft: totalFlatArea,
    total_area_adjusted_sqft: totalAdjustedArea,
    total_squares: totalSquares,
    waste_factor_percent: (wasteFactor - 1) * 100,
    total_squares_with_waste: totalSquaresWithWaste,
    predominant_pitch: predominantPitch,
    pixels_per_foot: 10,
    scale_method: 'solar_api_footprint',
    scale_confidence: 'high',
    measurement_confidence: 90,
    requires_manual_review: footprintSource === 'solar_bbox_fallback',
    roof_type: roofTypeFromTopology,
    complexity_rating: complexity,
    facet_count: segmentCount, // Use Solar segment count (11 for this property)
    total_eave_length: linearMeasurements.eave,
    total_rake_length: linearMeasurements.rake,
    total_hip_length: linearMeasurements.hip,
    total_valley_length: linearMeasurements.valley,
    total_ridge_length: linearMeasurements.ridge,
    material_calculations: materials,
    linear_features_wkt: linearFeatures,
    perimeter_wkt: perimeterWkt,
    bounding_box: aiAnalysis.boundingBox,
    analysis_zoom: IMAGE_ZOOM,
    analysis_image_size: { width: 640, height: 640 },
    validation_status: 'pending',
    vertex_count: footprintVertexCount,
    perimeter_vertex_count: footprintVertexCount,
    interior_vertex_count: 0,
    metadata: { 
      fast_path: true, 
      solar_segments: solarData.roofSegments.length,
      footprint_source: footprintSource,
      footprint_vertex_count: footprintVertexCount
    },
    // Authoritative footprint tracking fields (now correctly tracks source!)
    footprint_source: footprintSource,
    footprint_confidence: footprintConfidence,
    footprint_vertices_geo: solarFastPathFootprint.vertices,
    footprint_requires_review: footprintSource === 'solar_bbox_fallback',
    dsm_available: dsmAvailable,
    footprint_validation: solarFastPathFootprint.validation,
  }).select().single()
  
  if (saveError) {
    console.error('Solar Fast Path save error:', saveError)
    return { success: false, reason: `Database save failed: ${saveError.message}` }
  }
  
  console.log(`💾 Solar Fast Path saved measurement: ${measurementRecord.id}`)
  
  // Save facets
  if (facetPolygons.length > 0) {
    await saveFacetsToDatabase(supabase, measurementRecord.id, facetPolygons, { predominantPitch })
  }
  
  const totalTime = Date.now() - startTime
  
  // Build response in same format as full pipeline
  const response = {
    success: true,
    measurementId: measurementRecord.id,
    timing: { totalMs: totalTime, fastPath: true },
    data: {
      address,
      coordinates,
      images: { 
        google: googleImage.url ? 'available' : 'unavailable', 
        mapbox: mapboxImage.url ? 'available' : 'unavailable', 
        selected: selectedImage.source 
      },
      solarApiData: {
        available: true,
        buildingFootprint: totalFlatArea,
        roofSegments: solarData.roofSegments.length,
        linearFeatures: linearFeatures.length
      },
      aiAnalysis: {
        roofType: roofTypeFromTopology,
        facetCount: segmentCount, // Actual Solar segment count
        complexity: complexity,
        pitch: predominantPitch,
        boundingBox: aiAnalysis.boundingBox,
        source: 'solar_fast_path',
        linearFeatureCounts: {
          ridges: ridgeCount,
          hips: hipCount,
          valleys: valleyCount
        }
      },
      measurements: {
        totalAreaSqft: totalAdjustedArea,
        totalSquares: totalSquares,
        wasteFactor: wasteFactor,
        facets: [],
        linear: linearMeasurements,
        materials: materials,
        predominantPitch: predominantPitch,
        linearFeaturesWkt: linearFeatures,
        analysisZoom: IMAGE_ZOOM,
        analysisImageSize: { width: 640, height: 640 }
      },
      linearFeaturesWkt: linearFeatures,
      perimeterWkt: perimeterWkt,
      analysisZoom: IMAGE_ZOOM,
      analysisImageSize: { width: 640, height: 640 },
      confidence: {
        score: 90,
        rating: 'high',
        factors: ['Solar API validation', 'Fast path processing', `Footprint: ${footprintSource}`],
        requiresReview: footprintSource === 'solar_bbox_fallback'
      },
      scale: {
        pixelsPerFoot: 10,
        method: 'solar_api_footprint',
        confidence: 'high'
      },
      // NEW: Footprint tracking for frontend badge display
      footprint: {
        source: footprintSource,
        confidence: footprintConfidence,
        vertexCount: footprintVertexCount,
        dsmAvailable: dsmAvailable,
        requiresReview: footprintSource === 'solar_bbox_fallback'
      },
      // NEW: Performance metrics for transparency
      performance: {
        path_used: 'solar_fast_path',
        fast_path_skipped_reason: null,
        timings_ms: {
          imagery_fetch: 0,
          footprint_total: 0,
          building_isolation: 0,
          perimeter_detection: 0,
          ridge_detection: 0,
          skeleton_generation: 0,
          total: totalTime
        },
        footprint_source: footprintSource
      }
    }
  }
  
  return { success: true, response }
}

// Simple convex hull using monotonic chain algorithm
function computeConvexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points
  
  // Sort by x, then y
  const sorted = [...points].sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0])
  
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  
  // Build lower hull
  const lower: [number, number][] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  
  // Build upper hull
  const upper: [number, number][] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  
  // Remove last point of each half (it's repeated)
  lower.pop()
  upper.pop()
  
  return lower.concat(upper)
}

// Fast pitch conversion for Solar Fast Path
function degreesToPitchFast(degrees: number): string {
  if (degrees < 5) return 'flat'
  if (degrees < 15) return '3/12'
  if (degrees < 20) return '4/12'
  if (degrees < 24) return '5/12'
  if (degrees < 28) return '6/12'
  if (degrees < 32) return '7/12'
  if (degrees < 36) return '8/12'
  if (degrees < 40) return '9/12'
  if (degrees < 45) return '10/12'
  return '12/12'
}

// ═══════════════════════════════════════════════════════════════════════════
// 🗺️ OSM OVERPASS BUILDING FOOTPRINT FALLBACK
// Free API, no key required - backup when Mapbox and Regrid fail
// ═══════════════════════════════════════════════════════════════════════════

interface OSMFootprint {
  vertices: Array<{ lat: number; lng: number }>;
  confidence: number;
  source: 'osm_overpass';
  osmId?: string;
}

async function fetchOSMBuildingFootprint(
  lat: number,
  lng: number
): Promise<OSMFootprint | null> {
  try {
    // Query buildings within ~50m of the point
    const radius = 50; // meters
    const overpassQuery = `
      [out:json][timeout:10];
      way["building"](around:${radius},${lat},${lng});
      out geom;
    `;
    
    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    console.log(`🗺️ OSM Overpass: Querying buildings within ${radius}m of ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    
    const response = await fetch(overpassUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    });
    
    if (!response.ok) {
      console.warn(`⚠️ OSM Overpass failed: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (!data.elements || data.elements.length === 0) {
      console.log('⚠️ No OSM buildings found');
      return null;
    }
    
    console.log(`📊 OSM Overpass: Found ${data.elements.length} building(s)`);
    
    // Find the building that contains the point or is closest
    type Candidate = {
      vertices: Array<{ lat: number; lng: number }>;
      osmId: string;
      containsPoint: boolean;
      distance: number;
    };
    
    const candidates: Candidate[] = [];
    
    for (const element of data.elements) {
      if (element.type !== 'way' || !element.geometry || element.geometry.length < 4) continue;
      
      const vertices = element.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon }));
      
      // Check if point is inside polygon
      const containsPoint = pointInPolygonLatLng({ lat, lng }, vertices);
      
      // Calculate distance to centroid
      const centroid = {
        lat: vertices.reduce((s: number, v: { lat: number }) => s + v.lat, 0) / vertices.length,
        lng: vertices.reduce((s: number, v: { lng: number }) => s + v.lng, 0) / vertices.length,
      };
      const distanceDeg = Math.sqrt(Math.pow(lat - centroid.lat, 2) + Math.pow(lng - centroid.lng, 2));
      const distanceM = distanceDeg * 111320; // rough conversion
      
      candidates.push({
        vertices,
        osmId: element.id?.toString() || 'unknown',
        containsPoint,
        distance: distanceM,
      });
    }
    
    if (candidates.length === 0) {
      console.log('⚠️ No valid OSM building polygons found');
      return null;
    }
    
    // Sort: prefer containing point, then by distance
    candidates.sort((a, b) => {
      if (a.containsPoint !== b.containsPoint) return a.containsPoint ? -1 : 1;
      return a.distance - b.distance;
    });
    
    const best = candidates[0];
    
    // Confidence based on containment and distance
    let confidence = 0.80;
    if (!best.containsPoint) confidence -= 0.15;
    if (best.distance > 20) confidence -= 0.05;
    confidence = Math.max(0.55, confidence);
    
    console.log(`✅ OSM footprint: ${best.vertices.length} vertices, containsPoint=${best.containsPoint}, distance=${best.distance.toFixed(1)}m, confidence ${(confidence * 100).toFixed(0)}%`);
    
    return {
      vertices: best.vertices,
      confidence,
      source: 'osm_overpass',
      osmId: best.osmId,
    };
    
  } catch (error) {
    console.error('❌ OSM Overpass error:', error);
    return null;
  }
}

// Point-in-polygon test for {lat, lng} objects
function pointInPolygonLatLng(point: { lat: number; lng: number }, polygon: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    
    if (((yi > point.lat) !== (yj > point.lat)) &&
        (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}
