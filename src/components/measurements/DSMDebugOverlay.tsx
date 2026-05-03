import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Bug, Layers, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface OverlayEdge {
  type: string;
  p1: [number, number];
  p2: [number, number];
  source?: string;
}

interface GeoEdge {
  start: [number, number];
  end: [number, number];
  type: string;
  score?: number;
  confidence?: number;
  source?: string;
  reason?: string;
}

interface GeoVertex {
  position: [number, number];
  type: string;
}

interface OverlayDebugData {
  raster_url?: string;
  raster_size?: { width: number; height: number };
  planes_px?: Array<{ polygon: [number, number][]; source?: string }>;
  edges_px?: OverlayEdge[];
  footprint_px?: [number, number][];
  rejected_edges_geo?: GeoEdge[];
  graph_vertices_geo?: GeoVertex[];
  accepted_edges_geo?: GeoEdge[];
  dsm_edges_detected?: number;
  dsm_edges_accepted?: number;
  validation_status?: string;
  hard_fail_reason?: string;
  // Expanded solver metrics (Patent Parity Phase 3)
  intersections_split?: number;
  intersection_filter_skipped?: number;
  cluster_merges?: number;
  collinear_merges?: number;
  fragment_merges?: number;
  dangling_edges_removed?: number;
  face_count_before_merge?: number;
  face_count_after_merge?: number;
  faces_rejected_by_plane_fit?: number;
  faces_rejected_by_area?: number;
  coverage_ratio?: number;
  customer_block_reason?: string;
  // Source tagging (Phase 5)
  geometry_source?: string;
  topology_source?: string;
  fallback_used?: boolean;
  customer_report_ready?: boolean;
  internal_debug_report_ready?: boolean;
  // Footprint diagnostics (Phase 6)
  footprint_source?: string;
  footprint_valid?: boolean;
  footprint_point_count?: number;
  footprint_area_sqft?: number;
  dsm_coordinate_match?: { match: boolean; overlap_ratio: number; footprint_dsm_bbox: any; dsm_bbox: any } | null;
  // Registration quality metrics
  overlay_calibration?: {
    registration_quality?: {
      rms_px?: number;
      max_error_px?: number;
      mask_iou?: number | null;
      coverage_ratio?: number;
      publish_allowed?: boolean;
      block_reason?: string | null;
    };
    [key: string]: any;
  };
}

interface DSMDebugOverlayProps {
  overlayDebug: OverlayDebugData | null;
  debugGeometry?: any;
}

const EDGE_COLORS: Record<string, string> = {
  ridge: '#ff0000',
  valley: '#0066ff',
  hip: '#ff8800',
  eave: '#00cc44',
  rake: '#00cc44',
};

const LAYER_DEFAULTS = {
  raster: true,
  footprint: true,
  acceptedEdges: true,
  rejectedEdges: true,
  classifiedEdgesPx: true,
  graphNodes: true,
  facets: false,
};

