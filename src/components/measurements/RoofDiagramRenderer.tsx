import { useMemo } from 'react';

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
};

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
  satelliteImageUrl,
}: RoofDiagramRendererProps) {
  
  // Debug log to see what data we're getting
  console.log('🎨 RoofDiagramRenderer:', { 
    hasMeasurement: !!measurement, 
    facesCount: measurement?.faces?.length,
    satelliteImageUrl: satelliteImageUrl?.substring(0, 50),
    showSatellite
  });
  
  // Parse facets from measurement data
  const facets = useMemo(() => {
    if (!measurement?.faces || measurement.faces.length === 0) {
      // Generate a default placeholder facet if no data
      console.log('⚠️ No faces data, generating placeholder');
      return [{
        id: 1,
        number: 1,
        area: measurement?.summary?.total_area_sqft || tags?.['roof.total_area'] || 0,
        pitch: measurement?.summary?.pitch || measurement?.predominant_pitch || '6/12',
        color: FACET_COLORS[0],
        polygon: generateDefaultRoofShape(width, height),
      }];
    }
    
    return measurement.faces.map((face: any, index: number) => ({
      id: face.id || index,
      number: face.facet_number || index + 1,
      area: face.area_sqft || face.plan_area_sqft || 0,
      pitch: face.pitch || '6/12',
      color: FACET_COLORS[index % FACET_COLORS.length],
      // Generate mock polygon if no WKT (for display purposes)
      polygon: face.wkt ? parseWKTToSVG(face.wkt, width, height) : generateMockPolygon(index, measurement.faces.length, width, height),
    }));
  }, [measurement, tags, width, height]);

  // Generate a simple house-shaped roof polygon
  function generateDefaultRoofShape(w: number, h: number): string {
    const padding = 80;
    const cx = w / 2;
    const cy = h / 2;
    const roofWidth = w - padding * 2;
    const roofHeight = h - padding * 2;
    
    // Simple gable roof shape
    return `M ${padding} ${cy + roofHeight * 0.3} 
            L ${cx} ${padding} 
            L ${w - padding} ${cy + roofHeight * 0.3} 
            L ${w - padding} ${h - padding} 
            L ${padding} ${h - padding} Z`;
  }

  // Parse linear features
  const linearFeatures = useMemo(() => {
    const features: Array<{
      type: string;
      color: string;
      path: string;
      length?: number;
      dashed?: boolean;
    }> = [];

    // Extract from tags or measurement.linear_features
    const linearData = measurement?.linear_features_wkt || measurement?.linear_features || [];
    
    // If linear_features is an object with type keys (like {ridge: 50, hip: 30})
    if (linearData && typeof linearData === 'object' && !Array.isArray(linearData)) {
      Object.entries(linearData).forEach(([type, length]) => {
        if (typeof length === 'number' && length > 0) {
          features.push({
            type: type.toLowerCase(),
            color: FEATURE_COLORS[type.toLowerCase() as keyof typeof FEATURE_COLORS] || FEATURE_COLORS.ridge,
            path: generateLinearFeaturePath(type, width, height, features.length),
            length: length,
            dashed: type === 'step',
          });
        }
      });
    } else if (Array.isArray(linearData)) {
      linearData.forEach((feature: any) => {
        const type = feature.type?.toLowerCase() || 'ridge';
        features.push({
          type,
          color: FEATURE_COLORS[type as keyof typeof FEATURE_COLORS] || FEATURE_COLORS.ridge,
          path: feature.wkt ? parseLineWKTToSVG(feature.wkt, width, height) : '',
          length: feature.length_ft || 0,
          dashed: type === 'step',
        });
      });
    }

    return features;
  }, [measurement, width, height]);

  // Generate simple linear feature paths for display
  function generateLinearFeaturePath(type: string, w: number, h: number, index: number): string {
    const padding = 80;
    const cx = w / 2;
    const cy = h / 2;
    
    switch (type.toLowerCase()) {
      case 'ridge':
        return `M ${padding + 20} ${cy - 30} L ${w - padding - 20} ${cy - 30}`;
      case 'hip':
        return `M ${cx} ${padding + 30} L ${w - padding - 40} ${cy + 40}`;
      case 'valley':
        return `M ${padding + 40} ${cy} L ${cx} ${h - padding - 40}`;
      case 'eave':
        return `M ${padding} ${h - padding - 20} L ${w - padding} ${h - padding - 20}`;
      case 'rake':
        return `M ${padding + 10} ${cy + 50} L ${padding + 10} ${h - padding}`;
      default:
        return `M ${padding + index * 20} ${cy} L ${w - padding - index * 20} ${cy}`;
    }
  }

  // Generate mock facet polygon for visual representation
  function generateMockPolygon(index: number, total: number, w: number, h: number): string {
    const centerX = w / 2;
    const centerY = h / 2;
    const radius = Math.min(w, h) * 0.35;
    
    // Create pie-slice style polygons
    const angleStart = (index / total) * Math.PI * 2 - Math.PI / 2;
    const angleEnd = ((index + 1) / total) * Math.PI * 2 - Math.PI / 2;
    
    const x1 = centerX + Math.cos(angleStart) * radius;
    const y1 = centerY + Math.sin(angleStart) * radius;
    const x2 = centerX + Math.cos(angleEnd) * radius;
    const y2 = centerY + Math.sin(angleEnd) * radius;
    
    return `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;
  }

  // Parse WKT POLYGON to SVG path
  function parseWKTToSVG(wkt: string, w: number, h: number): string {
    if (!wkt) return '';
    
    const match = wkt.match(/POLYGON\(\(([^)]+)\)\)/);
    if (!match) return '';
    
    const coords = match[1].split(',').map(pair => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return { lat, lng };
    });
    
    if (coords.length < 3) return '';
    
    // Find bounds
    const lats = coords.map(c => c.lat);
    const lngs = coords.map(c => c.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    
    // Convert to SVG coordinates with padding
    const padding = 50;
    const scaleX = (w - padding * 2) / (maxLng - minLng || 1);
    const scaleY = (h - padding * 2) / (maxLat - minLat || 1);
    const scale = Math.min(scaleX, scaleY);
    
    const points = coords.map(c => {
      const x = padding + (c.lng - minLng) * scale;
      const y = padding + (maxLat - c.lat) * scale; // Flip Y
      return `${x},${y}`;
    });
    
    return `M ${points.join(' L ')} Z`;
  }

  // Parse WKT LINESTRING to SVG path
  function parseLineWKTToSVG(wkt: string, w: number, h: number): string {
    if (!wkt) return '';
    
    const match = wkt.match(/LINESTRING\(([^)]+)\)/);
    if (!match) return '';
    
    const coords = match[1].split(',').map(pair => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return { lat, lng };
    });
    
    if (coords.length < 2) return '';
    
    // Use same bounds as facets for consistency
    // For standalone use, calculate from line coords
    const points = coords.map((c, i) => {
      // Simple normalized positioning (0-1 range assumed)
      const x = 50 + (c.lng + 82) * 100; // Rough conversion
      const y = 50 + (28 - c.lat) * 100;
      return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    });
    
    return points.join(' ');
  }

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
        <div className="absolute inset-0 bg-slate-100 dark:bg-slate-800 rounded" />
      )}

      {/* SVG Overlay */}
      <svg 
        width={width} 
        height={height} 
        className="absolute inset-0"
        style={{ background: showSatellite ? 'transparent' : undefined }}
      >
        {/* Facet polygons */}
        {facets.map((facet, i) => (
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
        {showLabels && facets.map((facet, i) => (
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
