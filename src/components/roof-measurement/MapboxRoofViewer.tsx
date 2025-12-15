import React, { useState, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Text, Group, Circle } from 'react-konva';
import useImage from 'use-image';

interface Facet {
  facetNumber: number;
  polygon: Array<{ lat: number; lng: number }>;
  pitch: string;
  adjustedAreaSqft: number;
  orientation: string;
}

interface EdgeSegment {
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  lengthFeet: number;
  facetsConnected?: number[];
}

interface Edges {
  ridge: { segments: EdgeSegment[]; totalFeet: number };
  hip: { segments: EdgeSegment[]; totalFeet: number };
  valley: { segments: EdgeSegment[]; totalFeet: number };
  eave: { segments: EdgeSegment[]; totalFeet: number };
  rake: { segments: EdgeSegment[]; totalFeet: number };
}

interface RoofAnalysis {
  facets: Facet[];
  edges: Edges;
}

interface Bounds {
  topLeft: { lat: number; lng: number };
  topRight: { lat: number; lng: number };
  bottomLeft: { lat: number; lng: number };
  bottomRight: { lat: number; lng: number };
}

interface MapboxRoofViewerProps {
  imageUrl: string;
  analysis: RoofAnalysis;
  bounds: Bounds;
  dimensions: { width: number; height: number };
  onFacetClick?: (facetNumber: number) => void;
}

const EDGE_COLORS: Record<string, string> = {
  ridge: '#ef4444',   // Red
  hip: '#f97316',     // Orange
  valley: '#3b82f6',  // Blue
  eave: '#22c55e',    // Green
  rake: '#a855f7',    // Purple
};

const FACET_COLORS = [
  'rgba(59, 130, 246, 0.3)',   // Blue
  'rgba(34, 197, 94, 0.3)',    // Green
  'rgba(249, 115, 22, 0.3)',   // Orange
  'rgba(168, 85, 247, 0.3)',   // Purple
  'rgba(236, 72, 153, 0.3)',   // Pink
  'rgba(20, 184, 166, 0.3)',   // Teal
  'rgba(234, 179, 8, 0.3)',    // Yellow
  'rgba(239, 68, 68, 0.3)',    // Red
];

