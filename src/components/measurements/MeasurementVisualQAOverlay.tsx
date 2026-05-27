// ============================================================================
// MeasurementVisualQAOverlay
// ----------------------------------------------------------------------------
// Aerial-backed visual QA overlay for AI Measurement runs. Renders the raw,
// refined, and selected perimeter on top of the actual aerial raster, with
// toggleable diagnostic layers, a vertex editor (drag / add / delete), and
// Approve / Save / Rerun controls.
//
// Contracts (Measurement Overlay UI & Visual QA skill):
//   - Aerial raster is the background whenever available.
//   - Every required layer is toggleable; missing data surfaces an inline note.
//   - Manual edits never flip customer_report_ready=true. Save only persists
//     the edited polygon + arms the visual-review bypass; the downstream
//     topology / pitch / vendor gates still decide.
//   - Rerun uses the canonical start-ai-measurement entrypoint via the
//     useMeasurementJob hook (no legacy route).
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  RefreshCcw,
  Save,
  Undo2,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  readRegistrationBlock,
  canApproveManualPerimeter,
  registrationBanner,
  isRegistrationFailure,
} from '@/lib/measurement/registration-gate';
import {
  resolveSourceRasterSize,
  classifyCoordinateSpace,
  hasDsmToRasterTransform,
  bboxOf,
  detectFrameMismatch,
} from '@/lib/measurements/overlayCoordinateFrame';

type Pt = [number, number];

export interface MeasurementVisualQAOverlayProps {
  measurement: any;
  aiMeasurementJobId?: string | null;
  /** Canonical rerun trigger. Wired to useMeasurementJob.startJob in the dialog. */
  onRequestRerun?: (opts: { userVerifiedPerimeter: boolean }) => Promise<void> | void;
}

type LayerKey =
  | 'aerial'
  | 'raw'
  | 'refined'
  | 'selected'
  | 'mask'
  | 'unsupported'
  | 'corner_cuts'
  | 'corners'
  | 'dsm';

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  aerial: true,
  raw: true,
  refined: true,
  selected: true,
  mask: true,
  unsupported: true,
  corner_cuts: true,
  corners: true,
  dsm: false,
};

const LAYER_META: Record<LayerKey, { label: string; swatch: string }> = {
  aerial:      { label: 'Aerial',                swatch: 'bg-slate-700' },
  raw:         { label: 'Raw perimeter',         swatch: 'bg-gray-400' },
  refined:     { label: 'Refined perimeter',     swatch: 'bg-emerald-500' },
  selected:    { label: 'Selected (editable)',   swatch: 'bg-blue-500' },
  mask:        { label: 'Target mask',           swatch: 'bg-blue-300/60' },
  unsupported: { label: 'Unsupported segments',  swatch: 'bg-red-500' },
  corner_cuts: { label: 'Long-segment corner cuts', swatch: 'bg-orange-500' },
  corners:     { label: 'Corner/snap points',    swatch: 'bg-white border border-slate-700' },
  dsm:         { label: 'DSM ridge/valley/hip',  swatch: 'bg-violet-500' },
};

const DSM_EDGE_COLOR: Record<string, string> = {
  ridge: '#dc2626',
  valley: '#2563eb',
  hip: '#ea580c',
  eave: '#16a34a',
  rake: '#16a34a',
};

function parseRasterSizeFromUrl(url?: string | null): { width: number; height: number } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const size = parsed.searchParams.get('size');
    const scale = Number(parsed.searchParams.get('scale') || 1);
    const match = size?.match(/^(\d+)x(\d+)$/);
    if (match) return { width: Number(match[1]) * scale, height: Number(match[2]) * scale };
  } catch { /* noop */ }
  return null;
}

