import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Crosshair,
  Eye,
  Layers,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * AI Measurement 3D / step-by-step Debug Viewer.
 *
 * Diagnostic-only. Not for customers. Reads from the measurement's
 * geometry_report_json + sibling debug payloads. Pure frontend — no
 * backend writes. SVG/Canvas based; upgradeable to Three.js later.
 */

interface Props {
  measurement: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type StageStatus = 'pass' | 'fail' | 'warn' | 'skip' | 'unknown';

interface StageDef {
  id: string;
  label: string;
  status: StageStatus;
  source?: string;
  reason?: string;
  payload: any;
}

const statusColor: Record<StageStatus, string> = {
  pass: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  fail: 'bg-destructive/15 text-destructive border-destructive/40',
  warn: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  skip: 'bg-muted text-muted-foreground border-border',
  unknown: 'bg-muted text-muted-foreground border-border',
};

const statusIcon: Record<StageStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="h-3.5 w-3.5" />,
  fail: <XCircle className="h-3.5 w-3.5" />,
  warn: <CircleAlert className="h-3.5 w-3.5" />,
  skip: <Activity className="h-3.5 w-3.5" />,
  unknown: <Activity className="h-3.5 w-3.5" />,
};

function pickStatus(ok: boolean | null | undefined, present: boolean): StageStatus {
  if (!present) return 'unknown';
  if (ok === true) return 'pass';
  if (ok === false) return 'fail';
  return 'warn';
}

