import React, { useMemo } from 'react';
import { Stage, Layer, Line, Circle, Text, Group, Rect, Arrow } from 'react-konva';
import { Badge } from '@/components/ui/badge';

interface Facet {
  facetNumber: number;
  points: Array<{ lng: number; lat: number }>;
  areaEstimate?: number;
  primaryDirection?: string;
  azimuthDegrees?: number;
  shapeType?: string;
}

interface LinearFeature {
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  wkt: string;
  lengthFt: number;
}

interface CleanRoofDiagramProps {
  facets?: Facet[];
  linearFeatures?: LinearFeature[];
  perimeterWkt?: string;
  coordinates: { lat: number; lng: number };
  totalArea?: number;
  pitch?: string;
  facetCount?: number;
  className?: string;
}

// Professional color palette
const FACET_COLORS = [
  '#60a5fa', // Blue
  '#4ade80', // Green
  '#fbbf24', // Yellow
  '#f87171', // Red
  '#a78bfa', // Purple
  '#fb923c', // Orange
  '#2dd4bf', // Teal
  '#f472b6', // Pink
];

const EDGE_COLORS: Record<string, string> = {
  ridge: '#16a34a',  // Green
  hip: '#7c3aed',    // Purple
  valley: '#dc2626', // Red
  eave: '#0891b2',   // Cyan
  rake: '#ea580c',   // Orange
  perimeter: '#1e40af', // Blue
};

