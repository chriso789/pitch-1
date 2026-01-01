import { useMemo } from 'react';
import { parseWKTPolygon } from '@/utils/geoCoordinates';

interface ComparisonOverlayProps {
  beforeWkt?: string;
  afterWkt?: string;
  satelliteImageUrl: string;
  centerLat: number;
  centerLng: number;
  showOverlay?: boolean;
  width?: number;
  height?: number;
}

export function ComparisonOverlay({
  beforeWkt,
  afterWkt,
  satelliteImageUrl,
  centerLat,
  centerLng,
  showOverlay = true,
  width = 400,
  height = 300
}: ComparisonOverlayProps) {
  // Parse WKT polygons and convert to SVG coordinates
  const { beforePoints, afterPoints } = useMemo(() => {
    const zoom = 20; // Standard analysis zoom
    const imageSize = 640; // Standard image size in pixels
    
    // Calculate meters per pixel at this zoom level
    const metersPerPixel = (156543.03392 * Math.cos(centerLat * Math.PI / 180)) / Math.pow(2, zoom);
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);
    
    const geoToSvg = (lat: number, lng: number): { x: number; y: number } => {
      // Convert lat/lng to offset in meters from center
      const dLat = lat - centerLat;
      const dLng = lng - centerLng;
      
      const metersY = dLat * metersPerDegLat;
      const metersX = dLng * metersPerDegLng;
      
      // Convert meters to pixels
      const pixelX = metersX / metersPerPixel;
      const pixelY = -metersY / metersPerPixel; // Invert Y for SVG
      
      // Scale to SVG dimensions (centered)
      const scaleX = width / imageSize;
      const scaleY = height / imageSize;
      
      return {
        x: (width / 2) + (pixelX * scaleX),
        y: (height / 2) + (pixelY * scaleY)
      };
    };
    
    let before: { x: number; y: number }[] = [];
    let after: { x: number; y: number }[] = [];
    
    if (beforeWkt) {
      const coords = parseWKTPolygon(beforeWkt);
      if (coords) {
        before = coords.map(([lng, lat]) => geoToSvg(lat, lng));
      }
    }
    
    if (afterWkt) {
      const coords = parseWKTPolygon(afterWkt);
      if (coords) {
        after = coords.map(([lng, lat]) => geoToSvg(lat, lng));
      }
    }
    
    return { beforePoints: before, afterPoints: after };
  }, [beforeWkt, afterWkt, centerLat, centerLng, width, height]);

  const pointsToPath = (points: { x: number; y: number }[]): string => {
    if (points.length < 3) return '';
    return points.map((p, i) => 
      `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
    ).join(' ') + ' Z';
  };

  return (
    <div className="relative rounded-lg overflow-hidden border bg-muted/30" style={{ width, height }}>
      {/* Satellite Image Background */}
      <img
        src={satelliteImageUrl}
        alt="Satellite view"
        className="absolute inset-0 w-full h-full object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      
      {/* SVG Overlay */}
      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: 'none' }}
      >
        {/* Before outline (red dashed) */}
        {showOverlay && beforePoints.length >= 3 && (
          <path
            d={pointsToPath(beforePoints)}
            fill="rgba(239, 68, 68, 0.15)"
            stroke="#ef4444"
            strokeWidth="2"
            strokeDasharray="6,3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        
        {/* After outline (green solid) */}
        {afterPoints.length >= 3 && (
          <path
            d={pointsToPath(afterPoints)}
            fill="rgba(34, 197, 94, 0.15)"
            stroke="#22c55e"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        
        {/* Vertices for before (red dots) */}
        {showOverlay && beforePoints.map((p, i) => (
          <circle
            key={`before-${i}`}
            cx={p.x}
            cy={p.y}
            r="3"
            fill="#ef4444"
            stroke="white"
            strokeWidth="1"
          />
        ))}
        
        {/* Vertices for after (green dots) */}
        {afterPoints.map((p, i) => (
          <circle
            key={`after-${i}`}
            cx={p.x}
            cy={p.y}
            r="3.5"
            fill="#22c55e"
            stroke="white"
            strokeWidth="1"
          />
        ))}
      </svg>
      
      {/* No data fallback */}
      {beforePoints.length < 3 && afterPoints.length < 3 && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
          <span className="text-sm text-muted-foreground">No perimeter data available</span>
        </div>
      )}
    </div>
  );
}