function buildStages(m: any): StageDef[] {
  const grj = m?.geometry_report_json || {};
  const ctx = grj.source_context_debug || {};
  const acq = grj.acquisition_audit || ctx.acquisition_audit || {};
  const phase0 = grj.perimeter_phase0 || ctx.perimeter_phase0 || grj.perimeter_gate_metrics || {};
  const targetMask = grj.target_mask_isolation || ctx.target_mask_isolation || {};
  const overlayDbg = grj.overlay_debug || {};
  const dsm = grj.dsm_planar_graph_debug || {};
  const topo = grj.topology_hierarchy_summary || {};
  const pitch = grj.pitch_resolver_debug || {};
  const customerGate = grj.customer_gate_debug || {};
  const layer1 = grj.layer1_perimeter || ctx.layer1_perimeter || {};

  const userConfirmed = m?.user_confirmed_roof_target ?? grj.user_confirmed_roof_target;
  const adminOverride = m?.roof_target_admin_override ?? grj.roof_target_admin_override;
  const targetOk = !!(userConfirmed || adminOverride);

  const acquisitionOk =
    acq?.selected_source != null &&
    acq?.selected_source !== 'none' &&
    acq?.selected_source !== 'unknown';

  const rasterOk = !!(overlayDbg?.raster_url || m?.satellite_overlay_url || m?.google_maps_image_url);

  const dsmOk =
    dsm?.coverage != null
      ? Number(dsm.coverage) >= 0.85
      : Boolean(dsm?.heightmap_url || dsm?.has_dsm);

  const perimeterCandidatesPresent = Array.isArray(layer1?.candidates) || Array.isArray(grj?.perimeter_candidates);

  const layer1Ok =
    layer1?.perimeter_status === 'accepted' ||
    !!grj?.true_outer_roof_perimeter_geo ||
    !!grj?.true_outer_roof_perimeter_px;

  const phase0Ran = !!phase0?.ran || !!phase0?.executed || Object.keys(phase0).length > 0;
  const phase0Ok = phase0?.ok === true || phase0?.passed === true;

  const targetMaskOk =
    targetMask?.target_mask_component_id != null &&
    (targetMask?.missed_target_roof_pct == null ||
      Number(targetMask.missed_target_roof_pct) < 15);

  const solarOk = Array.isArray(grj?.solar_segments)
    ? grj.solar_segments.length > 0
    : !!grj?.google_solar_segments_count;

  const pitchOk = pitch?.pitch_valid === true || (m?.predominant_pitch != null && m.predominant_pitch > 0);

  const topoOk =
    topo?.facets_count != null
      ? Number(topo.facets_count) >= 3
      : Number(m?.facet_count || 0) >= 3;

  const finalOk = !!grj?.final_diagram_url || Array.isArray(grj?.roof_lines);

  const customerReady =
    m?.customer_report_ready === true || customerGate?.customer_report_ready === true;

  return [
    {
      id: 'target',
      label: 'Target confirmation',
      status: targetOk ? 'pass' : 'fail',
      source: adminOverride ? 'admin_override' : userConfirmed ? 'user_confirmed' : 'none',
      reason: targetOk ? undefined : 'AI Measurement blocked: roof target not confirmed.',
      payload: {
        original_geocode_lat_lng: grj.original_geocode_lat_lng ?? null,
        confirmed_roof_center_lat_lng: grj.confirmed_roof_center_lat_lng ?? {
          lat: m?.target_lat,
          lng: m?.target_lng,
        },
        marker_offset_ft: grj.marker_offset_ft ?? null,
        user_confirmed_roof_target: userConfirmed ?? false,
        roof_target_admin_override: adminOverride ?? false,
        lat_lng_source: grj.lat_lng_source ?? null,
      },
    },
    {
      id: 'acquisition',
      label: 'Source acquisition',
      status: pickStatus(acquisitionOk, Object.keys(acq).length > 0 || acquisitionOk),
      source: acq?.selected_source ?? null,
      reason: acquisitionOk
        ? undefined
        : acq?.failure_reason || 'No imagery source selected.',
      payload: acq,
    },
    {
      id: 'raster',
      label: 'Raster tile / DSM',
      status: pickStatus(rasterOk && dsmOk, true),
      source: overlayDbg?.imagery_source || m?.selected_image_source || m?.image_source,
      payload: {
        raster_url: overlayDbg?.raster_url || m?.satellite_overlay_url || m?.google_maps_image_url,
        raster_size: overlayDbg?.raster_size || m?.analysis_image_size,
        tile_center_lat_lng: overlayDbg?.tile_center_lat_lng,
        tile_ground_extent_m: overlayDbg?.tile_ground_extent_m,
        actual_mpp: overlayDbg?.actual_mpp,
        coordinate_space: overlayDbg?.coordinate_space_solver,
        dsm_coverage: dsm?.coverage,
        dsm_heightmap_url: dsm?.heightmap_url,
      },
    },
    {
      id: 'perimeter_candidates',
      label: 'Perimeter candidates',
      status: pickStatus(perimeterCandidatesPresent, perimeterCandidatesPresent),
      payload: {
        candidates: layer1?.candidates || grj?.perimeter_candidates || [],
        forbidden: ['solar_union', 'solar_hull', 'solar_bbox', 'parcel', 'global_mask'],
      },
    },
    {
      id: 'layer1',
      label: 'Layer-1 true perimeter',
      status: pickStatus(layer1Ok, true),
      source: layer1?.selected_source,
      reason: layer1Ok ? undefined : layer1?.rejection_reason,
      payload: {
        true_outer_roof_perimeter_px: grj?.true_outer_roof_perimeter_px,
        true_outer_roof_perimeter_geo: grj?.true_outer_roof_perimeter_geo,
        eave_edges: layer1?.eave_edges,
        rake_edges: layer1?.rake_edges,
        roof_corners: layer1?.roof_corners,
        perimeter_confidence: layer1?.perimeter_confidence,
        perimeter_status: layer1?.perimeter_status,
      },
    },
    {
      id: 'phase0',
      label: 'Perimeter Phase 0 gate',
      status: phase0Ran ? (phase0Ok ? 'pass' : 'fail') : 'fail',
      reason: phase0Ran
        ? phase0?.failure_reason
        : 'BUG: Perimeter Phase 0 may have been bypassed.',
      payload: phase0,
    },
    {
      id: 'target_mask',
      label: 'Target-mask isolation',
      status: pickStatus(targetMaskOk, Object.keys(targetMask).length > 0),
      payload: targetMask,
    },
    {
      id: 'solar',
      label: 'Solar segments',
      status: pickStatus(solarOk, true),
      payload: {
        segments: grj?.solar_segments || [],
        google_solar_segments_count: grj?.google_solar_segments_count,
      },
    },
    {
      id: 'pitch',
      label: 'Pitch resolver',
      status: pickStatus(pitchOk, true),
      source: pitch?.pitch_source,
      reason: pitch?.pitch_valid === false ? pitch?.rejected_pitch_reason : undefined,
      payload: {
        pitch_source: pitch?.pitch_source,
        pitch_valid: pitch?.pitch_valid,
        solar_pitch_degrees: pitch?.solar_pitch_degrees,
        dsm_plane_pitch: pitch?.dsm_plane_pitch,
        final_predominant_pitch: pitch?.final_predominant_pitch ?? m?.predominant_pitch,
        rejected_pitch_reason: pitch?.rejected_pitch_reason,
      },
    },
    {
      id: 'topology',
      label: 'Internal topology',
      status: pickStatus(topoOk, Object.keys(topo).length > 0 || topoOk),
      payload: topo,
    },
    {
      id: 'final',
      label: 'Final diagram',
      status: pickStatus(finalOk, true),
      payload: {
        final_diagram_url: grj?.final_diagram_url,
        roof_lines_count: Array.isArray(grj?.roof_lines) ? grj.roof_lines.length : 0,
        totals: {
          eave: m?.total_eave_length,
          rake: m?.total_rake_length,
          ridge: m?.total_ridge_length,
          hip: m?.total_hip_length,
          valley: m?.total_valley_length,
        },
        vendor_benchmark: grj?.vendor_benchmark || null,
      },
    },
    {
      id: 'gate',
      label: 'Customer report gate',
      status: customerReady ? 'pass' : 'fail',
      reason: customerReady ? undefined : m?.customer_report_block_reason || customerGate?.block_reason,
      payload: {
        result_state: m?.result_state,
        customer_report_ready: customerReady,
        customer_report_block_reason: m?.customer_report_block_reason,
        ...customerGate,
      },
    },
  ];
}

