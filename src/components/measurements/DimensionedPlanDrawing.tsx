import { useMemo } from 'react';

export type EdgeType = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';

export interface PlanEdge {
  id: string;
  type: EdgeType;
  // World/plan coordinates in feet (relative). Derived from geo when available.
  p1: [number, number];
  p2: [number, number];
  length_ft: number;
  confirmed?: boolean;
  // Optional geographic coordinates (lng, lat) used for overlaying on aerial imagery
  geo_p1?: [number, number];
  geo_p2?: [number, number];
}

export interface AerialBackground {
  /** Image URL or data URI */
  imageUrl: string;
  /** Pixel size of the source image */
  imageWidth: number;
  imageHeight: number;
  /** Geographic bounds the image covers: [west, south, east, north] in lng/lat */
  bounds: [number, number, number, number];
}

interface DimensionedPlanDrawingProps {
  edges: PlanEdge[];
  width?: number;
  height?: number;
  showOverallDims?: boolean;
  highlightEdgeId?: string;
  /** Optional aerial photo to render behind the traced edges */
  aerial?: AerialBackground | null;
  /** Optional footprint polygon in geo coords (lng, lat) for outline */
  footprintGeo?: Array<[number, number]>;
}

const EDGE_STYLES: Record<EdgeType, { stroke: string; dash?: string; label: string }> = {
  ridge:  { stroke: '#ef4444', label: 'Ridge' },
  hip:    { stroke: '#f59e0b', label: 'Hip' },
  valley: { stroke: '#3b82f6', dash: '4,3', label: 'Valley' },
  eave:   { stroke: '#10b981', label: 'Eave' },
  rake:   { stroke: '#a855f7', dash: '6,3', label: 'Rake' },
};

