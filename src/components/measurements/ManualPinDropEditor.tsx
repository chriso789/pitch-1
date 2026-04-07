import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MousePointer2, Trash2, Plus, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type EdgeType = 'eave' | 'rake' | 'ridge' | 'hip' | 'valley';

interface Pin {
  id: string;
  x: number; // pixel position
  y: number;
  lat: number;
  lng: number;
}

interface Edge {
  id: string;
  from: string; // pin id
  to: string;   // pin id
  type: EdgeType;
  lengthFt: number;
}

interface LinearFeature {
  id: string;
  wkt: string;
  length_ft: number;
  type: string;
}

interface ManualPinDropEditorProps {
  satelliteImageUrl: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  existingFeatures?: LinearFeature[];
  onFeaturesChange?: (features: LinearFeature[]) => void;
}

const EDGE_COLORS: Record<EdgeType, string> = {
  eave: '#006400',
  rake: '#17A2B8',
  ridge: '#90EE90',
  hip: '#9B59B6',
  valley: '#DC3545',
};

const EDGE_LABELS: Record<EdgeType, string> = {
  eave: 'Eave',
  rake: 'Rake',
  ridge: 'Ridge',
  hip: 'Hip',
  valley: 'Valley',
};

// Haversine distance in feet
function haversineFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SVG_WIDTH = 800;
const SVG_HEIGHT = 600;