interface LayerToggle {
  key: string;
  label: string;
  default: boolean;
}

const LAYER_TOGGLES: LayerToggle[] = [
  { key: 'raster', label: 'Aerial raster', default: true },
  { key: 'geocode', label: 'Original geocode', default: true },
  { key: 'confirmed', label: 'Confirmed roof center', default: true },
  { key: 'solar', label: 'Solar segments', default: true },
  { key: 'targetMask', label: 'Target roof mask', default: true },
  { key: 'globalMask', label: 'Global mask', default: false },
  { key: 'missed', label: 'Missed roof regions', default: true },
  { key: 'perimeter', label: 'Selected perimeter', default: true },
  { key: 'eaves', label: 'Eaves', default: true },
  { key: 'rakes', label: 'Rakes', default: true },
  { key: 'ridges', label: 'Ridges', default: true },
  { key: 'hips', label: 'Hips', default: false },
  { key: 'valleys', label: 'Valleys', default: false },
  { key: 'rejected', label: 'Rejected edges', default: false },
];

export const AIMeasurement3DDebugViewer: React.FC<Props> = ({
  measurement,
  open,
  onOpenChange,
}) => {
  const stages = useMemo(() => buildStages(measurement), [measurement]);
  const [activeStage, setActiveStage] = useState<string>(stages[0]?.id || 'target');
  const [layers, setLayers] = useState<Record<string, boolean>>(
    () => Object.fromEntries(LAYER_TOGGLES.map((l) => [l.key, l.default])),
  );

  const grj = measurement?.geometry_report_json || {};
  const overlayDbg = grj.overlay_debug || {};
  const rasterUrl: string | undefined =
    overlayDbg?.raster_url || measurement?.satellite_overlay_url || measurement?.google_maps_image_url;

  const stage = stages.find((s) => s.id === activeStage) || stages[0];

  const phase0Bypassed = (() => {
    const ph = stages.find((s) => s.id === 'phase0');
    const tm = stages.find((s) => s.id === 'target_mask');
    return ph?.status === 'fail' && tm && tm.status !== 'unknown';
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1200px] w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            AI Measurement Process Viewer
            <Badge variant="outline" className="ml-2">Diagnostic</Badge>
          </DialogTitle>
          <DialogDescription>
            Step-by-step visualization of the AI Measurement pipeline. Internal use only —
            not for customers.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 grid grid-cols-[260px_1fr_320px] gap-0">
          {/* LEFT: stage timeline */}
          <div className="border-r overflow-y-auto">
            <ScrollArea className="h-full">
              <div className="p-3 space-y-1">
                {stages.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveStage(s.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-md border text-sm transition-colors',
                      'flex items-start gap-2',
                      activeStage === s.id
                        ? 'bg-primary/10 border-primary/40'
                        : 'border-transparent hover:bg-muted',
                    )}
                  >
                    <span className="text-xs text-muted-foreground w-5 mt-0.5">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{s.label}</div>
                      {s.source && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          src: {s.source}
                        </div>
                      )}
                      {s.reason && (
                        <div className="text-[11px] text-destructive truncate">{s.reason}</div>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] px-1.5 py-0 gap-1', statusColor[s.status])}
                    >
                      {statusIcon[s.status]}
                      {s.status}
                    </Badge>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* CENTER: canvas */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <div className="flex items-center gap-2 text-sm">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{stage?.label}</span>
                <Badge
                  variant="outline"
                  className={cn('text-[10px] px-1.5 py-0 gap-1', statusColor[stage?.status || 'unknown'])}
                >
                  {statusIcon[stage?.status || 'unknown']}
                  {stage?.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Run: {measurement?.id?.slice(0, 8)} · engine{' '}
                {measurement?.ai_measurement_engine_version || '—'}
              </div>
            </div>

            {phase0Bypassed && (
              <div className="mx-4 mt-3 p-3 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                <div>
                  <div className="font-semibold">BUG: Perimeter Phase 0 was bypassed</div>
                  <div className="text-xs">
                    Target-mask isolation has data but the perimeter gate didn't run.
                    AI Measurement should not have proceeded.
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0 p-4">
              <DebugCanvas
                measurement={measurement}
                stage={stage}
                layers={layers}
                rasterUrl={rasterUrl}
              />
            </div>
          </div>

          {/* RIGHT: layers + payload */}
          <div className="border-l overflow-y-auto">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                    Layers
                  </div>
                  <div className="space-y-2">
                    {LAYER_TOGGLES.map((l) => (
                      <div key={l.key} className="flex items-center justify-between">
                        <Label htmlFor={`layer-${l.key}`} className="text-sm cursor-pointer">
                          {l.label}
                        </Label>
                        <Switch
                          id={`layer-${l.key}`}
                          checked={layers[l.key]}
                          onCheckedChange={(v) =>
                            setLayers((prev) => ({ ...prev, [l.key]: v }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                    Stage payload
                  </div>
                  <pre className="text-[10px] bg-muted/40 p-2 rounded border overflow-auto max-h-[400px]">
                    {JSON.stringify(stage?.payload ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>

        <div className="px-6 py-3 border-t flex justify-between items-center text-xs text-muted-foreground">
          <span>
            result_state:{' '}
            <span className="font-mono text-foreground">
              {measurement?.result_state || '—'}
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------- Canvas ---------------- */

interface CanvasProps {
  measurement: any;
  stage: StageDef | undefined;
  layers: Record<string, boolean>;
  rasterUrl?: string;
}

function DebugCanvas({ measurement, stage, layers, rasterUrl }: CanvasProps) {
  const grj = measurement?.geometry_report_json || {};
  const overlayDbg = grj.overlay_debug || {};
  const size = overlayDbg?.raster_size ||
    measurement?.analysis_image_size || { width: 800, height: 800 };
  const W = Number(size.width) || 800;
  const H = Number(size.height) || 800;

  const perimeterPx: Array<[number, number]> | undefined =
    grj?.true_outer_roof_perimeter_px || grj?.footprint_px;
  const solarSegments: any[] = Array.isArray(grj?.solar_segments) ? grj.solar_segments : [];
  const eaves: any[] = grj?.layer1_perimeter?.eave_edges || [];
  const rakes: any[] = grj?.layer1_perimeter?.rake_edges || [];
  const roofLines: any[] = Array.isArray(grj?.roof_lines) ? grj.roof_lines : [];

  const ridges = roofLines.filter((l) => l.attribute === 'ridge');
  const hips = roofLines.filter((l) => l.attribute === 'hip');
  const valleys = roofLines.filter((l) => l.attribute === 'valley');
  const rejected = roofLines.filter((l) => l.rejected);

  return (
    <div className="relative w-full h-full rounded-lg border bg-muted/30 overflow-hidden">
      {rasterUrl && layers.raster ? (
        <img
          src={rasterUrl}
          alt="Aerial raster"
          className="absolute inset-0 w-full h-full object-contain bg-black"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          No raster tile available for this run.
        </div>
      )}

      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Perimeter */}
        {layers.perimeter && perimeterPx && perimeterPx.length > 2 && (
          <polygon
            points={perimeterPx.map((p) => `${p[0]},${p[1]}`).join(' ')}
            fill="rgba(34,197,94,0.08)"
            stroke="#22c55e"
            strokeWidth={3}
          />
        )}

        {/* Eaves */}
        {layers.eaves &&
          eaves.map((e: any, i: number) =>
            e?.p1 && e?.p2 ? (
              <line
                key={`eave-${i}`}
                x1={e.p1[0]}
                y1={e.p1[1]}
                x2={e.p2[0]}
                y2={e.p2[1]}
                stroke="#22c55e"
                strokeWidth={4}
              />
            ) : null,
          )}

        {/* Rakes */}
        {layers.rakes &&
          rakes.map((e: any, i: number) =>
            e?.p1 && e?.p2 ? (
              <line
                key={`rake-${i}`}
                x1={e.p1[0]}
                y1={e.p1[1]}
                x2={e.p2[0]}
                y2={e.p2[1]}
                stroke="#a855f7"
                strokeWidth={3}
                strokeDasharray="6,3"
              />
            ) : null,
          )}

        {/* Solar segments */}
        {layers.solar &&
          solarSegments.map((seg: any, i: number) => {
            const poly = seg.polygon_px || seg.bbox_px;
            if (!poly || !Array.isArray(poly) || poly.length < 3) return null;
            return (
              <g key={`solar-${i}`}>
                <polygon
                  points={poly.map((p: [number, number]) => `${p[0]},${p[1]}`).join(' ')}
                  fill="rgba(59,130,246,0.18)"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                />
                {seg.center_px && seg.azimuth_degrees != null && (
                  <line
                    x1={seg.center_px[0]}
                    y1={seg.center_px[1]}
                    x2={seg.center_px[0] + 25 * Math.sin((seg.azimuth_degrees * Math.PI) / 180)}
                    y2={seg.center_px[1] - 25 * Math.cos((seg.azimuth_degrees * Math.PI) / 180)}
                    stroke="#3b82f6"
                    strokeWidth={2}
                    markerEnd="url(#arrow)"
                  />
                )}
              </g>
            );
          })}

        {/* Ridges */}
        {layers.ridges &&
          ridges.map((l: any, i: number) =>
            l?.p1 && l?.p2 ? (
              <line
                key={`ridge-${i}`}
                x1={l.p1[0]}
                y1={l.p1[1]}
                x2={l.p2[0]}
                y2={l.p2[1]}
                stroke="#ef4444"
                strokeWidth={3}
              />
            ) : null,
          )}

        {/* Hips */}
        {layers.hips &&
          hips.map((l: any, i: number) =>
            l?.p1 && l?.p2 ? (
              <line
                key={`hip-${i}`}
                x1={l.p1[0]}
                y1={l.p1[1]}
                x2={l.p2[0]}
                y2={l.p2[1]}
                stroke="#f59e0b"
                strokeWidth={2.5}
              />
            ) : null,
          )}

        {/* Valleys */}
        {layers.valleys &&
          valleys.map((l: any, i: number) =>
            l?.p1 && l?.p2 ? (
              <line
                key={`valley-${i}`}
                x1={l.p1[0]}
                y1={l.p1[1]}
                x2={l.p2[0]}
                y2={l.p2[1]}
                stroke="#06b6d4"
                strokeWidth={2.5}
              />
            ) : null,
          )}

        {/* Rejected */}
        {layers.rejected &&
          rejected.map((l: any, i: number) =>
            l?.p1 && l?.p2 ? (
              <line
                key={`rej-${i}`}
                x1={l.p1[0]}
                y1={l.p1[1]}
                x2={l.p2[0]}
                y2={l.p2[1]}
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="3,3"
                opacity={0.5}
              />
            ) : null,
          )}

        {/* Confirmed roof center */}
        {layers.confirmed && (
          <g>
            <circle cx={W / 2} cy={H / 2} r={10} fill="none" stroke="#22c55e" strokeWidth={2} />
            <line x1={W / 2 - 14} y1={H / 2} x2={W / 2 + 14} y2={H / 2} stroke="#22c55e" />
            <line x1={W / 2} y1={H / 2 - 14} x2={W / 2} y2={H / 2 + 14} stroke="#22c55e" />
          </g>
        )}

        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#3b82f6" />
          </marker>
        </defs>
      </svg>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 bg-background/90 rounded px-2 py-1 text-[10px] flex flex-wrap gap-2 border">
        <LegendDot color="#22c55e" label="Perimeter / Eaves" />
        <LegendDot color="#a855f7" label="Rakes" />
        <LegendDot color="#ef4444" label="Ridges" />
        <LegendDot color="#f59e0b" label="Hips" />
        <LegendDot color="#06b6d4" label="Valleys" />
        <LegendDot color="#3b82f6" label="Solar" />
      </div>

      <div className="absolute top-2 right-2 bg-background/90 rounded px-2 py-1 text-[10px] border flex items-center gap-1">
        <Crosshair className="h-3 w-3 text-emerald-600" />
        Active stage:{' '}
        <span className="font-medium text-foreground">{stage?.label}</span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-0.5" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export default AIMeasurement3DDebugViewer;
