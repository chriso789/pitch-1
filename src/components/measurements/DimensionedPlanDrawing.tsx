import { useMemo } from 'react';

export type EdgeType = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';

export interface PlanEdge {
  id: string;
  type: EdgeType;
  // World/plan coordinates in feet (relative)
  p1: [number, number];
  p2: [number, number];
  length_ft: number;
  confirmed?: boolean;
}

interface DimensionedPlanDrawingProps {
  edges: PlanEdge[];
  width?: number;
  height?: number;
  showOverallDims?: boolean;
  highlightEdgeId?: string;
}

const EDGE_STYLES: Record<EdgeType, { stroke: string; dash?: string; label: string }> = {
  ridge:  { stroke: 'hsl(var(--destructive))', label: 'Ridge' },
  hip:    { stroke: 'hsl(var(--warning))', label: 'Hip' },
  valley: { stroke: 'hsl(var(--primary))', dash: '4,3', label: 'Valley' },
  eave:   { stroke: 'hsl(var(--foreground))', label: 'Eave' },
  rake:   { stroke: 'hsl(var(--muted-foreground))', dash: '6,3', label: 'Rake' },
};

export function DimensionedPlanDrawing({
  edges,
  width = 720,
  height = 520,
  showOverallDims = true,
  highlightEdgeId,
}: DimensionedPlanDrawingProps) {
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
      <svg width={width} height={height} className="w-full h-auto">
        {/* Grid background */}
        <defs>
          <pattern id="plan-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="hsl(var(--muted))" strokeWidth="0.5" opacity="0.4" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#plan-grid)" />

        {/* Title block */}
        <text x={20} y={28} className="fill-foreground" fontSize="13" fontWeight="600">
          ROOF PLAN — DIMENSIONED
        </text>
        <text x={20} y={44} className="fill-muted-foreground" fontSize="10">
          All measurements in linear feet
        </text>

        {/* Edges */}
        {edges.map(edge => {
          const [x1, y1] = transform(edge.p1);
          const [x2, y2] = transform(edge.p2);
          const style = EDGE_STYLES[edge.type];
          const isHighlight = edge.id === highlightEdgeId;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          // Perpendicular offset for label
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const offsetDist = 14;
          const ox = (-dy / len) * offsetDist;
          const oy = (dx / len) * offsetDist;
          let angle = Math.atan2(dy, dx) * (180 / Math.PI);
          if (angle > 90 || angle < -90) angle += 180;

          return (
            <g key={edge.id}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={style.stroke}
                strokeWidth={isHighlight ? 4 : 2.5}
                strokeDasharray={style.dash}
                opacity={edge.confirmed === false ? 0.4 : 1}
              />
              {/* Length label */}
              <g transform={`translate(${midX + ox}, ${midY + oy}) rotate(${angle})`}>
                <rect x={-22} y={-9} width={44} height={14} rx={2} fill="hsl(var(--background))" opacity={0.92} />
                <text textAnchor="middle" fontSize="10" className="fill-foreground" fontWeight="500" y={2}>
                  {edge.length_ft.toFixed(1)}'
                </text>
              </g>
            </g>
          );
        })}

        {/* Overall dimensions */}
        {showOverallDims && (bounds as any).scale && (
          <g>
            {/* Horizontal overall */}
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
            {/* Vertical overall */}
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
        <g transform={`translate(20, ${height - 80})`}>
          {(Object.keys(EDGE_STYLES) as EdgeType[]).map((t, i) => {
            const s = EDGE_STYLES[t];
            return (
              <g key={t} transform={`translate(0, ${i * 12})`}>
                <line x1={0} y1={0} x2={18} y2={0} stroke={s.stroke} strokeWidth={2.5} strokeDasharray={s.dash} />
                <text x={24} y={3} fontSize="9" className="fill-muted-foreground">{s.label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