export function MapboxRoofViewer({ 
  imageUrl, 
  analysis, 
  bounds, 
  dimensions,
  onFacetClick 
}: MapboxRoofViewerProps) {
  const [image] = useImage(imageUrl);
  const [selectedFacet, setSelectedFacet] = useState<number | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [showFacets, setShowFacets] = useState(true);
  const [hoveredFacet, setHoveredFacet] = useState<number | null>(null);

  // Convert GPS to pixel coordinates
  const gpsToPixel = useMemo(() => {
    if (!bounds) return (gps: { lat: number; lng: number }) => ({ x: 0, y: 0 });
    
    const { topLeft, bottomRight } = bounds;
    const latRange = topLeft.lat - bottomRight.lat;
    const lngRange = bottomRight.lng - topLeft.lng;
    
    return (gps: { lat: number; lng: number }) => {
      const x = ((gps.lng - topLeft.lng) / lngRange) * dimensions.width;
      const y = ((topLeft.lat - gps.lat) / latRange) * dimensions.height;
      return { x, y };
    };
  }, [bounds, dimensions]);

  // Calculate facet centroids for labels
  const facetCentroids = useMemo(() => {
    return (analysis.facets || []).map(facet => {
      if (!facet.polygon || facet.polygon.length === 0) return { x: 0, y: 0 };
      
      const points = facet.polygon.map(gpsToPixel);
      const centroidX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const centroidY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      
      return { x: centroidX, y: centroidY };
    });
  }, [analysis.facets, gpsToPixel]);

  const handleFacetClick = (facetNumber: number) => {
    setSelectedFacet(facetNumber === selectedFacet ? null : facetNumber);
    onFacetClick?.(facetNumber);
  };

  // Render roof facets
  const renderFacets = () => {
    if (!showFacets) return null;
    
    return (analysis.facets || []).map((facet, idx) => {
      if (!facet.polygon || facet.polygon.length === 0) return null;
      
      const points = facet.polygon.flatMap(p => {
        const pixel = gpsToPixel(p);
        return [pixel.x, pixel.y];
      });
      
      const isSelected = selectedFacet === facet.facetNumber;
      const isHovered = hoveredFacet === facet.facetNumber;
      const color = FACET_COLORS[idx % FACET_COLORS.length];
      
      return (
        <Group key={`facet-${idx}`}>
          <Line
            points={points}
            closed
            stroke={isSelected ? '#00ff00' : isHovered ? '#ffffff' : '#0099ff'}
            strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
            fill={isSelected ? 'rgba(0, 255, 0, 0.3)' : color}
            onClick={() => handleFacetClick(facet.facetNumber)}
            onTap={() => handleFacetClick(facet.facetNumber)}
            onMouseEnter={() => setHoveredFacet(facet.facetNumber)}
            onMouseLeave={() => setHoveredFacet(null)}
            style={{ cursor: 'pointer' }}
          />
          
          {showLabels && (
            <Group x={facetCentroids[idx]?.x - 30} y={facetCentroids[idx]?.y - 20}>
              <Text
                text={`#${facet.facetNumber}`}
                fontSize={12}
                fontStyle="bold"
                fill="white"
                stroke="black"
                strokeWidth={0.5}
              />
              <Text
                y={14}
                text={`${facet.adjustedAreaSqft?.toFixed(0) || '?'} sqft`}
                fontSize={10}
                fill="white"
                stroke="black"
                strokeWidth={0.3}
              />
              <Text
                y={26}
                text={facet.pitch || '?/12'}
                fontSize={10}
                fill="yellow"
                stroke="black"
                strokeWidth={0.3}
              />
            </Group>
          )}
        </Group>
      );
    });
  };

  // Render edge lines
  const renderEdges = () => {
    if (!showEdges || !analysis.edges) return null;
    
    const edgeTypes: (keyof Edges)[] = ['ridge', 'hip', 'valley', 'eave', 'rake'];
    
    return edgeTypes.flatMap(type => {
      const edgeData = analysis.edges[type];
      if (!edgeData?.segments) return [];
      
      return edgeData.segments.map((segment, idx) => {
        if (!segment.start || !segment.end) return null;
        
        const start = gpsToPixel(segment.start);
        const end = gpsToPixel(segment.end);
        const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        
        return (
          <Group key={`${type}-${idx}`}>
            <Line
              points={[start.x, start.y, end.x, end.y]}
              stroke={EDGE_COLORS[type]}
              strokeWidth={type === 'ridge' ? 4 : 3}
              dash={type === 'ridge' ? [10, 5] : undefined}
              lineCap="round"
            />
            {/* Start point */}
            <Circle
              x={start.x}
              y={start.y}
              radius={4}
              fill={EDGE_COLORS[type]}
              stroke="white"
              strokeWidth={1}
            />
            {/* End point */}
            <Circle
              x={end.x}
              y={end.y}
              radius={4}
              fill={EDGE_COLORS[type]}
              stroke="white"
              strokeWidth={1}
            />
            {/* Length label */}
            {showLabels && segment.lengthFeet > 5 && (
              <Group x={midpoint.x - 15} y={midpoint.y - 8}>
                <Text
                  text={`${segment.lengthFeet.toFixed(0)}'`}
                  fontSize={10}
                  fontStyle="bold"
                  fill="white"
                  stroke="black"
                  strokeWidth={0.5}
                  padding={2}
                />
              </Group>
            )}
          </Group>
        );
      });
    });
  };

  return (
    <div className="mapbox-roof-viewer">
      {/* Controls */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setShowLabels(!showLabels)}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            showLabels 
              ? 'bg-primary text-primary-foreground' 
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {showLabels ? 'Hide' : 'Show'} Labels
        </button>
        <button
          onClick={() => setShowEdges(!showEdges)}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            showEdges 
              ? 'bg-primary text-primary-foreground' 
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {showEdges ? 'Hide' : 'Show'} Edges
        </button>
        <button
          onClick={() => setShowFacets(!showFacets)}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            showFacets 
              ? 'bg-primary text-primary-foreground' 
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {showFacets ? 'Hide' : 'Show'} Facets
        </button>
        {selectedFacet && (
          <button
            onClick={() => setSelectedFacet(null)}
            className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground"
          >
            Clear Selection
          </button>
        )}
      </div>

      {/* Canvas */}
      <div className="border rounded-lg overflow-hidden bg-muted">
        <Stage width={dimensions.width} height={dimensions.height}>
          <Layer>
            {/* Satellite image */}
            {image && <KonvaImage image={image} width={dimensions.width} height={dimensions.height} />}
            
            {/* Roof analysis overlay */}
            {renderFacets()}
            {renderEdges()}
          </Layer>
        </Stage>
      </div>

      {/* Selected Facet Details */}
      {selectedFacet && (
        <div className="mt-4 p-4 bg-accent rounded-lg border">
          <h3 className="font-semibold text-lg mb-2">Facet #{selectedFacet}</h3>
          {(() => {
            const facet = (analysis.facets || []).find(f => f.facetNumber === selectedFacet);
            return facet ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Area:</span> <span className="font-medium">{facet.adjustedAreaSqft?.toFixed(0)} sqft</span></div>
                <div><span className="text-muted-foreground">Pitch:</span> <span className="font-medium">{facet.pitch}</span></div>
                <div><span className="text-muted-foreground">Orientation:</span> <span className="font-medium">{facet.orientation}</span></div>
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* Edge Legend */}
      <div className="mt-4 p-4 bg-muted/50 rounded-lg">
        <h4 className="font-semibold text-sm mb-2">Edge Types</h4>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.ridge }} />
            <span>Ridge ({analysis.edges?.ridge?.totalFeet?.toFixed(0) || 0} ft)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.hip }} />
            <span>Hip ({analysis.edges?.hip?.totalFeet?.toFixed(0) || 0} ft)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.valley }} />
            <span>Valley ({analysis.edges?.valley?.totalFeet?.toFixed(0) || 0} ft)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.eave }} />
            <span>Eave ({analysis.edges?.eave?.totalFeet?.toFixed(0) || 0} ft)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 rounded" style={{ backgroundColor: EDGE_COLORS.rake }} />
            <span>Rake ({analysis.edges?.rake?.totalFeet?.toFixed(0) || 0} ft)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
