import React, { useMemo, useState } from 'react';
import { Stage, Layer, Line, Circle, Text, Group, Rect, Arrow } from 'react-konva';
import { Badge } from '@/components/ui/badge';
import { Toggle } from '@/components/ui/toggle';
import { Layers, Grid3X3 } from 'lucide-react';

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

// Roofr-style color palette - matches professional reports
const EDGE_COLORS: Record<string, string> = {
  ridge: '#16a34a',  // Green (same as eaves in Roofr)
  hip: '#7c3aed',    // Purple
  valley: '#dc2626', // Red
  eave: '#16a34a',   // Green
  rake: '#f97316',   // Orange
  perimeter: '#16a34a', // Green default
};

const FACET_COLORS = [
  'rgba(59, 130, 246, 0.25)',   // Blue
  'rgba(34, 197, 94, 0.25)',    // Green
  'rgba(251, 191, 36, 0.25)',   // Yellow
  'rgba(239, 68, 68, 0.25)',    // Red
  'rgba(139, 92, 246, 0.25)',   // Purple
  'rgba(236, 72, 153, 0.25)',   // Pink
];

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
  const [showFacets, setShowFacets] = useState(false); // Default to edge-only view like Roofr
  const canvasSize = 500;
  const padding = 50;
  const drawableSize = canvasSize - padding * 2;

  // Convert facets to pixel coordinates
  const { pixelFacets, bounds } = useMemo(() => {
    if (facets.length === 0) return { pixelFacets: [], bounds: null };

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
    const scale = drawableSize / Math.max(lngRange, latRange);

    const pixelFacets = facets.map((facet, idx) => {
      const pixelPoints = facet.points.map(p => ({
        x: padding + (p.lng - minLng) * scale * (drawableSize / (lngRange * scale)),
        y: padding + (maxLat - p.lat) * scale * (drawableSize / (latRange * scale)),
      }));

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

  // Parse linear features to pixel coordinates with per-segment data
  const parsedFeatures = useMemo(() => {
    if (!bounds) return [];

    return linearFeatures.map(feature => {
      const coords = parseWKTToGPS(feature.wkt);
      const pixelCoords = coords.map(c => ({
        x: padding + (c.lng - bounds.minLng) / bounds.lngRange * drawableSize,
        y: padding + (bounds.maxLat - c.lat) / bounds.latRange * drawableSize,
      }));
      
      // Calculate midpoint for label placement
      let midX = 0, midY = 0;
      if (pixelCoords.length >= 2) {
        midX = (pixelCoords[0].x + pixelCoords[pixelCoords.length - 1].x) / 2;
        midY = (pixelCoords[0].y + pixelCoords[pixelCoords.length - 1].y) / 2;
      }
      
      // Calculate angle for label rotation
      let angle = 0;
      if (pixelCoords.length >= 2) {
        const dx = pixelCoords[1].x - pixelCoords[0].x;
        const dy = pixelCoords[1].y - pixelCoords[0].y;
        angle = Math.atan2(dy, dx) * 180 / Math.PI;
        // Keep text readable (not upside down)
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
      }
      
      return { ...feature, pixelCoords, midX, midY, angle };
    });
  }, [linearFeatures, bounds, drawableSize, padding]);

  // Calculate linear totals by type for summary
  const linearTotals = useMemo(() => {
    const totals: Record<string, { count: number; totalFt: number }> = {};
    linearFeatures.forEach(f => {
      if (!totals[f.type]) totals[f.type] = { count: 0, totalFt: 0 };
      totals[f.type].count++;
      totals[f.type].totalFt += f.lengthFt;
    });
    return totals;
  }, [linearFeatures]);

  // Format length as feet and inches like Roofr
  const formatLength = (ft: number): string => {
    if (ft < 10) return `${ft.toFixed(0)}'`;
    const wholeFeet = Math.floor(ft);
    const inches = Math.round((ft - wholeFeet) * 12);
    if (inches === 0 || inches === 12) return `${wholeFeet}'`;
    return `${wholeFeet}'`;
  };

  // Format total length as feet and inches like Roofr (195' 2")
  const formatTotalLength = (ft: number): string => {
    const wholeFeet = Math.floor(ft);
    const inches = Math.round((ft - wholeFeet) * 12);
    if (inches === 0 || inches === 12) return `${wholeFeet}'`;
    return `${wholeFeet}' ${inches}"`;
  };

  const compassPos = { x: canvasSize - 40, y: 40 };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header with view toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Roof Measurement Diagram</h3>
          <p className="text-sm text-muted-foreground">
            {facets.length > 0 ? `${facets.length} facets` : 'Edge measurements'} • AI-analyzed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Toggle
            size="sm"
            pressed={showFacets}
            onPressedChange={setShowFacets}
            className="gap-1"
          >
            {showFacets ? <Layers className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
            {showFacets ? 'Facets' : 'Edges'}
          </Toggle>
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            Professional View
          </Badge>
        </div>
      </div>

      {/* Canvas - Roofr-style edge diagram */}
      <div className="border-2 border-muted rounded-lg overflow-hidden bg-white">
        <Stage width={canvasSize} height={canvasSize}>
          <Layer>
            {/* White background */}
            <Rect x={0} y={0} width={canvasSize} height={canvasSize} fill="#ffffff" />

            {/* Optional: Facet polygons (toggled off by default for Roofr style) */}
            {showFacets && pixelFacets.map((facet, idx) => (
              <Group key={`facet-${idx}`}>
                <Line
                  points={facet.pixelPoints.flatMap(p => [p.x, p.y])}
                  closed
                  fill={facet.color}
                  stroke={EDGE_COLORS.perimeter}
                  strokeWidth={2}
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
              </Group>
            ))}

            {/* LINEAR FEATURES - Roofr style with per-segment measurements */}
            {parsedFeatures.map((feature, idx) => {
              const color = EDGE_COLORS[feature.type] || '#888';
              const strokeWidth = feature.type === 'ridge' ? 4 : feature.type === 'hip' || feature.type === 'valley' ? 3 : 2;
              
              return (
                <Group key={`feature-${feature.type}-${idx}`}>
                  {/* The line itself */}
                  <Line
                    points={feature.pixelCoords.flatMap(p => [p.x, p.y])}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    lineCap="round"
                    lineJoin="round"
                  />
                  
                  {/* Per-segment measurement label */}
                  {feature.lengthFt >= 5 && feature.pixelCoords.length >= 2 && (
                    <Group x={feature.midX} y={feature.midY}>
                      {/* White background for readability */}
                      <Rect
                        x={-22}
                        y={-12}
                        width={44}
                        height={18}
                        fill="white"
                        cornerRadius={3}
                        stroke={color}
                        strokeWidth={1}
                        opacity={0.95}
                      />
                      {/* Measurement text */}
                      <Text
                        x={-19}
                        y={-8}
                        text={formatLength(feature.lengthFt)}
                        fontSize={11}
                        fontStyle="bold"
                        fill={color}
                        align="center"
                        width={38}
                      />
                    </Group>
                  )}
                </Group>
              );
            })}

            {/* Compass Rose */}
            <Group x={compassPos.x} y={compassPos.y}>
              <Circle radius={18} fill="white" stroke="#94a3b8" strokeWidth={1} />
              <Arrow
                points={[0, 6, 0, -12]}
                fill="#1e40af"
                stroke="#1e40af"
                strokeWidth={2}
              />
              <Text x={-4} y={-26} text="N" fontSize={11} fontStyle="bold" fill="#1e40af" />
            </Group>

            {/* Total Area Box - Bottom left */}
            {totalArea && (
              <Group x={padding} y={canvasSize - 30}>
                <Rect
                  x={0}
                  y={0}
                  width={130}
                  height={22}
                  fill="#1e40af"
                  cornerRadius={4}
                />
                <Text
                  x={8}
                  y={5}
                  text={`Total: ${totalArea.toLocaleString()} sq ft`}
                  fontSize={11}
                  fontStyle="bold"
                  fill="white"
                />
              </Group>
            )}

            {/* Pitch indicator - Next to total */}
            {pitch && (
              <Group x={padding + 140} y={canvasSize - 30}>
                <Rect
                  x={0}
                  y={0}
                  width={80}
                  height={22}
                  fill="#16a34a"
                  cornerRadius={4}
                />
                <Text
                  x={8}
                  y={5}
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

      {/* Linear Measurements Summary - Roofr style */}
      <div className="p-4 bg-muted/30 rounded-lg border">
        <h4 className="text-sm font-semibold mb-3">Linear Measurements</h4>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Object.entries(linearTotals).map(([type, data]) => (
            <div key={type} className="flex items-center gap-2 p-2 bg-background rounded-md">
              <div
                className="w-5 h-1.5 rounded-full"
                style={{ backgroundColor: EDGE_COLORS[type] || '#888' }}
              />
              <div className="text-sm">
                <span className="capitalize font-medium">{type}</span>
                <span className="text-muted-foreground ml-1">
                  {formatTotalLength(data.totalFt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Facet Details - Only show when facets toggle is on */}
      {showFacets && pixelFacets.length > 0 && (
        <div className="p-4 bg-muted/30 rounded-lg border">
          <h4 className="text-sm font-semibold mb-3">Facet Details</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {pixelFacets.map((facet, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 bg-background rounded-md text-sm">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: facet.color.replace('0.25', '0.6') }}
                />
                <span>
                  #{facet.facetNumber}: {facet.areaEstimate?.toLocaleString() || '?'} sf
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend - Matches Roofr report style */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground px-1">
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.eave }} />
          <span>Eaves/Ridges</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.hip }} />
          <span>Hips</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.valley }} />
          <span>Valleys</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.rake }} />
          <span>Rakes</span>
        </div>
      </div>
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
