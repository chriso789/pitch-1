import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  computeOverlayTransform,
  transformOverlayPoint,
  type OverlayBBox,
  type OverlayCalibration,
} from '@/lib/measurements/overlayTransform';

/**
 * Dev-only debug view that overlays measured planes & edges on top of the
 * actual satellite raster used for analysis. Use it to catch frame mismatch
 * (planes drawn off the building) and @2x calibration errors (planes drawn
 * at half/double size).
 *
 * Coordinates expected:
 *   - planes_px:  Array<{ polygon: [x,y][] }> in raster pixel space
 *   - edges_px:   Array<{ type, p1:[x,y], p2:[x,y] }> in raster pixel space
 *   - imageUrl:   URL of the raster the pixels were measured against
 *   - rasterSize: { width, height } the pixels are calibrated to
 */
type Pt = [number, number];
type PlanePx = { polygon: Pt[] };
type EdgePx = { type: string; p1: Pt; p2: Pt };

const EDGE_COLORS: Record<string, string> = {
  ridge: '#ef4444',
  hip: '#f97316',
  valley: '#3b82f6',
  eave: '#22c55e',
  rake: '#a855f7',
};

export function RasterOverlayDebugView({
  imageUrl,
  rasterSize,
  planes_px,
  edges_px,
  footprint_px = [],
  overlayCalibration,
  roofTargetBboxPx,
  geometryPxSpace,
}: {
  imageUrl: string | null | undefined;
  rasterSize: { width: number; height: number } | null | undefined;
  planes_px: PlanePx[];
  edges_px: EdgePx[];
  footprint_px?: Pt[];
  overlayCalibration?: OverlayCalibration | null;
  roofTargetBboxPx?: Partial<OverlayBBox> | null;
  geometryPxSpace?: string | null;
}) {
  const [showPlanes, setShowPlanes] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [showFootprint, setShowFootprint] = useState(true);
  const [showRaster, setShowRaster] = useState(true);

  const viewBox = useMemo(() => {
    const w = rasterSize?.width || 1024;
    const h = rasterSize?.height || 1024;
    return `0 0 ${w} ${h}`;
  }, [rasterSize]);

  const calibration = useMemo(() => {
    if (!rasterSize) return null;
    if (geometryPxSpace === 'raster_calibrated') return null;
    if (overlayCalibration?.calibrated) return overlayCalibration;
    const geometryPoints = [
      ...planes_px.flatMap((p) => (p.polygon || []).map(([x, y]) => ({ x, y }))),
      ...edges_px.flatMap((e) => [
        { x: e.p1[0], y: e.p1[1] },
        { x: e.p2[0], y: e.p2[1] },
      ]),
        ...footprint_px.map(([x, y]) => ({ x, y })),
    ];
    return computeOverlayTransform({
      rasterSize,
      geometryPoints,
      roofTargetBboxPx: roofTargetBboxPx || null,
    });
  }, [edges_px, footprint_px, geometryPxSpace, overlayCalibration, planes_px, rasterSize, roofTargetBboxPx]);

  const targetBbox = calibration?.roof_target_bbox_px || roofTargetBboxPx || null;

  const displayPlanes = useMemo(() => {
    if (!calibration?.calibrated) return planes_px;
    return planes_px.map((p) => ({
      ...p,
      polygon: (p.polygon || []).map(([x, y]) => {
        const out = transformOverlayPoint({ x, y }, calibration);
        return [out.x, out.y] as Pt;
      }),
    }));
  }, [calibration, planes_px]);

  const displayEdges = useMemo(() => {
    if (!calibration?.calibrated) return edges_px;
    return edges_px.map((e) => {
      const p1 = transformOverlayPoint({ x: e.p1[0], y: e.p1[1] }, calibration);
      const p2 = transformOverlayPoint({ x: e.p2[0], y: e.p2[1] }, calibration);
      return { ...e, p1: [p1.x, p1.y] as Pt, p2: [p2.x, p2.y] as Pt };
    });
  }, [calibration, edges_px]);

  const displayFootprint = useMemo(() => {
    if (!calibration?.calibrated) return footprint_px;
    return footprint_px.map(([x, y]) => {
      const out = transformOverlayPoint({ x, y }, calibration);
      return [out.x, out.y] as Pt;
    });
  }, [calibration, footprint_px]);

  if (!imageUrl || !rasterSize) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Raster Overlay Debug</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            No raster image or calibrated size on this measurement.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Raster Overlay Debug</CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {rasterSize.width}×{rasterSize.height}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-4 pt-2">
          <div className="flex items-center gap-2">
            <Switch id="raster" checked={showRaster} onCheckedChange={setShowRaster} />
            <Label htmlFor="raster" className="text-xs">Raster</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="planes" checked={showPlanes} onCheckedChange={setShowPlanes} />
            <Label htmlFor="planes" className="text-xs">Planes ({planes_px.length})</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="edges" checked={showEdges} onCheckedChange={setShowEdges} />
            <Label htmlFor="edges" className="text-xs">Edges ({edges_px.length})</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="footprint" checked={showFootprint} onCheckedChange={setShowFootprint} />
            <Label htmlFor="footprint" className="text-xs">Footprint ({footprint_px.length})</Label>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative w-full bg-muted rounded overflow-hidden">
          <svg
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-auto block"
          >
            {showRaster && (
              <image
                href={imageUrl}
                x={0}
                y={0}
                width={rasterSize.width}
                height={rasterSize.height}
                opacity={0.95}
              />
            )}
            {targetBbox && (
              <rect
                x={targetBbox.minX}
                y={targetBbox.minY}
                width={targetBbox.width}
                height={targetBbox.height}
                fill="none"
                stroke="#fbbf24"
                strokeWidth={2}
                strokeDasharray="8 5"
              />
            )}
            {showPlanes &&
              displayPlanes.map((p, i) => {
                const pts = (p.polygon || [])
                  .map((pt) => `${pt[0]},${pt[1]}`)
                  .join(' ');
                if (!pts) return null;
                return (
                  <polygon
                    key={`pl-${i}`}
                    points={pts}
                    fill="rgba(34,197,94,0.18)"
                    stroke="#16a34a"
                    strokeWidth={2}
                  />
                );
              })}
            {showEdges &&
              displayEdges.map((e, i) => (
                <line
                  key={`e-${i}`}
                  x1={e.p1[0]}
                  y1={e.p1[1]}
                  x2={e.p2[0]}
                  y2={e.p2[1]}
                  stroke={EDGE_COLORS[e.type] || '#fff'}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              ))}
            {showFootprint && displayFootprint.length >= 3 && (
              <polygon
                points={displayFootprint.map((pt) => `${pt[0]},${pt[1]}`).join(' ')}
                fill="none"
                stroke="#eab308"
                strokeWidth={4}
                strokeDasharray="12 8"
              />
            )}
          </svg>
        </div>
        <div className="flex flex-wrap gap-3 mt-3 text-[10px] font-mono text-muted-foreground">
          {Object.entries(EDGE_COLORS).map(([t, c]) => (
            <span key={t} className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5" style={{ background: c }} />
              {t}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default RasterOverlayDebugView;