export function DSMDebugOverlay({ overlayDebug, debugGeometry }: DSMDebugOverlayProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [layers, setLayers] = useState(LAYER_DEFAULTS);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  const data = overlayDebug;
  if (!data) return null;

  const rasterW = data.raster_size?.width || 800;
  const rasterH = data.raster_size?.height || 600;

  const toggleLayer = (key: keyof typeof LAYER_DEFAULTS) => {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw raster background
    if (layers.raster && data.raster_url) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(pan.x, pan.y);
        ctx.scale(zoom, zoom);
        ctx.globalAlpha = 0.7;
        ctx.drawImage(img, 0, 0, rasterW, rasterH);
        ctx.globalAlpha = 1.0;
        drawOverlays(ctx);
        ctx.restore();
      };
      img.src = data.raster_url;
    } else {
      // Dark background
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, rasterW, rasterH);
      drawOverlays(ctx);
    }

    ctx.restore();
  }, [data, layers, zoom, pan, rasterW, rasterH]);

  const drawOverlays = useCallback((ctx: CanvasRenderingContext2D) => {
    // Footprint
    if (layers.footprint && data.footprint_px && data.footprint_px.length >= 3) {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(data.footprint_px[0][0], data.footprint_px[0][1]);
      for (let i = 1; i < data.footprint_px.length; i++) {
        ctx.lineTo(data.footprint_px[i][0], data.footprint_px[i][1]);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Facets (planes_px)
    if (layers.facets && data.planes_px) {
      for (const plane of data.planes_px) {
        if (plane.polygon.length < 3) continue;
        ctx.fillStyle = 'rgba(100, 180, 255, 0.15)';
        ctx.strokeStyle = 'rgba(100, 180, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plane.polygon[0][0], plane.polygon[0][1]);
        for (let i = 1; i < plane.polygon.length; i++) {
          ctx.lineTo(plane.polygon[i][0], plane.polygon[i][1]);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Rejected edges (from geo, converted via edges_px coordinate space if available)
    // For now show edges_px rejected as faded red
    if (layers.rejectedEdges && data.rejected_edges_geo && data.rejected_edges_geo.length > 0) {
      // These are in geo coords — we need to draw them differently
      // For now, draw a status badge — the px-space edges are in edges_px
      // We'll show rejected count in the legend
    }

    // Classified edges from edges_px (accepted, final)
    if (layers.classifiedEdgesPx && data.edges_px) {
      for (const edge of data.edges_px) {
        const baseColor = EDGE_COLORS[edge.type] || '#ffffff';
        // Confidence-based opacity: stronger edges are more opaque
        const confidence = (edge as any).confidence ?? 1;
        const alpha = Math.max(0.3, Math.min(1, confidence));
        ctx.strokeStyle = baseColor;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = edge.source === 'dsm' ? 3 : edge.source === 'skeleton' ? 2 : 3;
        ctx.beginPath();
        ctx.moveTo(edge.p1[0], edge.p1[1]);
        ctx.lineTo(edge.p2[0], edge.p2[1]);
        ctx.stroke();
        ctx.globalAlpha = 1.0;

        // Label at midpoint with type + source
        const mx = (edge.p1[0] + edge.p2[0]) / 2;
        const my = (edge.p1[1] + edge.p2[1]) / 2;
        ctx.fillStyle = baseColor;
        ctx.font = '10px monospace';
        const label = edge.source ? `${edge.type}(${edge.source})` : edge.type;
        ctx.fillText(label, mx + 3, my - 3);
      }
    }

    // Graph nodes
    if (layers.graphNodes && data.edges_px) {
      // Compute node degree from edge endpoints
      const nodeDegree = new Map<string, number>();
      for (const e of data.edges_px) {
        const k1 = `${Math.round(e.p1[0])},${Math.round(e.p1[1])}`;
        const k2 = `${Math.round(e.p2[0])},${Math.round(e.p2[1])}`;
        nodeDegree.set(k1, (nodeDegree.get(k1) || 0) + 1);
        nodeDegree.set(k2, (nodeDegree.get(k2) || 0) + 1);
      }
      for (const [key, degree] of nodeDegree) {
        const [x, y] = key.split(',').map(Number);
        // Color by degree: dangling=red, normal=cyan, high-degree=yellow
        ctx.fillStyle = degree === 1 ? '#ff4444' : degree >= 4 ? '#ffff00' : '#00ffff';
        ctx.beginPath();
        ctx.arc(x, y, degree === 1 ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
        // Degree label
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 8px monospace';
        ctx.fillText(String(degree), x - 3, y + 3);
      }
    }
  }, [data, layers]);

  useEffect(() => {
    if (!isOpen) return;
    draw();
  }, [isOpen, draw]);

  // Mouse handlers for pan/zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.2, Math.min(5, z * delta)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Stats
  const edgesPxCount = data.edges_px?.length ?? 0;
  const rejectedCount = data.rejected_edges_geo?.length ?? 0;
  const vertexCount = data.graph_vertices_geo?.length ?? 0;
  const facetCount = data.planes_px?.length ?? 0;

  const ridgeEdges = data.edges_px?.filter(e => e.type === 'ridge').length ?? 0;
  const valleyEdges = data.edges_px?.filter(e => e.type === 'valley').length ?? 0;
  const hipEdges = data.edges_px?.filter(e => e.type === 'hip').length ?? 0;
  const eaveEdges = data.edges_px?.filter(e => e.type === 'eave').length ?? 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-xs">
          <Bug className="h-3 w-3" />
          DSM Debug Overlay
          {data.hard_fail_reason && (
            <Badge variant="destructive" className="text-[10px] px-1 py-0">
              {data.hard_fail_reason}
            </Badge>
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-2 border-dashed border-yellow-500/50">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs flex items-center gap-2">
              <Layers className="h-3 w-3" />
              DSM Pipeline Debug View
              <Badge variant="outline" className="text-[10px]">
                {data.validation_status || 'unknown'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            {/* Stats bar */}
            <div className="flex flex-wrap gap-2 text-[10px]">
              <Badge variant="secondary">DSM detected: {data.dsm_edges_detected ?? '?'}</Badge>
              <Badge variant="secondary">Accepted: {data.dsm_edges_accepted ?? '?'}</Badge>
              <Badge variant="secondary">Edges (px): {edgesPxCount}</Badge>
              <Badge variant="destructive" className="text-[10px]">Rejected: {rejectedCount}</Badge>
              <Badge style={{ backgroundColor: '#00ffff', color: '#000' }} className="text-[10px]">Nodes: {vertexCount}</Badge>
              <Badge variant="secondary">Facets: {facetCount}</Badge>
            </div>

            {/* Expanded solver metrics (Patent Parity) */}
            <div className="flex flex-wrap gap-2 text-[10px]">
              {data.intersections_split != null && <Badge variant="outline">Splits: {data.intersections_split}</Badge>}
              {data.intersection_filter_skipped != null && <Badge variant="outline">Skipped: {data.intersection_filter_skipped}</Badge>}
              {data.collinear_merges != null && <Badge variant="outline">Collinear: {data.collinear_merges}</Badge>}
              {data.cluster_merges != null && <Badge variant="outline">Clusters: {data.cluster_merges}</Badge>}
              {data.fragment_merges != null && <Badge variant="outline">Fragments: {data.fragment_merges}</Badge>}
              {data.dangling_edges_removed != null && <Badge variant="outline">Dangling: {data.dangling_edges_removed}</Badge>}
              {data.face_count_before_merge != null && <Badge variant="outline">Pre-merge: {data.face_count_before_merge}</Badge>}
              {data.face_count_after_merge != null && <Badge variant="outline">Post-merge: {data.face_count_after_merge}</Badge>}
              {data.faces_rejected_by_plane_fit != null && <Badge variant="destructive" className="text-[10px]">Fit rejected: {data.faces_rejected_by_plane_fit}</Badge>}
              {data.faces_rejected_by_area != null && <Badge variant="destructive" className="text-[10px]">Area rejected: {data.faces_rejected_by_area}</Badge>}
              {data.coverage_ratio != null && (
                <Badge variant={data.coverage_ratio >= 0.85 ? "secondary" : "destructive"} className="text-[10px]">
                  Coverage: {Math.round(data.coverage_ratio * 100)}%
                </Badge>
              )}
            </div>

            {/* Registration quality metrics */}
            {data.overlay_calibration?.registration_quality && (
              <div className="flex flex-wrap gap-2 text-[10px]">
                <Badge variant={data.overlay_calibration.registration_quality.publish_allowed ? "secondary" : "destructive"}>
                  RMS: {data.overlay_calibration.registration_quality.rms_px ?? '?'}px
                </Badge>
                <Badge variant="outline">
                  Max err: {data.overlay_calibration.registration_quality.max_error_px ?? '?'}px
                </Badge>
                {data.overlay_calibration.registration_quality.mask_iou != null && (
                  <Badge variant={data.overlay_calibration.registration_quality.mask_iou >= 0.85 ? "secondary" : "destructive"}>
                    Mask IoU: {Math.round((data.overlay_calibration.registration_quality.mask_iou ?? 0) * 100)}%
                  </Badge>
                )}
                <Badge variant={data.overlay_calibration.registration_quality.publish_allowed ? "secondary" : "destructive"}>
                  {data.overlay_calibration.registration_quality.publish_allowed ? '✓ Publish OK' : '✗ Blocked'}
                </Badge>
                {data.overlay_calibration.registration_quality.block_reason && (
                  <Badge variant="destructive" className="text-[10px]">
                    {data.overlay_calibration.registration_quality.block_reason}
                  </Badge>
                )}
              </div>
            )}

            {data.customer_block_reason && (
              <div className="text-[10px] text-destructive font-medium">
                Block reason: {data.customer_block_reason}
              </div>
            )}

            {/* Source Tagging (Phase 5) */}
            <div className="flex flex-wrap gap-1">
              {data.geometry_source && (
                <Badge variant="outline" className="text-[9px]">
                  Geo: {data.geometry_source}
                </Badge>
              )}
              {data.topology_source && (
                <Badge variant={data.topology_source === 'autonomous_dsm_graph_solver' ? 'secondary' : 'destructive'} className="text-[9px]">
                  Topo: {data.topology_source}
                </Badge>
              )}
              {data.fallback_used != null && (
                <Badge variant={data.fallback_used ? 'destructive' : 'secondary'} className="text-[9px]">
                  {data.fallback_used ? '⚠ Fallback' : '✓ No fallback'}
                </Badge>
              )}
              {data.customer_report_ready != null && (
                <Badge variant={data.customer_report_ready ? 'secondary' : 'destructive'} className="text-[9px]">
                  {data.customer_report_ready ? '✓ Customer Report' : '✗ No Customer Report'}
                </Badge>
              )}
            </div>

            {/* Edge classification breakdown */}
            <div className="flex flex-wrap gap-2 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: '#ff0000' }} /> Ridge: {ridgeEdges}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: '#0066ff' }} /> Valley: {valleyEdges}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: '#ff8800' }} /> Hip: {hipEdges}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: '#00cc44' }} /> Eave: {eaveEdges}
              </span>
            </div>

            {/* Layer toggles */}
            <div className="flex flex-wrap gap-3 text-[10px]">
              {(Object.keys(LAYER_DEFAULTS) as Array<keyof typeof LAYER_DEFAULTS>).map(key => (
                <div key={key} className="flex items-center gap-1">
                  <Switch
                    id={`layer-${key}`}
                    checked={layers[key]}
                    onCheckedChange={() => toggleLayer(key)}
                    className="scale-75"
                  />
                  <Label htmlFor={`layer-${key}`} className="text-[10px] cursor-pointer">
                    {key}
                  </Label>
                </div>
              ))}
            </div>

            {/* Zoom controls */}
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setZoom(z => Math.min(5, z * 1.3))} className="h-6 w-6 p-0">
                <ZoomIn className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setZoom(z => Math.max(0.2, z * 0.7))} className="h-6 w-6 p-0">
                <ZoomOut className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={resetView} className="h-6 w-6 p-0">
                <RotateCcw className="h-3 w-3" />
              </Button>
              <span className="text-[10px] text-muted-foreground self-center ml-1">{Math.round(zoom * 100)}%</span>
            </div>

            {/* Canvas */}
            <div
              ref={containerRef}
              className="relative overflow-hidden rounded border border-border bg-black"
              style={{ height: Math.min(500, rasterH * 0.6) }}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <canvas
                ref={canvasRef}
                width={rasterW}
                height={rasterH}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  cursor: isDraggingRef.current ? 'grabbing' : 'grab',
                }}
              />
            </div>

            {/* Hard fail reason */}
            {data.hard_fail_reason && (
              <div className="p-2 rounded bg-destructive/10 border border-destructive/30 text-[11px] text-destructive">
                <strong>Hard Fail:</strong> {data.hard_fail_reason}
              </div>
            )}

            {/* Debug geometry summary */}
            {debugGeometry && (
              <details className="text-[10px]">
                <summary className="cursor-pointer text-muted-foreground">Raw debug_geometry JSON</summary>
                <pre className="mt-1 p-2 bg-muted rounded text-[9px] overflow-x-auto max-h-40 overflow-y-auto">
                  {JSON.stringify(debugGeometry, null, 2)}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