function asPxRing(input: any): Pt[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((p: any) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null))
    .filter((p): p is Pt => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  // accept either 0..1 fraction or 0..100 percent
  const pct = v <= 1 ? v * 100 : v;
  return `${pct.toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Number(v).toFixed(digits);
}

const MeasurementVisualQAOverlay: React.FC<MeasurementVisualQAOverlayProps> = ({
  measurement,
  aiMeasurementJobId,
  onRequestRerun,
}) => {
  const { toast } = useToast();
  const grj = (measurement as any)?.geometry_report_json || {};
  const overlayDbg = grj.overlay_debug || {};
  const phase35: any = grj.phase3A_5 ?? grj.phase3_5 ?? {};

  // Registration Gate v2 — disable manual approval when the displayed
  // perimeter may be drawn on the wrong house / wrong coordinate frame.
  const registration = readRegistrationBlock(measurement);
  const registrationFailed = isRegistrationFailure(measurement);
  const approvalAllowed = !registrationFailed && canApproveManualPerimeter(registration);
  const banner = registrationBanner(registration);

  const rasterUrl: string | null =
    overlayDbg?.raster_url ||
    (measurement as any)?.satellite_overlay_url ||
    (measurement as any)?.google_maps_image_url ||
    (measurement as any)?.mapbox_image_url ||
    grj?.raster_image_url ||
    null;

  // Track the loaded image's natural size so resolveSourceRasterSize has a
  // last-resort fallback. NOTE: no silent 1280x1280 default — if nothing
  // resolves we render a banner and skip projection.
  const [imageNatural, setImageNatural] = useState<{ width: number; height: number } | null>(null);
  const resolvedRaster = resolveSourceRasterSize(measurement, rasterUrl, imageNatural);
  const rasterSize = {
    width: resolvedRaster.width ?? 0,
    height: resolvedRaster.height ?? 0,
  };
  const rasterSizeResolved = resolvedRaster.source !== 'unresolved' && rasterSize.width > 0;

  // Render order (fallback chain):
  // 1. aerial_candidate_roof_graph.perimeter_ring_px (DSM-failed runs that still
  //    captured registered aerial geometry — top priority).
  // 2. phase3_5.raw_perimeter_px
  // 3. debug_layers.raw_perimeter_px
  // 4. perimeter_topology.perimeter_ring_px
  // Ensures the overlay still renders on runs preempted before refinement.
  const aerialCandidateGraph = (grj as any)?.aerial_candidate_roof_graph
    ?? (grj as any)?.debug_layers?.aerial_candidate_roof_graph;
  const aerialCandidatePerimeterPx =
    aerialCandidateGraph?.perimeter_ring_px;
  const perimeterTopologyRingPx = (grj as any)?.perimeter_topology?.perimeter_ring_px;
  const debugLayersRawPx = (grj as any)?.debug_layers?.raw_perimeter_px;
  const rawRing = useMemo<Pt[]>(
    () => {
      const a = asPxRing(aerialCandidatePerimeterPx);
      if (a.length >= 3) return a;
      const r1 = asPxRing(phase35?.raw_perimeter_px);
      if (r1.length >= 3) return r1;
      const r2 = asPxRing(debugLayersRawPx);
      if (r2.length >= 3) return r2;
      return asPxRing(perimeterTopologyRingPx);
    },
    [phase35, debugLayersRawPx, perimeterTopologyRingPx, aerialCandidatePerimeterPx],
  );
  const refinedRing = useMemo<Pt[]>(() => asPxRing(phase35?.refined_perimeter_px), [phase35]);

  // Editable copy — seeds from refined (or raw fallback). User edits stay local
  // until Save explicitly persists them through verify-perimeter-manually.
  const seedRing: Pt[] = refinedRing.length >= 4 ? refinedRing : rawRing;

  const [editedRing, setEditedRing] = useState<Pt[]>(seedRing);
  const [editMode, setEditMode] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [verifyState, setVerifyState] = useState<'idle' | 'approved' | 'rejected'>('idle');

  useEffect(() => {
    setEditedRing(seedRing);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase35]);

  const unsupportedIdx: number[] = Array.isArray(phase35?.aerial_edge_unsupported_segments)
    ? phase35.aerial_edge_unsupported_segments
    : [];
  const cornerCutMids: Pt[] = useMemo(
    () => asPxRing(phase35?.long_segment_corner_cut_midpoints_px),
    [phase35],
  );
  const maskPolygon: Pt[] = useMemo(
    () => asPxRing(overlayDbg?.target_mask_polygon_px),
    [overlayDbg],
  );
  const dsmEdges: Array<{ type: string; p1: Pt; p2: Pt }> = useMemo(() => {
    if (!Array.isArray(overlayDbg?.edges_px)) return [];
    return overlayDbg.edges_px
      .map((e: any) => ({
        type: String(e?.type ?? 'unknown'),
        p1: Array.isArray(e?.p1) ? ([Number(e.p1[0]), Number(e.p1[1])] as Pt) : null,
        p2: Array.isArray(e?.p2) ? ([Number(e.p2[0]), Number(e.p2[1])] as Pt) : null,
      }))
      .filter((e: any) => e.p1 && e.p2);
  }, [overlayDbg]);

  const [rawLayers, setRawLayers] = useState<Record<LayerKey, boolean>>(DEFAULT_LAYERS);
  // When registration failed, force the editable / refined perimeter layers
  // off so we never draw a manipulable polygon on the wrong house.
  const layers: Record<LayerKey, boolean> = registrationFailed
    ? { ...rawLayers, selected: false, refined: false }
    : rawLayers;
  const setLayer = (k: LayerKey, v: boolean) => setRawLayers((s) => ({ ...s, [k]: v }));

  // ---- Viewport mode (Full Tile vs Roof Focus) ----------------------------
  // Roof Focus crops the displayed canvas to the perimeter bbox + padding.
  // It is a pure display transform — overlay pixel coordinates are unchanged.
  type ViewportMode = "full_tile" | "roof_focus";
  const focusSourceRing: Pt[] = rawRing.length >= 3 ? rawRing : refinedRing;
  const focusBbox = useMemo(() => {
    if (focusSourceRing.length < 3) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of focusSourceRing) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }, [focusSourceRing]);
  const [viewportMode, setViewportMode] = useState<ViewportMode>("full_tile");
  // Default to Roof Focus when a perimeter bbox exists (set once when ready).
  const focusReady = !!focusBbox && rasterSizeResolved;
  const focusInitialisedRef = useRef(false);
  useEffect(() => {
    if (focusReady && !focusInitialisedRef.current) {
      setViewportMode("roof_focus");
      focusInitialisedRef.current = true;
    }
  }, [focusReady]);

  // ---- Canvas rendering ---------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Compute the active source-pixel viewport: either the full raster, or a
  // padded bbox around the roof perimeter. Pad ~100px clamped to raster.
  const viewportSrc = useMemo(() => {
    const fullW = rasterSize.width;
    const fullH = rasterSize.height;
    if (viewportMode === "roof_focus" && focusBbox && fullW > 0 && fullH > 0) {
      const pad = Math.max(80, Math.min(120, Math.round(Math.max(focusBbox.maxX - focusBbox.minX, focusBbox.maxY - focusBbox.minY) * 0.15)));
      const minX = Math.max(0, focusBbox.minX - pad);
      const minY = Math.max(0, focusBbox.minY - pad);
      const maxX = Math.min(fullW, focusBbox.maxX + pad);
      const maxY = Math.min(fullH, focusBbox.maxY + pad);
      return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    }
    return { minX: 0, minY: 0, maxX: fullW, maxY: fullH, w: fullW, h: fullH };
  }, [viewportMode, focusBbox, rasterSize.width, rasterSize.height]);

  const scale = containerWidth > 0 && viewportSrc.w > 0
    ? containerWidth / viewportSrc.w
    : 1;
  const displayHeight = viewportSrc.h > 0 ? viewportSrc.h * scale : 0;


  // Load the aerial image once and capture natural size for resolver fallback.
  useEffect(() => {
    if (!rasterUrl) { imgRef.current = null; setImageNatural(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setImageNatural({ width: img.naturalWidth, height: img.naturalHeight });
      draw();
    };
    img.onerror = () => { imgRef.current = null; setImageNatural(null); draw(); };
    img.src = rasterUrl;
    return () => { imgRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rasterUrl]);

  useEffect(() => {
    draw();
    /* eslint-disable-next-line */
  }, [
    layers, scale, editedRing, rawRing, refinedRing, maskPolygon, cornerCutMids, dsmEdges,
    viewportSrc.minX, viewportSrc.minY, viewportSrc.w, viewportSrc.h,
  ]);

  const dsmAllowed = hasDsmToRasterTransform(measurement);

  function draw() {
    const cvs = canvasRef.current;
    if (!cvs) return;
    if (!rasterSizeResolved) {
      // Refuse to project onto a guessed frame. The "raster size unknown"
      // banner above the canvas tells the user why nothing is drawn.
      cvs.width = 1; cvs.height = 1;
      return;
    }
    const W = Math.max(1, Math.round(viewportSrc.w * scale));
    const H = Math.max(1, Math.round(viewportSrc.h * scale));
    cvs.width = W;
    cvs.height = H;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // Aerial background — draw the source-pixel sub-rect of the image so the
    // displayed canvas focuses on the roof while overlay coords stay in the
    // same source-pixel space.
    if (layers.aerial && imgRef.current) {
      ctx.drawImage(
        imgRef.current,
        viewportSrc.minX, viewportSrc.minY, Math.max(1, viewportSrc.w), Math.max(1, viewportSrc.h),
        0, 0, W, H,
      );
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, W, H);
    }

    const sx = (p: Pt) => (p[0] - viewportSrc.minX) * scale;
    const sy = (p: Pt) => (p[1] - viewportSrc.minY) * scale;


    const drawRing = (
      ring: Pt[],
      stroke: string,
      width: number,
      dash: number[] = [],
      fill?: string,
    ) => {
      if (ring.length < 2) return;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.lineWidth = width;
      ctx.strokeStyle = stroke;
      ctx.moveTo(sx(ring[0]), sy(ring[0]));
      for (let i = 1; i < ring.length; i++) ctx.lineTo(sx(ring[i]), sy(ring[i]));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.stroke();
      ctx.restore();
    };

    // Target mask (translucent fill, dashed outline)
    if (layers.mask && maskPolygon.length >= 3) {
      drawRing(maskPolygon, 'rgba(59,130,246,0.55)', 1, [4, 3], 'rgba(59,130,246,0.18)');
    }

    // DSM ridge / valley / hip lines
    if (layers.dsm && dsmEdges.length && dsmAllowed) {
      ctx.save();
      ctx.lineWidth = 1.5;
      for (const e of dsmEdges) {
        ctx.strokeStyle = DSM_EDGE_COLOR[e.type] || '#a78bfa';
        ctx.beginPath();
        ctx.moveTo(sx(e.p1), sy(e.p1));
        ctx.lineTo(sx(e.p2), sy(e.p2));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Raw, refined, selected perimeters
    if (layers.raw && rawRing.length >= 3) {
      drawRing(rawRing, '#888888', 1.5);
    }
    if (layers.refined && refinedRing.length >= 3) {
      drawRing(refinedRing, '#00c853', 2);
    }
    if (layers.selected && editedRing.length >= 3) {
      drawRing(editedRing, '#2196f3', 2.5);
    }

    // Unsupported segments (red) — indices into the selected ring
    if (layers.unsupported && layers.selected && editedRing.length >= 2 && unsupportedIdx.length) {
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3.5;
      for (const i of unsupportedIdx) {
        const a = editedRing[i];
        const b = editedRing[(i + 1) % editedRing.length];
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(sx(a), sy(a));
        ctx.lineTo(sx(b), sy(b));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Corner cuts (orange rings)
    if (layers.corner_cuts && cornerCutMids.length) {
      ctx.save();
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2;
      for (const p of cornerCutMids) {
        ctx.beginPath();
        ctx.arc(sx(p), sy(p), 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Corner/snap points (small white nodes)
    if (layers.corners && layers.selected && editedRing.length) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      for (const p of editedRing) {
        ctx.beginPath();
        ctx.arc(sx(p), sy(p), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ---- Vertex editor ------------------------------------------------------
  const dragIdxRef = useRef<number | null>(null);

  // Convert ring source-pixel coords → canvas display coords using the active
  // viewport offset so hit-testing still works in Roof Focus.
  const ringSx = (x: number) => (x - viewportSrc.minX) * scale;
  const ringSy = (y: number) => (y - viewportSrc.minY) * scale;
  const dispToSrcX = (lx: number) => lx / scale + viewportSrc.minX;
  const dispToSrcY = (ly: number) => ly / scale + viewportSrc.minY;

  function pickVertex(localX: number, localY: number): number {
    const tol = 10;
    for (let i = 0; i < editedRing.length; i++) {
      const dx = ringSx(editedRing[i][0]) - localX;
      const dy = ringSy(editedRing[i][1]) - localY;
      if (Math.hypot(dx, dy) <= tol) return i;
    }
    return -1;
  }

  function pickEdge(localX: number, localY: number): number {
    const tol = 8;
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < editedRing.length; i++) {
      const a = editedRing[i];
      const b = editedRing[(i + 1) % editedRing.length];
      const ax = ringSx(a[0]), ay = ringSy(a[1]);
      const bx = ringSx(b[0]), by = ringSy(b[1]);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((localX - ax) * dx + (localY - ay) * dy) / len2));
      const px = ax + t * dx, py = ay + t * dy;
      const d = Math.hypot(localX - px, localY - py);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestDist <= tol ? bestIdx : -1;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!editMode) return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.shiftKey) {
      // Delete vertex on shift-click
      const vi = pickVertex(x, y);
      if (vi >= 0 && editedRing.length > 4) {
        const next = editedRing.slice();
        next.splice(vi, 1);
        setEditedRing(next);
        setDirty(true);
      }
      return;
    }

    const vi = pickVertex(x, y);
    if (vi >= 0) {
      dragIdxRef.current = vi;
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      return;
    }

    // Otherwise try to add a vertex on the nearest edge
    const ei = pickEdge(x, y);
    if (ei >= 0) {
      const next = editedRing.slice();
      next.splice(ei + 1, 0, [dispToSrcX(x), dispToSrcY(y)]);
      setEditedRing(next);
      setDirty(true);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!editMode || dragIdxRef.current === null) return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = dispToSrcX(e.clientX - rect.left);
    const y = dispToSrcY(e.clientY - rect.top);
    const next = editedRing.slice();
    next[dragIdxRef.current] = [x, y];
    setEditedRing(next);
    setDirty(true);
  }


  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    dragIdxRef.current = null;
    try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }

  function resetEdits() {
    setEditedRing(seedRing);
    setDirty(false);
  }

  // ---- Persistence --------------------------------------------------------
  async function callVerify(approved: boolean, includeEditedPolygon: boolean) {
    if (!aiMeasurementJobId) {
      toast({ title: 'Cannot save', description: 'No AI measurement job id on this row.', variant: 'destructive' });
      return false;
    }
    setSaving(true);
    try {
      const body: any = {
        ai_measurement_job_id: aiMeasurementJobId,
        approved,
      };
      if (includeEditedPolygon && approved && editedRing.length >= 4) {
        body.edited_perimeter_px = editedRing;
        // geo conversion happens server-side when the next canonical run
        // resolves the raster transform; we persist px here so nothing is lost.
      }
      const { error } = await supabase.functions.invoke('verify-perimeter-manually', { body });
      if (error) throw error;
      setVerifyState(approved ? 'approved' : 'rejected');
      setDirty(false);
      toast({
        title: approved ? 'Perimeter approved' : 'Perimeter rejected',
        description: approved
          ? 'Saved. Customer-ready status is unchanged — downstream gates still apply.'
          : 'Verification cleared.',
      });
      return true;
    } catch (err: any) {
      toast({ title: 'Save failed', description: err?.message || 'Unknown error', variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function approveAndRerun() {
    const ok = await callVerify(true, dirty);
    if (!ok) return;
    if (!onRequestRerun) {
      toast({ title: 'No rerun handler', description: 'Open from Measurement Report to trigger a rerun.', variant: 'destructive' });
      return;
    }
    setRerunning(true);
    try {
      await onRequestRerun({ userVerifiedPerimeter: true });
    } finally {
      setRerunning(false);
    }
  }

  // ---- Metrics ------------------------------------------------------------
  const metrics = [
    { label: 'visual_edge_alignment',     value: fmtNum(phase35?.visual_edge_alignment_score, 3) },
    { label: 'aerial_edge_support',       value: fmtPct(phase35?.aerial_edge_support_pct) },
    { label: 'dsm_boundary_support',      value: fmtPct(phase35?.dsm_boundary_support_pct) },
    { label: 'corner_snap_confidence',    value: fmtNum(phase35?.corner_snap_confidence, 3) },
    { label: 'long_segment_corner_cuts',  value: String(phase35?.long_segment_corner_cut_count ?? '—') },
    { label: 'visual_review_gate',        value: String(phase35?.visual_review_gate ?? phase35?.shape_validation?.shape_passed === false ? 'fail' : (phase35?.shape_validation?.shape_passed ? 'pass' : '—')) },
  ];
  const shapeFailures: string[] = Array.isArray(phase35?.shape_validation?.failure_reasons)
    ? phase35.shape_validation.failure_reasons
    : [];

  const hasPerimeterData = rawRing.length >= 3 || refinedRing.length >= 3;

  if (!hasPerimeterData && !rasterUrl) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Visual QA overlay unavailable</AlertTitle>
        <AlertDescription>
          No <code>aerial_candidate_roof_graph.perimeter_ring_px</code>,{' '}
          <code>phase3_5.raw_perimeter_px</code>,{' '}
          <code>debug_layers.raw_perimeter_px</code>,{' '}
          <code>perimeter_topology.perimeter_ring_px</code>, or aerial{' '}
          <code>raster_url</code> was persisted for this run.
        </AlertDescription>
      </Alert>
    );
  }


  // ---- Overlay transform diagnostics --------------------------------------
  const overlaySourceField =
    aerialCandidatePerimeterPx ? 'aerial_candidate_roof_graph.perimeter_ring_px'
      : phase35?.raw_perimeter_px ? 'phase3_5.raw_perimeter_px'
      : debugLayersRawPx ? 'debug_layers.raw_perimeter_px'
      : perimeterTopologyRingPx ? 'perimeter_topology.perimeter_ring_px'
      : 'none';
  const overlayCoordSpace = classifyCoordinateSpace(overlaySourceField);
  const confirmedCenterPx: Pt | null = (() => {
    const c = (grj as any)?.confirmed_center_px ?? overlayDbg?.confirmed_center_px;
    if (Array.isArray(c) && c.length >= 2) return [Number(c[0]), Number(c[1])];
    if (rasterSize.width > 0) return [rasterSize.width / 2, rasterSize.height / 2];
    return null;
  })();
  const sourceTransform = {
    scaleX: scale, scaleY: scale, offsetX: 0, offsetY: 0, fit: 'fill' as const, resolved: rasterSizeResolved,
  };
  const frameCheck = rasterSizeResolved && rawRing.length >= 3
    ? detectFrameMismatch({
        perimeterPxSource: rawRing,
        confirmedCenterPxSource: confirmedCenterPx,
        sourceRasterSize: rasterSize,
        transform: sourceTransform,
      })
    : { mismatch: false, distancePx: 0, tolerancePx: 0 };
  const firstPt = rawRing[0];
  const projectedFirst = firstPt ? [firstPt[0] * scale, firstPt[1] * scale] : null;
  const bb = bboxOf(rawRing);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            Visual QA — Perimeter Overlay
            <Badge variant="secondary">phase 3A.5</Badge>
            {verifyState === 'approved' && <Badge className="bg-emerald-600">approved</Badge>}
            {verifyState === 'rejected' && <Badge variant="destructive">rejected</Badge>}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Manual approval saves the polygon but does <strong>not</strong> mark the report customer-ready.
            Downstream topology / pitch / vendor gates still apply on rerun.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={editMode ? 'default' : 'outline'}
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {editMode ? 'Exit edit' : 'Edit vertices'}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={!dirty} onClick={resetEdits}>
            <Undo2 className="h-4 w-4 mr-1" /> Reset
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {banner && (
          <Alert variant={banner.variant === "warning" ? "default" : "destructive"}>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{banner.title}</AlertTitle>
            <AlertDescription>
              {banner.description}
              <div className="mt-1 text-[11px] font-mono opacity-80">
                Failed: {banner.failedFlags.join(', ')}
              </div>
            </AlertDescription>
          </Alert>
        )}
        {/* Perimeter Confidence callout — surfaces the proof that target isolation worked */}
        {(() => {
          const layer1: any = (grj as any).layer1_perimeter || {};
          const tmi: any = (grj as any).target_mask_isolation || {};
          const overlap = layer1.target_mask_overlap_with_perimeter ??
            tmi.target_mask_overlap_with_perimeter ?? null;
          const iou = layer1.perimeter_iou ?? tmi.perimeter_iou ?? null;
          const conf = layer1.perimeter_confidence ?? null;
          if (overlap == null && iou == null && conf == null) return null;
          const pill = (label: string, v: any) => (
            <div className="flex flex-col px-3 py-1.5 rounded-md border bg-muted/40">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
              <span className="font-mono text-sm">{v == null ? '—' : fmtNum(Number(v), 3)}</span>
            </div>
          );
          return (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground mr-1">Perimeter confidence:</span>
              {pill('Mask Overlap', overlap)}
              {pill('IoU', iou)}
              {pill('Confidence', conf)}
            </div>
          );
        })()}
        {!rasterUrl && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No aerial available</AlertTitle>
            <AlertDescription>
              No <code>raster_url</code> on this row. Showing perimeter geometry on a neutral background.
            </AlertDescription>
          </Alert>
        )}
        {!rasterSizeResolved && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Raster size unknown</AlertTitle>
            <AlertDescription>
              Overlay rendering is suppressed because the source raster size could not be resolved
              (no <code>overlay_debug.raster_size</code>, <code>analysis_image_size</code>,
              <code>?size=WxH</code> on the URL, or image natural dimensions). Drawing polygon
              pixels against a guessed frame would mis-place the geometry.
            </AlertDescription>
          </Alert>
        )}
        {frameCheck.mismatch && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Overlay render transform mismatch</AlertTitle>
            <AlertDescription>
              The selected perimeter bbox center is{' '}
              <code>{frameCheck.distancePx.toFixed(1)}px</code> from the confirmed roof center
              (tolerance <code>{frameCheck.tolerancePx.toFixed(1)}px</code>). The polygon is still
              drawn so you can diagnose, but the rendering frame likely does not match the displayed aerial.
            </AlertDescription>
          </Alert>
        )}


        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          {/* Canvas */}
          <div ref={wrapRef} className="relative w-full rounded-md overflow-hidden border bg-slate-900">
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: displayHeight ? `${displayHeight}px` : 'auto', display: 'block', touchAction: 'none', cursor: editMode ? 'crosshair' : 'default' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
            {editMode && (
              <div className="absolute bottom-2 left-2 right-2 text-[11px] bg-background/85 backdrop-blur px-2 py-1 rounded border">
                Drag a node to move • Click an edge to add a vertex • Shift-click a node to delete
              </div>
            )}
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Layers</div>
              <div className="space-y-1.5">
                {(Object.keys(LAYER_META) as LayerKey[]).map((k) => {
                  const m = LAYER_META[k];
                  const dataMissing =
                    (k === 'aerial' && !rasterUrl) ||
                    (k === 'raw' && rawRing.length < 3) ||
                    (k === 'refined' && refinedRing.length < 3) ||
                    (k === 'selected' && editedRing.length < 3) ||
                    (k === 'mask' && maskPolygon.length < 3) ||
                    (k === 'unsupported' && unsupportedIdx.length === 0) ||
                    (k === 'corner_cuts' && cornerCutMids.length === 0) ||
                    (k === 'dsm' && dsmEdges.length === 0);
                  return (
                    <div key={k} className="flex items-center justify-between gap-2 text-xs">
                      <Label htmlFor={`layer-${k}`} className="flex items-center gap-2 cursor-pointer">
                        <span className={`inline-block w-3 h-3 rounded ${m.swatch}`} />
                        {m.label}
                        {dataMissing && (
                          <span className="text-[10px] text-muted-foreground italic">not persisted</span>
                        )}
                      </Label>
                      <Switch
                        id={`layer-${k}`}
                        checked={layers[k]}
                        onCheckedChange={(v) => setLayer(k, v)}
                        disabled={dataMissing}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Metrics</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono">
                {metrics.map((m) => (
                  <>
                    <div key={`${m.label}-k`} className="text-muted-foreground">{m.label}</div>
                    <div key={`${m.label}-v`} className="text-right">{m.value}</div>
                  </>
                ))}
              </div>
              {shapeFailures.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] font-semibold text-destructive mb-1">shape_validation failed</div>
                  <ul className="text-[11px] list-disc list-inside space-y-0.5 text-destructive/90">
                    {shapeFailures.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>

            <details open={!rasterSizeResolved || frameCheck.mismatch || registrationFailed} className="border rounded p-2">
              <summary className="text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer">
                Overlay transform
              </summary>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono mt-2">
                <div className="text-muted-foreground">source_field</div>
                <div className="text-right break-all">{overlaySourceField}</div>
                <div className="text-muted-foreground">coord_space</div>
                <div className="text-right">{overlayCoordSpace}</div>
                <div className="text-muted-foreground">raster_size_src</div>
                <div className="text-right">{resolvedRaster.source}</div>
                <div className="text-muted-foreground">source_raster_px</div>
                <div className="text-right">{rasterSize.width}×{rasterSize.height}</div>
                <div className="text-muted-foreground">displayed_px</div>
                <div className="text-right">{Math.round(containerWidth)}×{Math.round(displayHeight)}</div>
                <div className="text-muted-foreground">scale</div>
                <div className="text-right">{scale.toFixed(4)}</div>
                <div className="text-muted-foreground">first_pt_src</div>
                <div className="text-right">{firstPt ? `${firstPt[0].toFixed(1)},${firstPt[1].toFixed(1)}` : '—'}</div>
                <div className="text-muted-foreground">first_pt_disp</div>
                <div className="text-right">{projectedFirst ? `${projectedFirst[0].toFixed(1)},${projectedFirst[1].toFixed(1)}` : '—'}</div>
                <div className="text-muted-foreground">bbox_center_src</div>
                <div className="text-right">{bb ? `${bb.cx.toFixed(1)},${bb.cy.toFixed(1)}` : '—'}</div>
                <div className="text-muted-foreground">confirmed_center_src</div>
                <div className="text-right">{confirmedCenterPx ? `${confirmedCenterPx[0].toFixed(0)},${confirmedCenterPx[1].toFixed(0)}` : '—'}</div>
                <div className="text-muted-foreground">frame_mismatch</div>
                <div className={`text-right ${frameCheck.mismatch ? 'text-destructive' : ''}`}>
                  {frameCheck.mismatch ? `${frameCheck.distancePx.toFixed(1)}px (>${frameCheck.tolerancePx.toFixed(1)})` : 'ok'}
                </div>
                <div className="text-muted-foreground">dsm_overlay</div>
                <div className="text-right">{dsmAllowed ? 'allowed' : 'suppressed (no dsm→raster)'}</div>
              </div>
            </details>


            <div className="space-y-2 pt-2 border-t">
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={!aiMeasurementJobId || saving || !dirty || !approvalAllowed}
                onClick={() => callVerify(true, true)}
                title={!approvalAllowed ? 'Coordinate registration gate failed — manual approval disabled.' : undefined}
              >
                <Save className="h-4 w-4 mr-1" />
                Save edited perimeter
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                className="w-full"
                disabled={!aiMeasurementJobId || saving || rerunning || !approvalAllowed}
                onClick={() => approveAndRerun()}
                title={!approvalAllowed ? 'Coordinate registration gate failed — manual approval disabled.' : undefined}
              >
                <RefreshCcw className={`h-4 w-4 mr-1 ${rerunning ? 'animate-spin' : ''}`} />
                Approve & rerun (user_verified=true)
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={!aiMeasurementJobId || saving || !approvalAllowed}
                  onClick={() => callVerify(true, false)}
                  title={!approvalAllowed ? 'Coordinate registration gate failed — manual approval disabled.' : undefined}
                >
                  <Check className="h-4 w-4 mr-1" /> Approve only
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={!aiMeasurementJobId || saving || !approvalAllowed}
                  onClick={() => callVerify(false, false)}
                  title={!approvalAllowed ? 'Coordinate registration gate failed — manual approval disabled.' : undefined}
                >
                  <XCircle className="h-4 w-4 mr-1" /> Reject
                </Button>
              </div>
              {!approvalAllowed && (
                <p className="text-[11px] text-destructive font-semibold leading-snug">
                  Cannot approve perimeter: target roof registration failed.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground leading-snug">
                Manual approval only unlocks topology diagnostics on rerun. <code>customer_report_ready</code> stays
                <code> false</code> until perimeter + topology + pitch + benchmark gates all pass.
              </p>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Manual approval only unlocks topology diagnostics on rerun. <code>customer_report_ready</code> stays
                <code> false</code> until perimeter + topology + pitch + benchmark gates all pass.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MeasurementVisualQAOverlay;
