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
  analysisZoom?: number;
  alignmentOffset?: { x: number; y: number };
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
  analysisZoom = 20,
  alignmentOffset = { x: 0, y: 0 },
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
      const coords = parseWKTToPixels(feature.wkt, coordinates, imageSize, analysisZoom);
      // Apply alignment offset
      const adjustedCoords = coords.map(p => ({
        x: p.x + alignmentOffset.x,
        y: p.y + alignmentOffset.y
      }));
      return { ...feature, pixelCoords: adjustedCoords };
    });
  }, [linearFeatures, coordinates, imageSize, analysisZoom, alignmentOffset]);

  // Parse perimeter WKT to pixels
  const perimeterPixels = useMemo(() => {
    let pixels: Array<{ x: number; y: number }> = [];
    if (perimeterWkt) {
      pixels = parseWKTPolygonToPixels(perimeterWkt, coordinates, imageSize, analysisZoom);
    } else if (perimeterVertices.length > 0) {
      pixels = perimeterVertices.map(v => ({ x: v.x, y: v.y }));
    }
    // Apply alignment offset
    return pixels.map(p => ({
      x: p.x + alignmentOffset.x,
      y: p.y + alignmentOffset.y
    }));
  }, [perimeterWkt, perimeterVertices, coordinates, imageSize, analysisZoom, alignmentOffset]);

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
  imageSize: number,
  zoom: number = 20
): Array<{ x: number; y: number }> {
  if (!wkt) return [];

  // Extract coordinates from LINESTRING(lng lat, lng lat, ...)
  const match = wkt.match(/LINESTRING\s*\((.*)\)/i);
  if (!match) return [];

  const coordPairs = match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return { lng, lat };
  });

  return coordPairs.map(gps => gpsToPixel(gps, center, imageSize, zoom));
}

// Helper: Parse WKT POLYGON to pixel coordinates
function parseWKTPolygonToPixels(
  wkt: string,
  center: { lat: number; lng: number },
  imageSize: number,
  zoom: number = 20
): Array<{ x: number; y: number }> {
  if (!wkt) return [];

  // Extract coordinates from POLYGON((lng lat, lng lat, ...))
  const match = wkt.match(/POLYGON\s*\(\((.*)\)\)/i);
  if (!match) return [];

  const coordPairs = match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return { lng, lat };
  });

  return coordPairs.map(gps => gpsToPixel(gps, center, imageSize, zoom));
}

/**
 * Convert GPS coordinates to pixel coordinates using Web Mercator projection.
 * This must match the projection used by Google Static Maps API at the given zoom level.
 *
 * Google Static Maps uses Web Mercator (EPSG:3857) projection.
 * At zoom level z, the world is 256 * 2^z pixels wide.
 *
 * Formula:
 * - Meters per pixel at equator = 156543.03392 / 2^zoom
 * - At latitude lat, meters per pixel = (156543.03392 / 2^zoom) * cos(lat)
 * - Convert coordinate delta to pixel delta using this scale
 */
function gpsToPixel(
  gps: { lng: number; lat: number },
  center: { lat: number; lng: number },
  imageSize: number,
  zoom: number = 20
): { x: number; y: number } {
  // Web Mercator constants
  const EARTH_CIRCUMFERENCE_METERS = 40075016.686;
  const TILE_SIZE = 256;

  // Pixels per meter at the equator at this zoom level
  const worldPixelSize = TILE_SIZE * Math.pow(2, zoom);
  const pixelsPerMeterAtEquator = worldPixelSize / EARTH_CIRCUMFERENCE_METERS;

  // Meters per degree of longitude (constant at any latitude)
  const metersPerDegreeLng = EARTH_CIRCUMFERENCE_METERS / 360;

  // Meters per degree of latitude varies with latitude
  // Using center latitude as reference for small area approximation
  const metersPerDegreeLat = EARTH_CIRCUMFERENCE_METERS / 360;

  // Calculate delta in degrees
  const dLng = gps.lng - center.lng;
  const dLat = center.lat - gps.lat; // Inverted because y increases downward

  // Convert to meters (using center latitude for Mercator correction)
  const latRadians = center.lat * Math.PI / 180;
  const dxMeters = dLng * metersPerDegreeLng * Math.cos(latRadians);
  const dyMeters = dLat * metersPerDegreeLat;

  // Convert meters to pixels at this zoom level
  // At the center latitude, adjust for Mercator distortion
  const pixelsPerMeter = pixelsPerMeterAtEquator * Math.cos(latRadians);

  const dx = dxMeters * pixelsPerMeter;
  const dy = dyMeters * pixelsPerMeter;

  // Center of image + offset
  const x = imageSize / 2 + dx;
  const y = imageSize / 2 + dy;

  return { x, y };
}

export default AIRoofSkeletonViewer;
