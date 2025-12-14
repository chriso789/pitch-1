import { useMemo } from 'react';
import { wktPolygonToLatLngs, wktLineToLatLngs } from '@/lib/canvassiq/wkt';

interface RoofDiagramRendererProps {
  measurement: any;
  tags: Record<string, any>;
  width: number;
  height: number;
  showSatellite?: boolean;
  showLabels?: boolean;
  showLengthLabels?: boolean;
  showAreaLabels?: boolean;
  showPitchLabels?: boolean;
  showFacetOverlay?: boolean;
  satelliteImageUrl?: string;
}

// Color palette for facets matching Roofr style
const FACET_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green  
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

// Feature colors matching Roofr exactly
const FEATURE_COLORS = {
  perimeter: '#f97316', // orange
  ridge: '#22c55e',     // green
  hip: '#3b82f6',       // blue
  valley: '#ef4444',    // red
  eave: '#06b6d4',      // cyan
  rake: '#d946ef',      // magenta/fuchsia
  step: '#f59e0b',      // amber (dashed)
  step_flashing: '#f59e0b',
};

// Helper to convert lat/lng coords to SVG coordinates
function coordsToSVG(
  coords: Array<{ lat: number; lng: number }>,
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  width: number,
  height: number,
  padding: number = 40
): string {
  if (coords.length < 2) return '';
  
  const scaleX = (width - padding * 2) / (bounds.maxLng - bounds.minLng || 0.0001);
  const scaleY = (height - padding * 2) / (bounds.maxLat - bounds.minLat || 0.0001);
  const scale = Math.min(scaleX, scaleY);
  
  // Center the drawing
  const drawWidth = (bounds.maxLng - bounds.minLng) * scale;
  const drawHeight = (bounds.maxLat - bounds.minLat) * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;
  
  const points = coords.map(c => {
    const x = offsetX + (c.lng - bounds.minLng) * scale;
    const y = offsetY + (bounds.maxLat - c.lat) * scale; // Flip Y axis
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  
  return `M ${points.join(' L ')} Z`;
}

function lineToSVG(
  coords: Array<{ lat: number; lng: number }>,
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  width: number,
  height: number,
  padding: number = 40
): string {
  if (coords.length < 2) return '';
  
  const scaleX = (width - padding * 2) / (bounds.maxLng - bounds.minLng || 0.0001);
  const scaleY = (height - padding * 2) / (bounds.maxLat - bounds.minLat || 0.0001);
  const scale = Math.min(scaleX, scaleY);
  
  const drawWidth = (bounds.maxLng - bounds.minLng) * scale;
  const drawHeight = (bounds.maxLat - bounds.minLat) * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;
  
  const points = coords.map((c, i) => {
    const x = offsetX + (c.lng - bounds.minLng) * scale;
    const y = offsetY + (bounds.maxLat - c.lat) * scale;
    return i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `L ${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  
  return points.join(' ');
}

export function RoofDiagramRenderer({
  measurement,
  tags,
  width,
  height,
  showSatellite = false,
  showLabels = true,
  showLengthLabels = false,
  showAreaLabels = false,
  showPitchLabels = false,
  showFacetOverlay = true,
  satelliteImageUrl,
}: RoofDiagramRendererProps) {
  
  // Calculate unified bounds from all geometry
  const bounds = useMemo(() => {
    const allCoords: Array<{ lat: number; lng: number }> = [];
    
    // From perimeter_wkt
    if (measurement?.perimeter_wkt) {
      const perimCoords = wktPolygonToLatLngs(measurement.perimeter_wkt);
      allCoords.push(...perimCoords);
    }
    
    // From linear_features_wkt
    const linearData = measurement?.linear_features_wkt || measurement?.linear_features || [];
    if (Array.isArray(linearData)) {
      linearData.forEach((feature: any) => {
        if (feature.wkt) {
          const coords = wktLineToLatLngs(feature.wkt);
          allCoords.push(...coords);
        }
      });
    }
    
    // From faces with WKT
    if (measurement?.faces) {
      measurement.faces.forEach((face: any) => {
        if (face.wkt) {
          const coords = wktPolygonToLatLngs(face.wkt);
          allCoords.push(...coords);
        }
      });
    }
    
    if (allCoords.length === 0) {
      return { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };
    }
    
    const lats = allCoords.map(c => c.lat);
    const lngs = allCoords.map(c => c.lng);
    
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    };
  }, [measurement]);
  
  // Parse perimeter from perimeter_wkt
  const perimeterPath = useMemo(() => {
    if (!measurement?.perimeter_wkt) return null;
    
    const coords = wktPolygonToLatLngs(measurement.perimeter_wkt);
    if (coords.length < 3) return null;
    
    return coordsToSVG(coords, bounds, width, height);
  }, [measurement?.perimeter_wkt, bounds, width, height]);
  
  // Parse facets from measurement data - prioritize perimeter_wkt if faces have no WKT
  const facets = useMemo(() => {
    // If we have faces with real WKT geometry, use them
    if (measurement?.faces && measurement.faces.length > 0 && measurement.faces[0]?.wkt) {
      return measurement.faces.map((face: any, index: number) => {
        const coords = wktPolygonToLatLngs(face.wkt);
        return {
          id: face.id || index,
          number: face.facet_number || index + 1,
          area: face.area_sqft || face.plan_area_sqft || 0,
          pitch: face.pitch || '6/12',
          color: FACET_COLORS[index % FACET_COLORS.length],
          polygon: coordsToSVG(coords, bounds, width, height),
        };
      });
    }
    
    // If we have perimeter_wkt but no face WKT, use perimeter as single facet
    if (perimeterPath) {
      return [{
        id: 1,
        number: 1,
        area: measurement?.summary?.total_area_sqft || tags?.['roof.total_area'] || 0,
        pitch: measurement?.summary?.pitch || measurement?.predominant_pitch || '6/12',
        color: FACET_COLORS[0],
        polygon: perimeterPath,
      }];
    }
    
    // No real geometry - return empty (no fake shapes)
    console.log('⚠️ No WKT geometry available for roof diagram');
    return [];
  }, [measurement, tags, bounds, width, height, perimeterPath]);

  // Parse linear features from WKT
  const linearFeatures = useMemo(() => {
    const features: Array<{
      type: string;
      color: string;
      path: string;
      length?: number;
      dashed?: boolean;
    }> = [];

    const linearData = measurement?.linear_features_wkt || measurement?.linear_features || [];
    
    if (Array.isArray(linearData)) {
      linearData.forEach((feature: any) => {
        const type = feature.type?.toLowerCase() || 'ridge';
        
        // Only render if we have WKT geometry
        if (feature.wkt) {
          const coords = wktLineToLatLngs(feature.wkt);
          if (coords.length >= 2) {
            features.push({
              type,
              color: FEATURE_COLORS[type as keyof typeof FEATURE_COLORS] || FEATURE_COLORS.ridge,
              path: lineToSVG(coords, bounds, width, height),
              length: feature.length_ft || 0,
              dashed: type === 'step' || type === 'step_flashing',
            });
          }
        }
      });
    }

    return features;
  }, [measurement, bounds, width, height]);

  // Check if we have any real geometry
  const hasGeometry = perimeterPath || facets.length > 0 || linearFeatures.length > 0;

  return (
    <div className="relative" style={{ width, height }}>
      {/* Background */}
      {showSatellite && satelliteImageUrl ? (
        <img 
          src={satelliteImageUrl} 
          alt="Satellite view"
          className="absolute inset-0 w-full h-full object-cover rounded"
        />
      ) : (
        <div className="absolute inset-0 bg-muted/20 rounded" />
      )}

      {/* No geometry message */}
      {!hasGeometry && !showSatellite && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">No roof geometry available</p>
        </div>
      )}

      {/* SVG Overlay */}
      <svg 
        width={width} 
        height={height} 
        className="absolute inset-0"
        style={{ background: showSatellite ? 'transparent' : undefined }}
      >
        {/* Facet polygons */}
        {showFacetOverlay && facets.map((facet, i) => (
          <g key={facet.id}>
            <path
              d={facet.polygon}
              fill={showSatellite ? `${facet.color}40` : `${facet.color}30`}
              stroke={facet.color}
              strokeWidth={2}
            />
            {/* Area label */}
            {showAreaLabels && facet.area > 0 && (
              <text
                x={width / 2}
                y={height / 2 + i * 20}
                textAnchor="middle"
                fill={showSatellite ? 'white' : 'currentColor'}
                fontSize={12}
                fontWeight="bold"
                style={{ textShadow: showSatellite ? '0 1px 2px rgba(0,0,0,0.8)' : undefined }}
              >
                {Math.round(facet.area)} sqft
              </text>
            )}
            {/* Pitch label */}
            {showPitchLabels && (
              <text
                x={width / 2}
                y={height / 2 + i * 20}
                textAnchor="middle"
                fill={showSatellite ? 'white' : 'currentColor'}
                fontSize={14}
                fontWeight="bold"
                style={{ textShadow: showSatellite ? '0 1px 2px rgba(0,0,0,0.8)' : undefined }}
              >
                {facet.pitch.replace('/12', '')}
              </text>
            )}
          </g>
        ))}

        {/* Linear features */}
        {linearFeatures.map((feature, i) => (
          <g key={`${feature.type}-${i}`}>
            <path
              d={feature.path}
              fill="none"
              stroke={feature.color}
              strokeWidth={3}
              strokeDasharray={feature.dashed ? '8,4' : undefined}
              strokeLinecap="round"
            />
            {/* Length label */}
            {showLengthLabels && feature.length && feature.length > 0 && (
              <text
                x={50 + i * 30}
                y={height - 20}
                fill={feature.color}
                fontSize={10}
                fontWeight="bold"
              >
                {Math.round(feature.length)}'
              </text>
            )}
          </g>
        ))}

        {/* Compass rose */}
        <g transform={`translate(${width - 40}, 40)`}>
          <circle cx={0} cy={0} r={20} fill="white" fillOpacity={0.9} stroke="currentColor" strokeWidth={1} />
          <path d="M 0 -15 L 3 0 L 0 -5 L -3 0 Z" fill="red" />
          <path d="M 0 15 L 3 0 L 0 5 L -3 0 Z" fill="currentColor" />
          <text x={0} y={-6} textAnchor="middle" fontSize={8} fontWeight="bold" fill="red">N</text>
        </g>

        {/* Facet numbers */}
        {showLabels && showFacetOverlay && facets.map((facet, i) => (
          <g key={`label-${facet.id}`}>
            <circle
              cx={width / 2 + (i - facets.length / 2) * 25}
              cy={30}
              r={10}
              fill={facet.color}
            />
            <text
              x={width / 2 + (i - facets.length / 2) * 25}
              y={34}
              textAnchor="middle"
              fill="white"
              fontSize={10}
              fontWeight="bold"
            >
              {facet.number}
            </text>
          </g>
        ))}
      </svg>

      {/* Legend for clean diagram */}
      {!showSatellite && showLabels && (
        <div className="absolute bottom-2 left-2 flex gap-2 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5" style={{ background: FEATURE_COLORS.ridge }} />
            Ridge
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5" style={{ background: FEATURE_COLORS.hip }} />
            Hip
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5" style={{ background: FEATURE_COLORS.valley }} />
            Valley
          </span>
        </div>
      )}
    </div>
  );
}
