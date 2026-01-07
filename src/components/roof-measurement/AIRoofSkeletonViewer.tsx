import React, { useState, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group } from 'react-konva';
import useImage from 'use-image';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, Layers, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface LinearFeature {
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  wkt: string;
  lengthFt: number;
}

interface PerimeterVertex {
  x: number;
  y: number;
  cornerType?: string;
}

interface AIRoofSkeletonViewerProps {
  satelliteImageUrl: string;
  perimeterVertices?: PerimeterVertex[];
  linearFeatures?: LinearFeature[];
  perimeterWkt?: string;
  coordinates: { lat: number; lng: number };
  imageSize?: number;
  onAdjust?: () => void;
  className?: string;
}

// Edge colors matching the system design
const EDGE_COLORS: Record<string, string> = {
  ridge: '#22c55e',     // Green (peak of roof)
  hip: '#a855f7',       // Purple (diagonal to corners)
  valley: '#ef4444',    // Red (internal corner)
  eave: '#06b6d4',      // Cyan (horizontal bottom)
  rake: '#f97316',      // Orange (sloped gable edge)
  perimeter: '#3b82f6', // Blue (outline)
};

const EDGE_STROKE_WIDTH: Record<string, number> = {
  ridge: 4,
  hip: 3,
  valley: 3,
  eave: 2,
  rake: 2,
  perimeter: 2,
};