export function DimensionedPlanDrawing({
  edges,
  width = 720,
  height = 520,
  showOverallDims = true,
  highlightEdgeId,
  aerial = null,
  footprintGeo,
}: DimensionedPlanDrawingProps) {
  // ============== AERIAL MODE ==============
  // When we have a satellite image + geo edges, render the image and project
  // edges from geo coordinates straight to image pixels.
  const aerialMode = !!(aerial && edges.some(e => e.geo_p1 && e.geo_p2));

  const aerialProjection = useMemo(() => {
    if (!aerial) return null;
    const [west, south, east, north] = aerial.bounds;
    const lngRange = east - west || 1e-9;
    const latRange = north - south || 1e-9;
    return (lng: number, lat: number): [number, number] => [
      ((lng - west) / lngRange) * width,
      ((north - lat) / latRange) * height,
    ];
  }, [aerial, width, height]);

  const { transform, bounds } = useMemo(() => {
    if (edges.length === 0) {
      return { transform: (p: [number, number]) => p, bounds: { w: 0, h: 0, minX: 0, minY: 0 } };
    }
    const xs = edges.flatMap(e => [e.p1[0], e.p2[0]]);
    const ys = edges.flatMap(e => [e.p1[1], e.p2[1]]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);

    const padding = 80;
    const availW = width - padding * 2;
    const availH = height - padding * 2;
    const scale = Math.min(availW / w, availH / h);

    const offsetX = padding + (availW - w * scale) / 2;
    const offsetY = padding + (availH - h * scale) / 2;

    return {
      transform: (p: [number, number]): [number, number] => [
        offsetX + (p[0] - minX) * scale,
        offsetY + (p[1] - minY) * scale,
      ],
      bounds: { w, h, minX, minY, scale, offsetX, offsetY, maxX, maxY } as any,
    };
  }, [edges, width, height]);

  if (edges.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 border border-dashed rounded-md text-muted-foreground text-sm">
        No edges to draw
      </div>
    );
  }

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <svg width={width} height={height} className="w-full h-auto" viewBox={`0 0 ${width} ${height}`}>
        {/* Aerial background (when available) */}
        {aerialMode && aerial && (
          <image
            href={aerial.imageUrl}
            x={0}
            y={0}
            width={width}
            height={height}
            preserveAspectRatio="xMidYMid slice"
          />
        )}

        {/* Grid background (only when no aerial) */}
        {!aerialMode && (
          <>
            <defs>
              <pattern id="plan-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="hsl(var(--muted))" strokeWidth="0.5" opacity="0.4" />
              </pattern>
            </defs>
            <rect width={width} height={height} fill="url(#plan-grid)" />
          </>
        )}

        {/* Title block */}
        <g>
          <rect x={8} y={8} width={aerialMode ? 320 : 260} height={36} rx={4} fill="rgba(0,0,0,0.55)" />
          <text x={20} y={26} fill="#fff" fontSize="12" fontWeight="700">
            {aerialMode ? 'AERIAL TRACE — DIMENSIONED' : 'ROOF PLAN — DIMENSIONED'}
          </text>
          <text x={20} y={40} fill="#e5e7eb" fontSize="10">
            All measurements in linear feet
          </text>
        </g>

        {/* Footprint outline (aerial mode) */}
        {aerialMode && aerialProjection && footprintGeo && footprintGeo.length >= 3 && (
          <polygon
            points={footprintGeo.map(([lng, lat]) => aerialProjection(lng, lat).join(',')).join(' ')}
            fill="rgba(255,255,0,0.08)"
            stroke="#fde047"
            strokeWidth={1.5}
            strokeDasharray="3,3"
          />
        )}

        {/* Edges */}
        {edges.map(edge => {
          let x1: number, y1: number, x2: number, y2: number;
          if (aerialMode && aerialProjection && edge.geo_p1 && edge.geo_p2) {
            [x1, y1] = aerialProjection(edge.geo_p1[0], edge.geo_p1[1]);
            [x2, y2] = aerialProjection(edge.geo_p2[0], edge.geo_p2[1]);
          } else {
            [x1, y1] = transform(edge.p1);
            [x2, y2] = transform(edge.p2);
          }
          const style = EDGE_STYLES[edge.type];
          const isHighlight = edge.id === highlightEdgeId;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          // Perpendicular offset for label
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const offsetDist = 16;
          const ox = (-dy / len) * offsetDist;
          const oy = (dx / len) * offsetDist;
          let angle = Math.atan2(dy, dx) * (180 / Math.PI);
          if (angle > 90 || angle < -90) angle += 180;

          return (
            <g key={edge.id}>
              {/* Halo for visibility on imagery */}
              {aerialMode && (
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="rgba(0,0,0,0.85)"
                  strokeWidth={isHighlight ? 7 : 5}
                  strokeLinecap="round"
                />
              )}
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={style.stroke}
                strokeWidth={isHighlight ? 4.5 : 3}
                strokeDasharray={style.dash}
                strokeLinecap="round"
                opacity={edge.confirmed === false ? 0.75 : 1}
              />
              {/* Length label */}
              <g transform={`translate(${midX + ox}, ${midY + oy}) rotate(${angle})`}>
                <rect x={-26} y={-10} width={52} height={16} rx={3} fill="rgba(0,0,0,0.75)" />
                <text textAnchor="middle" fontSize="11" fill="#fff" fontWeight="600" y={3}>
                  {edge.length_ft.toFixed(1)}'
                </text>
              </g>
              {/* Endpoint dots in aerial mode */}
              {aerialMode && (
                <>
                  <circle cx={x1} cy={y1} r={3} fill={style.stroke} stroke="#000" strokeWidth={1} />
                  <circle cx={x2} cy={y2} r={3} fill={style.stroke} stroke="#000" strokeWidth={1} />
                </>
              )}
            </g>
          );
        })}

        {/* Overall dimensions (plan-only mode) */}
        {!aerialMode && showOverallDims && (bounds as any).scale && (
          <g>
            <line
              x1={(bounds as any).offsetX}
              y1={height - 30}
              x2={(bounds as any).offsetX + (bounds as any).w * (bounds as any).scale}
              y2={height - 30}
              stroke="hsl(var(--foreground))"
              strokeWidth={1}
            />
            <text
              x={(bounds as any).offsetX + ((bounds as any).w * (bounds as any).scale) / 2}
              y={height - 15}
              textAnchor="middle"
              fontSize="11"
              className="fill-foreground"
              fontWeight="600"
            >
              {(bounds as any).w.toFixed(1)} ft overall
            </text>
            <line
              x1={width - 30}
              y1={(bounds as any).offsetY}
              x2={width - 30}
              y2={(bounds as any).offsetY + (bounds as any).h * (bounds as any).scale}
              stroke="hsl(var(--foreground))"
              strokeWidth={1}
            />
            <text
              x={width - 18}
              y={(bounds as any).offsetY + ((bounds as any).h * (bounds as any).scale) / 2}
              textAnchor="middle"
              fontSize="11"
              className="fill-foreground"
              fontWeight="600"
              transform={`rotate(90, ${width - 18}, ${(bounds as any).offsetY + ((bounds as any).h * (bounds as any).scale) / 2})`}
            >
              {(bounds as any).h.toFixed(1)} ft overall
            </text>
          </g>
        )}

        {/* Legend */}
        <g transform={`translate(12, ${height - 80})`}>
          <rect x={-4} y={-12} width={108} height={74} rx={4} fill="rgba(0,0,0,0.6)" />
          {(Object.keys(EDGE_STYLES) as EdgeType[]).map((t, i) => {
            const s = EDGE_STYLES[t];
            return (
              <g key={t} transform={`translate(4, ${i * 13})`}>
                <line x1={0} y1={0} x2={20} y2={0} stroke={s.stroke} strokeWidth={3} strokeDasharray={s.dash} />
                <text x={26} y={3} fontSize="10" fill="#fff">{s.label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
