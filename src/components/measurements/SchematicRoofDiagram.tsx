import { useMemo, useEffect, useState } from 'react';
import { wktLineToLatLngs, wktPolygonToLatLngs } from '@/lib/canvassiq/wkt';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, Eye, EyeOff, MapPin, Layers, Info, CheckCircle, Map, Cpu } from 'lucide-react';
import { calculateImageBounds, gpsToPixel, type ImageBounds, type GPSCoord } from '@/utils/gpsCalculations';
import { type SolarSegment } from '@/lib/measurements/segmentGeometryParser';
import { reconstructRoofFromPerimeter, type ReconstructedRoof } from '@/lib/measurements/roofGeometryReconstructor';
import { Badge } from '@/components/ui/badge';
// Roofr exact color palette - MATCHED to Roofr conventions
const FEATURE_COLORS = {
  eave: '#006400',    // Dark green - Eaves
  ridge: '#90EE90',   // Light green - Ridges  
  hip: '#9B59B6',     // Purple - Hips
  valley: '#DC3545',  // Red - Valleys
  rake: '#17A2B8',    // Cyan/Teal - Rakes
  step: '#6C757D',    // Gray (dotted) - Steps
  perimeter: '#343A40', // Dark outline
};

// Facet color palette - distinct colors for each facet
const FACET_COLORS = [
  'rgba(59, 130, 246, 0.3)',   // Blue
  'rgba(239, 68, 68, 0.3)',    // Red
  'rgba(34, 197, 94, 0.3)',    // Green
  'rgba(251, 191, 36, 0.3)',   // Yellow
  'rgba(139, 92, 246, 0.3)',   // Purple
  'rgba(236, 72, 153, 0.3)',   // Pink
  'rgba(20, 184, 166, 0.3)',   // Teal
  'rgba(249, 115, 22, 0.3)',   // Orange
];

// Plausibility thresholds for linear features - RELAXED for valid hip roofs
// A standard hip roof has 1 ridge + 4 hips = 5 lines, with ridge endpoints each having 3 lines converging
// This is NORMAL topology, not a starburst pattern
const LINE_PLAUSIBILITY = {
  MAX_LINES_PER_TYPE: 20,       // Reasonable limit per type
  MAX_STARBURST_RATIO: 0.50,    // RELAXED - only flag extreme convergence (>50% at one point)
  MIN_LINE_LENGTH_FT: 2,        // Ignore very short lines
  MAX_LINE_LENGTH_FT: 200,      // Allow longer features for large roofs
  MAX_CONVERGENCE_POINTS: 4,    // Allow more convergence points (valleys, complex roofs)
  MIN_LINES_FOR_STARBURST: 8,   // Only check for starburst with many lines (8+)
  ABSOLUTE_MAX_CONVERGENCE: 6,  // Only flag if 6+ lines meet at single point (extreme)
};

interface LinearFeature {
  type: string;
  wkt?: string;
  length_ft?: number;
  length?: number;
}

interface FacetData {
  id: string;
  facet_number: number;
  polygon_points: { lat: number; lng: number }[];
  centroid: { lat: number; lng: number };
  area_flat_sqft: number;
  area_adjusted_sqft: number;
  pitch: string;
  primary_direction: string;
}

interface GeometryQA {
  hasFacets: boolean;
  facetCount: number;
  vertexCount: number;
  linearFeatureCount: number;
  plausibleLines: number;
  implausibleLines: number;
  perimeterStatus: 'ok' | 'warning' | 'missing';
}

interface SchematicRoofDiagramProps {
  measurement: any;
  tags: Record<string, any>;
  measurementId?: string;
  width?: number;
  height?: number;
  showLengthLabels?: boolean;
  showLegend?: boolean;
  showCompass?: boolean;
  showTotals?: boolean;
  showFacets?: boolean;
  showQAPanel?: boolean;
  backgroundColor?: string;
  // NEW: Satellite overlay props
  satelliteImageUrl?: string;
  showSatelliteOverlay?: boolean;
  satelliteOpacity?: number;
  // NEW: Debug mode props
  showDebugMarkers?: boolean;
  showDebugPanel?: boolean;
}

