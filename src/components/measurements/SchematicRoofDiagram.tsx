import { useMemo, useEffect, useState } from 'react';
import { wktLineToLatLngs, wktPolygonToLatLngs } from '@/lib/canvassiq/wkt';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle } from 'lucide-react';

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

// Plausibility thresholds for linear features
const LINE_PLAUSIBILITY = {
  MAX_LINES_PER_TYPE: 20,      // Max ridges/hips/valleys (increased for complex buildings)
  MAX_STARBURST_RATIO: 0.5,    // Max % of lines meeting at one point (relaxed)
  MIN_LINE_LENGTH_FT: 2,       // Ignore very short lines
  MAX_LINE_LENGTH_FT: 200,     // Flag unusually long lines (increased for large roofs)
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
}

// Calculate distance between two points in feet (haversine)
function calculateSegmentLength(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
  const R = 20902231; // Earth's radius in feet
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Filter out implausible linear features
function filterPlausibleLines(
  features: Array<{ type: string; coords: { lat: number; lng: number }[]; length: number }>
): { plausible: typeof features; implausibleCount: number } {
  // Count lines by type
  const typeCounts: Record<string, number> = {};
  features.forEach(f => {
    typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
  });
  
  // Count lines meeting at same start point (starburst detection)
  const startPoints: Record<string, number> = {};
  features.forEach(f => {
    if (f.coords.length >= 2) {
      const key = `${f.coords[0].lat.toFixed(6)},${f.coords[0].lng.toFixed(6)}`;
      startPoints[key] = (startPoints[key] || 0) + 1;
    }
  });
  
  const maxAtSinglePoint = Math.max(...Object.values(startPoints), 0);
  const starburstRatio = features.length > 0 ? maxAtSinglePoint / features.length : 0;
  
  // If starburst detected, hide all interior lines
  if (starburstRatio > LINE_PLAUSIBILITY.MAX_STARBURST_RATIO && maxAtSinglePoint > 4) {
    console.warn(`🚨 Starburst detected: ${maxAtSinglePoint} lines at single point (${(starburstRatio * 100).toFixed(0)}%)`);
    return { plausible: [], implausibleCount: features.length };
  }
  
  // Filter individual lines
  const plausible = features.filter(f => {
    // Skip very short or very long lines
    if (f.length < LINE_PLAUSIBILITY.MIN_LINE_LENGTH_FT) return false;
    if (f.length > LINE_PLAUSIBILITY.MAX_LINE_LENGTH_FT) return false;
    
    // Skip if too many of this type
    if (typeCounts[f.type] > LINE_PLAUSIBILITY.MAX_LINES_PER_TYPE) return false;
    
    return true;
  });
  
  return { plausible, implausibleCount: features.length - plausible.length };
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
}: SchematicRoofDiagramProps) {
  const [facets, setFacets] = useState<FacetData[]>([]);
  const [geometryQA, setGeometryQA] = useState<GeometryQA | null>(null);
  
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
  
  // Parse and transform coordinates to SVG space
  const { perimeterPath, perimeterSegments, linearFeatures, bounds, svgPadding, facetPaths, eaveSegments, rakeSegments } = useMemo(() => {
    const padding = 60;
    const segments: Array<{ type: string; points: { x: number; y: number }[]; length: number; color: string }> = [];
    let allLatLngs: { lat: number; lng: number }[] = [];
    
    // Extract perimeter from WKT or faces
    let perimeterCoords: { lat: number; lng: number }[] = [];
    
    // Priority 1: perimeter_wkt from measurement
    if (measurement?.perimeter_wkt) {
      perimeterCoords = wktPolygonToLatLngs(measurement.perimeter_wkt);
    }
    // Priority 2: First face WKT
    else if (measurement?.faces?.[0]?.wkt) {
      perimeterCoords = wktPolygonToLatLngs(measurement.faces[0].wkt);
    }
    // Priority 3: building_outline_wkt
    else if (measurement?.building_outline_wkt) {
      perimeterCoords = wktPolygonToLatLngs(measurement.building_outline_wkt);
    }
    
    if (perimeterCoords.length > 0) {
      allLatLngs = [...perimeterCoords];
    }
    
    // Add facet coordinates to bounds calculation
    facets.forEach(facet => {
      if (facet.polygon_points && Array.isArray(facet.polygon_points)) {
        allLatLngs.push(...facet.polygon_points);
      }
    });
    
    // Extract linear features with WKT - use original coordinates (no snapping)
    const linearFeaturesData: Array<{ type: string; coords: { lat: number; lng: number }[]; length: number }> = [];
    const features = measurement?.linear_features || measurement?.linear_features_wkt || [];
    
    if (Array.isArray(features)) {
      features.forEach((f: LinearFeature) => {
        if (f.wkt) {
          const coords = wktLineToLatLngs(f.wkt);
          if (coords.length >= 2) {
            allLatLngs.push(...coords);
            linearFeaturesData.push({
              type: f.type?.toLowerCase() || 'ridge',
              coords,
              length: f.length_ft || f.length || calculateSegmentLength(coords[0], coords[coords.length - 1]),
            });
          }
        }
      });
    }
    
    // Debug logging for linear features
    const featureCounts = linearFeaturesData.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('📊 Linear features by type:', featureCounts);
    
    // Apply plausibility filter to linear features
    const { plausible: plausibleLinearFeatures, implausibleCount } = filterPlausibleLines(linearFeaturesData);
    
    console.log(`📐 Plausible features: ${plausibleLinearFeatures.length}, Filtered: ${implausibleCount}`);
    
    // Calculate bounds
    if (allLatLngs.length === 0) {
      return { 
        perimeterPath: '', 
        perimeterSegments: [], 
        linearFeatures: [], 
        bounds: null, 
        svgPadding: padding, 
        facetPaths: [],
        eaveSegments: [],
        rakeSegments: [],
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
    
    const lats = allLatLngs.map(c => c.lat);
    const lngs = allLatLngs.map(c => c.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    // Coordinate transformation function
    const toSvg = (coord: { lat: number; lng: number }) => {
      const scaleX = (width - padding * 2) / (maxLng - minLng || 0.0001);
      const scaleY = (height - padding * 2) / (maxLat - minLat || 0.0001);
      const scale = Math.min(scaleX, scaleY);
      
      // Center the diagram
      const offsetX = (width - (maxLng - minLng) * scale) / 2;
      const offsetY = (height - (maxLat - minLat) * scale) / 2;
      
      return {
        x: offsetX + (coord.lng - minLng) * scale,
        y: offsetY + (maxLat - coord.lat) * scale, // Flip Y
      };
    };
    
    // Build perimeter path and segments
    let pathD = '';
    const perimSegs: typeof segments = [];
    
    // Build perimeter outline (just for reference, not for eave/rake classification)
    if (perimeterCoords.length >= 3) {
      const svgCoords = perimeterCoords.map(toSvg);
      pathD = `M ${svgCoords.map(c => `${c.x},${c.y}`).join(' L ')} Z`;
      
      // Create perimeter segments for reference
      for (let i = 0; i < perimeterCoords.length - 1; i++) {
        const p1 = perimeterCoords[i];
        const p2 = perimeterCoords[i + 1];
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
    
    // Extract eaves and rakes directly from linear_features_wkt (these are the accurate straight lines)
    const classifiedEaves: Array<{ start: { x: number; y: number }; end: { x: number; y: number }; length: number }> = [];
    const classifiedRakes: Array<{ start: { x: number; y: number }; end: { x: number; y: number }; length: number }> = [];
    
    // Build linear feature paths from measurement data - use ALL features including eaves/rakes
    const linFeatures = plausibleLinearFeatures.map(f => {
      const svgCoords = f.coords.map(toSvg);
      
      // If it's an eave or rake, also add to classified segments for thick line rendering
      if (f.type === 'eave' && svgCoords.length >= 2) {
        classifiedEaves.push({
          start: svgCoords[0],
          end: svgCoords[svgCoords.length - 1],
          length: f.length,
        });
      } else if (f.type === 'rake' && svgCoords.length >= 2) {
        classifiedRakes.push({
          start: svgCoords[0],
          end: svgCoords[svgCoords.length - 1],
          length: f.length,
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
    
    // Debug: log hip features specifically  
    const hipFeatures = linFeatures.filter(f => f.type === 'hip');
    console.log(`🟣 Hip features to render: ${hipFeatures.length}`, hipFeatures.map(h => ({ points: h.points.length, length: h.length })));
    
    // Build facet paths
    const facetPathsData = facets.map((facet, index) => {
      if (!facet.polygon_points || facet.polygon_points.length < 3) return null;
      
      const svgCoords = facet.polygon_points.map(toSvg);
      const pathD = `M ${svgCoords.map(c => `${c.x},${c.y}`).join(' L ')} Z`;
      const centroidSvg = facet.centroid ? toSvg(facet.centroid) : {
        x: svgCoords.reduce((sum, c) => sum + c.x, 0) / svgCoords.length,
        y: svgCoords.reduce((sum, c) => sum + c.y, 0) / svgCoords.length,
      };
      
      return {
        facetNumber: facet.facet_number,
        path: pathD,
        centroid: centroidSvg,
        color: FACET_COLORS[index % FACET_COLORS.length],
        area: facet.area_adjusted_sqft || facet.area_flat_sqft,
        pitch: facet.pitch,
        direction: facet.primary_direction,
      };
    }).filter(Boolean);
    
    // Build QA data
    const qaData: GeometryQA = {
      hasFacets: facetPathsData.length > 0,
      facetCount: facetPathsData.length,
      vertexCount: perimeterCoords.length,
      linearFeatureCount: linearFeaturesData.length,
      plausibleLines: plausibleLinearFeatures.length,
      implausibleLines: implausibleCount,
      perimeterStatus: perimeterCoords.length >= 3 ? 'ok' : 'warning',
    };
    
    return {
      perimeterPath: pathD,
      perimeterSegments: perimSegs,
      linearFeatures: linFeatures,
      bounds: { minLat, maxLat, minLng, maxLng },
      svgPadding: padding,
      facetPaths: facetPathsData,
      eaveSegments: classifiedEaves,
      rakeSegments: classifiedRakes,
      qaData,
    };
  }, [measurement, width, height, facets]);

  // Update geometry QA when data changes
  useEffect(() => {
    const qaData = (perimeterPath as any)?.qaData;
    if (qaData) {
      setGeometryQA(qaData);
    }
  }, [perimeterPath]);

  // Destructure qaData from the memo result
  const qaData = useMemo(() => {
    // Access qaData from the memoized result
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
  const showPerimeterOnlyWarning = facets.length === 0 && measurement?.facet_count > 0;

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
      <svg width={width} height={height} className="absolute inset-0">
        {/* White background */}
        <rect x={0} y={0} width={width} height={height} fill={backgroundColor} />
        
        {/* Facet polygons (rendered first so they're behind lines) */}
        {showFacets && facetPaths.map((facet: any, i: number) => (
          <g key={`facet-${facet.facetNumber}`}>
            <path
              d={facet.path}
              fill={facet.color}
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
            {/* Area label below number */}
            {facet.area > 0 && (
              <text
                x={facet.centroid.x}
                y={facet.centroid.y + 28}
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
        {perimeterPath && (
          <path
            d={perimeterPath}
            fill="none"
            stroke={FEATURE_COLORS.perimeter}
            strokeWidth={1}
            strokeLinejoin="miter"
            opacity={0.3}
          />
        )}
        
        {/* Eave segments - thick dark green straight lines */}
        {eaveSegments.map((seg, i) => (
          <line
            key={`eave-${i}`}
            x1={seg.start.x}
            y1={seg.start.y}
            x2={seg.end.x}
            y2={seg.end.y}
            stroke={FEATURE_COLORS.eave}
            strokeWidth={5}
            strokeLinecap="square"
          />
        ))}
        
        {/* Rake segments - thick cyan straight lines */}
        {rakeSegments.map((seg, i) => (
          <line
            key={`rake-${i}`}
            x1={seg.start.x}
            y1={seg.start.y}
            x2={seg.end.x}
            y2={seg.end.y}
            stroke={FEATURE_COLORS.rake}
            strokeWidth={5}
            strokeLinecap="square"
          />
        ))}
        
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
        
        {/* Compass rose */}
        {showCompass && (
          <g transform={`translate(${width - 45}, 45)`}>
            <circle cx={0} cy={0} r={22} fill="white" stroke="#d1d5db" strokeWidth={1} />
            <path d="M 0 -16 L 4 0 L 0 -6 L -4 0 Z" fill="#DC2626" />
            <path d="M 0 16 L 4 0 L 0 6 L -4 0 Z" fill="#374151" />
            <text x={0} y={-6} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#DC2626">N</text>
            <text x={0} y={12} textAnchor="middle" fontSize={7} fill="#6b7280">S</text>
            <text x={10} y={3} textAnchor="middle" fontSize={7} fill="#6b7280">E</text>
            <text x={-10} y={3} textAnchor="middle" fontSize={7} fill="#6b7280">W</text>
          </g>
        )}
      </svg>
      
      {/* Perimeter Only Warning */}
      {showPerimeterOnlyWarning && (
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
      
      {/* Total Area Badge */}
      {showTotals && totals.total_area > 0 && (
        <div className="absolute top-3 left-3 bg-white/95 backdrop-blur border rounded-lg px-3 py-1.5 shadow-sm">
          <div className="text-[10px] text-muted-foreground uppercase">Total Area</div>
          <div className="text-lg font-bold">{Math.round(totals.total_area).toLocaleString()} sq ft</div>
          {totals.facet_count > 0 && (
            <div className="text-[10px] text-muted-foreground">{totals.facet_count} Facets</div>
          )}
        </div>
      )}
    </div>
  );
}
