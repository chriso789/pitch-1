import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Crosshair,
  Eye,
  Layers,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveMeasurementDiagnosticState } from "@/lib/measurements/measurementDiagnosticState";

/**
 * AI Measurement 3D / step-by-step Debug Viewer.
 *
 * Diagnostic-only. Not for customers. Reads from the measurement's
 * geometry_report_json + sibling debug payloads. Pure frontend — no
 * backend writes. SVG/Canvas based; upgradeable to Three.js later.
 */

interface Props {
  measurement: any;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render inline (no Dialog wrapper) for embedding in the report. */
  embedded?: boolean;
}

type StageStatus = "pass" | "fail" | "warn" | "skip" | "unknown";

interface StageDef {
  id: string;
  label: string;
  status: StageStatus;
  source?: string;
  reason?: string;
  payload: any;
}

const statusColor: Record<StageStatus, string> = {
  pass: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  fail: "bg-destructive/15 text-destructive border-destructive/40",
  warn: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  skip: "bg-muted text-muted-foreground border-border",
  unknown: "bg-muted text-muted-foreground border-border",
};

const statusIcon: Record<StageStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="h-3.5 w-3.5" />,
  fail: <XCircle className="h-3.5 w-3.5" />,
  warn: <CircleAlert className="h-3.5 w-3.5" />,
  skip: <Activity className="h-3.5 w-3.5" />,
  unknown: <Activity className="h-3.5 w-3.5" />,
};

function pickStatus(
  ok: boolean | null | undefined,
  present: boolean,
): StageStatus {
  if (!present) return "unknown";
  if (ok === true) return "pass";
  if (ok === false) return "fail";
  return "warn";
}