// Calculate distance between two points in feet (haversine)
function calculateSegmentLength(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
  const R = 20902231; // Earth's radius in feet
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Convert azimuth angle to compass direction
function getDirectionFromAzimuth(azimuth: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(azimuth / 45) % 8;
  return directions[index];
}

// Filter out implausible linear features - BUT NOT EAVES/RAKES (they need to be reliable)
function filterPlausibleLines(
  features: Array<{ type: string; coords: { lat: number; lng: number }[]; length: number }>
): { plausible: typeof features; implausibleCount: number; starburstDetected: boolean } {
  // Separate eaves/rakes from interior lines - eaves/rakes bypass filtering
  const eavesRakes = features.filter(f => f.type === 'eave' || f.type === 'rake');
  const interiorLines = features.filter(f => f.type !== 'eave' && f.type !== 'rake');
  
  // Count interior lines by type
  const typeCounts: Record<string, number> = {};
  interiorLines.forEach(f => {
    typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
  });
  
  // ENHANCED STARBURST DETECTION: Check BOTH start AND end points
  // The bug was that all lines were converging to 1-2 central points
  const allEndpoints: Record<string, number> = {};
  interiorLines.forEach(f => {
    if (f.coords.length >= 2) {
      // Check start point
      const startKey = `${f.coords[0].lat.toFixed(5)},${f.coords[0].lng.toFixed(5)}`;
      allEndpoints[startKey] = (allEndpoints[startKey] || 0) + 1;
      
      // Check end point (where the actual convergence happens)
      const lastIdx = f.coords.length - 1;
      const endKey = `${f.coords[lastIdx].lat.toFixed(5)},${f.coords[lastIdx].lng.toFixed(5)}`;
      allEndpoints[endKey] = (allEndpoints[endKey] || 0) + 1;
    }
  });
  
  // Count how many unique high-convergence points exist
  const convergenceThreshold = Math.max(3, interiorLines.length * 0.25); // 25% of lines or 3, whichever is higher
  const highConvergencePoints = Object.entries(allEndpoints)
    .filter(([_, count]) => count >= convergenceThreshold);
  
  const maxAtSinglePoint = Math.max(...Object.values(allEndpoints), 0);
  const totalInteriorEndpoints = interiorLines.length * 2; // Each line has 2 endpoints
  const starburstRatio = totalInteriorEndpoints > 0 ? maxAtSinglePoint / totalInteriorEndpoints : 0;
  
  let plausibleInterior = interiorLines;
  let starburstDetected = false;
  
// STARBURST DETECTION CRITERIA - RELAXED for valid hip roof topology:
  // A standard hip roof has 2 ridge endpoints, each with 3 lines converging (ridge + 2 hips)
  // This is NORMAL and should NOT be flagged as a starburst
  // Only flag TRUE starbursts: 1 central point with 5+ lines radiating outward
  const hasEnoughLines = interiorLines.length >= LINE_PLAUSIBILITY.MIN_LINES_FOR_STARBURST;
  
  // Only consider it a starburst if:
  // - There is exactly 1 high-convergence point (true radial pattern), AND
  // - That point has 6+ lines converging (extreme), AND
  // - The ratio is very high (>50% of endpoints at one point)
  const isTrueStarburst = highConvergencePoints.length === 1 && 
                          maxAtSinglePoint >= LINE_PLAUSIBILITY.ABSOLUTE_MAX_CONVERGENCE &&
                          starburstRatio > LINE_PLAUSIBILITY.MAX_STARBURST_RATIO;
  
  // Debug logging for starburst detection
  console.log(`🔍 Starburst check: ${interiorLines.length} interior lines`);
  console.log(`   - Max at single point: ${maxAtSinglePoint} (threshold: ${LINE_PLAUSIBILITY.ABSOLUTE_MAX_CONVERGENCE})`);
  console.log(`   - High convergence points: ${highConvergencePoints.length} (needs exactly 1 for starburst)`);
  console.log(`   - Starburst ratio: ${(starburstRatio * 100).toFixed(1)}% (threshold: ${LINE_PLAUSIBILITY.MAX_STARBURST_RATIO * 100}%)`);
  console.log(`   - Is true starburst: ${isTrueStarburst}`);
  
  if (hasEnoughLines && isTrueStarburst) {
    console.warn(`🚨 TRUE STARBURST DETECTED - hiding interior lines`);
    plausibleInterior = [];
    starburstDetected = true;
  } else {
    console.log(`✅ Valid roof topology - showing ${interiorLines.length} interior lines`);
    // Filter individual interior lines only
    plausibleInterior = interiorLines.filter(f => {
      if (f.length < LINE_PLAUSIBILITY.MIN_LINE_LENGTH_FT) return false;
      if (f.length > LINE_PLAUSIBILITY.MAX_LINE_LENGTH_FT) return false;
      if (typeCounts[f.type] > LINE_PLAUSIBILITY.MAX_LINES_PER_TYPE) return false;
      return true;
    });
  }
  
  // Always include eaves/rakes with basic length filter
  const plausibleEavesRakes = eavesRakes.filter(f => f.length >= 1);
  
  return { 
    plausible: [...plausibleEavesRakes, ...plausibleInterior], 
    implausibleCount: features.length - plausibleEavesRakes.length - plausibleInterior.length,
    starburstDetected
  };
}


export function SchematicRoofDiagram({
  measurement,
  tags,
  measurementId,
  width = 600,
  height = 500,
  showLengthLabels = true,
  showLegend = true,
  showCompass = true,
  showTotals = true,
  showFacets = true,
  showQAPanel = false,
  backgroundColor = '#FFFFFF',
  // Satellite overlay
  satelliteImageUrl,
  showSatelliteOverlay = false,
  satelliteOpacity = 0.55,
  // Debug mode
  showDebugMarkers = false,
  showDebugPanel = false,
}: SchematicRoofDiagramProps) {
  const [facets, setFacets] = useState<FacetData[]>([]);
  const [geometryQA, setGeometryQA] = useState<GeometryQA | null>(null);
  const [localShowOverlay, setLocalShowOverlay] = useState(showSatelliteOverlay);
  const [localShowMarkers, setLocalShowMarkers] = useState(showDebugMarkers);
  const [localShowDebugPanel, setLocalShowDebugPanel] = useState(showDebugPanel);
  const [diagramSource, setDiagramSource] = useState<'database' | 'reconstructed' | 'perimeter'>('perimeter');
  const [reconstructedGeometry, setReconstructedGeometry] = useState<ReconstructedRoof | null>(null);
  
  // Fetch facets from database if measurementId is provided
  useEffect(() => {
    async function fetchFacets() {
      if (!measurementId) return;
      
      try {
        const { data, error } = await supabase
          .from('roof_measurement_facets')
          .select('*')
          .eq('measurement_id', measurementId)
          .order('facet_number', { ascending: true });
        
        if (error) {
          console.log('No facets found:', error.message);
          return;
        }
        
        if (data && data.length > 0) {
          console.log(`📐 Loaded ${data.length} facets from database`);
          setFacets(data.map(f => ({
            id: f.id,
            facet_number: f.facet_number,
            polygon_points: f.polygon_points as { lat: number; lng: number }[],
            centroid: f.centroid as { lat: number; lng: number },
            area_flat_sqft: f.area_flat_sqft || 0,
            area_adjusted_sqft: f.area_adjusted_sqft || 0,
            pitch: f.pitch || '',
            primary_direction: f.primary_direction || ''
          })));
        }
      } catch (err) {
        console.error('Error fetching facets:', err);
      }
    }
    
    fetchFacets();
  }, [measurementId]);
  
  // Calculate image bounds for satellite overlay mode
  const imageBounds = useMemo<ImageBounds | null>(() => {
    if (!measurement) return null;
    
    // Get center coordinates from measurement
    const gpsCoords = measurement.gps_coordinates || {};
    const centerLat = gpsCoords.lat || measurement.lat || measurement.center_lat;
    const centerLng = gpsCoords.lng || measurement.lng || measurement.center_lng;
    
    if (!centerLat || !centerLng) return null;
    
    const zoom = measurement.analysis_zoom || 20;
    const imageSize = measurement.analysis_image_size || { width: 640, height: 640 };
    const imgWidth = typeof imageSize === 'object' ? imageSize.width : 640;
    const imgHeight = typeof imageSize === 'object' ? imageSize.height : 640;
    
    return calculateImageBounds(centerLat, centerLng, zoom, imgWidth, imgHeight);
  }, [measurement]);
  
  // Parse and transform coordinates to SVG space
  // PRIORITY: Use Solar API segment bounding boxes if available for accurate geometry
  // When satellite overlay is enabled, use image-based coordinate transformation
  const { 
    perimeterPath, 
    perimeterCoords,
    perimeterSegments, 
    linearFeatures, 
    bounds, 
    svgPadding, 
    facetPaths, 
    eaveSegments, 
    rakeSegments,
    debugInfo,
    solarSegmentPolygons
  } = useMemo(() => {
    const padding = localShowOverlay ? 0 : 60; // No padding when using satellite overlay
    const segments: Array<{ type: string; points: { x: number; y: number }[]; length: number; color: string }> = [];
    let allLatLngs: { lat: number; lng: number }[] = [];
    
    // NOTE: Solar API segments are BOUNDING BOXES (rectangles) - NOT accurate roof geometry!
    // They produce chaotic edges when intersected. We only use them for metadata (pitch, azimuth, area).
    const solarSegments: SolarSegment[] = measurement?.solar_api_response?.roofSegments || [];
    const hasSolarMetadata = solarSegments.length > 0;
    
    console.log(`📐 Geometry source: WKT linear_features (${solarSegments.length} Solar segments for metadata only)`);
    
    // Extract perimeter from WKT or faces - this is the ONLY source of truth for building outline
    let perimCoords: { lat: number; lng: number }[] = [];
    
    // Priority 1: perimeter_wkt from measurement
    if (measurement?.perimeter_wkt) {
      perimCoords = wktPolygonToLatLngs(measurement.perimeter_wkt);
    }
    // Priority 2: First face WKT
    else if (measurement?.faces?.[0]?.wkt) {
      perimCoords = wktPolygonToLatLngs(measurement.faces[0].wkt);
    }
    // Priority 3: building_outline_wkt
    else if (measurement?.building_outline_wkt) {
      perimCoords = wktPolygonToLatLngs(measurement.building_outline_wkt);
    }
    
    if (perimCoords.length > 0) {
      allLatLngs = [...perimCoords];
    }
    
    // Add facet coordinates to bounds calculation (from database, not Solar API)
    facets.forEach(facet => {
      if (facet.polygon_points && Array.isArray(facet.polygon_points)) {
        allLatLngs.push(...facet.polygon_points);
      }
    });
    
    // Extract ALL linear features from WKT - ALWAYS use this, never Solar API edges
    // Solar API bounding box edges produce chaotic garbage geometry
    let linearFeaturesData: Array<{ type: string; coords: { lat: number; lng: number }[]; length: number }> = [];
    let geometrySource: 'database' | 'reconstructed' | 'perimeter' = 'perimeter';
    
    // ALWAYS use WKT linear features - they have accurate geometry from straight skeleton
    const features = measurement?.linear_features || measurement?.linear_features_wkt || [];
    
    if (Array.isArray(features) && features.length > 0) {
      features.forEach((f: LinearFeature) => {
        if (f.wkt) {
          const coords = wktLineToLatLngs(f.wkt);
          if (coords.length >= 2) {
            const featureType = f.type?.toLowerCase() || 'ridge';
            
            // Add eave/rake coords to bounds calculation
            if (featureType === 'eave' || featureType === 'rake') {
              allLatLngs.push(...coords);
            }
            
            linearFeaturesData.push({
              type: featureType,
              coords,
              length: f.length_ft || f.length || calculateSegmentLength(coords[0], coords[coords.length - 1]),
            });
          }
        }
      });
      
      if (linearFeaturesData.length > 0) {
        geometrySource = 'database';
      }
    }
    
    // FALLBACK: If no WKT features, use client-side reconstruction
    if (linearFeaturesData.length === 0 && perimCoords.length >= 4) {
      console.log('🔄 No WKT features found, using client-side reconstruction');
      
      try {
        const gpsCoords = perimCoords.map(c => ({ lat: c.lat, lng: c.lng }));
        const pitch = measurement?.predominant_pitch || '6/12';
        const reconstructed = reconstructRoofFromPerimeter(gpsCoords, pitch);
        
        // Convert reconstructed geometry to linearFeaturesData format
        reconstructed.ridges.forEach(ridge => {
          linearFeaturesData.push({
            type: 'ridge',
            coords: [{ lat: ridge.start.lat, lng: ridge.start.lng }, { lat: ridge.end.lat, lng: ridge.end.lng }],
            length: ridge.lengthFt
          });
        });
        
        reconstructed.hips.forEach(hip => {
          linearFeaturesData.push({
            type: 'hip',
            coords: [{ lat: hip.start.lat, lng: hip.start.lng }, { lat: hip.end.lat, lng: hip.end.lng }],
            length: hip.lengthFt
          });
        });
        
        reconstructed.valleys.forEach(valley => {
          linearFeaturesData.push({
            type: 'valley',
            coords: [{ lat: valley.start.lat, lng: valley.start.lng }, { lat: valley.end.lat, lng: valley.end.lng }],
            length: valley.lengthFt
          });
        });
        
        geometrySource = 'reconstructed';
        console.log(`✅ Reconstructed: ${reconstructed.ridges.length} ridges, ${reconstructed.hips.length} hips, ${reconstructed.valleys.length} valleys (quality: ${reconstructed.diagramQuality})`);
      } catch (err) {
        console.warn('Reconstruction failed:', err);
      }
    }
    
    console.log(`📐 Loaded ${linearFeaturesData.length} linear features (source: ${geometrySource})`);
    
    // Debug logging for linear features
    const featureCounts = linearFeaturesData.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('📊 Linear features by type (raw):', featureCounts);
    
    // Apply plausibility filter (eaves/rakes bypass the strict filtering)
    const { plausible: plausibleLinearFeatures, implausibleCount, starburstDetected } = filterPlausibleLines(linearFeaturesData);
    
    console.log(`📐 Plausible features: ${plausibleLinearFeatures.length}, Filtered: ${implausibleCount}${starburstDetected ? ' (STARBURST HIDDEN)' : ''}`);
    
    // Update diagram source if starburst was detected
    if (starburstDetected) {
      geometrySource = 'perimeter';
    }
    
    // Calculate bounds from perimeter primarily (more stable)
    if (allLatLngs.length === 0) {
      return { 
        perimeterPath: '', 
        perimeterCoords: [],
        perimeterSegments: [], 
        linearFeatures: [], 
        bounds: null, 
        svgPadding: padding, 
        facetPaths: [],
        eaveSegments: [],
        rakeSegments: [],
        debugInfo: null,
        solarSegmentPolygons: [],
        qaData: {
          hasFacets: false,
          facetCount: 0,
          vertexCount: 0,
          linearFeatureCount: 0,
          plausibleLines: 0,
          implausibleLines: 0,
          perimeterStatus: 'missing' as const,
        }
      };
    }
    
    // Calculate bounds from perimeter only for stability
    const perimLats = perimCoords.map(c => c.lat);
    const perimLngs = perimCoords.map(c => c.lng);
    const minLat = perimLats.length > 0 ? Math.min(...perimLats) : Math.min(...allLatLngs.map(c => c.lat));
    const maxLat = perimLats.length > 0 ? Math.max(...perimLats) : Math.max(...allLatLngs.map(c => c.lat));
    const minLng = perimLngs.length > 0 ? Math.min(...perimLngs) : Math.min(...allLatLngs.map(c => c.lng));
    const maxLng = perimLngs.length > 0 ? Math.max(...perimLngs) : Math.max(...allLatLngs.map(c => c.lng));
    
    // Calculate eave-specific bounds for debug
    const eavesRaw = linearFeaturesData.filter(f => f.type === 'eave');
    const eaveCoords = eavesRaw.flatMap(e => e.coords);
    const eaveBounds = eaveCoords.length > 0 ? {
      minLat: Math.min(...eaveCoords.map(c => c.lat)),
      maxLat: Math.max(...eaveCoords.map(c => c.lat)),
      minLng: Math.min(...eaveCoords.map(c => c.lng)),
      maxLng: Math.max(...eaveCoords.map(c => c.lng)),
    } : null;
    
    // Debug info for coordinate alignment
    const dbgInfo = {
      perimeterBounds: { minLat, maxLat, minLng, maxLng },
      eaveBounds,
      perimeterPoints: perimCoords.length,
      eaveCount: eavesRaw.length,
      rakeCount: linearFeaturesData.filter(f => f.type === 'rake').length,
      hipCount: linearFeaturesData.filter(f => f.type === 'hip').length,
      valleyCount: linearFeaturesData.filter(f => f.type === 'valley').length,
      ridgeCount: linearFeaturesData.filter(f => f.type === 'ridge').length,
      transformMode: 'bounds-fit',
    };
    
    console.log('🗺️ Coordinate bounds verification:', dbgInfo);
    
    // Project lat/lng to local planar meters to fix aspect ratio distortion
    // 1 degree latitude ≈ 111,320 meters everywhere
    // 1 degree longitude ≈ 111,320 * cos(latitude) meters
    const centerLat = (minLat + maxLat) / 2;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos(centerLat * Math.PI / 180);
    
    // Convert bounds to meters
    const boundsWidthMeters = (maxLng - minLng) * metersPerDegreeLng;
    const boundsHeightMeters = (maxLat - minLat) * metersPerDegreeLat;
    
    // Coordinate transformation function
    // When satellite overlay is enabled, use image-based GPS-to-pixel transformation
    // Otherwise use bounds-fit transformation for schematic view
    const toSvg = (coord: { lat: number; lng: number }) => {
      // SATELLITE OVERLAY MODE: Use imageBounds for accurate alignment
      if (localShowOverlay && imageBounds) {
        return gpsToPixel(coord, imageBounds, { width, height });
      }
      
      // SCHEMATIC MODE: Use bounds-fit transformation (meters-based for correct proportions)
      // Convert to meters from origin (minLng, minLat)
      const xMeters = (coord.lng - minLng) * metersPerDegreeLng;
      const yMeters = (coord.lat - minLat) * metersPerDegreeLat;
      
      // Calculate uniform scale to fit in canvas
      const scaleX = (width - padding * 2) / (boundsWidthMeters || 0.0001);
      const scaleY = (height - padding * 2) / (boundsHeightMeters || 0.0001);
      const scale = Math.min(scaleX, scaleY);
      
      // Center the diagram
      const offsetX = (width - boundsWidthMeters * scale) / 2;
      const offsetY = (height - boundsHeightMeters * scale) / 2;
      
      return {
        x: offsetX + xMeters * scale,
        y: offsetY + (boundsHeightMeters - yMeters) * scale, // Flip Y (SVG y grows down)
      };
    };
    
    // Build perimeter path and segments
    let pathD = '';
    const perimSegs: typeof segments = [];
    
    // Build perimeter outline
    if (perimCoords.length >= 3) {
      const svgCoords = perimCoords.map(toSvg);
      pathD = `M ${svgCoords.map(c => `${c.x},${c.y}`).join(' L ')} Z`;
      
      // Create perimeter segments for reference
      for (let i = 0; i < perimCoords.length - 1; i++) {
        const p1 = perimCoords[i];
        const p2 = perimCoords[i + 1];
        const length = calculateSegmentLength(p1, p2);
        const svgP1 = svgCoords[i];
        const svgP2 = svgCoords[i + 1];
        
        perimSegs.push({
          type: 'perimeter',
          points: [svgP1, svgP2],
          length,
          color: FEATURE_COLORS.perimeter,
        });
      }
    }
    
    // Extract eaves and rakes directly from WKT (these are accurate straight lines)
    const classifiedEaves: Array<{ start: { x: number; y: number }; end: { x: number; y: number }; length: number; gpsStart: GPSCoord; gpsEnd: GPSCoord }> = [];
    const classifiedRakes: Array<{ start: { x: number; y: number }; end: { x: number; y: number }; length: number; gpsStart: GPSCoord; gpsEnd: GPSCoord }> = [];
    
    // Build linear feature paths from measurement data
    const linFeatures = plausibleLinearFeatures.map(f => {
      const svgCoords = f.coords.map(toSvg);
      
      // If it's an eave or rake, also add to classified segments for thick line rendering
      if (f.type === 'eave' && svgCoords.length >= 2) {
        classifiedEaves.push({
          start: svgCoords[0],
          end: svgCoords[svgCoords.length - 1],
          length: f.length,
          gpsStart: f.coords[0],
          gpsEnd: f.coords[f.coords.length - 1],
        });
      } else if (f.type === 'rake' && svgCoords.length >= 2) {
        classifiedRakes.push({
          start: svgCoords[0],
          end: svgCoords[svgCoords.length - 1],
          length: f.length,
          gpsStart: f.coords[0],
          gpsEnd: f.coords[f.coords.length - 1],
        });
      }
      
      return {
        type: f.type,
        points: svgCoords,
        length: f.length || (f.coords.length >= 2 ? calculateSegmentLength(f.coords[0], f.coords[f.coords.length - 1]) : 0),
        color: FEATURE_COLORS[f.type as keyof typeof FEATURE_COLORS] || FEATURE_COLORS.ridge,
      };
    });
    
    console.log(`🏠 Linear features: ${classifiedEaves.length} eaves, ${classifiedRakes.length} rakes from measurement data`);
    
    // Build facet paths - ONLY use database facets (Solar API segments are bounding boxes, not real facets)
    let facetPathsData: any[] = [];
    
    // Get faces from measurement for direction fallback
    const measurementFaces = measurement?.faces || [];
    
    // Use database facets only - Solar API bounding boxes produce garbage rectangular shapes
    facetPathsData = facets.map((facet, index) => {
      if (!facet.polygon_points || facet.polygon_points.length < 3) return null;
      
      const svgCoords = facet.polygon_points.map(toSvg);
      const pathD = `M ${svgCoords.map(c => `${c.x},${c.y}`).join(' L ')} Z`;
      const centroidSvg = facet.centroid ? toSvg(facet.centroid) : {
        x: svgCoords.reduce((sum, c) => sum + c.x, 0) / svgCoords.length,
        y: svgCoords.reduce((sum, c) => sum + c.y, 0) / svgCoords.length,
      };
      
      // Get direction from database, or fallback to measurement.faces by matching index
      let direction = facet.primary_direction;
      if (!direction && measurementFaces[index]) {
        const face = measurementFaces[index];
        direction = face.direction || (face.azimuth_degrees != null 
          ? getDirectionFromAzimuth(face.azimuth_degrees) 
          : null);
      }
      
      return {
        facetNumber: facet.facet_number,
        path: pathD,
        centroid: centroidSvg,
        color: FACET_COLORS[index % FACET_COLORS.length],
        area: facet.area_adjusted_sqft || facet.area_flat_sqft,
        pitch: facet.pitch,
        direction,
        isSolarSegment: false,
      };
    }).filter(Boolean);
    
    // Build QA data
    const qaData: GeometryQA = {
      hasFacets: facetPathsData.length > 0,
      facetCount: facetPathsData.length,
      vertexCount: perimCoords.length,
      linearFeatureCount: linearFeaturesData.length,
      plausibleLines: plausibleLinearFeatures.length,
      implausibleLines: implausibleCount,
      perimeterStatus: perimCoords.length >= 3 ? 'ok' : 'warning',
    };
    
    // Convert perimeter coords to SVG for debug markers
    const perimeterWithSvg = perimCoords.map((coord, i) => ({
      ...coord,
      svg: toSvg(coord),
      index: i + 1,
    }));
    
    return {
      perimeterPath: pathD,
      perimeterCoords: perimeterWithSvg,
      perimeterSegments: perimSegs,
      linearFeatures: linFeatures,
      bounds: { minLat, maxLat, minLng, maxLng },
      svgPadding: padding,
      facetPaths: facetPathsData,
      eaveSegments: classifiedEaves,
      rakeSegments: classifiedRakes,
      debugInfo: { ...dbgInfo, solarMetadataAvailable: hasSolarMetadata },
      solarSegmentPolygons: [], // No longer using Solar API for geometry
      qaData,
    };
  }, [measurement, width, height, facets, localShowOverlay, imageBounds]);

  // Update geometry QA when data changes
  useEffect(() => {
    const qaData = (perimeterPath as any)?.qaData;
    if (qaData) {
      setGeometryQA(qaData);
    }
  }, [perimeterPath]);

  // Destructure qaData from the memo result
  const qaData = useMemo(() => {
    const result = { perimeterPath, perimeterSegments, linearFeatures, bounds, svgPadding, facetPaths };
    return (result as any).qaData as GeometryQA | undefined;
  }, [perimeterPath, perimeterSegments, linearFeatures, bounds, svgPadding, facetPaths]);

  // Extract totals from tags or measurement summary
  const totals = useMemo(() => ({
    ridge: tags['lf.ridge'] || measurement?.total_ridge_length || measurement?.summary?.ridge_ft || 0,
    hip: tags['lf.hip'] || measurement?.total_hip_length || measurement?.summary?.hip_ft || 0,
    valley: tags['lf.valley'] || measurement?.total_valley_length || measurement?.summary?.valley_ft || 0,
    eave: tags['lf.eave'] || measurement?.total_eave_length || measurement?.summary?.eave_ft || 0,
    rake: tags['lf.rake'] || measurement?.total_rake_length || measurement?.summary?.rake_ft || 0,
    step: tags['lf.step'] || measurement?.summary?.step_ft || 0,
    total_area: tags['roof.total_area'] || measurement?.total_area_adjusted_sqft || measurement?.summary?.total_area_sqft || 0,
    facet_count: measurement?.facet_count || facets.length || 0,
  }), [tags, measurement, facets]);
  
  // Check if we should show "perimeter only" warning
  // Only show if: no database facets loaded AND measurement expects facets AND reconstructor didn't help
  const showPerimeterOnlyWarning = facets.length === 0 && 
    (measurement?.facet_count || 0) > 1 && 
    facetPaths.length <= 1;

  // If no geometry, show placeholder with totals
  if (!bounds) {
    return (
      <div 
        className="relative flex flex-col items-center justify-center rounded-lg border"
        style={{ width, height, backgroundColor }}
      >
        <div className="text-center text-muted-foreground mb-4">
          <p className="text-sm font-medium mb-2">No WKT geometry available</p>
          <p className="text-xs">Showing measurement totals only</p>
        </div>
        
        {showTotals && (
          <div className="grid grid-cols-3 gap-3 p-4 bg-muted/30 rounded-lg">
            {[
              { label: 'Eaves', value: totals.eave, color: FEATURE_COLORS.eave },
              { label: 'Ridges', value: totals.ridge, color: FEATURE_COLORS.ridge },
              { label: 'Hips', value: totals.hip, color: FEATURE_COLORS.hip },
              { label: 'Valleys', value: totals.valley, color: FEATURE_COLORS.valley },
              { label: 'Rakes', value: totals.rake, color: FEATURE_COLORS.rake },
              { label: 'Facets', value: totals.facet_count, color: '#374151' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center p-2">
                <div 
                  className="text-lg font-bold"
                  style={{ color }}
                >
                  {label === 'Facets' ? value : `${Math.round(value)}'`}
                </div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden border" style={{ width, height, backgroundColor }}>
      {/* Satellite image background (when overlay is enabled) */}
      {localShowOverlay && satelliteImageUrl && (
        <img 
          src={satelliteImageUrl}
          alt="Satellite view"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: satelliteOpacity }}
        />
      )}
      
      <svg width={width} height={height} className="absolute inset-0">
        {/* White/transparent background */}
        {!localShowOverlay && (
          <rect x={0} y={0} width={width} height={height} fill={backgroundColor} />
        )}
        
        {/* Facet polygons (rendered first so they're behind lines) */}
        {showFacets && facetPaths.map((facet: any, i: number) => (
          <g key={`facet-${facet.facetNumber}`}>
            <path
              d={facet.path}
              fill={localShowOverlay ? 'rgba(59, 130, 246, 0.2)' : facet.color}
              stroke={FACET_COLORS[i % FACET_COLORS.length].replace('0.3', '0.8')}
              strokeWidth={1.5}
            />
            {/* Facet number label */}
            <circle
              cx={facet.centroid.x}
              cy={facet.centroid.y}
              r={14}
              fill="white"
              stroke="#374151"
              strokeWidth={1}
            />
            <text
              x={facet.centroid.x}
              y={facet.centroid.y + 4}
              textAnchor="middle"
              fontSize={12}
              fontWeight="bold"
              fill="#374151"
            >
              {facet.facetNumber}
            </text>
            {/* Direction label below number */}
            {facet.direction && (
              <text
                x={facet.centroid.x}
                y={facet.centroid.y + 18}
                textAnchor="middle"
                fontSize={10}
                fontWeight="500"
                fill="#374151"
              >
                {facet.direction}
              </text>
            )}
            {/* Area label below direction */}
            {facet.area > 0 && (
              <text
                x={facet.centroid.x}
                y={facet.centroid.y + (facet.direction ? 32 : 28)}
                textAnchor="middle"
                fontSize={9}
                fill="#6b7280"
              >
                {Math.round(facet.area)} sqft
              </text>
            )}
          </g>
        ))}
        
        {/* Perimeter outline (thin guide line - behind everything) */}
        {/* Perimeter outline - rendered prominently as "perimeter first" */}
        {perimeterPath && (
          <path
            d={perimeterPath}
            fill="none"
            stroke={localShowOverlay ? '#FFFFFF' : FEATURE_COLORS.perimeter}
            strokeWidth={localShowOverlay ? 3 : 2.5}
            strokeLinejoin="miter"
            opacity={localShowOverlay ? 0.9 : 0.85}
          />
        )}
        
        {/* Eave segments - thick dark green straight lines with length labels */}
        {eaveSegments.map((seg, i) => {
          const midX = (seg.start.x + seg.end.x) / 2;
          const midY = (seg.start.y + seg.end.y) / 2;
          const angle = Math.atan2(seg.end.y - seg.start.y, seg.end.x - seg.start.x) * 180 / Math.PI;
          const displayAngle = angle > 90 || angle < -90 ? angle + 180 : angle;
          const length = seg.length || 0;
          
          return (
            <g key={`eave-${i}`}>
              <line
                x1={seg.start.x}
                y1={seg.start.y}
                x2={seg.end.x}
                y2={seg.end.y}
                stroke={FEATURE_COLORS.eave}
                strokeWidth={5}
                strokeLinecap="square"
              />
              {/* Eave length label */}
              {showLengthLabels && length >= 3 && (
                <g transform={`translate(${midX}, ${midY}) rotate(${displayAngle})`}>
                  <rect
                    x={-18}
                    y={-11}
                    width={36}
                    height={18}
                    fill="white"
                    stroke={FEATURE_COLORS.eave}
                    strokeWidth={1}
                    rx={3}
                  />
                  <text
                    x={0}
                    y={4}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight="bold"
                    fill={FEATURE_COLORS.eave}
                  >
                    {Math.round(length)}'
                  </text>
                </g>
              )}
            </g>
          );
        })}
        
        {/* Rake segments - thick cyan straight lines with length labels */}
        {rakeSegments.map((seg, i) => {
          const midX = (seg.start.x + seg.end.x) / 2;
          const midY = (seg.start.y + seg.end.y) / 2;
          const angle = Math.atan2(seg.end.y - seg.start.y, seg.end.x - seg.start.x) * 180 / Math.PI;
          const displayAngle = angle > 90 || angle < -90 ? angle + 180 : angle;
          const length = seg.length || 0;
          
          return (
            <g key={`rake-${i}`}>
              <line
                x1={seg.start.x}
                y1={seg.start.y}
                x2={seg.end.x}
                y2={seg.end.y}
                stroke={FEATURE_COLORS.rake}
                strokeWidth={5}
                strokeLinecap="square"
              />
              {/* Rake length label */}
              {showLengthLabels && length >= 3 && (
                <g transform={`translate(${midX}, ${midY}) rotate(${displayAngle})`}>
                  <rect
                    x={-18}
                    y={-11}
                    width={36}
                    height={18}
                    fill="white"
                    stroke={FEATURE_COLORS.rake}
                    strokeWidth={1}
                    rx={3}
                  />
                  <text
                    x={0}
                    y={4}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight="bold"
                    fill={FEATURE_COLORS.rake}
                  >
                    {Math.round(length)}'
                  </text>
                </g>
              )}
            </g>
          );
        })}
        
        {/* Linear features - ridges, hips, valleys (skip eaves/rakes as they're rendered with thick lines above) */}
        {linearFeatures
          .filter(f => f.type !== 'eave' && f.type !== 'rake')
          .map((feature, i) => {
            if (feature.points.length < 2) return null;
            const pathD = `M ${feature.points.map(p => `${p.x},${p.y}`).join(' L ')}`;
            const isDashed = feature.type === 'step';
            
            // Set stroke width based on feature type
            const strokeWidth = feature.type === 'hip' ? 4 : feature.type === 'valley' ? 4 : 4;
            
            return (
              <g key={`${feature.type}-${i}`}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={feature.color}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={isDashed ? '10,5' : undefined}
                />
                
                {/* Length label at midpoint */}
                {showLengthLabels && feature.length > 0 && feature.points.length >= 2 && (
                  (() => {
                    const midIdx = Math.floor(feature.points.length / 2);
                    const p1 = feature.points[midIdx - 1] || feature.points[0];
                    const p2 = feature.points[midIdx] || feature.points[1];
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
                    // Keep text upright
                    const displayAngle = angle > 90 || angle < -90 ? angle + 180 : angle;
                    
                    return (
                      <g transform={`translate(${midX}, ${midY}) rotate(${displayAngle})`}>
                        <rect
                          x={-16}
                          y={-10}
                          width={32}
                          height={16}
                          fill="white"
                          rx={3}
                        />
                        <text
                          x={0}
                          y={4}
                          textAnchor="middle"
                          fontSize={11}
                          fontWeight="bold"
                          fill={feature.color}
                        >
                          {Math.round(feature.length)}'
                        </text>
                      </g>
                    );
                  })()
                )}
              </g>
            );
          })}
        
        {/* Debug: Numbered perimeter vertex markers */}
        {localShowMarkers && perimeterCoords && perimeterCoords.map((coord: any, i: number) => (
          <g key={`marker-${i}`}>
            <circle
              cx={coord.svg.x}
              cy={coord.svg.y}
              r={i === 0 ? 12 : 8}
              fill={i === 0 ? '#DC2626' : '#FFFFFF'}
              stroke={i === 0 ? '#FFFFFF' : '#374151'}
              strokeWidth={2}
            />
            <text
              x={coord.svg.x}
              y={coord.svg.y + 4}
              textAnchor="middle"
              fontSize={i === 0 ? 10 : 8}
              fontWeight="bold"
              fill={i === 0 ? '#FFFFFF' : '#374151'}
            >
              {coord.index}
            </text>
          </g>
        ))}
        
        {/* Debug: Eave endpoint markers */}
        {localShowMarkers && eaveSegments.map((seg: any, i: number) => (
          <g key={`eave-marker-${i}`}>
            <circle cx={seg.start.x} cy={seg.start.y} r={3} fill="#006400" />
            <circle cx={seg.end.x} cy={seg.end.y} r={3} fill="#006400" />
          </g>
        ))}
        
        {/* Perimeter segment labels */}
        {showLengthLabels && perimeterSegments.map((seg, i) => {
          const p1 = seg.points[0];
          const p2 = seg.points[1];
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
          const displayAngle = angle > 90 || angle < -90 ? angle + 180 : angle;
          
          if (seg.length < 3) return null; // Skip very short segments
          
          return (
            <g key={`peri-${i}`} transform={`translate(${midX}, ${midY}) rotate(${displayAngle})`}>
              <rect
                x={-14}
                y={-10}
                width={28}
                height={16}
                fill="white"
                stroke="#e5e7eb"
                strokeWidth={0.5}
                rx={3}
              />
              <text
                x={0}
                y={4}
                textAnchor="middle"
                fontSize={10}
                fontWeight="600"
                fill="#374151"
              >
                {Math.round(seg.length)}'
              </text>
            </g>
          );
        })}
        
        {/* Compass rose with primary facing direction */}
        {showCompass && (
          <g transform={`translate(${width - 45}, 45)`}>
            <circle cx={0} cy={0} r={22} fill="white" stroke="#d1d5db" strokeWidth={1} />
            <path d="M 0 -16 L 4 0 L 0 -6 L -4 0 Z" fill="#DC2626" />
            <path d="M 0 16 L 4 0 L 0 6 L -4 0 Z" fill="#374151" />
            <text x={0} y={-6} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#DC2626">N</text>
            <text x={0} y={12} textAnchor="middle" fontSize={7} fill="#6b7280">S</text>
            <text x={10} y={3} textAnchor="middle" fontSize={7} fill="#6b7280">E</text>
            <text x={-10} y={3} textAnchor="middle" fontSize={7} fill="#6b7280">W</text>
            {/* Primary facing direction from largest facet */}
            {(() => {
              const faces = measurement?.faces || [];
              if (faces.length === 0) return null;
              const largest = faces.reduce((max: any, face: any) => 
                (face.area_sqft || 0) > (max?.area_sqft || 0) ? face : max
              , faces[0]);
              const dir = largest?.direction || (largest?.azimuth_degrees != null 
                ? getDirectionFromAzimuth(largest.azimuth_degrees) 
                : null);
              if (!dir) return null;
              return (
                <text x={0} y={32} textAnchor="middle" fontSize={8} fill="#6b7280">
                  Facing {dir}
                </text>
              );
            })()}
          </g>
        )}
      </svg>
      
      {/* Debug Controls (top-left) */}
      {(satelliteImageUrl || showDebugMarkers || showDebugPanel) && (
        <div className="absolute top-3 left-24 flex gap-1">
          {satelliteImageUrl && (
            <button
              onClick={() => setLocalShowOverlay(!localShowOverlay)}
              className={`p-1.5 rounded-md text-xs flex items-center gap-1 ${
                localShowOverlay 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-white/90 text-muted-foreground hover:bg-white'
              }`}
              title="Toggle satellite overlay"
            >
              <Layers className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setLocalShowMarkers(!localShowMarkers)}
            className={`p-1.5 rounded-md text-xs flex items-center gap-1 ${
              localShowMarkers 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-white/90 text-muted-foreground hover:bg-white'
            }`}
            title="Toggle debug markers"
          >
            <MapPin className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setLocalShowDebugPanel(!localShowDebugPanel)}
            className={`p-1.5 rounded-md text-xs flex items-center gap-1 ${
              localShowDebugPanel 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-white/90 text-muted-foreground hover:bg-white'
            }`}
            title="Toggle debug panel"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      
      {/* Debug Panel (bottom-right) */}
      {localShowDebugPanel && debugInfo && (
        <div className="absolute bottom-3 right-3 bg-slate-900/95 text-white rounded-lg px-3 py-2 shadow-lg text-[9px] font-mono max-w-[220px]">
          <div className="font-semibold text-xs mb-1.5 text-amber-400">🔍 Debug Info</div>
          <div className="space-y-1">
            <div className="text-slate-300">Transform: <span className="text-white">{debugInfo.transformMode}</span></div>
            <div className="text-slate-300">Perimeter pts: <span className="text-white">{debugInfo.perimeterPoints}</span></div>
            {debugInfo.solarMetadataAvailable && (
              <div className="text-blue-400">
                Solar metadata available (not used for geometry)
              </div>
            )}
            <div className="border-t border-slate-700 pt-1 mt-1">
              <div className="text-amber-400 mb-0.5">Feature Counts:</div>
              <div className="grid grid-cols-2 gap-x-2">
                <span style={{ color: FEATURE_COLORS.eave }}>Eaves: {debugInfo.eaveCount}</span>
                <span style={{ color: FEATURE_COLORS.rake }}>Rakes: {debugInfo.rakeCount}</span>
                <span style={{ color: FEATURE_COLORS.hip }}>Hips: {debugInfo.hipCount}</span>
                <span style={{ color: FEATURE_COLORS.valley }}>Valleys: {debugInfo.valleyCount}</span>
                <span style={{ color: FEATURE_COLORS.ridge }}>Ridges: {debugInfo.ridgeCount}</span>
              </div>
            </div>
            {debugInfo.eaveBounds && (
              <div className="border-t border-slate-700 pt-1 mt-1">
                <div className="text-amber-400 mb-0.5">Eave Bounds:</div>
                <div className="text-[8px]">
                  Lat: {debugInfo.eaveBounds.minLat.toFixed(6)} → {debugInfo.eaveBounds.maxLat.toFixed(6)}
                </div>
                <div className="text-[8px]">
                  Lng: {debugInfo.eaveBounds.minLng.toFixed(6)} → {debugInfo.eaveBounds.maxLng.toFixed(6)}
                </div>
              </div>
            )}
            <div className="border-t border-slate-700 pt-1 mt-1">
              <div className="text-amber-400 mb-0.5">Perimeter Bounds:</div>
              <div className="text-[8px]">
                Lat: {debugInfo.perimeterBounds?.minLat?.toFixed(6) || 'N/A'} → {debugInfo.perimeterBounds?.maxLat?.toFixed(6) || 'N/A'}
              </div>
              <div className="text-[8px]">
                Lng: {debugInfo.perimeterBounds?.minLng?.toFixed(6) || 'N/A'} → {debugInfo.perimeterBounds?.maxLng?.toFixed(6) || 'N/A'}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Rectangular Approximation Warning */}
      {perimeterCoords.length > 0 && perimeterCoords.length <= 4 && (
        <div className="absolute top-3 right-16 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 shadow-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <div className="text-xs text-amber-800">
            <div className="font-semibold">Rectangular Approximation</div>
            <div className="text-amber-600">{perimeterCoords.length} vertices - Draw footprint for accuracy</div>
          </div>
        </div>
      )}
      
      {/* Perimeter Only Warning */}
      {showPerimeterOnlyWarning && perimeterCoords.length > 4 && (
        <div className="absolute top-3 right-16 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 shadow-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <div className="text-xs text-amber-800">
            <div className="font-semibold">Perimeter Only</div>
            <div className="text-amber-600">Facet geometry unavailable</div>
          </div>
        </div>
      )}
      
      {/* QA Panel */}
      {showQAPanel && geometryQA && (
        <div className="absolute top-3 right-3 bg-slate-800/90 text-white rounded-lg px-3 py-2 shadow-lg text-[10px] font-mono">
          <div className="font-semibold text-xs mb-1">Geometry QA</div>
          <div className="grid gap-0.5">
            <div>Vertices: {geometryQA.vertexCount}</div>
            <div>Facets: {geometryQA.facetCount} {!geometryQA.hasFacets && <span className="text-amber-400">(missing)</span>}</div>
            <div>Lines: {geometryQA.plausibleLines}/{geometryQA.linearFeatureCount} 
              {geometryQA.implausibleLines > 0 && <span className="text-red-400"> ({geometryQA.implausibleLines} hidden)</span>}
            </div>
            <div>Perimeter: <span className={geometryQA.perimeterStatus === 'ok' ? 'text-green-400' : 'text-amber-400'}>{geometryQA.perimeterStatus}</span></div>
          </div>
        </div>
      )}
      
      {/* Legend */}
      {showLegend && (
        <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur border rounded-lg p-2.5 shadow-sm">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Linear Features
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {[
              { label: 'Eaves', color: FEATURE_COLORS.eave, value: totals.eave },
              { label: 'Ridges', color: FEATURE_COLORS.ridge, value: totals.ridge },
              { label: 'Hips', color: FEATURE_COLORS.hip, value: totals.hip },
              { label: 'Valleys', color: FEATURE_COLORS.valley, value: totals.valley },
              { label: 'Rakes', color: FEATURE_COLORS.rake, value: totals.rake },
              { label: 'Step Flash', color: FEATURE_COLORS.step, value: totals.step },
            ].filter(item => item.value > 0).map(({ label, color, value }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-4 h-1 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-muted-foreground">{label}:</span>
                <span className="font-semibold">{Math.round(value)}'</span>
              </div>
            ))}
          </div>
          {facets.length > 0 && (
            <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground">
              {facets.length} Facets Detected
            </div>
          )}
        </div>
      )}
      
      {/* Total Area Badge - Shows FLAT × Pitch Multiplier = ADJUSTED */}
      {showTotals && totals.total_area > 0 && (() => {
        // Calculate pitch multiplier
        const pitchStr = measurement?.predominant_pitch || tags?.['roof.pitch'] || '6/12';
        const pitchParts = pitchStr.split('/');
        const pitchNum = parseFloat(pitchParts[0]) || 6;
        const pitchMultiplier = Math.sqrt(1 + (pitchNum / 12) ** 2);
        
        // Get flat area - either stored or calculate back from adjusted
        const adjustedArea = totals.total_area;
        const flatArea = measurement?.total_area_flat_sqft || measurement?.flat_area_sqft || (adjustedArea / pitchMultiplier);
        
        return (
          <div className="absolute top-3 left-3 bg-white/95 backdrop-blur border rounded-lg px-3 py-2 shadow-sm">
            <div className="text-[10px] text-muted-foreground uppercase mb-1">Total Area</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold text-muted-foreground">{Math.round(flatArea).toLocaleString()}</span>
              <span className="text-[10px] text-muted-foreground">FLAT</span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              × {pitchMultiplier.toFixed(3)} ({pitchStr})
            </div>
            <div className="flex items-baseline gap-1.5 border-t mt-1 pt-1">
              <span className="text-lg font-bold text-primary">{Math.round(adjustedArea).toLocaleString()}</span>
              <span className="text-[10px] text-muted-foreground">sq ft</span>
            </div>
            {totals.facet_count > 0 && (
              <div className="text-[10px] text-muted-foreground">{totals.facet_count} Facets</div>
            )}
          </div>
        );
      })()}
      
      {/* Footprint Source Badge - shows data origin for transparency */}
      {(measurement?.footprint_source || measurement?.dsm_available !== undefined) && (
        <div className="absolute top-3 left-48 z-10 flex flex-col gap-1">
          {/* Primary source badge */}
          <Badge 
            variant={
              measurement.footprint_source?.includes('google_solar') ? 'default' :
              measurement.footprint_source === 'mapbox_vector' ? 'default' :
              measurement.footprint_source === 'regrid_parcel' ? 'secondary' :
              'outline'
            }
            className={`text-xs gap-1 ${
              measurement.footprint_source?.includes('google_solar') && measurement.dsm_available
                ? 'bg-emerald-600 hover:bg-emerald-600' 
                : measurement.footprint_source?.includes('google_solar')
                ? 'bg-green-600 hover:bg-green-600'
                : measurement.footprint_source === 'google_solar+mapbox'
                ? 'bg-green-600 hover:bg-green-600'
                : measurement.footprint_source === 'mapbox_vector'
                ? 'bg-blue-600 hover:bg-blue-600 text-white'
                : measurement.footprint_source === 'regrid_parcel'
                ? 'bg-blue-600 hover:bg-blue-600 text-white'
                : 'bg-amber-100 text-amber-800 border-amber-300'
            }`}
          >
            {measurement.footprint_source?.includes('google_solar') && measurement.dsm_available && (
              <>
                <CheckCircle className="h-3 w-3" />
                DSM + Solar Verified ({Math.round((measurement.footprint_confidence || 0.95) * 100)}%)
              </>
            )}
            {measurement.footprint_source === 'google_solar+mapbox' && (
              <>
                <CheckCircle className="h-3 w-3" />
                Solar + Mapbox ({Math.round((measurement.footprint_confidence || 0.92) * 100)}%)
              </>
            )}
            {measurement.footprint_source === 'mapbox_vector' && (
              <>
                <Map className="h-3 w-3" />
                Mapbox Footprint ({Math.round((measurement.footprint_confidence || 0.92) * 100)}%)
              </>
            )}
            {measurement.footprint_source === 'google_solar_api' && !measurement.dsm_available && (
              <>
                <CheckCircle className="h-3 w-3" />
                Solar API ({Math.round((measurement.footprint_confidence || 0.95) * 100)}%)
              </>
            )}
            {measurement.footprint_source === 'regrid_parcel' && (
              <>
                <Map className="h-3 w-3" />
                Parcel Data ({Math.round((measurement.footprint_confidence || 0.85) * 100)}%)
              </>
            )}
            {measurement.footprint_source === 'ai_detection' && (
              <>
                <Cpu className="h-3 w-3" />
                AI Detection - Review
              </>
            )}
          </Badge>
          
          {/* DSM / Ridge Detection Quality Indicator */}
          {measurement.dsm_available !== undefined && (
            <Badge 
              variant="outline"
              className={`text-[10px] gap-1 ${
                measurement.dsm_available 
                  ? 'bg-green-50 text-green-700 border-green-300' 
                  : measurement.footprint_source 
                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                  : 'bg-orange-50 text-orange-700 border-orange-300'
              }`}
            >
              {measurement.dsm_available ? (
                <>
                  <CheckCircle className="h-2.5 w-2.5" />
                  AI Ridge Detection
                </>
              ) : measurement.footprint_source ? (
                <>
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Geometry Estimated
                </>
              ) : (
                <>
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Perimeter Only - Trace Footprint
                </>
              )}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
