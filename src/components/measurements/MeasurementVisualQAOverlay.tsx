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
//     DSM / topology / pitch self-consistency gates still decide.
//   - Rerun uses the canonical start-ai-measurement entrypoint via the
//     useMeasurementJob hook (no legacy route).
// ============================================================================

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { resolveDsmStatusFields } from '@/lib/measurement/resolveDsmStatusFields';
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
import { resolveFrameMismatch } from '@/lib/measurement/resolveFrameMismatch';
import { computeAlignmentStatus } from '@/lib/measurement/alignmentStatus';
import {
  resolveSourceRasterSize,
  classifyCoordinateSpace,
  hasDsmToRasterTransform,
  bboxOf,
  detectFrameMismatch,
} from '@/lib/measurements/overlayCoordinateFrame';
import {
  roofFocusViewport,
  pickFocusPerimeter,
} from '@/lib/measurements/roofFocusViewport';

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
  // Banner is computed below, AFTER alignmentStatus, so the resolved Overlay
  // Transform diagnostics can override the registration block's frame source.


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

  // Compute the active source-pixel viewport via the shared Roof Focus helper
  // so RasterOverlayDebugView, the PDF export panel, and this canvas all crop
  // identically. Falls back to full tile when no perimeter is available or
  // viewportMode is "full_tile".
  const focusRing = viewportMode === 'roof_focus' ? focusSourceRing : [];
  const focus = useMemo(
    () =>
      roofFocusViewport({
        rasterSize: { width: rasterSize.width, height: rasterSize.height },
        perimeterPx: focusRing,
        displayWidth: containerWidth || 1,
      }),
    [rasterSize.width, rasterSize.height, focusRing, containerWidth],
  );
  const viewportSrc = {
    minX: focus.cropBboxPx.minX,
    minY: focus.cropBboxPx.minY,
    maxX: focus.cropBboxPx.maxX,
    maxY: focus.cropBboxPx.maxY,
    w: focus.cropBboxPx.w,
    h: focus.cropBboxPx.h,
  };

  const scale = focus.cropScale;
  const displayHeight = focus.displayPxWithinCrop.height;


  // Load the aerial image once and capture natural size for resolver fallback.
  useEffect(() => {
    if (!rasterUrl) { imgRef.current = null; setImageNatural(null); return; }
    const img = new Image();
    // NOTE: do NOT set crossOrigin here. Google Static Maps does not return
    // CORS headers, so requesting CORS makes the image fail to load entirely
    // and the canvas falls through to the fallback fill (previously black).
    // We only display the canvas; we never read pixels back, so a tainted
    // canvas is acceptable and the raster actually renders.
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

    // The aerial raster is rendered as a normal DOM <img> behind this canvas.
    // That avoids Google Static Maps/CORS canvas edge-cases while keeping the
    // overlay canvas transparent. Only paint a neutral fallback when the aerial
    // layer is intentionally unavailable/disabled.
    if (!layers.aerial || !rasterUrl) {
      ctx.fillStyle = '#f8fafc';
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
  // Crop-aware display projection: subtract the active viewport offset so
  // Roof Focus displayed coordinates land INSIDE the visible canvas
  // (not at full-raster coordinates that exceed the cropped viewport).
  const projectedFirst = firstPt
    ? [(firstPt[0] - viewportSrc.minX) * scale, (firstPt[1] - viewportSrc.minY) * scale]
    : null;
  const bb = bboxOf(rawRing);
  const bbDisp = bb
    ? { cx: (bb.cx - viewportSrc.minX) * scale, cy: (bb.cy - viewportSrc.minY) * scale }
    : null;

  // Overlay Truth — the resolved frame source the report JSON authoritatively
  // exposes. Mirrors the backend early-DSM gate's resolveFrameMismatch so the
  // banner, debug card and gate read the same source.

  // exposes. Mirrors the backend early-DSM gate's resolveFrameMismatch so the
  // banner, debug card and gate read the same source.
  const overlayFrameResolution = resolveFrameMismatch(grj);
  const dsmTransformAvailable = dsmAllowed;

  // Build the SAME Overlay Transform object the diagnostics card renders and
  // pass it into computeAlignmentStatus. This is the wiring fix: alignment
  // logic now sees the already-resolved crop math, not a partial JSON re-read.
  const resolvedOverlayTransformDiagnostics = {
    coord_space: overlayCoordSpace,
    source_px: rasterSizeResolved
      ? { width: rasterSize.width, height: rasterSize.height }
      : null,
    crop_bbox_px: rasterSizeResolved
      ? {
          minX: viewportSrc.minX,
          minY: viewportSrc.minY,
          maxX: viewportSrc.maxX,
          maxY: viewportSrc.maxY,
        }
      : null,
    display_px_within_crop: rasterSizeResolved
      ? { width: containerWidth, height: displayHeight }
      : null,
    first_pt_disp: projectedFirst
      ? ([projectedFirst[0], projectedFirst[1]] as [number, number])
      : null,
    bbox_center_disp: bbDisp ? ([bbDisp.cx, bbDisp.cy] as [number, number]) : null,
    target_mask_overlap:
      typeof (phase35 as any)?.target_mask_overlap_with_perimeter === 'number'
        ? (phase35 as any).target_mask_overlap_with_perimeter
        : typeof (grj as any)?.target_mask_isolation?.target_mask_overlap_with_perimeter === 'number'
          ? (grj as any).target_mask_isolation.target_mask_overlap_with_perimeter
          : typeof (overlayDbg as any)?.target_mask_overlap === 'number'
            ? (overlayDbg as any).target_mask_overlap
            : null,
  };

  const alignmentStatus = computeAlignmentStatus(measurement, {
    overlayTransform: resolvedOverlayTransformDiagnostics,
  });

  // Banner source: when the resolved Overlay Transform proves the aerial crop
  // is valid (alignmentStatus === "ok"), force frame_mismatch="ok" into the
  // registration block before calling registrationBanner. This stops the UI
  // from showing "Coordinate frame mismatch" when the real failure is missing
  // DSM registration. Banner copy then correctly reads
  // "DSM registration incomplete — manual approval locked".
  const effectiveRegistration =
    alignmentStatus.raster_overlay_displacement === 'ok' && registration
      ? { ...registration, frame_mismatch: 'ok' as const }
      : registration;
  const banner = registrationBanner(effectiveRegistration);

  const showRasterImage = layers.aerial && !!rasterUrl && rasterSizeResolved;
  const rasterImageStyle: CSSProperties = {
    width: `${rasterSize.width * scale}px`,
    height: `${rasterSize.height * scale}px`,
    left: `${-viewportSrc.minX * scale}px`,
    top: `${-viewportSrc.minY * scale}px`,
  };




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
            Downstream DSM / topology / pitch self-consistency gates still apply on rerun.
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
          <div ref={wrapRef} className="relative w-full rounded-md overflow-hidden border bg-muted">
            {showRasterImage && (
              <img
                src={rasterUrl}
                alt="Aerial raster background"
                className="absolute z-0 max-w-none select-none pointer-events-none"
                style={rasterImageStyle}
                draggable={false}
              />
            )}
            {/* Viewport mode toggle (Full Tile / Roof Focus) */}
            {focusBbox && (
              <div className="absolute top-2 right-2 z-10 flex rounded border bg-background/90 backdrop-blur text-[11px] overflow-hidden shadow-sm">
                <button
                  type="button"
                  onClick={() => setViewportMode("full_tile")}
                  className={`px-2 py-1 ${viewportMode === "full_tile" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >
                  Full Tile
                </button>
                <button
                  type="button"
                  onClick={() => setViewportMode("roof_focus")}
                  className={`px-2 py-1 ${viewportMode === "roof_focus" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >
                  Roof Focus
                </button>
              </div>
            )}
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: displayHeight ? `${displayHeight}px` : 'auto', display: 'block', position: 'relative', zIndex: 1, touchAction: 'none', cursor: editMode ? 'crosshair' : 'default' }}
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
            {/* DSM Status card — read-only summary of DSM registration state */}
            {(() => {
              const f = resolveDsmStatusFields(grj);
              const dsmOverlayVisible = dsmAllowed && dsmEdges.length > 0;
              return (
                <div className="rounded-md border bg-muted/30 p-2.5">
                  <div className="text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">DSM Status</div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] font-mono">
                    <div className="text-muted-foreground">Status</div>
                    <div className="text-right">{f.statusLabel}</div>
                    <div className="text-muted-foreground">Size</div>
                    <div className="text-right">{f.dsmLoaded ? `${f.dsmW ?? '?'}×${f.dsmH ?? '?'}` : '—'}</div>
                    <div className="text-muted-foreground">Bounds</div>
                    <div className="text-right break-all">{f.dsmBoundsFailure ?? 'ok'}</div>
                    <div className="text-muted-foreground">Transform</div>
                    <div className="text-right break-all">{f.dsmTransformSource ?? 'unavailable'}</div>
                    <div className="text-muted-foreground">Overlay</div>
                    <div className="text-right">{dsmOverlayVisible ? 'shown' : 'suppressed'}</div>
                    <div className="text-muted-foreground">Policy</div>
                    <div className="text-right break-all">{f.policy}</div>
                  </div>
                </div>
              );
            })()}




            {/* Layer status summary — separates the three semantic layers */}
            {(() => {
              const aerialCandVisible =
                !!aerialCandidateGraph || rawRing.length >= 3;
              const dsmRegistered = (grj as any).dsm_pixel_transform_valid === true;
              const dsmTopologyStatus = !dsmRegistered ? 'unavailable' : (dsmEdges.length > 0 ? 'visible' : 'none');
              const reportableCount = Number(
                (grj as any).reportable_roof_lines_count ??
                (grj as any).reportable_roof_lines?.length ??
                (Array.isArray((grj as any).roof_lines) ? (grj as any).roof_lines.length : 0)
              );
              const reportableLabel = reportableCount > 0 ? `${reportableCount} lines` : 'none';
              const row = (label: string, status: string, tone: string) => (
                <div className="flex items-center justify-between text-[11px]">
                  <span>{label}</span>
                  <span className={`font-mono ${tone}`}>{status}</span>
                </div>
              );
              return (
                <div className="rounded-md border bg-muted/30 p-2.5">
                  <div className="text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">Layer Status</div>
                  <div className="space-y-1">
                    {row('Aerial perimeter candidate', aerialCandVisible ? 'visible' : 'none', aerialCandVisible ? 'text-emerald-600' : 'text-muted-foreground')}
                    {row('DSM-derived topology', dsmTopologyStatus, dsmTopologyStatus === 'visible' ? 'text-emerald-600' : 'text-muted-foreground')}
                    {row('Reportable roof lines', reportableLabel, reportableCount > 0 ? 'text-emerald-600' : 'text-muted-foreground')}
                  </div>
                </div>
              );
            })()}

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

            {/* Measurement Alignment — splits raster overlay drift vs DSM
                registration so the lock reason and copy reflect the real
                failure (see alignmentStatus helper). */}
            <div className="rounded-md border bg-muted/30 p-2.5">
              <div className="text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">Measurement Alignment</div>
              <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] font-mono">
                <div className="text-muted-foreground">Aerial overlay</div>
                <div className={`text-right ${alignmentStatus.raster_overlay_displacement === 'ok' ? 'text-emerald-600' : alignmentStatus.raster_overlay_displacement === 'mismatch' ? 'text-destructive' : ''}`}>
                  {alignmentStatus.raster_overlay_displacement === 'ok' ? 'aligned to raster crop' : alignmentStatus.raster_overlay_displacement}
                </div>
                <div className="text-muted-foreground">Roof focus crop</div>
                <div className="text-right">{focusRing && focusRing.length >= 3 ? 'active' : 'inactive'}</div>
                <div className="text-muted-foreground">DSM registration</div>
                <div className={`text-right ${alignmentStatus.dsm_registration_displacement === 'validated' ? 'text-emerald-600' : 'text-destructive'}`}>
                  {alignmentStatus.dsm_registration_displacement}
                </div>
                <div className="text-muted-foreground">Manual approval</div>
                <div className="text-right">
                  {alignmentStatus.manual_approval_lock_reason === null
                    ? 'allowed'
                    : alignmentStatus.manual_approval_lock_reason === 'dsm_registration_missing'
                    ? 'locked by DSM registration'
                    : alignmentStatus.manual_approval_lock_reason === 'frame_mismatch'
                    ? 'locked by frame mismatch'
                    : 'locked by unconfirmed roof target'}
                </div>
                <div className="text-muted-foreground">Displacement source</div>
                <div className="text-right">
                  {alignmentStatus.raster_overlay_displacement === 'ok' && alignmentStatus.dsm_registration_displacement !== 'validated'
                    ? 'DSM transform unavailable, not aerial overlay drift'
                    : alignmentStatus.raster_overlay_displacement === 'mismatch'
                    ? 'aerial overlay drift'
                    : '—'}
                </div>
              </div>
            </div>

            {/* Overlay Truth — labels are driven by the alignment helper so
                a valid raster crop is never labelled "unknown" or "frame
                mismatch" when the real lock is DSM registration. */}
            <div className="rounded-md border bg-muted/30 p-2.5">
              <div className="text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">Overlay Truth</div>
              <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] font-mono">
                <div className="text-muted-foreground">Overlay frame</div>
                <div className={`text-right ${alignmentStatus.raster_overlay_displacement === 'ok' ? 'text-emerald-600' : alignmentStatus.raster_overlay_displacement === 'mismatch' ? 'text-destructive' : ''}`}>
                  {alignmentStatus.raster_overlay_displacement === 'ok'
                    ? 'OK / crop-valid'
                    : alignmentStatus.raster_overlay_displacement === 'mismatch'
                    ? (overlayFrameResolution.frame_mismatch_raw ?? 'mismatch')
                    : 'unknown'}
                </div>
                <div className="text-muted-foreground">Overlay source</div>
                <div className="text-right break-all">
                  {alignmentStatus.raster_overlay_displacement === 'ok'
                    ? (focusRing && focusRing.length >= 3 ? 'roof_focus_crop / raster_px' : (overlayFrameResolution.frame_mismatch_source ?? 'raster_px'))
                    : (overlayFrameResolution.frame_mismatch_source ?? '—')}
                </div>
                <div className="text-muted-foreground">DSM transform</div>
                <div className="text-right">
                  {alignmentStatus.dsm_registration_displacement === 'validated' ? 'available' : alignmentStatus.dsm_registration_displacement}
                </div>
                <div className="text-muted-foreground">Manual approval</div>
                <div className="text-right">
                  {approvalAllowed
                    ? 'allowed'
                    : alignmentStatus.manual_approval_lock_reason === 'dsm_registration_missing'
                    ? 'locked by DSM registration'
                    : alignmentStatus.manual_approval_lock_reason === 'frame_mismatch'
                    ? 'locked by frame mismatch'
                    : alignmentStatus.manual_approval_lock_reason === 'target_unconfirmed'
                    ? 'locked by unconfirmed roof target'
                    : 'locked'}
                </div>
              </div>
              {/* Explicit displacement metrics — distinguishes Roof Focus
                  visual displacement from the legacy global centroid offset. */}
              <div className="mt-2 pt-2 border-t border-border/40 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] font-mono">
                <div className="text-muted-foreground">Perimeter bbox center src</div>
                <div className="text-right">{alignmentStatus.metrics.perimeter_bbox_center_src ? `${alignmentStatus.metrics.perimeter_bbox_center_src[0].toFixed(1)},${alignmentStatus.metrics.perimeter_bbox_center_src[1].toFixed(1)}` : '—'}</div>
                <div className="text-muted-foreground">Confirmed center src</div>
                <div className="text-right">{alignmentStatus.metrics.confirmed_center_src ? `${alignmentStatus.metrics.confirmed_center_src[0].toFixed(0)},${alignmentStatus.metrics.confirmed_center_src[1].toFixed(0)}` : '—'}</div>
                <div className="text-muted-foreground">Raster center offset</div>
                <div className="text-right">{alignmentStatus.metrics.raster_center_offset_px != null ? `${alignmentStatus.metrics.raster_center_offset_px.toFixed(1)} px` : '—'}</div>
                <div className="text-muted-foreground">Target mask overlap</div>
                <div className="text-right">{alignmentStatus.metrics.target_mask_overlap != null ? alignmentStatus.metrics.target_mask_overlap.toFixed(3) : '—'}</div>
                <div className="text-muted-foreground">Perimeter vs mask IoU</div>
                <div className="text-right">{alignmentStatus.metrics.perimeter_vs_mask_iou != null ? alignmentStatus.metrics.perimeter_vs_mask_iou.toFixed(3) : '—'}</div>
                {alignmentStatus.metrics.legacy_centroid_offset_px != null && (
                  <>
                    <div className="text-muted-foreground col-span-2 mt-1 text-[10px] italic">
                      Legacy centroid offset: {alignmentStatus.metrics.legacy_centroid_offset_px.toFixed(0)} px (legacy/global diagnostic; not Roof Focus visual displacement)
                    </div>
                  </>
                )}
              </div>
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
                <div className="text-muted-foreground">source_px</div>
                <div className="text-right">{rasterSize.width}×{rasterSize.height}</div>
                <div className="text-muted-foreground">crop_bbox_px</div>
                <div className="text-right">{`${Math.round(viewportSrc.minX)},${Math.round(viewportSrc.minY)}→${Math.round(viewportSrc.maxX)},${Math.round(viewportSrc.maxY)}`}</div>
                <div className="text-muted-foreground">display_px_within_crop</div>
                <div className="text-right">{Math.round(containerWidth)}×{Math.round(displayHeight)}</div>
                <div className="text-muted-foreground">crop_scale</div>
                <div className="text-right">{scale.toFixed(4)}</div>
                <div className="text-muted-foreground">crop_offset</div>
                <div className="text-right">{`-${Math.round(viewportSrc.minX)}, -${Math.round(viewportSrc.minY)}`}</div>
                <div className="text-muted-foreground">first_pt_src</div>
                <div className="text-right">{firstPt ? `${firstPt[0].toFixed(1)},${firstPt[1].toFixed(1)}` : '—'}</div>
                <div className="text-muted-foreground">first_pt_disp</div>
                <div className="text-right">{projectedFirst ? `${projectedFirst[0].toFixed(1)},${projectedFirst[1].toFixed(1)}` : '—'}</div>
                <div className="text-muted-foreground">bbox_center_src</div>
                <div className="text-right">{bb ? `${bb.cx.toFixed(1)},${bb.cy.toFixed(1)}` : '—'}</div>
                <div className="text-muted-foreground">bbox_center_disp</div>
                <div className="text-right">{bbDisp ? `${bbDisp.cx.toFixed(1)},${bbDisp.cy.toFixed(1)}` : '—'}</div>
                <div className="text-muted-foreground">confirmed_center_src</div>
                <div className="text-right">{confirmedCenterPx ? `${confirmedCenterPx[0].toFixed(0)},${confirmedCenterPx[1].toFixed(0)}` : '—'}</div>
                <div className="text-muted-foreground">frame_mismatch</div>
                <div className={`text-right ${overlayFrameResolution.frame_mismatch_ok ? '' : 'text-destructive'}`}>
                  {overlayFrameResolution.frame_mismatch_ok ? 'ok' : (frameCheck.mismatch ? `${frameCheck.distancePx.toFixed(1)}px (>${frameCheck.tolerancePx.toFixed(1)})` : (overlayFrameResolution.frame_mismatch_raw ?? 'unknown'))}
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
                title={!approvalAllowed ? 'Roof target not confirmed — re-place PIN to continue.' : undefined}
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
                  title={!approvalAllowed ? 'Roof target not confirmed — re-place PIN to continue.' : undefined}
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
                  title={!approvalAllowed ? 'Roof target not confirmed — re-place PIN to continue.' : undefined}
                >
                  <XCircle className="h-4 w-4 mr-1" /> Reject
                </Button>
              </div>
              {!approvalAllowed && (
                <p className="text-[11px] text-destructive font-semibold leading-snug">
                  Cannot approve perimeter: roof target not confirmed. Re-place the PIN on the actual roof to continue.
                </p>
              )}
              {approvalAllowed && registration?.dsm_registration_status === 'unavailable_but_aerial_perimeter_editable' && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
                  DSM registration unavailable — manual approval saves the aerial perimeter and unlocks a rerun.
                  DSM / topology / pitch self-consistency must still pass before a customer report can be generated.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground leading-snug">
                Manual approval only unlocks topology diagnostics on rerun. <code>customer_report_ready</code> stays
                <code> false</code> until perimeter + topology + pitch self-consistency gates all pass.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MeasurementVisualQAOverlay;