function buildStages(m: any): StageDef[] {
  const grj = m?.geometry_report_json || {};
  const resolvedState = resolveMeasurementDiagnosticState(m);
  const ctx = grj.source_context_debug || {};
  const acq = grj.acquisition_audit || ctx.acquisition_audit || {};
  const phase0 = grj.perimeter_phase0 || ctx.perimeter_phase0 ||
    grj.perimeter_gate_metrics || {};
  const targetMask = grj.target_mask_isolation || ctx.target_mask_isolation ||
    {};
  const overlayDbg = grj.overlay_debug || {};
  const dsm = grj.dsm_planar_graph_debug || {};
  const topo = grj.topology_hierarchy_summary || {};
  const pitch = grj.pitch_resolver_debug || {};
  const customerGate = grj.customer_gate_debug || {};
  const layer1 = grj.layer1_perimeter || ctx.layer1_perimeter || {};

  const userConfirmed = m?.user_confirmed_roof_target ??
    grj.user_confirmed_roof_target;
  const adminOverride = m?.roof_target_admin_override ??
    grj.roof_target_admin_override;
  const targetOk = resolvedState.target_confirmation_passed ||
    !!(userConfirmed || adminOverride);

  const acquisitionOk = resolvedState.source_acquisition_completed ||
    acq?.selected_source != null &&
      acq?.selected_source !== "none" &&
      acq?.selected_source !== "unknown";

  const rasterOk = !!(overlayDbg?.raster_url || m?.satellite_overlay_url ||
    m?.google_maps_image_url);

  const dsmOk = resolvedState.dsm_loaded ||
    (dsm?.coverage != null
      ? Number(dsm.coverage) >= 0.85
      : Boolean(dsm?.heightmap_url || dsm?.has_dsm));

  const perimeterCandidatesPresent = Array.isArray(layer1?.candidates) ||
    Array.isArray(grj?.perimeter_candidates);

  const layer1Ok = layer1?.perimeter_status === "accepted" ||
    !!grj?.true_outer_roof_perimeter_geo ||
    !!grj?.true_outer_roof_perimeter_px;

  const phase0Ran = !!phase0?.ran || !!phase0?.executed ||
    Object.keys(phase0).length > 0;
  const phase0Ok = phase0?.ok === true || phase0?.passed === true;

  const targetMaskOk = targetMask?.target_mask_component_id != null &&
    (targetMask?.missed_target_roof_pct == null ||
      Number(targetMask.missed_target_roof_pct) < 15);

  const solarOk = Array.isArray(grj?.solar_segments)
    ? grj.solar_segments.length > 0
    : !!grj?.google_solar_segments_count;

  const pitchOk = pitch?.pitch_valid === true ||
    (m?.predominant_pitch != null && m.predominant_pitch > 0);

  const facetCount = Number(m?.facet_count ?? topo?.facets_count ?? 0);
  const roofLinesCount = Array.isArray(grj?.roof_lines)
    ? grj.roof_lines.length
    : Number(grj?.roof_lines_count ?? 0);
  const topoOk = topo?.facets_count != null
    ? Number(topo.facets_count) >= 3
    : facetCount >= 3;

  // Final diagram CANNOT pass without real geometry. Zero facets AND zero
  // roof_lines means we have nothing reportable, regardless of any URL.
  const hasFinalGeometry = facetCount > 0 || roofLinesCount > 0;
  const finalOk = hasFinalGeometry &&
    (!!grj?.final_diagram_url || Array.isArray(grj?.roof_lines));

  const customerReady = m?.customer_report_ready === true ||
    customerGate?.customer_report_ready === true;

  return [
    {
      id: "target",
      label: "Target confirmation",
      status: targetOk ? "pass" : "fail",
      source: adminOverride
        ? "admin_override"
        : userConfirmed
        ? "user_confirmed"
        : "none",
      reason: targetOk
        ? undefined
        : "AI Measurement blocked: roof target not confirmed.",
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
      id: "acquisition",
      label: "Source acquisition",
      status: pickStatus(
        acquisitionOk,
        Object.keys(acq).length > 0 || acquisitionOk,
      ),
      source: acq?.selected_source ?? null,
      reason: acquisitionOk
        ? undefined
        : acq?.failure_reason || "No imagery source selected.",
      payload: acq,
    },
    {
      id: "raster",
      label: "Raster tile / DSM fetch",
      status: pickStatus(rasterOk && dsmOk, true),
      source: overlayDbg?.imagery_source || m?.selected_image_source ||
        m?.image_source,
      payload: {
        raster_url: overlayDbg?.raster_url || m?.satellite_overlay_url ||
          m?.google_maps_image_url,
        raster_size: overlayDbg?.raster_size || m?.analysis_image_size,
        tile_center_lat_lng: overlayDbg?.tile_center_lat_lng,
        tile_ground_extent_m: overlayDbg?.tile_ground_extent_m,
        actual_mpp: overlayDbg?.actual_mpp,
        coordinate_space: overlayDbg?.coordinate_space_solver,
        dsm_coverage: dsm?.coverage,
        dsm_heightmap_url: dsm?.heightmap_url,
        dsm_loaded: resolvedState.dsm_loaded,
        dsm_size_px: grj?.registration?.dsm_size_px ?? grj?.dsm_size_px ?? null,
      },
    },
    {
      id: "dsm_transform",
      label: "DSM georegistration / transform",
      status: resolvedState.dsm_transform_valid
        ? "pass"
        : (resolvedState.dsm_loaded ? "fail" : "unknown"),
      reason: resolvedState.dsm_transform_valid
        ? undefined
        : "DSM was fetched, but georegistration (tile bounds / geo→DSM / DSM→raster transform) is invalid or missing.",
      payload: {
        dsm_tile_bounds_lat_lng:
          grj?.registration?.dsm_tile_bounds_lat_lng ??
            grj?.dsm_tile_bounds_lat_lng ?? null,
        geo_to_dsm_transform: grj?.registration?.geo_to_dsm_transform ?? null,
        dsm_to_raster_transform:
          grj?.registration?.dsm_to_raster_transform ?? null,
        dsm_pixel_transform_valid:
          grj?.registration?.dsm_pixel_transform_valid ?? null,
        geo_to_dsm_px_success: grj?.registration?.geo_to_dsm_px_success ?? null,
        transform_package_valid:
          grj?.registration?.transform_package_valid ?? null,
        transform_failure_reasons:
          grj?.registration?.transform_failure_reasons ?? null,
      },
    },
    {
      id: "perimeter_candidates",
      label: "Perimeter candidates",
      status: pickStatus(
        perimeterCandidatesPresent,
        perimeterCandidatesPresent,
      ),
      payload: {
        candidates: layer1?.candidates || grj?.perimeter_candidates || [],
        forbidden: [
          "solar_union",
          "solar_hull",
          "solar_bbox",
          "parcel",
          "global_mask",
        ],
      },
    },
    {
      id: "layer1",
      label: "Layer-1 true perimeter",
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
      id: "phase0",
      label: "Perimeter Phase 0 gate",
      status: phase0Ran ? (phase0Ok ? "pass" : "fail") : "fail",
      reason: phase0Ran
        ? phase0?.failure_reason
        : resolvedState.phase0_incomplete_reason === "runtime_preemption"
        ? "Perimeter Phase 0 incomplete due to runtime preemption."
        : "BUG: Perimeter Phase 0 may have been bypassed.",
      payload: phase0,
    },
    {
      id: "target_mask",
      label: "Target-mask isolation",
      status: pickStatus(targetMaskOk, Object.keys(targetMask).length > 0),
      payload: targetMask,
    },
    {
      id: "solar",
      label: "Solar segments",
      status: pickStatus(solarOk, true),
      payload: {
        segments: grj?.solar_segments || [],
        google_solar_segments_count: grj?.google_solar_segments_count,
      },
    },
    {
      id: "pitch",
      label: "Pitch resolver",
      status: pickStatus(pitchOk, true),
      source: pitch?.pitch_source,
      reason: pitch?.pitch_valid === false
        ? pitch?.rejected_pitch_reason
        : undefined,
      payload: {
        pitch_source: pitch?.pitch_source,
        pitch_valid: pitch?.pitch_valid,
        solar_pitch_degrees: pitch?.solar_pitch_degrees,
        dsm_plane_pitch: pitch?.dsm_plane_pitch,
        final_predominant_pitch: pitch?.final_predominant_pitch ??
          m?.predominant_pitch,
        rejected_pitch_reason: pitch?.rejected_pitch_reason,
      },
    },
    {
      id: "topology",
      label: "Phase 3A.5 / Perimeter topology",
      status: pickStatus(topoOk, Object.keys(topo).length > 0 || topoOk),
      reason: resolvedState.final_state_source === "runtime_cpu_budget_guard"
        ? "Phase 3A.5 stopped: CPU budget exceeded before topology completed."
        : undefined,
      payload: {
        ...topo,
        phase3_5: grj?.phase3_5 ?? grj?.phase3A_5 ?? null,
        cpu_budget_stage: grj?.cpu_budget_stage ?? null,
        cpu_budget_elapsed_ms: grj?.cpu_budget_elapsed_ms ?? null,
        cpu_budget_ms: grj?.cpu_budget_ms ?? null,
        estimated_work_units: grj?.estimated_work_units ?? null,
        topology_pixel_limit: grj?.topology_pixel_limit ?? null,
      },
    },
    {
      id: "final",
      label: "Final diagram",
      status: hasFinalGeometry
        ? pickStatus(finalOk, true)
        : "fail",
      reason: hasFinalGeometry
        ? undefined
        : "Final diagram blocked: zero facets and zero roof_lines persisted.",
      payload: {
        final_diagram_url: grj?.final_diagram_url,
        roof_lines_count: roofLinesCount,
        facet_count: facetCount,
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
      id: "gate",
      label: "Customer report gate",
      status: customerReady ? "pass" : "fail",
      reason: customerReady
        ? undefined
        : m?.customer_report_block_reason || customerGate?.block_reason,
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
  { key: "raster", label: "Aerial raster", default: true },
  { key: "geocode", label: "Original geocode", default: true },
  { key: "confirmed", label: "Confirmed roof center", default: true },
  { key: "solar", label: "Solar segments", default: true },
  { key: "targetMask", label: "Target roof mask", default: true },
  { key: "globalMask", label: "Global mask", default: true },
  { key: "missed", label: "Missed roof regions", default: true },
  { key: "perimeter", label: "Selected perimeter", default: true },
  { key: "eaves", label: "Eaves", default: true },
  { key: "rakes", label: "Rakes", default: true },
  { key: "ridges", label: "Ridges", default: true },
  { key: "hips", label: "Hips", default: true },
  { key: "valleys", label: "Valleys", default: true },
  { key: "rejected", label: "Rejected edges", default: true },
];

export const AIMeasurement3DDebugViewer: React.FC<Props> = ({
  measurement,
  open,
  onOpenChange,
  embedded = false,
}) => {
  const stages = useMemo(() => buildStages(measurement), [measurement]);
  const initialResolved = useMemo(
    () => resolveMeasurementDiagnosticState(measurement),
    [measurement],
  );
  const defaultStageId =
    (initialResolved.active_stage_hint &&
      stages.find((s) => s.id === initialResolved.active_stage_hint)?.id) ||
    stages[0]?.id ||
    "target";
  const [activeStage, setActiveStage] = useState<string>(defaultStageId);
  const [layers, setLayers] = useState<Record<string, boolean>>(
    () => Object.fromEntries(LAYER_TOGGLES.map((l) => [l.key, l.default])),
  );

  const grj = measurement?.geometry_report_json || {};
  const resolvedState = initialResolved;
  const overlayDbg = grj.overlay_debug || {};
  const rasterUrl: string | undefined = overlayDbg?.raster_url ||
    measurement?.satellite_overlay_url || measurement?.google_maps_image_url;

  const stage = stages.find((s) => s.id === activeStage) || stages[0];

  const phase0Bypassed = (() => {
    if (resolvedState.phase0_incomplete_reason === "runtime_preemption") {
      return false;
    }
    const ph = stages.find((s) => s.id === "phase0");
    const tm = stages.find((s) => s.id === "target_mask");
    return ph?.status === "fail" && tm && tm.status !== "unknown";
  })();

  const header = (
    <div
      className={cn(
        "flex items-center gap-2",
        embedded ? "px-4 py-3 border-b" : "",
      )}
    >
      <Layers className="h-5 w-5 text-primary" />
      <span className="font-semibold">AI Measurement Process Viewer</span>
      <Badge variant="outline" className="ml-2">Diagnostic</Badge>
      {embedded && (
        <span className="ml-auto text-xs text-muted-foreground">
          Internal use only — not for customers.
        </span>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="border rounded-lg bg-card flex flex-col overflow-hidden h-[720px]">
        {header}
        <ViewerBody
          stages={stages}
          activeStage={activeStage}
          setActiveStage={setActiveStage}
          layers={layers}
          setLayers={setLayers}
          stage={stage}
          measurement={measurement}
          rasterUrl={rasterUrl}
          phase0Bypassed={phase0Bypassed}
        />
      </div>
    );
  }

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
            Step-by-step visualization of the AI Measurement pipeline. Internal
            use only — not for customers.
          </DialogDescription>
        </DialogHeader>

        <ViewerBody
          stages={stages}
          activeStage={activeStage}
          setActiveStage={setActiveStage}
          layers={layers}
          setLayers={setLayers}
          stage={stage}
          measurement={measurement}
          rasterUrl={rasterUrl}
          phase0Bypassed={phase0Bypassed}
        />

        <div className="px-6 py-3 border-t flex justify-between items-center text-xs text-muted-foreground">
          <span>
            result_state:{" "}
            <span className="font-mono text-foreground">
              {measurement?.result_state || "—"}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange?.(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------- Viewer Body ---------------- */

interface ViewerBodyProps {
  stages: StageDef[];
  activeStage: string;
  setActiveStage: (id: string) => void;
  layers: Record<string, boolean>;
  setLayers: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  stage: StageDef | undefined;
  measurement: any;
  rasterUrl?: string;
  phase0Bypassed: boolean;
}

function ViewerBody({
  stages,
  activeStage,
  setActiveStage,
  layers,
  setLayers,
  stage,
  measurement,
  rasterUrl,
  phase0Bypassed,
}: ViewerBodyProps) {
  return (
    <div className="flex-1 min-h-0 grid grid-cols-[240px_1fr_280px] gap-0">
      {/* LEFT: stage timeline */}
      <div className="border-r overflow-y-auto">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-1">
            {stages.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActiveStage(s.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md border text-sm transition-colors",
                  "flex items-start gap-2",
                  activeStage === s.id
                    ? "bg-primary/10 border-primary/40"
                    : "border-transparent hover:bg-muted",
                )}
              >
                <span className="text-xs text-muted-foreground w-5 mt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{s.label}</div>
                  {s.source && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      src: {s.source}
                    </div>
                  )}
                  {s.reason && (
                    <div className="text-[11px] text-destructive truncate">
                      {s.reason}
                    </div>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1.5 py-0 gap-1",
                    statusColor[s.status],
                  )}
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
              className={cn(
                "text-[10px] px-1.5 py-0 gap-1",
                statusColor[stage?.status || "unknown"],
              )}
            >
              {statusIcon[stage?.status || "unknown"]}
              {stage?.status}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            Run: {measurement?.id?.slice(0, 8)} · engine{" "}
            {measurement?.ai_measurement_engine_version || "—"}
          </div>
        </div>

        {phase0Bypassed && (
          <div className="mx-4 mt-3 p-3 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <div className="font-semibold">
                BUG: Perimeter Phase 0 was bypassed
              </div>
              <div className="text-xs">
                Target-mask isolation has data but the perimeter gate didn't
                run. AI Measurement should not have proceeded.
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
                  <div
                    key={l.key}
                    className="flex items-center justify-between"
                  >
                    <Label
                      htmlFor={`layer-${l.key}`}
                      className="text-sm cursor-pointer"
                    >
                      {l.label}
                    </Label>
                    <Switch
                      id={`layer-${l.key}`}
                      checked={layers[l.key]}
                      onCheckedChange={(v) =>
                        setLayers((prev) => ({ ...prev, [l.key]: v }))}
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
  );
}

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

  // ----- geo → px transform (best-effort using overlay_debug) -----
  const tileCenter = overlayDbg?.tile_center_lat_lng;
  const extent = overlayDbg?.tile_ground_extent_m; // { width, height } meters
  const mppX = extent?.width ? extent.width / W : overlayDbg?.actual_mpp;
  const mppY = extent?.height ? extent.height / H : overlayDbg?.actual_mpp;
  function geoToPx(
    lat?: number | null,
    lng?: number | null,
  ): [number, number] | null {
    if (lat == null || lng == null || !tileCenter || !mppX || !mppY) {
      return null;
    }
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos((tileCenter.lat * Math.PI) / 180);
    const dxM = (lng - tileCenter.lng) * metersPerDegLng;
    const dyM = (lat - tileCenter.lat) * metersPerDegLat;
    return [W / 2 + dxM / mppX, H / 2 - dyM / mppY];
  }

  // Pull from new debug_layers / phase3_5 first so blocked runs still render.
  const debugLayers = grj?.debug_layers || {};
  const phase35 = grj?.phase3_5 || grj?.phase3A_5 || {};
  const debugRoofLines: any[] = Array.isArray(grj?.debug_roof_lines)
    ? grj.debug_roof_lines
    : [];

  const rawPerimeterPx: Array<[number, number]> | undefined =
    phase35?.raw_perimeter_px || debugLayers?.raw_perimeter_px;
  const refinedPerimeterPx: Array<[number, number]> | undefined =
    phase35?.refined_perimeter_px;
  const selectedPerimeterPx: Array<[number, number]> | undefined =
    debugLayers?.selected_perimeter_px ||
    grj?.true_outer_roof_perimeter_px ||
    grj?.footprint_px;
  const perimeterPx: Array<[number, number]> | undefined =
    selectedPerimeterPx || refinedPerimeterPx || rawPerimeterPx;

  const solarSegments: any[] = Array.isArray(grj?.solar_segments)
    ? grj.solar_segments
    : Array.isArray(debugLayers?.solar_segments_px)
    ? debugLayers.solar_segments_px
    : [];
  const eaves: any[] = [
    ...(grj?.layer1_perimeter?.eave_edges || []),
    ...debugRoofLines.filter((l: any) => l?.type === "eave"),
  ];
  const rakes: any[] = [
    ...(grj?.layer1_perimeter?.rake_edges || []),
    ...debugRoofLines.filter((l: any) => l?.type === "rake"),
  ];
  const roofLines: any[] = Array.isArray(grj?.roof_lines) ? grj.roof_lines : [];

  const ridges = roofLines.filter((l) => l.attribute === "ridge");
  const hips = roofLines.filter((l) => l.attribute === "hip");
  const valleys = roofLines.filter((l) => l.attribute === "valley");
  const rejected = roofLines.filter((l) => l.rejected);

  const targetMaskDbg = grj?.target_mask_isolation || {};
  function collectPolys(candidates: any[]): Array<Array<[number, number]>> {
    for (const c of candidates) {
      if (!c) continue;
      if (
        Array.isArray(c) && Array.isArray(c[0]) &&
        Array.isArray((c[0] as any)[0])
      ) return c as any;
      if (Array.isArray(c) && Array.isArray(c[0])) return [c as any];
    }
    return [];
  }
  function bboxToPoly(b: any): Array<[number, number]> | null {
    if (!b) return null;
    if (Array.isArray(b) && b.length === 4 && typeof b[0] === "number") {
      const [x1, y1, x2, y2] = b;
      return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    }
    if (b.minX != null && b.minY != null && b.maxX != null && b.maxY != null) {
      return [
        [b.minX, b.minY],
        [b.maxX, b.minY],
        [b.maxX, b.maxY],
        [b.minX, b.maxY],
      ];
    }
    return null;
  }
  const targetMaskPolys = collectPolys([
    targetMaskDbg?.target_mask_polygons_px,
    targetMaskDbg?.target_mask_polygon_px,
    targetMaskDbg?.target_mask_contour_px,
    debugLayers?.target_roof_mask_px,
    debugLayers?.target_mask_contour_px,
    grj?.target_mask_polygons_px,
    grj?.target_mask_polygon_px,
  ]);
  if (!targetMaskPolys.length) {
    const bboxPoly = bboxToPoly(
      targetMaskDbg?.target_mask_bbox_px ?? debugLayers?.target_mask_bbox_px,
    );
    if (bboxPoly) targetMaskPolys.push(bboxPoly);
  }
  const globalMaskPolys = collectPolys([
    targetMaskDbg?.global_mask_polygons_px,
    targetMaskDbg?.global_mask_contours_px,
    debugLayers?.global_mask_px,
    grj?.global_mask_polygons_px,
    grj?.global_mask_polygon_px,
  ]);
  if (!globalMaskPolys.length) {
    const bboxPoly = bboxToPoly(
      targetMaskDbg?.global_visible_roof_bbox_px ??
        debugLayers?.global_visible_roof_bbox_px,
    );
    if (bboxPoly) globalMaskPolys.push(bboxPoly);
  }
  const missedRegions = collectPolys([
    targetMaskDbg?.missed_roof_regions_px,
    targetMaskDbg?.missed_target_roof_regions_px,
    debugLayers?.missed_roof_regions_px,
    grj?.missed_roof_regions_px,
    grj?.missed_target_roof_regions_px,
  ]);

  const originalGeo = grj?.original_geocode_lat_lng;
  const geocodePx: [number, number] | null = overlayDbg?.original_geocode_px ||
    grj?.original_geocode_px ||
    geoToPx(originalGeo?.lat, originalGeo?.lng);

  const confirmedGeo = grj?.confirmed_roof_center_lat_lng ||
    (measurement?.target_lat != null
      ? { lat: measurement.target_lat, lng: measurement.target_lng }
      : null);
  const confirmedPx: [number, number] =
    geoToPx(confirmedGeo?.lat, confirmedGeo?.lng) || [W / 2, H / 2];

  // Layers with no underlying data so we can hint to the user
  const missingLayers: string[] = [];
  if (!targetMaskPolys.length) missingLayers.push("Target roof mask");
  if (!globalMaskPolys.length) missingLayers.push("Global mask");
  if (!missedRegions.length) missingLayers.push("Missed roof regions");
  if (!solarSegments.length) missingLayers.push("Solar segments");
  if (!perimeterPx || perimeterPx.length < 3) {
    missingLayers.push("Selected perimeter");
  }
  if (!eaves.length) missingLayers.push("Eaves");
  if (!rakes.length) missingLayers.push("Rakes");
  if (!ridges.length) missingLayers.push("Ridges");
  if (!hips.length) missingLayers.push("Hips");
  if (!valleys.length) missingLayers.push("Valleys");

  return (
    <div className="relative w-full h-full rounded-lg border bg-muted/30 overflow-hidden">
      {rasterUrl && layers.raster
        ? (
          <img
            src={rasterUrl}
            alt="Aerial raster"
            className="absolute inset-0 w-full h-full object-contain bg-black"
          />
        )
        : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            No raster tile available for this run.
          </div>
        )}

      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Global mask (lowest z) */}
        {layers.globalMask &&
          globalMaskPolys.map((poly, i) =>
            poly && poly.length > 2
              ? (
                <polygon
                  key={`gmask-${i}`}
                  points={poly.map((p) => `${p[0]},${p[1]}`).join(" ")}
                  fill="rgba(148,163,184,0.25)"
                  stroke="#94a3b8"
                  strokeWidth={1}
                  strokeDasharray="4,3"
                />
              )
              : null
          )}

        {/* Target roof mask */}
        {layers.targetMask &&
          targetMaskPolys.map((poly, i) =>
            poly && poly.length > 2
              ? (
                <polygon
                  key={`tmask-${i}`}
                  points={poly.map((p) => `${p[0]},${p[1]}`).join(" ")}
                  fill="rgba(16,185,129,0.18)"
                  stroke="#10b981"
                  strokeWidth={2}
                />
              )
              : null
          )}

        {/* Missed roof regions */}
        {layers.missed &&
          missedRegions.map((poly, i) =>
            poly && poly.length > 2
              ? (
                <polygon
                  key={`missed-${i}`}
                  points={poly.map((p) => `${p[0]},${p[1]}`).join(" ")}
                  fill="rgba(249,115,22,0.25)"
                  stroke="#f97316"
                  strokeWidth={1.5}
                  strokeDasharray="3,3"
                />
              )
              : null
          )}

        {/* Perimeter */}
        {layers.perimeter && perimeterPx && perimeterPx.length > 2 && (
          <polygon
            points={perimeterPx.map((p) => `${p[0]},${p[1]}`).join(" ")}
            fill="rgba(34,197,94,0.08)"
            stroke="#22c55e"
            strokeWidth={3}
          />
        )}

        {/* Eaves */}
        {layers.eaves &&
          eaves.map((e: any, i: number) =>
            e?.p1 && e?.p2
              ? (
                <line
                  key={`eave-${i}`}
                  x1={e.p1[0]}
                  y1={e.p1[1]}
                  x2={e.p2[0]}
                  y2={e.p2[1]}
                  stroke="#22c55e"
                  strokeWidth={4}
                />
              )
              : null
          )}

        {/* Rakes */}
        {layers.rakes &&
          rakes.map((e: any, i: number) =>
            e?.p1 && e?.p2
              ? (
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
              )
              : null
          )}

        {/* Solar segments */}
        {layers.solar &&
          solarSegments.map((seg: any, i: number) => {
            const poly = seg.polygon_px || seg.bbox_px;
            if (poly && Array.isArray(poly) && poly.length >= 3) {
              return (
                <g key={`solar-${i}`}>
                  <polygon
                    points={poly.map((p: [number, number]) => `${p[0]},${p[1]}`)
                      .join(" ")}
                    fill="rgba(59,130,246,0.18)"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                  />
                </g>
              );
            }
            // Fallback: render center from geo + area
            const centerGeo = seg.center_geo; // [lng, lat]
            const cPx = centerGeo
              ? geoToPx(centerGeo[1], centerGeo[0])
              : seg.center_px || null;
            if (!cPx) return null;
            const areaSqft = Number(seg.area_sqft || 0);
            const radiusPx = mppX
              ? Math.max(6, Math.sqrt((areaSqft * 0.092903) / Math.PI) / mppX)
              : 10;
            return (
              <g key={`solar-${i}`}>
                <circle
                  cx={cPx[0]}
                  cy={cPx[1]}
                  r={radiusPx}
                  fill="rgba(59,130,246,0.18)"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                />
                {seg.azimuth_degrees != null && (
                  <line
                    x1={cPx[0]}
                    y1={cPx[1]}
                    x2={cPx[0] +
                      25 * Math.sin((seg.azimuth_degrees * Math.PI) / 180)}
                    y2={cPx[1] -
                      25 * Math.cos((seg.azimuth_degrees * Math.PI) / 180)}
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
            l?.p1 && l?.p2
              ? (
                <line
                  key={`ridge-${i}`}
                  x1={l.p1[0]}
                  y1={l.p1[1]}
                  x2={l.p2[0]}
                  y2={l.p2[1]}
                  stroke="#ef4444"
                  strokeWidth={3}
                />
              )
              : null
          )}

        {/* Hips */}
        {layers.hips &&
          hips.map((l: any, i: number) =>
            l?.p1 && l?.p2
              ? (
                <line
                  key={`hip-${i}`}
                  x1={l.p1[0]}
                  y1={l.p1[1]}
                  x2={l.p2[0]}
                  y2={l.p2[1]}
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                />
              )
              : null
          )}

        {/* Valleys */}
        {layers.valleys &&
          valleys.map((l: any, i: number) =>
            l?.p1 && l?.p2
              ? (
                <line
                  key={`valley-${i}`}
                  x1={l.p1[0]}
                  y1={l.p1[1]}
                  x2={l.p2[0]}
                  y2={l.p2[1]}
                  stroke="#06b6d4"
                  strokeWidth={2.5}
                />
              )
              : null
          )}

        {/* Rejected */}
        {layers.rejected &&
          rejected.map((l: any, i: number) =>
            l?.p1 && l?.p2
              ? (
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
              )
              : null
          )}

        {/* Confirmed roof center */}
        {layers.confirmed && (
          <g>
            <circle
              cx={confirmedPx[0]}
              cy={confirmedPx[1]}
              r={10}
              fill="none"
              stroke="#22c55e"
              strokeWidth={2}
            />
            <line
              x1={confirmedPx[0] - 14}
              y1={confirmedPx[1]}
              x2={confirmedPx[0] + 14}
              y2={confirmedPx[1]}
              stroke="#22c55e"
            />
            <line
              x1={confirmedPx[0]}
              y1={confirmedPx[1] - 14}
              x2={confirmedPx[0]}
              y2={confirmedPx[1] + 14}
              stroke="#22c55e"
            />
          </g>
        )}

        {/* Original geocode marker */}
        {layers.geocode && geocodePx && (
          <g>
            <circle
              cx={geocodePx[0]}
              cy={geocodePx[1]}
              r={7}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={2}
            />
            <line
              x1={geocodePx[0] - 10}
              y1={geocodePx[1]}
              x2={geocodePx[0] + 10}
              y2={geocodePx[1]}
              stroke="#f59e0b"
            />
            <line
              x1={geocodePx[0]}
              y1={geocodePx[1] - 10}
              x2={geocodePx[0]}
              y2={geocodePx[1] + 10}
              stroke="#f59e0b"
            />
          </g>
        )}

        <defs>
          <marker
            id="arrow"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
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
        Active stage:{" "}
        <span className="font-medium text-foreground">{stage?.label}</span>
      </div>

      {missingLayers.length > 0 && (
        <div className="absolute top-2 left-2 max-w-[60%] bg-amber-500/15 border border-amber-500/40 text-amber-700 rounded px-2 py-1 text-[10px]">
          <span className="font-semibold">No pixel data persisted for:</span>
          {" "}
          {missingLayers.join(" · ")}
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block w-3 h-0.5"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

export default AIMeasurement3DDebugViewer;