export function AIRoofSkeletonViewer({
  satelliteImageUrl,
  perimeterVertices = [],
  linearFeatures = [],
  perimeterWkt,
  coordinates,
  imageSize = 640,
  onAdjust,
  className = '',
}: AIRoofSkeletonViewerProps) {
  const [image] = useImage(satelliteImageUrl);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [overlayOpacity, setOverlayOpacity] = useState([0.85]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Parse WKT strings to pixel coordinates
  const parsedFeatures = useMemo(() => {
    return linearFeatures.map(feature => {
      const coords = parseWKTToPixels(feature.wkt, coordinates, imageSize);
      return { ...feature, pixelCoords: coords };
    });
  }, [linearFeatures, coordinates, imageSize]);

  // Parse perimeter WKT to pixels
  const perimeterPixels = useMemo(() => {
    if (perimeterWkt) {
      return parseWKTPolygonToPixels(perimeterWkt, coordinates, imageSize);
    }
    // Fallback to vertices if WKT not available
    if (perimeterVertices.length > 0) {
      return perimeterVertices.map(v => ({ x: v.x, y: v.y }));
    }
    return [];
  }, [perimeterWkt, perimeterVertices, coordinates, imageSize]);

  // Group features by type for legend
  const featureSummary = useMemo(() => {
    const summary: Record<string, { count: number; totalFt: number }> = {};
    linearFeatures.forEach(f => {
      if (!summary[f.type]) {
        summary[f.type] = { count: 0, totalFt: 0 };
      }
      summary[f.type].count++;
      summary[f.type].totalFt += f.lengthFt;
    });
    return summary;
  }, [linearFeatures]);

  const handleZoomIn = () => setZoom(Math.min(zoom + 0.25, 3));
  const handleZoomOut = () => setZoom(Math.max(zoom - 0.25, 0.5));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const canvasSize = imageSize;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={showSkeleton ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowSkeleton(!showSkeleton)}
        >
          {showSkeleton ? <Eye className="h-4 w-4 mr-1" /> : <EyeOff className="h-4 w-4 mr-1" />}
          Skeleton
        </Button>
        
        <Button
          variant={showLabels ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowLabels(!showLabels)}
        >
          <Layers className="h-4 w-4 mr-1" />
          Labels
        </Button>

        <div className="flex items-center gap-1 border rounded-md p-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">Opacity:</span>
          <Slider
            value={overlayOpacity}
            onValueChange={setOverlayOpacity}
            min={0.3}
            max={1}
            step={0.05}
            className="w-24"
          />
        </div>

        {onAdjust && (
          <Button variant="outline" size="sm" onClick={onAdjust}>
            Adjust Manually
          </Button>
        )}
      </div>

      {/* Canvas with Skeleton Overlay */}
      <div className="border rounded-lg overflow-hidden bg-muted relative">
        <Stage 
          width={canvasSize} 
          height={canvasSize}
          scaleX={zoom}
          scaleY={zoom}
          x={pan.x}
          y={pan.y}
          draggable
          onDragEnd={(e) => setPan({ x: e.target.x(), y: e.target.y() })}
        >
          <Layer>
            {/* Satellite Image */}
            {image && (
              <KonvaImage 
                image={image} 
                width={canvasSize} 
                height={canvasSize}
                opacity={overlayOpacity[0]}
              />
            )}

            {showSkeleton && (
              <>
                {/* Perimeter Outline */}
                {perimeterPixels.length > 2 && (
                  <Line
                    points={perimeterPixels.flatMap(p => [p.x, p.y])}
                    closed
                    stroke={EDGE_COLORS.perimeter}
                    strokeWidth={EDGE_STROKE_WIDTH.perimeter}
                    dash={[8, 4]}
                    opacity={0.9}
                  />
                )}

                {/* Linear Features (Ridge, Hip, Valley, etc.) */}
                {parsedFeatures.map((feature, idx) => (
                  <Group key={`${feature.type}-${idx}`}>
                    <Line
                      points={feature.pixelCoords.flatMap(p => [p.x, p.y])}
                      stroke={EDGE_COLORS[feature.type] || '#ffffff'}
                      strokeWidth={EDGE_STROKE_WIDTH[feature.type] || 2}
                      lineCap="round"
                      lineJoin="round"
                    />
                    
                    {/* Endpoint circles */}
                    {feature.pixelCoords.map((point, pIdx) => (
                      <Circle
                        key={`point-${pIdx}`}
                        x={point.x}
                        y={point.y}
                        radius={4}
                        fill={EDGE_COLORS[feature.type] || '#ffffff'}
                        stroke="white"
                        strokeWidth={1}
                      />
                    ))}

                    {/* Length label at midpoint */}
                    {showLabels && feature.pixelCoords.length >= 2 && feature.lengthFt > 5 && (
                      <Group
                        x={(feature.pixelCoords[0].x + feature.pixelCoords[1].x) / 2 - 15}
                        y={(feature.pixelCoords[0].y + feature.pixelCoords[1].y) / 2 - 8}
                      >
                        <Text
                          text={`${feature.lengthFt.toFixed(0)}'`}
                          fontSize={11}
                          fontStyle="bold"
                          fill="white"
                          stroke="black"
                          strokeWidth={0.5}
                        />
                      </Group>
                    )}
                  </Group>
                ))}
              </>
            )}
          </Layer>
        </Stage>

        {/* Overlay badge showing skeleton status */}
        {showSkeleton && (
          <div className="absolute top-2 left-2">
            <Badge variant="secondary" className="bg-background/90 text-foreground">
              AI Skeleton Active
            </Badge>
          </div>
        )}
      </div>

      {/* Legend */}
      {showSkeleton && Object.keys(featureSummary).length > 0 && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <h4 className="text-sm font-semibold mb-2">Roof Components</h4>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            {Object.entries(featureSummary).map(([type, data]) => (
              <div key={type} className="flex items-center gap-2">
                <div 
                  className="w-4 h-1 rounded" 
                  style={{ backgroundColor: EDGE_COLORS[type] || '#888' }} 
                />
                <span className="capitalize">
                  {type}: {data.totalFt.toFixed(0)} ft
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper: Parse WKT LINESTRING to pixel coordinates
function parseWKTToPixels(
  wkt: string,
  center: { lat: number; lng: number },
  imageSize: number
): Array<{ x: number; y: number }> {
  if (!wkt) return [];
  
  // Extract coordinates from LINESTRING(lng lat, lng lat, ...)
  const match = wkt.match(/LINESTRING\s*\((.*)\)/i);
  if (!match) return [];
  
  const coordPairs = match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return { lng, lat };
  });
  
  return coordPairs.map(gps => gpsToPixel(gps, center, imageSize));
}

// Helper: Parse WKT POLYGON to pixel coordinates
function parseWKTPolygonToPixels(
  wkt: string,
  center: { lat: number; lng: number },
  imageSize: number
): Array<{ x: number; y: number }> {
  if (!wkt) return [];
  
  // Extract coordinates from POLYGON((lng lat, lng lat, ...))
  const match = wkt.match(/POLYGON\s*\(\((.*)\)\)/i);
  if (!match) return [];
  
  const coordPairs = match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return { lng, lat };
  });
  
  return coordPairs.map(gps => gpsToPixel(gps, center, imageSize));
}

// Helper: Convert GPS to pixel coordinates (Web Mercator approximation)
function gpsToPixel(
  gps: { lng: number; lat: number },
  center: { lat: number; lng: number },
  imageSize: number
): { x: number; y: number } {
  // At zoom 20, approximate degrees per pixel
  const zoom = 20;
  const degreesPerPixel = 156543.03392 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, zoom) / 111320;
  
  const x = (gps.lng - center.lng) / degreesPerPixel + imageSize / 2;
  const y = (center.lat - gps.lat) / degreesPerPixel + imageSize / 2;
  
  return { x, y };
}

export default AIRoofSkeletonViewer;