const ManualPinDropEditor: React.FC<ManualPinDropEditorProps> = ({
  satelliteImageUrl,
  centerLat,
  centerLng,
  zoom,
  existingFeatures,
  onFeaturesChange,
}) => {
  const [pins, setPins] = useState<Pin[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedEdgeType, setSelectedEdgeType] = useState<EdgeType>('eave');
  const [tool, setTool] = useState<'add' | 'connect' | 'delete'>('add');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [hoveredPin, setHoveredPin] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Convert pixel to GPS
  const pixelToGps = useCallback((px: number, py: number) => {
    const metersPerPx = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
    const dx = (px - SVG_WIDTH / 2) * metersPerPx;
    const dy = (SVG_HEIGHT / 2 - py) * metersPerPx;
    const lat = centerLat + dy / 111320;
    const lng = centerLng + dx / (111320 * Math.cos(centerLat * Math.PI / 180));
    return { lat, lng };
  }, [centerLat, centerLng, zoom]);

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== 'add') return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = SVG_WIDTH / rect.width;
    const scaleY = SVG_HEIGHT / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const { lat, lng } = pixelToGps(x, y);

    const newPin: Pin = {
      id: `pin-${Date.now()}`,
      x, y, lat, lng,
    };
    setPins(prev => [...prev, newPin]);
  }, [tool, pixelToGps]);

  const handlePinClick = useCallback((pinId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tool === 'delete') {
      setPins(prev => prev.filter(p => p.id !== pinId));
      setEdges(prev => prev.filter(edge => edge.from !== pinId && edge.to !== pinId));
      return;
    }
    if (tool === 'connect') {
      if (!connectFrom) {
        setConnectFrom(pinId);
      } else if (connectFrom !== pinId) {
        const fromPin = pins.find(p => p.id === connectFrom);
        const toPin = pins.find(p => p.id === pinId);
        if (fromPin && toPin) {
          const lengthFt = haversineFt(fromPin.lat, fromPin.lng, toPin.lat, toPin.lng);
          const newEdge: Edge = {
            id: `edge-${Date.now()}`,
            from: connectFrom,
            to: pinId,
            type: selectedEdgeType,
            lengthFt,
          };
          setEdges(prev => [...prev, newEdge]);
        }
        setConnectFrom(null);
      }
    }
  }, [tool, connectFrom, pins, selectedEdgeType]);

  // Summary by type
  const edgeSummary = useMemo(() => {
    const summary: Record<EdgeType, number> = { eave: 0, rake: 0, ridge: 0, hip: 0, valley: 0 };
    edges.forEach(e => { summary[e.type] += e.lengthFt; });
    return summary;
  }, [edges]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 border rounded-md p-0.5">
          <Button
            size="sm" variant={tool === 'add' ? 'default' : 'ghost'}
            onClick={() => { setTool('add'); setConnectFrom(null); }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Point
          </Button>
          <Button
            size="sm" variant={tool === 'connect' ? 'default' : 'ghost'}
            onClick={() => { setTool('connect'); setConnectFrom(null); }}
          >
            <Link2 className="h-3.5 w-3.5 mr-1" /> Connect
          </Button>
          <Button
            size="sm" variant={tool === 'delete' ? 'destructive' : 'ghost'}
            onClick={() => { setTool('delete'); setConnectFrom(null); }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
          </Button>
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Edge type selector */}
        <div className="flex gap-1">
          {(Object.keys(EDGE_COLORS) as EdgeType[]).map(type => (
            <Button
              key={type}
              size="sm"
              variant={selectedEdgeType === type ? 'default' : 'outline'}
              className="h-7 px-2 text-xs"
              style={{
                borderColor: selectedEdgeType === type ? EDGE_COLORS[type] : undefined,
                backgroundColor: selectedEdgeType === type ? EDGE_COLORS[type] : undefined,
                color: selectedEdgeType === type ? '#fff' : undefined,
              }}
              onClick={() => setSelectedEdgeType(type)}
            >
              {EDGE_LABELS[type]}
            </Button>
          ))}
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative border rounded-lg overflow-hidden bg-muted" style={{ aspectRatio: `${SVG_WIDTH}/${SVG_HEIGHT}` }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="w-full h-full cursor-crosshair"
          onClick={handleSvgClick}
        >
          {/* Satellite background */}
          {satelliteImageUrl && (
            <image
              href={satelliteImageUrl}
              x="0" y="0"
              width={SVG_WIDTH} height={SVG_HEIGHT}
              preserveAspectRatio="xMidYMid slice"
            />
          )}

          {/* Edges */}
          {edges.map(edge => {
            const fromPin = pins.find(p => p.id === edge.from);
            const toPin = pins.find(p => p.id === edge.to);
            if (!fromPin || !toPin) return null;
            const mx = (fromPin.x + toPin.x) / 2;
            const my = (fromPin.y + toPin.y) / 2;
            return (
              <g key={edge.id}>
                <line
                  x1={fromPin.x} y1={fromPin.y}
                  x2={toPin.x} y2={toPin.y}
                  stroke={EDGE_COLORS[edge.type]}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
                {/* Length label */}
                <rect
                  x={mx - 20} y={my - 10}
                  width={40} height={18}
                  rx={3}
                  fill="rgba(0,0,0,0.75)"
                />
                <text
                  x={mx} y={my + 3}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight="bold"
                  fill="#fff"
                >
                  {Math.round(edge.lengthFt)}'
                </text>
              </g>
            );
          })}

          {/* Pins */}
          {pins.map(pin => (
            <g key={pin.id} onClick={(e) => handlePinClick(pin.id, e)}>
              <circle
                cx={pin.x} cy={pin.y} r={hoveredPin === pin.id ? 8 : 6}
                fill={connectFrom === pin.id ? '#f59e0b' : '#fff'}
                stroke={tool === 'delete' ? '#ef4444' : '#3b82f6'}
                strokeWidth={2.5}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredPin(pin.id)}
                onMouseLeave={() => setHoveredPin(null)}
              />
            </g>
          ))}
        </svg>

        {/* Instructions overlay */}
        {pins.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-background/80 backdrop-blur-sm rounded-lg px-4 py-3 text-center">
              <MousePointer2 className="h-6 w-6 mx-auto mb-1 text-muted-foreground" />
              <p className="text-sm font-medium">Click to drop pins on roof corners</p>
              <p className="text-xs text-muted-foreground">Then use Connect to draw edges</p>
            </div>
          </div>
        )}
      </div>

      {/* Edge Summary */}
      {edges.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {(Object.keys(EDGE_COLORS) as EdgeType[]).map(type => (
            <div key={type} className="text-center p-2 rounded-md bg-muted">
              <div className="flex items-center justify-center gap-1.5 mb-0.5">
                <div className="w-3 h-1 rounded-full" style={{ backgroundColor: EDGE_COLORS[type] }} />
                <span className="text-xs font-medium">{EDGE_LABELS[type]}</span>
              </div>
              <span className="text-sm font-bold">{Math.round(edgeSummary[type])} ft</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{pins.length} pins · {edges.length} edges</span>
        {connectFrom && (
          <Badge variant="secondary" className="text-xs">
            Select second point to connect
          </Badge>
        )}
      </div>
    </div>
  );
};

export default ManualPinDropEditor;