export function CleanRoofDiagram({
  facets = [],
  linearFeatures = [],
  perimeterWkt,
  coordinates,
  totalArea,
  pitch,
  facetCount,
  className = '',
}: CleanRoofDiagramProps) {
  const canvasSize = 500;
  const padding = 40;
  const drawableSize = canvasSize - padding * 2;

  // Convert facets to pixel coordinates
  const { pixelFacets, bounds } = useMemo(() => {
    if (facets.length === 0) return { pixelFacets: [], bounds: null };

    // Find bounding box of all facets
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    facets.forEach(facet => {
      facet.points.forEach(p => {
        minLng = Math.min(minLng, p.lng);
        maxLng = Math.max(maxLng, p.lng);
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
      });
    });

    const lngRange = maxLng - minLng || 0.001;
    const latRange = maxLat - minLat || 0.001;
    
    // Scale to fit canvas with padding
    const scale = drawableSize / Math.max(lngRange, latRange);

    const pixelFacets = facets.map((facet, idx) => {
      const pixelPoints = facet.points.map(p => ({
        x: padding + (p.lng - minLng) * scale * (drawableSize / (lngRange * scale)),
        y: padding + (maxLat - p.lat) * scale * (drawableSize / (latRange * scale)),
      }));

      // Calculate centroid
      const centroidX = pixelPoints.reduce((sum, p) => sum + p.x, 0) / pixelPoints.length;
      const centroidY = pixelPoints.reduce((sum, p) => sum + p.y, 0) / pixelPoints.length;

      return {
        ...facet,
        pixelPoints,
        centroid: { x: centroidX, y: centroidY },
        color: FACET_COLORS[idx % FACET_COLORS.length],
      };
    });

    return {
      pixelFacets,
      bounds: { minLng, maxLng, minLat, maxLat, lngRange, latRange, scale },
    };
  }, [facets, drawableSize, padding]);

  // Parse linear features to pixel coordinates
  const parsedFeatures = useMemo(() => {
    if (!bounds) return [];

    return linearFeatures.map(feature => {
      const coords = parseWKTToGPS(feature.wkt);
      const pixelCoords = coords.map(c => ({
        x: padding + (c.lng - bounds.minLng) / bounds.lngRange * drawableSize,
        y: padding + (bounds.maxLat - c.lat) / bounds.latRange * drawableSize,
      }));
      return { ...feature, pixelCoords };
    });
  }, [linearFeatures, bounds, drawableSize, padding]);

  // Calculate linear totals for legend
  const linearTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    linearFeatures.forEach(f => {
      totals[f.type] = (totals[f.type] || 0) + f.lengthFt;
    });
    return totals;
  }, [linearFeatures]);

  // Compass rose position
  const compassPos = { x: canvasSize - 50, y: 50 };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Professional Roof Diagram</h3>
          <p className="text-sm text-muted-foreground">
            {pixelFacets.length} facets detected • AI-generated schematic
          </p>
        </div>
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
          Clean View
        </Badge>
      </div>

      {/* Canvas */}
      <div className="border rounded-lg overflow-hidden bg-slate-50">
        <Stage width={canvasSize} height={canvasSize}>
          <Layer>
            {/* Background */}
            <Rect x={0} y={0} width={canvasSize} height={canvasSize} fill="#f8fafc" />

            {/* Facets as filled polygons */}
            {pixelFacets.map((facet, idx) => (
              <Group key={`facet-${idx}`}>
                {/* Filled facet */}
                <Line
                  points={facet.pixelPoints.flatMap(p => [p.x, p.y])}
                  closed
                  fill={facet.color}
                  stroke="#1e40af"
                  strokeWidth={2}
                  opacity={0.7}
                />
                
                {/* Facet number */}
                <Circle
                  x={facet.centroid.x}
                  y={facet.centroid.y}
                  radius={14}
                  fill="white"
                  stroke="#1e40af"
                  strokeWidth={2}
                />
                <Text
                  x={facet.centroid.x - 5}
                  y={facet.centroid.y - 6}
                  text={String(facet.facetNumber)}
                  fontSize={12}
                  fontStyle="bold"
                  fill="#1e40af"
                />

                {/* Area label below number */}
                {facet.areaEstimate && facet.areaEstimate > 50 && (
                  <Text
                    x={facet.centroid.x - 25}
                    y={facet.centroid.y + 16}
                    text={`${facet.areaEstimate.toFixed(0)} sf`}
                    fontSize={10}
                    fill="#475569"
                  />
                )}
              </Group>
            ))}

            {/* Linear features (ridges, hips, valleys) */}
            {parsedFeatures.map((feature, idx) => (
              <Group key={`feature-${feature.type}-${idx}`}>
                <Line
                  points={feature.pixelCoords.flatMap(p => [p.x, p.y])}
                  stroke={EDGE_COLORS[feature.type] || '#888'}
                  strokeWidth={feature.type === 'ridge' ? 4 : 3}
                  lineCap="round"
                  lineJoin="round"
                />
                
                {/* Measurement label at midpoint */}
                {feature.pixelCoords.length >= 2 && feature.lengthFt > 8 && (
                  <Group
                    x={(feature.pixelCoords[0].x + feature.pixelCoords[1].x) / 2}
                    y={(feature.pixelCoords[0].y + feature.pixelCoords[1].y) / 2 - 10}
                  >
                    <Rect
                      x={-18}
                      y={-8}
                      width={36}
                      height={16}
                      fill="white"
                      cornerRadius={3}
                      opacity={0.9}
                    />
                    <Text
                      x={-15}
                      y={-5}
                      text={`${feature.lengthFt.toFixed(0)}'`}
                      fontSize={10}
                      fontStyle="bold"
                      fill={EDGE_COLORS[feature.type] || '#333'}
                    />
                  </Group>
                )}
              </Group>
            ))}

            {/* Compass Rose */}
            <Group x={compassPos.x} y={compassPos.y}>
              <Circle radius={20} fill="white" stroke="#94a3b8" strokeWidth={1} />
              <Arrow
                points={[0, 8, 0, -15]}
                fill="#1e40af"
                stroke="#1e40af"
                strokeWidth={2}
              />
              <Text x={-4} y={-28} text="N" fontSize={12} fontStyle="bold" fill="#1e40af" />
            </Group>

            {/* Total Area Box */}
            {totalArea && (
              <Group x={padding} y={canvasSize - padding + 10}>
                <Rect
                  x={0}
                  y={0}
                  width={120}
                  height={24}
                  fill="#1e40af"
                  cornerRadius={4}
                />
                <Text
                  x={8}
                  y={6}
                  text={`Total: ${totalArea.toFixed(0)} sq ft`}
                  fontSize={11}
                  fontStyle="bold"
                  fill="white"
                />
              </Group>
            )}

            {/* Pitch indicator */}
            {pitch && (
              <Group x={padding + 130} y={canvasSize - padding + 10}>
                <Rect
                  x={0}
                  y={0}
                  width={70}
                  height={24}
                  fill="#16a34a"
                  cornerRadius={4}
                />
                <Text
                  x={8}
                  y={6}
                  text={`Pitch: ${pitch}`}
                  fontSize={11}
                  fontStyle="bold"
                  fill="white"
                />
              </Group>
            )}
          </Layer>
        </Stage>
      </div>

      {/* Legend */}
      <div className="p-3 bg-muted/50 rounded-lg">
        <h4 className="text-sm font-semibold mb-2">Roof Components</h4>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          {Object.entries(linearTotals).map(([type, total]) => (
            <div key={type} className="flex items-center gap-2">
              <div
                className="w-4 h-1 rounded"
                style={{ backgroundColor: EDGE_COLORS[type] || '#888' }}
              />
              <span className="capitalize">
                {type}: {total.toFixed(0)} ft
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Facet Summary Table */}
      {pixelFacets.length > 0 && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <h4 className="text-sm font-semibold mb-2">Facet Details</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {pixelFacets.map((facet, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 bg-background rounded">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: facet.color }}
                />
                <span>
                  #{facet.facetNumber}: {facet.areaEstimate?.toFixed(0) || '?'} sf
                  {facet.primaryDirection && ` (${facet.primaryDirection})`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper: Parse WKT LINESTRING to GPS coordinates
function parseWKTToGPS(wkt: string): Array<{ lng: number; lat: number }> {
  if (!wkt) return [];
  
  const match = wkt.match(/LINESTRING\s*\((.*)\)/i);
  if (!match) return [];
  
  return match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return { lng, lat };
  });
}

export default CleanRoofDiagram;
