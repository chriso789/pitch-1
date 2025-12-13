import { useMemo } from 'react';
import { wktLineToLatLngs, wktPolygonToLatLngs } from '@/lib/canvassiq/wkt';

// Roofr exact color palette
const FEATURE_COLORS = {
  eave: '#00B894',    // Teal green
  ridge: '#D63384',   // Magenta/pink
  hip: '#FD7E14',     // Orange
  valley: '#0D6EFD',  // Blue
  rake: '#9B59B6',    // Purple
  step: '#6C757D',    // Gray (dotted)
  perimeter: '#343A40', // Dark outline
};

interface LinearFeature {
  type: string;
  wkt?: string;
  length_ft?: number;
  length?: number;
}

interface SchematicRoofDiagramProps {
  measurement: any;
  tags: Record<string, any>;
  width?: number;
  height?: number;
  showLengthLabels?: boolean;
  showLegend?: boolean;
  showCompass?: boolean;
  showTotals?: boolean;
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

export function SchematicRoofDiagram({
  measurement,
  tags,
  width = 600,
  height = 500,
  showLengthLabels = true,
  showLegend = true,
  showCompass = true,
  showTotals = true,
  backgroundColor = '#FFFFFF',
}: SchematicRoofDiagramProps) {
  // Parse and transform coordinates to SVG space
  const { perimeterPath, perimeterSegments, linearFeatures, bounds, svgPadding } = useMemo(() => {
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
    
    // Extract linear features with WKT
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
              length: f.length_ft || f.length || 0,
            });
          }
        }
      });
    }
    
    // Calculate bounds
    if (allLatLngs.length === 0) {
      return { perimeterPath: '', perimeterSegments: [], linearFeatures: [], bounds: null, svgPadding: padding };
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
    
    if (perimeterCoords.length >= 3) {
      const svgCoords = perimeterCoords.map(toSvg);
      pathD = `M ${svgCoords.map(c => `${c.x},${c.y}`).join(' L ')} Z`;
      
      // Create individual edge segments with lengths
      for (let i = 0; i < perimeterCoords.length - 1; i++) {
        const p1 = perimeterCoords[i];
        const p2 = perimeterCoords[i + 1];
        const length = calculateSegmentLength(p1, p2);
        const svgP1 = svgCoords[i];
        const svgP2 = svgCoords[i + 1];
        
        // Classify as eave or rake (simplified - edges are labeled as perimeter segments)
        perimSegs.push({
          type: 'perimeter',
          points: [svgP1, svgP2],
          length,
          color: FEATURE_COLORS.perimeter,
        });
      }
    }
    
    // Build linear feature paths
    const linFeatures = linearFeaturesData.map(f => {
      const svgCoords = f.coords.map(toSvg);
      return {
        type: f.type,
        points: svgCoords,
        length: f.length || (f.coords.length >= 2 ? calculateSegmentLength(f.coords[0], f.coords[f.coords.length - 1]) : 0),
        color: FEATURE_COLORS[f.type as keyof typeof FEATURE_COLORS] || FEATURE_COLORS.ridge,
      };
    });
    
    return {
      perimeterPath: pathD,
      perimeterSegments: perimSegs,
      linearFeatures: linFeatures,
      bounds: { minLat, maxLat, minLng, maxLng },
      svgPadding: padding,
    };
  }, [measurement, width, height]);

  // Extract totals from tags or measurement summary
  const totals = useMemo(() => ({
    ridge: tags['lf.ridge'] || measurement?.summary?.ridge_ft || 0,
    hip: tags['lf.hip'] || measurement?.summary?.hip_ft || 0,
    valley: tags['lf.valley'] || measurement?.summary?.valley_ft || 0,
    eave: tags['lf.eave'] || measurement?.summary?.eave_ft || 0,
    rake: tags['lf.rake'] || measurement?.summary?.rake_ft || 0,
    step: tags['lf.step'] || measurement?.summary?.step_ft || 0,
    total_area: tags['roof.total_area'] || measurement?.summary?.total_area_sqft || 0,
  }), [tags, measurement]);

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
              { label: 'Step', value: totals.step, color: FEATURE_COLORS.step },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center p-2">
                <div 
                  className="text-lg font-bold"
                  style={{ color }}
                >
                  {Math.round(value)}'
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
        
        {/* Perimeter outline (thick dark line) */}
        {perimeterPath && (
          <path
            d={perimeterPath}
            fill="none"
            stroke={FEATURE_COLORS.perimeter}
            strokeWidth={3}
            strokeLinejoin="round"
          />
        )}
        
        {/* Linear features */}
        {linearFeatures.map((feature, i) => {
          if (feature.points.length < 2) return null;
          const pathD = `M ${feature.points.map(p => `${p.x},${p.y}`).join(' L ')}`;
          const isDashed = feature.type === 'step';
          
          return (
            <g key={`${feature.type}-${i}`}>
              <path
                d={pathD}
                fill="none"
                stroke={feature.color}
                strokeWidth={4}
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
        </div>
      )}
      
      {/* Total Area Badge */}
      {showTotals && totals.total_area > 0 && (
        <div className="absolute top-3 left-3 bg-white/95 backdrop-blur border rounded-lg px-3 py-1.5 shadow-sm">
          <div className="text-[10px] text-muted-foreground uppercase">Total Area</div>
          <div className="text-lg font-bold">{Math.round(totals.total_area).toLocaleString()} sq ft</div>
        </div>
      )}
    </div>
  );
}
