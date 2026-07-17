import React, { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import {
  Activity,
  AlertTriangle,
  Download,
  Loader2,
  Ruler,
  ShieldCheck,
  Square,
  TriangleIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import PatentRoofReport from "./PatentRoofReport";
import RasterOverlayDebugView from "./RasterOverlayDebugView";
import { resolveAerialCandidateGraph } from "@/lib/measurements/aerialCandidateGraphResolver";
import { MeasurementOverrideEditor } from "@/components/measurement/MeasurementOverrideEditor";
import AIMeasurement3DDebugViewer from "./AIMeasurement3DDebugViewer";
import MeasurementVisualQAOverlay from "./MeasurementVisualQAOverlay";
import { useMeasurementJob } from "@/hooks/useMeasurementJob";
import { Layers as LayersIcon } from "lucide-react";
import { resolveMeasurementDiagnosticState } from "@/lib/measurements/measurementDiagnosticState";
import { getRasterOverlayData as getRasterOverlayDataShared } from "@/lib/measurements/rasterOverlayData";
import MeasurementReportPdfVisualSection from "./MeasurementReportPdfVisualSection";

interface MeasurementReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measurement: any;
  tags?: Record<string, any>;
  address?: string;
  pipelineEntryId?: string;
  tenantId?: string;
  aiMeasurementJobId?: string | null;
  onMeasurementUpdate?: (measurement: any, tags: any) => void;
}

interface DiagramRow {
  id: string;
  diagram_type: string;
  title: string;
  page_number: number | null;
  svg_markup: string | null;
}

const PAGE_LABELS = [
  "Cover",
  "Image / Overlay",
  "Length Diagram",
  "Pitch Diagram",
  "Area Diagram",
  "Notes Diagram",
];

function evaluatePreviewGate(
  measurement: any,
): { ok: boolean; reason?: string } {
  if (!measurement) return { ok: false, reason: "No measurement record." };
  const grj = measurement.geometry_report_json;
  // Preview gate is intentionally lenient: we want to show diagrams whenever
  // real geometry exists, even for needs_review / single_plane_fallback jobs.
  // Hard blocks: placeholder, solar bbox rectangles, or no geometry+no PDF at all.
  if (grj?.is_placeholder === true) {
    return { ok: false, reason: "Geometry is placeholder." };
  }
  if (grj?.geometry_source === "google_solar_bbox") {
    return { ok: false, reason: "Geometry source is solar bbox (rectangles)." };
  }
  if (
    !grj && !measurement.report_pdf_url && !measurement.ai_measurement_job_id
  ) {
    return { ok: false, reason: "No geometry, PDF, or job to preview." };
  }
  return { ok: true };
}

/** Detect if geometry required bbox-fit rescue (not raster-calibrated). */
function detectBboxRescue(measurement: any): boolean {
  const grj = measurement?.geometry_report_json;
  if (!grj) return false;
  // Explicit flag from pipeline
  if (grj.overlay_requires_bbox_rescue === true) return true;
  // Infer: if geometry_px_space is not 'raster_calibrated' and overlay_calibration
  // shows the geometry was fit into a target box, bbox rescue was used.
  const pxSpace = grj.geometry_px_space;
  if (pxSpace && pxSpace !== "raster_calibrated") return true;
  // If coordinate_space_solver says 'geo' but no persisted footprint_px or planes_px,
  // the renderer will have to bbox-fit
  const solverSpace = grj.coordinate_space_solver;
  if (solverSpace === "geo" && !Array.isArray(grj.planes_px)) return true;
  return false;
}

/** Client mirror of the PDF-specific QC gate enforced by render-measurement-pdf. */
function evaluatePdfGate(
  measurement: any,
): { ok: boolean; reason?: string; warning?: string } {
  if (!measurement) return { ok: false, reason: "No measurement record." };
  const grj = measurement.geometry_report_json;
  if (
    measurement.validation_status === "needs_internal_review" ||
    measurement.validation_status === "needs_manual_measurement"
  ) return { ok: false, reason: "Job flagged needs_internal_review." };
  if (!measurement.facet_count || measurement.facet_count <= 0) {
    return { ok: false, reason: "No roof facets recorded." };
  }
  if (!grj) return { ok: false, reason: "geometry_report_json missing." };
  if (grj.block_customer_report_reason) {
    return { ok: false, reason: String(grj.block_customer_report_reason) };
  }
  if (grj.is_placeholder === true) {
    return { ok: false, reason: "Geometry is placeholder." };
  }
  if (grj.geometry_source === "google_solar_bbox") {
    return { ok: false, reason: "Geometry source is solar bbox (rectangles)." };
  }
  // Hard gate: heuristic geometry MUST NOT produce customer PDFs
  if (grj.geometry_source === "heuristic_estimate") {
    return {
      ok: false,
      reason:
        "Geometry is heuristic estimate — not validated for customer use.",
    };
  }
  if (measurement.customer_report_ready === false) {
    return { ok: false, reason: "customer_report_ready gate is false." };
  }
  const cal = grj.overlay_calibration;
  if (cal?.calibrated !== true) {
    return { ok: false, reason: "overlay_alignment_failed" };
  }
  if (cal?.calibrated) {
    if (
      Number(cal.coverage_ratio_width) < 0.65 ||
      Number(cal.coverage_ratio_height) < 0.65
    ) {
      return { ok: false, reason: "overlay_alignment_failed" };
    }
    if (Number(cal.center_error_px) > 80) {
      return { ok: false, reason: "overlay_alignment_failed" };
    }
  }

  // Block customer PDF when geometry depends on bbox rescue (not raster-calibrated)
  if (detectBboxRescue(measurement)) {
    return {
      ok: false,
      reason:
        "overlay_requires_bbox_rescue — geometry is not raster-calibrated",
    };
  }

  const warnings: string[] = [];
  if (grj.single_plane_fallback === true) {
    warnings.push(
      "Roof slopes could not be fully segmented; PDF will be marked as a footprint estimate.",
    );
  }
  if (
    typeof grj.overlay_alignment_score === "number" &&
    grj.overlay_alignment_score < 0.75
  ) {
    warnings.push(
      "Overlay alignment is below the review threshold; PDF will be marked for verification.",
    );
  }
  return { ok: true, warning: warnings.join(" ") || undefined };
}

/** Always-visible measurement data summary page */
const MeasurementDataSummary: React.FC<{ m: any }> = ({ m }) => {
  if (!m) return null;
  const grj = m.geometry_report_json || {};
  const resolvedState = resolveMeasurementDiagnosticState(m);
  // For failed runs, the full debug payload is persisted to
  // ai_measurement_jobs.source_context.debug. Fall back to it so
  // perimeter_phase0 and target-mask metrics are always available in the UI.
  const sourceCtxDebug = m.source_context?.debug ||
    m.source_context?.source_context?.debug || null;
  const registrationBlocked = grj.registration_precedence_applied === true &&
    resolvedState.final_state_source !== "runtime_cpu_budget_guard";
  const registrationPrecedenceReason = registrationBlocked
    ? (grj.registration_precedence_reason || grj.hard_fail_reason ||
      grj.block_customer_report_reason || null)
    : null;
  const phase0 = registrationBlocked
    ? null
    : (grj.perimeter_phase0 || sourceCtxDebug?.perimeter_phase0 ||
      grj.perimeter_gate_metrics || m.perimeter_gate_metrics || null);
  const targetMask = registrationBlocked
    ? {}
    : (phase0?.target_mask_isolation || grj.perimeter_inner_trace ||
      sourceCtxDebug?.perimeter_inner_trace || grj.target_mask_isolation || {});
  const dp = grj.debug_pipeline || {};
  const phase3 = grj.phase3 || sourceCtxDebug?.phase3 || null;
  const phase3A = grj.phase3A || sourceCtxDebug?.phase3A || null;
  const phase3B = grj.phase3B || sourceCtxDebug?.phase3B || null;
  const phase3Enabled = grj.phase3_enabled ?? phase3?.enabled ??
    sourceCtxDebug?.phase3_enabled ?? null;
  const acquisitionAudit = grj.acquisition_audit ||
    grj.source_acquisition_debug?.acquisition_audit ||
    m.source_context?.acquisition_audit ||
    m.source_context?.debug?.acquisition_audit || null;
  const sourceAcquisitionDebug = grj.source_acquisition_debug ||
    m.source_context?.source_acquisition_debug ||
    m.source_context?.debug?.source_acquisition_debug || null;
  const registrationGate = grj.registration_gate || grj.registration ||
    sourceCtxDebug?.registration_gate || sourceCtxDebug?.registration || {};

  const fmt = (v: any, unit = "") => {
    if (v == null || v === "" || (typeof v === "number" && isNaN(v))) {
      return "—";
    }
    const n = Number(v);
    return isNaN(n)
      ? String(v)
      : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${
        unit ? ` ${unit}` : ""
      }`;
  };
  const isDiagnosticBboxTrace =
    (m.footprint_source === "solar_bbox_fallback" || grj.footprint_source === "solar_bbox_fallback") &&
    m.result_state !== "customer_report_ready";
  const fmtVerifiedLine = (v: any, unit = "LF") => isDiagnosticBboxTrace ? "—" : fmt(v, unit);

  const rows: { label: string; value: string; icon?: React.ReactNode }[] = [
    {
      label: "Total Area (flat)",
      value: fmt(m.total_area_flat_sqft ?? m.roof_area_sq_ft, "sq ft"),
      icon: <Square className="h-4 w-4" />,
    },
    {
      label: "Total Area (adjusted)",
      value: fmt(m.total_area_adjusted_sqft, "sq ft"),
    },
    { label: "Total Squares", value: fmt(m.total_squares) },
    {
      label: "Predominant Pitch",
      value: fmt(m.predominant_pitch, "/12"),
      icon: <TriangleIcon className="h-4 w-4" />,
    },
    {
      label: "Facet Count",
      value: fmt(m.facet_count ?? dp.final_plane_count_saved),
    },
    {
      label: "Ridge",
      value: fmtVerifiedLine(m.total_ridge_length ?? m.ridges_lf),
      icon: <Ruler className="h-4 w-4" />,
    },
    { label: "Hip", value: fmtVerifiedLine(m.total_hip_length ?? m.hips_lf) },
    {
      label: "Valley",
      value: fmtVerifiedLine(m.total_valley_length ?? m.valleys_lf),
    },
    { label: "Eave", value: fmtVerifiedLine(m.total_eave_length ?? m.eaves_lf) },
    { label: "Rake", value: fmtVerifiedLine(m.total_rake_length ?? m.rakes_lf) },
  ];

  const isBboxRescue = detectBboxRescue(m);

  const debugRows: { label: string; value: string }[] = [
    {
      label: "Detection Method",
      value: String(m.detection_method ?? grj.detection_method ?? "—"),
    },
    {
      label: "Footprint Source",
      value: String(
        resolvedState.footprint_source ??
          (registrationBlocked
            ? "blocked_by_registration_gate"
            : (m.footprint_source ?? grj.footprint_source ?? "—")),
      ),
    },
    { label: "Footprint Valid", value: String(grj.footprint_valid ?? "—") },
    {
      label: "Coordinate Match",
      value: String(
        grj.coordinate_space_match ?? grj.dsm_coordinate_match?.match ?? "—",
      ),
    },
    {
      label: "Solver Space",
      value: String(
        grj.coordinate_space_solver ??
          grj.overlay_debug?.coordinate_space_solver ?? "—",
      ),
    },
    {
      label: "Export Space",
      value: String(grj.coordinate_space_export ?? "—"),
    },
    { label: "BBox Rescue", value: isBboxRescue ? "⚠ YES" : "No" },
    {
      label: "Attempted Faces",
      value: fmt(grj.attempted_faces ?? grj.faces_attempted),
    },
    {
      label: "Validated Faces",
      value: fmt(grj.validated_faces ?? grj.valid_faces),
    },
    {
      label: "Coverage",
      value: fmt(
        ((grj.debug_geometry?.face_coverage_ratio ?? grj.face_coverage_ratio) ||
          0) * 100,
        "%",
      ),
    },
    {
      label: "Failure Reason",
      value: String(
        resolvedState.hard_fail_reason ?? registrationPrecedenceReason ??
          m.gate_reason ?? "—",
      ),
    },
    {
      label: "Failure Stage",
      value: String(resolvedState.failure_stage ?? grj.failure_stage ?? "—"),
    },
    {
      label: "Final State Source",
      value: String(
        resolvedState.final_state_source ?? grj.final_state_source ?? "—",
      ),
    },
    // ─── Registration Precedence (registration-precedence-v3 / gate v2.3) ───
    {
      label: "Registration Precedence Version",
      value: String(grj.registration_precedence_version ?? "—"),
    },
    {
      label: "Registration Precedence Applied",
      value: String(grj.registration_precedence_applied ?? "—"),
    },
    {
      label: "Registration Precedence Reason",
      value: String(grj.registration_precedence_reason ?? "—"),
    },
    {
      label: "Registration Gate Version",
      value: String(
        (registrationGate as any)?.version ?? grj.registration_gate_version ??
          "—",
      ),
    },
    {
      label: "Transform Builder Called",
      value: String((registrationGate as any)?.transform_builder_called ?? "—"),
    },
    {
      label: "Transform Callsite",
      value: String((registrationGate as any)?.transform_callsite ?? "—"),
    },
    {
      label: "Transform Package Valid",
      value: String((registrationGate as any)?.transform_package_valid ?? "—"),
    },
    {
      label: "Transform Failures",
      value:
        Array.isArray((registrationGate as any)?.transform_failure_reasons) &&
          (registrationGate as any).transform_failure_reasons.length > 0
          ? (registrationGate as any).transform_failure_reasons.join(", ")
          : "—",
    },
    {
      label: "Registration Evaluation Stage",
      value: String((registrationGate as any)?.evaluation_stage ?? "—"),
    },
    {
      label: "Coordinate Gate Passed",
      value: String(
        (registrationGate as any)?.coordinate_registration_gate_passed ?? "—",
      ),
    },
    {
      label: "Missing Required Fields",
      value:
        Array.isArray((registrationGate as any)?.missing_required_fields) &&
          (registrationGate as any).missing_required_fields.length > 0
          ? (registrationGate as any).missing_required_fields.join(", ")
          : "—",
    },
    {
      label: "Topology Source",
      value: String(grj.topology_source ?? grj.geometry_source ?? "—"),
    },
    { label: "Planes (saved)", value: fmt(dp.final_plane_count_saved) },
    { label: "Edges (saved)", value: fmt(dp.final_edge_count_saved) },
    { label: "Patent Planes", value: fmt(dp.final_patent_model_plane_count) },
    {
      label: "Shared Edges",
      value: fmt(
        dp.edge_classification_debug?.shared_edge_count ??
          grj.edge_emit_diagnostics?.shared_edge_count,
      ),
    },
    {
      label: "Outside Footprint",
      value: fmt(
        dp.edge_classification_debug?.edges_outside_footprint_count ??
          grj.edge_emit_diagnostics?.edges_outside_footprint_count,
      ),
    },
    {
      label: "Null Endpoints",
      value: fmt(
        dp.edge_classification_debug?.null_endpoint_count ??
          grj.edge_emit_diagnostics?.null_endpoint_count,
      ),
    },
    {
      label: "Area Conservation",
      value: fmt(
        dp.edge_classification_debug?.area_conservation_ratio ??
          grj.edge_emit_diagnostics?.area_conservation_ratio,
      ),
    },
    { label: "Footprint Confidence", value: fmt(m.footprint_confidence) },
    { label: "Measurement Confidence", value: fmt(m.measurement_confidence) },
    { label: "Validation Status", value: String(m.validation_status ?? "—") },
    {
      label: "Image Source",
      value: String(m.selected_image_source ?? m.image_source ?? "—"),
    },
    // v13: registration gate
    {
      label: "Registration Passed",
      value: String(grj.footprint_registration_passed ?? "—"),
    },
    {
      label: "Registration Version",
      value: String(registrationGate.version ?? "—"),
    },
    {
      label: "Target Confirmed",
      value: String(registrationGate.user_confirmed_roof_target ?? "—"),
    },
    {
      label: "Original Geocode",
      value: JSON.stringify(registrationGate.original_geocode_lat_lng ?? null),
    },
    {
      label: "Confirmed Roof Center",
      value: JSON.stringify(
        registrationGate.confirmed_roof_center_lat_lng ?? null,
      ),
    },
    {
      label: "Confirmed Center PX",
      value: JSON.stringify(registrationGate.confirmed_roof_center_px ?? null),
    },
    {
      label: "Static Map Center",
      value: JSON.stringify(registrationGate.static_map_center_lat_lng ?? null),
    },
    {
      label: "Raster Bounds",
      value: JSON.stringify(registrationGate.raster_bounds_lat_lng ?? null),
    },
    {
      label: "DSM Tile Bounds",
      value: JSON.stringify(registrationGate.dsm_tile_bounds_lat_lng ?? null),
    },
    {
      label: "geo_to_dsm_px_success",
      value: String(
        registrationGate.geo_to_dsm_px_success ?? grj.geo_to_dsm_px_success ??
          "—",
      ),
    },
    {
      label: "dsm_pixel_transform_valid",
      value: String(
        registrationGate.dsm_pixel_transform_valid ??
          grj.dsm_pixel_transform_valid ?? "—",
      ),
    },
    {
      label: "dsm_to_raster_transform_exists",
      value: String(
        registrationGate.dsm_to_raster_transform_exists ??
          (registrationGate.dsm_to_raster_transform != null ? true : "—"),
      ),
    },
    {
      label: "raster_bounds_contain_center",
      value: String(
        registrationGate.raster_bounds_contain_confirmed_center ?? "—",
      ),
    },
    {
      label: "confirmed_center_inside_candidate",
      value: String(registrationGate.confirmed_center_inside_candidate ?? "—"),
    },
    {
      label: "coordinate_gate_passed",
      value: String(
        registrationGate.coordinate_registration_gate_passed ?? "—",
      ),
    },
    {
      label: "Registration Failure",
      value: String(
        registrationGate.failure_reason ?? registrationGate.failure?.reason ??
          "—",
      ),
    },
    // ── DSM registration diagnostic projection (read-only pass-through) ──
    // Fallback chain (in priority order):
    //   registration.dsm.*
    //   registration.transform_package.*
    //   registration.* (flat)
    //   registration_gate.dsm.*
    //   registration_gate.transform_package.*
    //   registration_gate.* (flat)
    //   geometry.registration_diagnostics.*
    //   geometry.dsm_split_status.georegistration_transform.*
    //   geometry.dsm_split_status.* (flat)
    ...(() => {
      const reg: any = (grj as any).registration || {};
      const regGate: any = (grj as any).registration_gate || {};
      const regDiag: any = (grj as any).registration_diagnostics || {};
      const dsmSplit: any = (grj as any).dsm_split_status || {};
      const gxform: any = dsmSplit.georegistration_transform || {};
      const pick = (key: string): any =>
        reg?.dsm?.[key] ??
        reg?.transform_package?.[key] ??
        reg?.[key] ??
        regGate?.dsm?.[key] ??
        regGate?.transform_package?.[key] ??
        regGate?.[key] ??
        regDiag?.[key] ??
        gxform?.[key] ??
        dsmSplit?.[key] ??
        null;
      const fmtVal = (v: any): string => {
        if (v === null || v === undefined || v === "") return "—";
        if (typeof v === "object") {
          if (typeof v.width === "number" && typeof v.height === "number") {
            return `${v.width}×${v.height}`;
          }
          return JSON.stringify(v);
        }
        return String(v);
      };
      const dsmSize = pick("dsm_size_px");
      const boundsWarning = pick("dsm_bounds_warning");
      const mpp = pick("dsm_meters_per_pixel");
      const mppSrc = pick("dsm_mpp_source");
      const tokens = pick("dsm_hoist_failure_tokens");
      return [
        { label: "DSM Size", value: fmtVal(dsmSize) },
        { label: "DSM Bounds Source", value: fmtVal(pick("dsm_tile_bounds_source") ?? pick("dsm_bounds_source")) },
        { label: "DSM Bounds Failure", value: fmtVal(pick("dsm_tile_bounds_failure_reason")) },
        {
          label: "DSM Bounds Derived",
          value: fmtVal(pick("dsm_bounds_derived")) +
            (boundsWarning ? ` (${boundsWarning})` : ""),
        },
        { label: "DSM Bounds Confidence", value: fmtVal(pick("dsm_bounds_confidence")) },
        {
          label: "DSM Meters/Pixel",
          value: fmtVal(mpp) + (mppSrc ? ` (${mppSrc})` : ""),
        },
        { label: "geo_to_dsm_transform_source", value: fmtVal(pick("geo_to_dsm_transform_source")) },
        { label: "dsm_to_raster_transform_source", value: fmtVal(pick("dsm_to_raster_transform_source")) },
        { label: "confirmed_roof_center_dsm_px_source", value: fmtVal(pick("confirmed_roof_center_dsm_px_source")) },
        { label: "DSM Transform Policy", value: fmtVal(pick("dsm_transform_policy_version")) },
        {
          label: "DSM Hoist Failure Tokens",
          value: Array.isArray(tokens) && tokens.length > 0 ? tokens.join(", ") : "—",
        },
      ];
    })(),

    {
      label: "Stage Hard Fail",
      value: String(
        registrationGate.stage_classifier?.stage_hard_fail_reason ??
          (grj as any).hard_fail_reason ?? "—",
      ),
    },
    {
      label: "Stage Failure Stage",
      value: String(
        registrationGate.stage_classifier?.stage_failure_stage ??
          (grj as any).failure_stage ?? "—",
      ),
    },
    { label: "Centroid Offset (px)", value: fmt(grj.centroid_offset_px) },
    { label: "Roof Overlap Score", value: fmt(grj.roof_image_overlap_score) },
    { label: "DSM Loaded", value: String(grj.dsm_loaded ?? "—") },
    { label: "Raw DSM Edges", value: fmt(grj.raw_edges) },
    { label: "Clustered Edges", value: fmt(grj.clustered_edges) },
    {
      label: "Topology Fidelity",
      value: String(grj.topology_fidelity?.topology_fidelity ?? "—"),
    },
    {
      label: "Topo Score",
      value: fmt(grj.topology_fidelity?.topology_fidelity_score),
    },
    {
      label: "Max Plane Ratio",
      value: fmt(grj.topology_fidelity?.max_plane_area_ratio),
    },
    { label: "Pitch Source", value: String(grj.pitch_source ?? "—") },
    { label: "Pitch Valid", value: String(grj.pitch_valid ?? "—") },
    {
      label: "Perimeter Phase 0",
      value: phase0
        ? "Ran"
        : (resolvedState.phase0_incomplete_reason === "runtime_preemption"
          ? "Incomplete due to runtime preemption"
          : "Perimeter Phase 0 did not run"),
    },
    {
      label: "Perimeter Inner Trace",
      value: String(targetMask?.inner_trace_detected ?? "—"),
    },
    {
      label: "Perimeter/Target Mask Ratio",
      value: fmt(
        targetMask?.perimeter_to_target_mask_ratio ??
          targetMask?.perimeter_to_mask_ratio,
      ),
    },
    {
      label: "Target Mask Area",
      value: fmt(
        phase0?.target_mask_area_sqft ?? targetMask?.target_mask_area_sqft ??
          targetMask?.target_roof_mask_area_sqft,
        "sq ft",
      ),
    },
    {
      label: "Global Mask Area",
      value: fmt(
        phase0?.global_mask_area_sqft ?? targetMask?.global_mask_area_sqft ??
          targetMask?.global_roof_mask_area_sqft,
        "sq ft",
      ),
    },
    {
      label: "Global Mask Inflation",
      value: fmt(
        phase0?.global_mask_inflation_ratio ??
          targetMask?.global_mask_inflation_ratio,
        "×",
      ),
    },
    {
      label: "Mask Components",
      value: fmt(
        phase0?.mask_components_table?.length ??
          targetMask?.target_mask_component_count,
      ),
    },
    {
      label: "Target Overlap w/ Perimeter",
      value: fmt(
        phase0?.target_mask_overlap_with_perimeter ??
          targetMask?.target_mask_overlap_with_perimeter ??
          targetMask?.target_component_overlap_with_perimeter,
      ),
    },
    {
      label: "Missed Target Roof",
      value: fmt(
        phase0?.missed_target_roof_pct ?? targetMask?.missed_target_roof_pct,
        "%",
      ),
    },
    {
      label: "Solar Sanity OK",
      value: String(
        phase0?.solar_sanity_ok ?? targetMask?.solar_sanity_ok ?? "—",
      ),
    },
    {
      label: "Benchmark Sanity OK",
      value: String(
        phase0?.benchmark_sanity_ok ?? targetMask?.benchmark_sanity_ok ?? "—",
      ),
    },
    { label: "Customer Ready", value: String(m.customer_report_ready ?? "—") },
    {
      label: "Result State",
      value: String(
        resolvedState.result_state ?? m.result_state ?? grj.result_state ?? "—",
      ),
    },
    {
      label: "Perimeter Gate",
      value: String(
        phase0?.perimeter_gate_passed ?? grj.perimeter_gate_passed ??
          m.perimeter_gate_passed ?? "—",
      ),
    },
    {
      label: "Perimeter Area (sqft)",
      value: fmt(
        phase0?.perimeter_area_sqft ?? grj.perimeter_area_sqft ??
          m.perimeter_area_sqft,
      ),
    },
    {
      label: "Eaves LF",
      value: fmt(phase0?.eave_length_lf ?? grj.eave_lf ?? m.eave_lf),
    },
    {
      label: "Rakes LF",
      value: fmt(phase0?.rake_length_lf ?? grj.rake_lf ?? m.rake_lf),
    },
    {
      label: "Perimeter vs Mask IoU",
      value: fmt(
        phase0?.perimeter_vs_mask_iou ?? grj.perimeter_vs_mask_iou ??
          m.perimeter_vs_mask_iou,
      ),
    },
    {
      label: "Missed Roof Area %",
      value: fmt(
        phase0?.missed_roof_area_pct ?? phase0?.missed_target_roof_pct ??
          grj.missed_roof_area_pct ?? m.missed_roof_area_pct,
      ),
    },
    {
      label: "OSM Candidates",
      value: fmt(
        sourceAcquisitionDebug?.no_osm_candidates === false
          ? (grj.candidates_tried ?? grj.candidates?.length)
          : grj.candidates_tried,
      ),
    },
    {
      label: "Solar Insights",
      value: String(sourceAcquisitionDebug?.solar_insights?.status ?? "—"),
    },
    {
      label: "Solar Segments",
      value: fmt(sourceAcquisitionDebug?.solar_segments_count),
    },
    { label: "Phase 3 Enabled", value: String(phase3Enabled ?? "—") },
    {
      label: "Phase 3 Engine",
      value: String(
        grj.phase3_engine_version ?? phase3?.engine_version ??
          sourceCtxDebug?.phase3_engine_version ?? "—",
      ),
    },
    {
      label: "Phase 3A Version",
      value: String(
        grj.phase3A_eave_rake_classifier_version ??
          phase3?.phase3A_eave_rake_classifier_version ?? "—",
      ),
    },
    {
      label: "Phase 3B Version",
      value: String(
        grj.phase3B_roof_lines_persistence_version ??
          phase3?.phase3B_roof_lines_persistence_version ?? "—",
      ),
    },
    {
      label: "Phase 3C",
      value: String(
        grj.phase3C?.version ?? grj.phase3?.phase3C_deferred_edges_version ??
          grj.phase3C_deferred_edges_version ??
          phase3?.phase3C_deferred_edges_version ??
          "MISSING — stale or non-canonical route",
      ) + (grj.phase3C
        ? (grj.phase3C.executed
          ? " / executed"
          : ` / skipped: ${grj.phase3C.skipped_reason || "unknown"}`)
        : ""),
    },
    {
      label: "Phase 3D",
      value: String(
        grj.phase3D?.version ?? grj.phase3?.phase3D_backbone_seed_version ??
          grj.phase3D_backbone_seed_version ??
          phase3?.phase3D_backbone_seed_version ??
          "MISSING — stale or non-canonical route",
      ) + (grj.phase3D
        ? (grj.phase3D.executed
          ? " / executed"
          : ` / skipped: ${grj.phase3D.skipped_reason || "unknown"}`)
        : ""),
    },
    {
      label: "Phase 3E",
      value: String(
        grj.phase3E?.version ??
          grj.phase3?.phase3E_constraint_repair_version ??
          grj.phase3E_constraint_repair_version ??
          phase3?.phase3E_constraint_repair_version ??
          "MISSING — stale or non-canonical route",
      ) + (grj.phase3E
        ? (grj.phase3E.executed
          ? " / executed"
          : ` / skipped: ${grj.phase3E.skipped_reason || "unknown"}`)
        : ""),
    },
    {
      label: "Phase 3A.5",
      value: String(
        grj.phase3A_5?.version ?? grj.phase3_5?.version ??
          "MISSING — stale or non-canonical route",
      ) + (grj.phase3A_5
        ? (grj.phase3A_5.executed
          ? " / executed"
          : ` / skipped: ${grj.phase3A_5.skipped_reason || "unknown"}`)
        : ""),
    },
    {
      label: "Phase 3A Failure",
      value: String(phase3A?.eave_rake_failure_reason ?? "—"),
    },
    (() => {
      // Reportable Roof Lines must be 0 until topology is actually validated
      // OR the row is customer-ready. Phase 3B's `reportable_roof_lines_count`
      // currently counts debug eave candidates — that is NOT reportable.
      const customerReady = (m as any)?.customer_report_ready === true ||
        (grj as any)?.customer_report_ready === true;
      const topologyValidated = (grj as any)?.topology_validated === true ||
        ((grj as any)?.geometry_source === "dsm_validated");
      const rawReportable = phase3B?.roof_lines_count ?? grj.roof_lines_count;
      const trueReportable =
        (customerReady || topologyValidated) ? rawReportable : 0;
      return { label: "Reportable Roof Lines", value: fmt(trueReportable) };
    })(),
    {
      label: "Debug Roof Lines",
      value: fmt(
        Array.isArray(grj.debug_roof_lines)
          ? grj.debug_roof_lines.length
          : (grj.debug_roof_lines_count ??
            phase3B?.reportable_roof_lines_count ?? 0),
      ),
    },

    (() => {
      const aerialGraph = resolveAerialCandidateGraph(grj);
      const hardFail = String((m as any)?.hard_fail_reason ?? "");
      const dvs = resolvedState.dsm_validation_status ??
        ((grj as any)?.dsm_validation_status ?? null);
      const dvsReason = dvs && typeof dvs === "object"
        ? String((dvs as any).reason ?? "")
        : "";
      const dsmUnavailable =
        hardFail === "dsm_transform_invalid" ||
        String((m as any)?.block_customer_report_reason ?? "") ===
          "dsm_validation_unavailable" ||
        dvsReason === "invalid_transform";
      const suffix = dsmUnavailable ? " — DSM validation unavailable" : "";

      let value: string;
      if (!aerialGraph.present) {
        value = "—";
      } else if (!aerialGraph.executed) {
        value = `present (0 candidate edges) — graph not executed${suffix}`;
      } else if (aerialGraph.edgeCount > 0) {
        value = `executed (${aerialGraph.edgeCount} candidate edges)${suffix}`;
      } else {
        value = `executed (0 candidate edges) — empty graph${suffix}`;
      }

      return { label: "Aerial Candidate Graph", value };
    })(),
    {
      label: "Primary Geometry Source",
      value: String(
        resolvedState.primary_geometry_source ??
          (grj as any)?.primary_geometry_source ?? "—",
      ),
    },
    (() => {
      const dvs = resolvedState.dsm_validation_status ??
        ((grj as any)?.dsm_validation_status ?? null);
      if (!dvs || typeof dvs !== "object") {
        return { label: "DSM Validation Status", value: "—" };
      }
      const available = (dvs as any).available === true;
      const reason = (dvs as any).reason
        ? ` (${(dvs as any).reason})`
        : "";
      return {
        label: "DSM Validation Status",
        value: available ? "available" : `unavailable${reason}`,
      };
    })(),
    {
      label: "Customer Report Blocker",
      value: String(
        resolvedState.block_customer_report_reason ??
          (m as any)?.block_customer_report_reason ?? "—",
      ),
    },
    {
      label: "Diagram Intent",
      value: String(
        resolvedState.diagram_render_intent ?? grj.diagram_render_intent ??
          sourceCtxDebug?.diagram_render_intent ?? "—",
      ),
    },
    {
      label: "Created By Function",
      value: String(
        (m as any).created_by_function ??
          grj.route_provenance?.created_by_function ?? "—",
      ),
    },
    {
      label: "Created By Component",
      value: String(
        (m as any).created_by_component ??
          grj.route_provenance?.created_by_component ?? "—",
      ),
    },
    {
      label: "Solver Entrypoint",
      value: String(
        (m as any).solver_entrypoint ??
          grj.route_provenance?.solver_entrypoint ?? "—",
      ),
    },
    {
      label: "Canonical Route",
      value: String(
        (m as any).canonical_measurement_route ??
          grj.route_provenance?.canonical_measurement_route ?? "—",
      ),
    },
    {
      label: "Route Audit Version",
      value: String(
        (m as any).route_audit_version ??
          grj.route_provenance?.route_audit_version ?? "—",
      ),
    },
    {
      label: "Report Renderer Version",
      value: String(
        (m as any).report_renderer_version ?? grj.report_renderer_version ??
          "—",
      ),
    },
  ];

  const blockReason = resolvedState.block_customer_report_reason ??
    (registrationBlocked
      ? registrationPrecedenceReason
      : grj.block_customer_report_reason);
  const faceRejections = Array.isArray(grj.face_rejection_table)
    ? grj.face_rejection_table
    : [];
  const warnings = grj.debug_pipeline?.warnings || grj.warnings || [];
  const errorList: string[] = [];
  const failureReasonStr = String(
    grj.hard_fail_reason ?? sourceCtxDebug?.hard_fail_reason ??
      grj.block_customer_report_reason ?? m.gate_reason ?? "",
  );
  const developerBug = String(
    grj.developer_bug ?? sourceCtxDebug?.developer_bug ?? "",
  );
  const innerTraceFired =
    /perimeter_inner_trace_detected/i.test(failureReasonStr) ||
    (Array.isArray(phase0?.perimeter_failure_reasons) &&
      phase0.perimeter_failure_reasons.some((r: any) =>
        /perimeter_inner_trace_detected/i.test(String(r))
      ));
  const phase0MissingBug = !phase0 && innerTraceFired;
  const phase0BypassBug =
    developerBug === "phase0_bypassed_before_perimeter_gate" ||
    /phase0_bypassed/i.test(failureReasonStr);

  if (resolvedState.final_state_source === "runtime_cpu_budget_guard") {
    errorList.push(
      "AI Measurement found an aerial roof perimeter, but customer-ready topology was blocked. DSM georegistration is missing and the run exceeded the CPU reserve before validated topology could complete.",
    );

  } else if (registrationBlocked) {
    errorList.push(
      `Registration failure: ${String(registrationPrecedenceReason)}`,
    );
  } else if (blockReason) errorList.push(`Blocked: ${String(blockReason)}`);
  if (phase3Enabled !== true) {
    errorList.push(
      "Phase 3 visibility fields missing — stale function or unwired payload.",
    );
  }
  if (m.validation_status === "needs_internal_review") {
    errorList.push("Validation: needs_internal_review");
  }
  if (m.validation_status === "needs_manual_measurement") {
    errorList.push("Validation: needs_manual_measurement");
  }
  if (
    dp.final_edge_count_saved === 0 && (dp.final_plane_count_saved ?? 0) > 0
  ) {
    errorList.push(
      "ERROR: Planes exist but Edges = 0 (plane graph has no classified edges)",
    );
  }
  if (grj.single_plane_fallback === true) {
    errorList.push("WARNING: single_plane_fallback — slopes not segmented");
  }
  if (
    typeof grj.overlay_alignment_score === "number" &&
    grj.overlay_alignment_score < 0.75
  ) {
    errorList.push(
      `WARNING: overlay_alignment_score = ${grj.overlay_alignment_score}`,
    );
  }
  if (Array.isArray(warnings)) {
    errorList.push(...warnings.map((w: any) => `WARNING: ${String(w)}`));
  }

  return (
    <div className="measurement-report-page border rounded-lg overflow-hidden bg-background">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="font-semibold text-sm flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Measurement Data Summary
        </div>
        <Badge variant="secondary">data</Badge>
      </div>
      <div className="p-4 space-y-4">
        {phase0BypassBug && (
          <div className="rounded-md bg-destructive text-destructive-foreground border-2 border-destructive px-3 py-2">
            <div className="text-xs font-bold uppercase tracking-wide">
              Developer Bug
            </div>
            <div className="text-sm font-semibold mt-1">
              phase0_bypassed_before_perimeter_gate — invariant tripped: a valid
              footprint reached the perimeter failure path without Phase 0 being
              built. Old global-mask early-return still active somewhere
              upstream.
            </div>
          </div>
        )}
        {phase0MissingBug && !phase0BypassBug && (
          <div className="rounded-md bg-destructive text-destructive-foreground border-2 border-destructive px-3 py-2">
            <div className="text-xs font-bold uppercase tracking-wide">
              Internal Bug
            </div>
            <div className="text-sm font-semibold mt-1">
              perimeter_inner_trace_detected fired before Perimeter Phase 0
              executed. Old global-mask gate is still active.
            </div>
          </div>
        )}
        {errorList.length > 0 && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 space-y-1">
            <div className="text-xs font-bold text-destructive">
              Errors &amp; Diagnostics
            </div>
            {errorList.map((e, i) => (
              <div key={i} className="text-xs text-destructive">{e}</div>
            ))}
          </div>
        )}

        {/* CPU reserve diagnostic panel */}
        {(() => {
          const elapsed = Number((grj as any).cpu_budget_elapsed_ms ?? (grj as any).cpu?.elapsed_ms ?? NaN);
          const remaining = Number((grj as any).cpu_budget_remaining_ms ?? (grj as any).cpu?.remaining_ms ?? NaN);
          const total = Number(
            (grj as any).cpu_budget_total_ms ??
            (grj as any).cpu_budget_ms ??
            (grj as any).cpu?.budget_ms ??
            ((Number.isFinite(elapsed) && Number.isFinite(remaining)) ? elapsed + remaining : NaN)
          );
          const late = (grj as any).late_cpu_preempt === true || (Number.isFinite(remaining) && remaining < 0);
          if (!Number.isFinite(elapsed) && !Number.isFinite(remaining)) return null;
          const reason = (grj as any).cpu_preempt_reason ?? (grj as any).cpu?.preempt_reason ?? (late ? 'wall_clock_reserve_threshold' : 'within_budget');
          const fmtS = (ms: number) => Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '—';
          return (
            <div className={`rounded-md border px-3 py-2 ${late ? 'border-destructive/40 bg-destructive/10' : 'bg-muted/30'}`}>
              <div className={`text-xs font-bold mb-1 ${late ? 'text-destructive' : 'text-muted-foreground'}`}>
                {late ? 'CPU reserve missed' : 'CPU budget'}
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] font-mono">
                <div className="text-muted-foreground">Elapsed</div>
                <div>{fmtS(elapsed)}{Number.isFinite(total) ? ` / ${fmtS(total)}` : ''}</div>
                <div className="text-muted-foreground">Remaining</div>
                <div className={late ? 'text-destructive' : ''}>{fmtS(remaining)}</div>
                <div className="text-muted-foreground">Preempt reason</div>
                <div className="break-all">{String(reason)}</div>
              </div>
            </div>
          );
        })()}


        {/* Main measurements */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {rows.map((r) => (
            <div key={r.label} className="rounded-md border bg-card p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                {r.icon}
                {r.label}
              </div>
              <div className="text-lg font-bold tabular-nums">{r.value}</div>
            </div>
          ))}
        </div>

        {/* Debug / pipeline info */}
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Pipeline &amp; debug details ▸
          </summary>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {debugRows.map((r) => (
              <div
                key={r.label}
                className="rounded border bg-muted/30 px-2 py-1.5"
              >
                <div className="text-[10px] text-muted-foreground">
                  {r.label}
                </div>
                <div className="text-xs font-medium truncate">{r.value}</div>
              </div>
            ))}
          </div>
        </details>

        {faceRejections.length > 0 && (
          <details className="group rounded-md border bg-muted/20 p-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              Face rejection table ({faceRejections.length}) ▸
            </summary>
            <div className="mt-2 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left p-1">Face</th>
                    <th className="text-right p-1">Area</th>
                    <th className="text-right p-1">RMS</th>
                    <th className="text-left p-1">Inside</th>
                    <th className="text-left p-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {faceRejections.map((r: any, i: number) => (
                    <tr key={i} className="border-t">
                      <td className="p-1 font-medium">
                        {String(r.face_id ?? i + 1)}
                      </td>
                      <td className="p-1 text-right tabular-nums">
                        {fmt(r.area_sqft, " sqft")}
                      </td>
                      <td className="p-1 text-right tabular-nums">
                        {fmt(r.plane_rms)}
                      </td>
                      <td className="p-1">
                        {String(r.inside_footprint ?? "—")}
                      </td>
                      <td className="p-1">
                        {String(r.rejection_reason ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {innerTraceFired && sourceCtxDebug && (
          <details
            className="group rounded-md border border-destructive/40 bg-destructive/5 p-3"
            data-pdf-exclude="true"
            open
          >
            <summary className="cursor-pointer text-xs font-bold text-destructive">
              Perimeter inner-trace debug payload (full gate context) ▸
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded border bg-background text-foreground p-2 text-[10px] font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(sourceCtxDebug, null, 2)}
            </pre>
          </details>
        )}

        {acquisitionAudit && (
          <details
            className="group rounded-md border bg-muted/20 p-3"
            data-pdf-exclude="true"
          >
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              Source acquisition audit — diagnostic JSON ▸
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded border bg-background text-foreground p-2 text-[10px] font-mono whitespace-pre-wrap break-all">
              {JSON.stringify({ acquisition_audit: acquisitionAudit, source_acquisition_debug: sourceAcquisitionDebug }, null, 2)}
            </pre>
          </details>
        )}

        {/* Raw geometry_report_json dump for ChatGPT analysis */}
        <div data-pdf-exclude="true">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Raw JSON — diagnostic payload
          </div>
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              Raw JSON (for analysis) ▸
            </summary>
            <pre className="mt-2 max-h-60 overflow-auto rounded border bg-background text-foreground p-2 text-[10px] font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(grj, null, 2)}
            </pre>
          </details>
        </div>

      </div>
    </div>
  );
};

const getRasterOverlayData = getRasterOverlayDataShared;



const MeasurementReportDialog: React.FC<MeasurementReportDialogProps> = ({
  open,
  onOpenChange,
  measurement,
  address,
  pipelineEntryId,
  aiMeasurementJobId: explicitJobId,
}) => {
  const { toast } = useToast();
  const reportContentRef = useRef<HTMLDivElement | null>(null);
  const exportImageCacheRef = useRef<Map<string, string>>(new Map());
  const [diagrams, setDiagrams] = useState<DiagramRow[]>([]);
  const [jobId, setJobId] = useState<string | null>(explicitJobId || null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fullMeasurement, setFullMeasurement] = useState<any | null>(null);
  const [overrideEditorOpen, setOverrideEditorOpen] = useState(false);
  const [debugViewerOpen, setDebugViewerOpen] = useState(false);
  const { user: currentUser } = useCurrentUser();
  const effectiveMeasurement = fullMeasurement || measurement;
  const canOverride = (() => {
    const registrationBlocked =
      (effectiveMeasurement as any)?.geometry_report_json
        ?.registration_precedence_applied === true;
    const r = (currentUser?.role ?? "").toLowerCase();
    return !registrationBlocked &&
      (r === "master" || r === "admin" || r === "cob");
  })();

  const previewGate = useMemo(() => evaluatePreviewGate(effectiveMeasurement), [
    effectiveMeasurement,
  ]);
  const pdfGate = useMemo(() => evaluatePdfGate(effectiveMeasurement), [
    effectiveMeasurement,
  ]);

  // ── PATCH 2: don't open a stale cached PDF if its signature no longer
  // matches the latest geometry_report_json (means a newer AI run
  // produced different planes/edges and the PDF must be re-rendered).
  const debugPipeline =
    (effectiveMeasurement as any)?.geometry_report_json?.debug_pipeline || null;
  const currentPdfSig =
    (effectiveMeasurement as any)?.geometry_report_json?.pdf_source_signature ||
    null;
  const lastRenderedSig = (effectiveMeasurement as any)?.geometry_report_json
    ?.last_rendered_pdf_signature || null;
  const pdfIsStale = Boolean(
    currentPdfSig && lastRenderedSig && currentPdfSig !== lastRenderedSig,
  );
  const canOpenExistingPdf = Boolean(
    (effectiveMeasurement as any)?.report_pdf_url && pdfGate.ok && !pdfIsStale,
  );
  const reportModel = useMemo(() => {
    const serverPatent = (effectiveMeasurement as any)?.patent_model ||
      (effectiveMeasurement as any)?.geometry_report_json?.patent_model;
    return serverPatent ?? null;
  }, [effectiveMeasurement]);
  const persistedPlaneCount = Number(
    (reportModel as any)?.plane_count ??
      (reportModel as any)?.facet_count ??
      (Array.isArray((reportModel as any)?.planes)
        ? (reportModel as any).planes.length
        : 0),
  );
  const renderedPlaneCount = Array.isArray((reportModel as any)?.planes)
    ? (reportModel as any).planes.length
    : 0;
  const renderedPlaneLabels = Array.isArray((reportModel as any)?.planes)
    ? new Set(
      (reportModel as any).planes.map((p: any) =>
        String(p.label ?? p.id ?? "A")
      ),
    ).size
    : 0;
  const reportCollapsed = Boolean(
    reportModel && persistedPlaneCount > 1 &&
      (renderedPlaneCount <= 1 || renderedPlaneLabels <= 1),
  );
  const hasRasterOverlayRenderable = (() => {
    return getRasterOverlayData(effectiveMeasurement).hasRasterOverlay;
  })();
  const hasRenderableReport = Boolean(reportModel) || diagrams.length > 0 ||
    hasRasterOverlayRenderable;
  const hasDiagnosticExport = Boolean(effectiveMeasurement);

  type PdfExportProfile = {
    scale: number;
    jpegQuality: number;
  };

  const PDF_MAX_BYTES = 9.5 * 1024 * 1024;
  const PDF_EXPORT_PROFILES: PdfExportProfile[] = [
    { scale: 2.5, jpegQuality: 0.95 },
    { scale: 2, jpegQuality: 0.9 },
    { scale: 1.5, jpegQuality: 0.65 },
  ];

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...Array.from(chunk));
    }
    return btoa(binary);
  };

  const imageUrlToDataUrl = async (url: string): Promise<string> => {
    if (!url || url.startsWith("data:")) return url;
    const cached = exportImageCacheRef.current.get(url);
    if (cached) return cached;
    const response = await fetch(url, { mode: "cors", cache: "force-cache" });
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    const contentType = response.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Expected image, got ${contentType}`);
    }
    const dataUrl = `data:${contentType};base64,${
      arrayBufferToBase64(await response.arrayBuffer())
    }`;
    exportImageCacheRef.current.set(url, dataUrl);
    return dataUrl;
  };

  const replaceSvgImagesForExport = async (
    source: HTMLElement,
    clone: HTMLElement,
    profile: PdfExportProfile,
  ) => {
    const sourceImages = Array.from(
      source.querySelectorAll<SVGImageElement>("svg image"),
    );
    const cloneImages = Array.from(
      clone.querySelectorAll<SVGImageElement>("svg image"),
    );
    await Promise.all(cloneImages.map(async (image, index) => {
      const sourceImage = sourceImages[index] || image;
      const href = sourceImage.getAttribute("href") ||
        sourceImage.getAttribute("xlink:href");
      if (!href) return;
      const dataUrl = await imageUrlToDataUrl(href);
      image.setAttribute("href", dataUrl);
      image.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);
      image.style.imageRendering = "auto";
      const width = Number(image.getAttribute("width") || 0);
      const height = Number(image.getAttribute("height") || 0);
      if (width > 0 && height > 0 && profile.scale >= 2) {
        image.setAttribute("width", String(width));
        image.setAttribute("height", String(height));
      }
    }));
  };

  const createExportReadyClone = async (
    page: HTMLElement,
    profile: PdfExportProfile,
  ) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-10000px";
    wrapper.style.top = "0";
    wrapper.style.width = `${page.offsetWidth || 900}px`;
    wrapper.style.background = "#ffffff";
    wrapper.style.zIndex = "-1";

    const clone = page.cloneNode(true) as HTMLElement;
    clone.style.width = `${page.offsetWidth || 900}px`;
    clone.querySelectorAll('img[aria-hidden="true"], img.hidden').forEach((
      img,
    ) => img.remove());
    // Drop diagnostic JSON dumps from the exported PDF. These render as dark
    // <pre> blocks that look like a stray black image in the rasterized PDF.
    clone
      .querySelectorAll('[data-pdf-exclude="true"]')
      .forEach((el) => el.remove());


    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    await replaceSvgImagesForExport(page, clone, profile);
    return { element: clone, cleanup: () => wrapper.remove() };
  };

  const capturePageImage = async (
    page: HTMLElement,
    profile: PdfExportProfile,
  ) => {
    const captureOptions = {
      scale: profile.scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      imageTimeout: 30000,
      logging: false,
    } as const;

    const exportClone = await createExportReadyClone(page, profile);
    try {
      await Promise.all(
        Array.from(exportClone.element.querySelectorAll("img")).map((img) => (
          img.complete ? Promise.resolve() : new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          })
        )),
      );
      const canvas = await html2canvas(exportClone.element, {
        ...captureOptions,
        windowWidth: exportClone.element.scrollWidth,
        windowHeight: exportClone.element.scrollHeight,
      });
      return {
        imgData: canvas.toDataURL("image/jpeg", profile.jpegQuality),
        width: canvas.width,
        height: canvas.height,
      };
    } catch (err) {
      console.warn(
        "Export-ready PDF page capture failed; retrying direct capture:",
        err,
      );
    } finally {
      exportClone.cleanup();
    }

    const canvas = await html2canvas(page, captureOptions);
    return {
      imgData: canvas.toDataURL("image/jpeg", profile.jpegQuality),
      width: canvas.width,
      height: canvas.height,
    };
  };

  const downloadVisibleReportPdf = async () => {
    const root = reportContentRef.current;
    if (!root) throw new Error("Report preview is not ready yet.");

    // Capture the dedicated PDF-only root. This is a visual-first export
    // (header + roof-focused aerial + compact diagnostic chips) rendered
    // off-screen by MeasurementReportPdfVisualSection, NOT the live
    // interactive dialog DOM. If the root is missing the export aborts
    // with a clear error rather than silently falling back to the
    // debug-grid-dominated dialog DOM.
    const pdfRoot = root.querySelector<HTMLElement>(
      '[data-pdf-report-root="true"]',
    );
    if (!pdfRoot) {
      console.error("PDF export root missing: data-pdf-report-root");
      throw new Error("PDF export root missing.");
    }

    await document.fonts?.ready;
    try {
      const { waitForImagesInRoot } = await import(
        "@/lib/measurements/exportImageLoader"
      );
      const states = await waitForImagesInRoot(pdfRoot, { timeoutMs: 5000 });
      // eslint-disable-next-line no-console
      console.log("PDF export image states:", states);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("PDF export image wait failed; proceeding to capture", e);
    }
    let pdf: jsPDF | null = null;
    for (const profile of PDF_EXPORT_PROFILES) {
      const candidate = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "letter",
        compress: true,
      });
      const pdfWidth = candidate.internal.pageSize.getWidth();
      const pdfHeight = candidate.internal.pageSize.getHeight();
      const margin = 24;
      const usableWidth = pdfWidth - margin * 2;
      const usableHeight = pdfHeight - margin * 2;

      const pageImage = await capturePageImage(pdfRoot, profile);
      const ratio = Math.min(
        usableWidth / pageImage.width,
        usableHeight / pageImage.height,
      );
      const width = pageImage.width * ratio;
      const height = pageImage.height * ratio;
      candidate.addImage(
        pageImage.imgData,
        "JPEG",
        (pdfWidth - width) / 2,
        margin,
        width,
        height,
      );

      const size = candidate.output("blob").size;
      pdf = candidate;
      if (
        size <= PDF_MAX_BYTES ||
        profile === PDF_EXPORT_PROFILES[PDF_EXPORT_PROFILES.length - 1]
      ) break;
    }

    const safeAddress = (address || "measurement-report")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "measurement-report";
    pdf?.save(`${safeAddress}-measurement-report.pdf`);
  };


  useEffect(() => {
    if (!open) {
      setFullMeasurement(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        setFullMeasurement(null);
        let resolvedJobId = explicitJobId ||
          (measurement as any)?.ai_measurement_job_id || null;
        if (!resolvedJobId && pipelineEntryId) {
          const { data } = await (supabase as any)
            .from("ai_measurement_jobs")
            .select("id")
            .eq("lead_id", pipelineEntryId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          resolvedJobId = data?.id || null;
        }
        if (!resolvedJobId) {
          if (!cancelled) {
            setJobId(null);
            setDiagrams([]);
          }
          return;
        }
        if (!cancelled) setJobId(resolvedJobId);

        const { data: roofMeasurement } = await (supabase as any)
          .from("roof_measurements")
          .select(
            "id, ai_measurement_job_id, validation_status, requires_manual_review, facet_count, geometry_report_json, report_pdf_url, report_pdf_path, total_area_flat_sqft, total_area_adjusted_sqft, total_squares, predominant_pitch, total_ridge_length, total_hip_length, total_valley_length, total_eave_length, total_rake_length, footprint_source, detection_method, google_maps_image_url, linear_features_wkt, perimeter_wkt, target_lat, target_lng, footprint_vertices_geo, footprint_confidence, satellite_overlay_url, gps_coordinates, analysis_zoom, analysis_image_size, image_bounds, mapbox_image_url, selected_image_source, image_source, measurement_confidence, overlay_schema, patent_model, result_state, customer_report_ready, gate_reason, block_customer_report_reason",
          )
          .eq("ai_measurement_job_id", resolvedJobId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: aiJobContext } = await (supabase as any)
          .from("ai_measurement_jobs")
          .select(
            "source_context, result_state, report_blocked, failure_reason, status_message",
          )
          .eq("id", resolvedJobId)
          .maybeSingle();

        const mergedMeasurement = roofMeasurement
          ? {
            ...(measurement as any),
            ...roofMeasurement,
            source_context: aiJobContext?.source_context ??
              (measurement as any)?.source_context,
            result_state: roofMeasurement.result_state ??
              aiJobContext?.result_state ?? (measurement as any)?.result_state,
          }
          : {
            ...(measurement as any),
            source_context: aiJobContext?.source_context ??
              (measurement as any)?.source_context,
            result_state: aiJobContext?.result_state ??
              (measurement as any)?.result_state,
          };
        if (!cancelled) setFullMeasurement(mergedMeasurement);

        if (evaluatePreviewGate(mergedMeasurement).ok) {
          const { data, error } = await (supabase as any)
            .from("ai_measurement_diagrams")
            .select("id, diagram_type, title, page_number, svg_markup")
            .eq("ai_measurement_job_id", resolvedJobId)
            .order("page_number", { ascending: true });
          if (!error && !cancelled) setDiagrams(data || []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, explicitJobId, measurement, pipelineEntryId]);

  const handleDownloadPdf = async () => {
    if (!hasDiagnosticExport && !hasRenderableReport && !jobId) return;
    setDownloading(true);

    // ALWAYS prefer capturing the visible report — it is the source of truth
    // the user sees on screen (raster overlay + patent model + diagrams).
    // The cached server `report_pdf_url` is often stale and shows entirely
    // different visuals (legacy patent line drawings) than the current
    // dialog. Only fall back to the cached/server PDF when client capture
    // genuinely cannot produce anything (no DOM pages at all).
    try {
      await downloadVisibleReportPdf();
      toast({
        title: pdfGate.ok
          ? "Report downloaded"
          : "Diagnostic report downloaded",
        description: pdfGate.ok
          ? "The measurement report PDF is ready."
          : "This PDF is marked preview-only and includes QA failure details for troubleshooting.",
      });
      setDownloading(false);
      return;
    } catch (clientErr: any) {
      console.warn(
        "Client PDF export failed, attempting server fallback:",
        clientErr,
      );
    }

    // Server fallback path: existing cached PDF first, then re-render.
    const existingPdfUrl = (effectiveMeasurement as any)?.report_pdf_url;
    if (existingPdfUrl && pdfGate.ok && !pdfIsStale) {
      window.open(existingPdfUrl, "_blank", "noopener,noreferrer");
      setDownloading(false);
      return;
    }
    if (!jobId) {
      toast({
        title: "PDF generation failed",
        description:
          "The browser could not export this report and no server job is available.",
        variant: "destructive",
      });
      setDownloading(false);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke(
        "render-measurement-pdf",
        {
          body: { ai_measurement_job_id: jobId },
        },
      );

      // supabase.functions.invoke treats any non-2xx as `error`. Our QC gate
      // returns 422 with a structured body — read it before falling through
      // to a generic failure toast.
      let payload: any = data;
      if (error && (error as any)?.context?.json) {
        try {
          payload = await (error as any).context.json();
        } catch { /* noop */ }
      } else if (error && (error as any)?.context?.body) {
        try {
          const txt = await (error as any).context.text?.();
          payload = txt ? JSON.parse(txt) : null;
        } catch { /* noop */ }
      }

      const errCode = (payload as any)?.error;
      if (
        errCode === "manual_measurement_required" ||
        errCode === "internal_review_required"
      ) {
        toast({
          title: "Internal review required",
          description: (payload as any)?.reason ||
            "Automated roof geometry could not be verified.",
          variant: "destructive",
        });
        return;
      }
      if (errCode === "no_diagrams") {
        toast({
          title: "No diagrams available",
          description:
            "No roof diagrams were generated for this job. Re-run the AI measurement.",
          variant: "destructive",
        });
        return;
      }
      if (error) throw error;

      const url = (data as any)?.pdf_url;
      if (!url) throw new Error("No PDF URL returned.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({
        title: "PDF generation failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[90vh] max-h-[90vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 flex flex-row items-center justify-between flex-shrink-0">
          <div>
            <DialogTitle>Measurement Report</DialogTitle>
            {(effectiveMeasurement as any)?.geometry_report_json
              ?.block_customer_report_reason && (
              <p className="mt-1 text-xs font-medium text-destructive">
                Diagnostic export only — not customer-ready.
              </p>
            )}
            {address && (
              <p className="text-sm text-muted-foreground mt-1">{address}</p>
            )}
            {(() => {
              const grj = (effectiveMeasurement as any)?.geometry_report_json ||
                {};
              const resolvedState = resolveMeasurementDiagnosticState(
                effectiveMeasurement as any,
              );
              const overlayDbg = grj.overlay_debug || {};
              const debugGeom = grj.debug_geometry || {};
              const dsmDbg = grj.dsm_planar_graph_debug || {};
              const registrationBlocked =
                grj.registration_precedence_applied === true &&
                resolvedState.final_state_source !== "runtime_cpu_budget_guard";
              const footprintSource = resolvedState.footprint_source ??
                (registrationBlocked
                  ? "blocked_by_registration_gate"
                  : ((effectiveMeasurement as any)?.footprint_source ??
                    grj.footprint_source ??
                    debugGeom.footprint_source ??
                    dsmDbg.footprint_source ??
                    overlayDbg.footprint_source ??
                    "unknown"));
              const inferenceSource =
                (effectiveMeasurement as any)?.inference_source ??
                  grj.inference_source ?? "unknown";
              const topologySource = grj.topology_source ??
                grj.geometry_source ?? "unknown";
              const usedDeterministic =
                grj.used_deterministic_topology === true;
              // Registration precedence wins — if the gate fired, show the
              // precedence reason instead of any downstream perimeter/topology
              // blocking reason that may still be stamped on the row.
              const blocked = resolvedState.block_customer_report_reason ??
                (registrationBlocked
                  ? (grj.registration_precedence_reason ||
                    grj.hard_fail_reason || grj.block_customer_report_reason ||
                    null)
                  : (grj.block_customer_report_reason || null));
              const coordMatch = grj.dsm_coordinate_match ??
                overlayDbg.dsm_coordinate_match ??
                dsmDbg.dsm_coordinate_match ?? null;
              const coordMatchOk = coordMatch?.match ?? null;
              return (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono text-muted-foreground max-w-full overflow-hidden">
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      usedDeterministic
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted"
                    }`}
                    title="Topology engine that produced ridges/hips/valleys"
                  >
                    topology: {String(topologySource)}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      footprintSource === "unknown" ||
                        footprintSource === "none"
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-muted"
                    }`}
                    title="Building footprint provider"
                  >
                    footprint: {String(footprintSource)}
                  </span>
                  {coordMatchOk !== null && (
                    <span
                      className={`px-1.5 py-0.5 rounded ${
                        coordMatchOk
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-destructive text-destructive-foreground"
                      }`}
                      title="Footprint overlaps DSM grid"
                    >
                      coord_match: {coordMatchOk ? "true" : "false"}
                    </span>
                  )}
                  <span
                    className="px-1.5 py-0.5 rounded bg-muted"
                    title="Inference source for plane detection"
                  >
                    inference: {String(inferenceSource)}
                  </span>
                  {debugPipeline && (
                    <>
                      <span className="px-1.5 py-0.5 rounded bg-muted">
                        planes:{" "}
                        {String(debugPipeline.final_plane_count_saved ?? 0)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-muted">
                        edges:{" "}
                        {String(debugPipeline.final_edge_count_saved ?? 0)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-muted">
                        patent_planes: {String(
                          debugPipeline.final_patent_model_plane_count ?? 0,
                        )}
                      </span>
                      {debugPipeline.ridge_split_recursive_entered && (
                        <span className="px-1.5 py-0.5 rounded bg-muted">
                          rsr: {String(
                            debugPipeline.ridge_split_recursive_plane_count ??
                              0,
                          )}p/
                          {String(
                            debugPipeline.ridge_split_recursive_edge_count ?? 0,
                          )}e
                        </span>
                      )}
                    </>
                  )}
                  {blocked && (() => {
                    const reasonLabels: Record<string, string> = {
                      target_roof_not_confirmed:
                        "Roof target not confirmed (place pin in StructureSelectionMap)",
                      coordinate_registration_failed:
                        "Coordinate registration failed (DSM/raster transform invalid)",
                      registration_field_conflict:
                        "Registration field conflict — gate passed with contradictory data",
                      missing_selected_candidate:
                        "Missing selected candidate (registration produced no candidate)",
                      blocked_by_registration_gate:
                        "Blocked by registration gate",
                    };
                    const friendly = reasonLabels[String(blocked)] ||
                      String(blocked);
                    return (
                      <span
                        className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-xs break-all whitespace-normal max-w-full block"
                        title={String(blocked)}
                      >
                        blocked: {friendly}
                      </span>
                    );
                  })()}
                  {pdfIsStale && (
                    <span className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground">
                      PDF stale — will regenerate
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
          {(() => {
            const needsReview =
              measurement?.validation_status === "needs_internal_review" ||
              measurement?.validation_status === "needs_manual_measurement" ||
              Boolean(
                (effectiveMeasurement as any)?.geometry_report_json
                  ?.block_customer_report_reason,
              );
            const canDownloadDiagnostic = hasDiagnosticExport ||
              hasRenderableReport || canOpenExistingPdf || Boolean(jobId);
            return (
              <Button
                size="sm"
                variant={needsReview ? "destructive" : "default"}
                onClick={handleDownloadPdf}
                disabled={downloading || !canDownloadDiagnostic}
                title={needsReview
                  ? "Download a preview-only diagnostic PDF for analysis. Customer-ready PDF remains blocked."
                  : undefined}
              >
                {downloading
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : needsReview
                  ? <AlertTriangle className="h-4 w-4 mr-2" />
                  : <Download className="h-4 w-4 mr-2" />}
                {needsReview ? "Download Diagnostic PDF" : "Download PDF"}
              </Button>
            );
          })()}
          {canOverride && effectiveMeasurement?.id && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="ml-2"
                onClick={() => setOverrideEditorOpen(true)}
                title="Open the patent override editor (master/admin only)"
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                Edit measurement
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="ml-2"
                onClick={() => setDebugViewerOpen(true)}
                title="Open the step-by-step AI Measurement diagnostic viewer"
              >
                <LayersIcon className="h-4 w-4 mr-2" />
                AI Process Viewer
              </Button>
            </>
          )}
        </DialogHeader>

        {effectiveMeasurement?.id && (
          <MeasurementOverrideEditor
            measurementId={effectiveMeasurement.id}
            open={overrideEditorOpen}
            onOpenChange={setOverrideEditorOpen}
            onRecalculated={() => {
              // Refresh the dialog by clearing local cache; parent typically refetches.
              setFullMeasurement(null);
            }}
          />
        )}

        {effectiveMeasurement?.id && (
          <AIMeasurement3DDebugViewer
            measurement={effectiveMeasurement}
            open={debugViewerOpen}
            onOpenChange={setDebugViewerOpen}
          />
        )}

        <ScrollArea className="flex-1 min-h-0 px-6 pb-6">
          <div ref={reportContentRef} className="relative">
            {/* PDF-only export root. Rendered off-screen but in the DOM so
                html2canvas can capture it. Excludes interactive controls,
                raw JSON, and the debug grid that previously dominated the
                exported PDF. The download path captures THIS root only. */}
            {effectiveMeasurement && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: '-100000px',
                  top: 0,
                  width: '900px',
                  background: '#ffffff',
                  pointerEvents: 'none',
                  zIndex: -1,
                }}
              >
                <MeasurementReportPdfVisualSection
                  measurement={effectiveMeasurement}
                  address={address}
                />
              </div>
            )}

            {effectiveMeasurement?.id && (
              <div className="mb-6">
                <AIMeasurement3DDebugViewer
                  measurement={effectiveMeasurement}
                  embedded
                />
              </div>
            )}


            {!previewGate.ok
              ? (
                (() => {
                  const {
                    grj,
                    rasterUrl,
                    rasterSize,
                    planes_px,
                    edges_px,
                    footprint_px,
                    hasRasterOverlay,
                  } = getRasterOverlayData(effectiveMeasurement);
                  const fpx = (getRasterOverlayData(effectiveMeasurement) as any).focusPerimeterPx;

                  return (
                    <div className="space-y-4">
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Internal review required</AlertTitle>
                        <AlertDescription>
                          Automated roof geometry could not be verified. This
                          measurement has been routed to internal QA.
                          ({previewGate.reason})
                        </AlertDescription>
                      </Alert>
                      {hasRasterOverlay && (
                        <div className="measurement-report-page border rounded-lg overflow-hidden bg-background">
                          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                            <div className="font-semibold text-sm">
                              Debug Overlay
                            </div>
                            <Badge variant="destructive">internal only</Badge>
                          </div>
                          <div className="p-2 bg-white">
                            <RasterOverlayDebugView
                              imageUrl={rasterUrl}
                              rasterSize={rasterSize}
                              planes_px={planes_px}
                              edges_px={edges_px}
                              footprint_px={footprint_px}
                              overlayCalibration={grj?.overlay_calibration ||
                                null}
                              roofTargetBboxPx={grj?.roof_target_bbox_px ||
                                grj?.debug_geometry?.solar_bbox_px || null}
                              geometryPxSpace={grj?.geometry_px_space || null}
                              focusPerimeterPx={fpx}
                            />
                          </div>
                        </div>
                      )}
                      {/* Show raw debug metrics if available */}
                      {grj?.debug_pipeline && (
                        <MeasurementDataSummary m={effectiveMeasurement} />
                      )}
                    </div>
                  );
                })()
              )
              : loading
              ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Loading diagrams…
                </div>
              )
              : (
                (() => {
                  const {
                    grj,
                    rasterUrl,
                    rasterSize,
                    planes_px,
                    edges_px,
                    footprint_px,
                    hasRasterOverlay,
                  } = getRasterOverlayData(effectiveMeasurement);
                  const fpx = (getRasterOverlayData(effectiveMeasurement) as any).focusPerimeterPx;
                  const showDebugOverlay = hasRasterOverlay;

                  const isDiagnosticOnly = !pdfGate.ok;
                  const isBboxRescued = detectBboxRescue(effectiveMeasurement);

                  const visualQAOverlay = (
                    <MeasurementVisualQAOverlay
                      measurement={effectiveMeasurement}
                      aiMeasurementJobId={(effectiveMeasurement as any)
                        ?.ai_measurement_job_id ??
                        explicitJobId ?? jobId ?? null}
                    />
                  );

                  const debugOverlay = showDebugOverlay
                    ? (
                      <>
                        {visualQAOverlay}
                        <div className="measurement-report-page border rounded-lg overflow-hidden bg-background relative">
                          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                            <div className="font-semibold text-sm">
                              Roof Overlay
                            </div>
                            {isDiagnosticOnly
                              ? (
                                <Badge variant="destructive">
                                  diagnostic only
                                </Badge>
                              )
                              : <Badge variant="secondary">preliminary</Badge>}
                          </div>
                          {isDiagnosticOnly && (
                            <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-destructive">
                              ⚠ DIAGNOSTIC — NOT FOR CUSTOMER USE{" "}
                              {isBboxRescued ? "— BBOX RESCUE ACTIVE" : ""}
                            </div>
                          )}
                          <div className="p-2 bg-white relative">
                            <RasterOverlayDebugView
                              imageUrl={rasterUrl}
                              rasterSize={rasterSize}
                              planes_px={planes_px}
                              edges_px={edges_px}
                              footprint_px={footprint_px}
                              overlayCalibration={grj?.overlay_calibration ||
                                null}
                              roofTargetBboxPx={grj?.roof_target_bbox_px ||
                                grj?.debug_geometry?.solar_bbox_px || null}
                              geometryPxSpace={grj?.geometry_px_space || null}
                              focusPerimeterPx={fpx}
                            />
                            {isDiagnosticOnly && (
                              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                <div className="text-destructive/15 font-black text-6xl -rotate-30 select-none whitespace-nowrap">
                                  DIAGNOSTIC ONLY
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )
                    : visualQAOverlay;

                  if (reportCollapsed) {
                    return (
                      <div className="space-y-6">
                        {debugOverlay}
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>
                            Report model collapse detected
                          </AlertTitle>
                          <AlertDescription>
                            BUG: persisted patent_model has multiple planes but
                            report UI collapsed it.
                          </AlertDescription>
                        </Alert>
                      </div>
                    );
                  }

                  if (reportModel) {
                    return (
                      <div className="space-y-6">
                        {(!pdfGate.ok || pdfGate.warning) && (
                          <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>
                              {pdfGate.warning
                                ? "Footprint estimate"
                                : pdfGate.reason?.includes("single-plane")
                                ? "Footprint estimate"
                                : "Preview only"}
                            </AlertTitle>
                            <AlertDescription>
                              {pdfGate.warning
                                ? pdfGate.warning
                                : pdfGate.reason?.includes("single-plane")
                                ? "Roof slopes could not be segmented. Showing footprint estimate."
                                : `Customer-ready PDF is blocked, but this diagnostic preview can be downloaded for analysis. (${pdfGate.reason})`}
                            </AlertDescription>
                          </Alert>
                        )}
                        {debugOverlay}
                        <MeasurementDataSummary m={effectiveMeasurement} />
                        <PatentRoofReport
                          initialModel={reportModel}
                          address={address}
                        />
                      </div>
                    );
                  }

                  // Fallback: legacy SVG diagrams when no overlay is available
                  if (diagrams.length === 0) {
                    const geoReport = effectiveMeasurement
                      ?.geometry_report_json as any;
                    const failReason = geoReport?.hard_fail_reason ||
                      (effectiveMeasurement as any)?.gate_reason || null;
                    const hasDebugData = geoReport &&
                      (geoReport.footprint_source || geoReport.debug_geometry ||
                        geoReport.overlay_debug);

                    return (
                      <div className="space-y-6">
                        {debugOverlay}
                        <MeasurementDataSummary m={effectiveMeasurement} />
                        {hasDebugData
                          ? (
                            <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                              <AlertTriangle className="h-4 w-4 text-amber-600" />
                              <AlertTitle>
                                INTERNAL DEBUG — NOT CUSTOMER READY
                              </AlertTitle>
                              <AlertDescription className="space-y-2">
                                <p className="font-medium">
                                  Failure: {failReason || "unknown"}
                                </p>
                                {geoReport?.footprint_source && (
                                  <p className="text-xs">
                                    Footprint source:{" "}
                                    {geoReport.footprint_source} | Valid:{" "}
                                    {String(geoReport.footprint_valid)}{" "}
                                    | Points:{" "}
                                    {geoReport.footprint_point_count ?? 0}{" "}
                                    | Area: {geoReport.footprint_area_sqft ?? 0}
                                    {" "}
                                    sqft
                                  </p>
                                )}
                                {geoReport?.debug_geometry && (
                                  <p className="text-xs">
                                    DSM edges detected:{" "}
                                    {geoReport.debug_geometry
                                      .dsm_edges_detected} | Accepted:{" "}
                                    {geoReport.debug_geometry
                                      .dsm_edges_accepted} | Faces:{" "}
                                    {geoReport.debug_geometry.faces_extracted}
                                    {" "}
                                    | Coverage: {((geoReport.debug_geometry
                                      .face_coverage_ratio || 0) * 100).toFixed(
                                        0,
                                      )}%
                                  </p>
                                )}
                                {Array.isArray(geoReport?.rejection_reasons) &&
                                  geoReport.rejection_reasons.length > 0 && (
                                  <details className="text-xs">
                                    <summary className="cursor-pointer font-medium">
                                      Rejection reasons ({geoReport
                                        .rejection_reasons.length})
                                    </summary>
                                    <pre className="mt-1 whitespace-pre-wrap text-muted-foreground">{JSON.stringify(geoReport.rejection_reasons, null, 2)}</pre>
                                  </details>
                                )}
                              </AlertDescription>
                            </Alert>
                          )
                          : (
                            <Alert>
                              <AlertTriangle className="h-4 w-4" />
                              <AlertTitle>No diagrams available</AlertTitle>
                              <AlertDescription>
                                The roof report has not been generated for this
                                measurement yet.
                              </AlertDescription>
                            </Alert>
                          )}
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-6">
                      {debugOverlay}
                      <MeasurementDataSummary m={effectiveMeasurement} />
                      {(!pdfGate.ok || pdfGate.warning) && (
                        <Alert>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>
                            {pdfGate.warning
                              ? "Footprint estimate"
                              : pdfGate.reason?.includes("single-plane")
                              ? "Footprint estimate"
                              : "INTERNAL DEBUG — FAILED GEOMETRY — NOT CUSTOMER READY"}
                          </AlertTitle>
                          <AlertDescription>
                            {pdfGate.warning
                              ? pdfGate.warning
                              : pdfGate.reason?.includes("single-plane")
                              ? "Roof slopes could not be segmented. Showing footprint estimate."
                              : `Customer-ready PDF is blocked, but this diagnostic preview can be downloaded for analysis. (${pdfGate.reason})`}
                          </AlertDescription>
                        </Alert>
                      )}
                      {(() => {
                        if (
                          (grj as any)?.registration_precedence_applied === true
                        ) return null;
                        const p35: any = (grj as any)?.phase3A_5 ??
                          (grj as any)?.phase3_5;
                        const overlaySvg: string | undefined = p35
                          ?.debug_perimeter_overlay_svg;
                        if (!overlaySvg) return null;
                        const safe = DOMPurify.sanitize(overlaySvg, {
                          USE_PROFILES: { svg: true, svgFilters: true },
                        });
                        const rejected = !!p35?.refinement_rejected;
                        const rejectReason = p35?.refinement_rejection_reason;
                        const fallback = p35?.refinement_fallback_used;
                        return (
                          <div className="border rounded-lg overflow-hidden bg-background">
                            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                              <div className="font-semibold text-sm">
                                Phase 3A.5 — Perimeter Refinement Overlay
                              </div>
                              <Badge variant="secondary">debug</Badge>
                            </div>
                            {rejected && (
                              <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200">
                                Refinement rejected:{" "}
                                <strong>{rejectReason || "unknown"}</strong>
                                {fallback
                                  ? (
                                    <>
                                      — fell back to{" "}
                                      <strong>{fallback}</strong>.
                                    </>
                                  )
                                  : null}
                              </div>
                            )}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-[11px] text-muted-foreground border-b">
                              <span>
                                <span className="inline-block w-3 h-0.5 bg-[#888] mr-1 align-middle" />
                                {" "}
                                raw
                              </span>
                              <span>
                                <span className="inline-block w-3 h-0.5 bg-[#00c853] mr-1 align-middle" />
                                {" "}
                                refined
                              </span>
                              <span>
                                <span className="inline-block w-3 h-0.5 bg-[#2196f3] mr-1 align-middle border-dashed" />
                                {" "}
                                selected
                              </span>
                              <span>
                                <span className="inline-block w-2 h-2 rounded-full bg-[#ff5252] mr-1 align-middle" />
                                {" "}
                                rejected vertex
                              </span>
                              <span>
                                <span className="inline-block w-2 h-2 rounded-full bg-[#ff9800] mr-1 align-middle" />
                                {" "}
                                applied exclusion
                              </span>
                            </div>
                            <div
                              className="relative w-full bg-white p-2 [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-h-[60vh] [&_svg]:block"
                              dangerouslySetInnerHTML={{ __html: safe }}
                            />
                          </div>
                        );
                      })()}
                      {diagrams.map((d) => {
                        const label = PAGE_LABELS[(d.page_number || 1) - 1] ||
                          d.title || d.diagram_type;
                        const normalized = (d.svg_markup || "").replace(
                          /<svg([^>]*)>/i,
                          (_m, attrs) => {
                            let a = attrs as string;
                            const hasViewBox = /viewBox=/.test(a);
                            const w = a.match(/\bwidth="(\d+(?:\.\d+)?)"/);
                            const h = a.match(/\bheight="(\d+(?:\.\d+)?)"/);
                            if (!hasViewBox && w && h) {
                              a += ` viewBox="0 0 ${w[1]} ${h[1]}"`;
                            }
                            a = a.replace(/\s(width|height)="[^"]*"/g, "");
                            if (!/preserveAspectRatio=/.test(a)) {
                              a += ' preserveAspectRatio="xMidYMid meet"';
                            }
                            return `<svg${a}>`;
                          },
                        );
                        const safeSvg = DOMPurify.sanitize(normalized, {
                          USE_PROFILES: { svg: true, svgFilters: true },
                        });
                        const showFailedWatermark = !pdfGate.ok &&
                          !pdfGate.warning;
                        return (
                          <div
                            key={d.id}
                            className="measurement-report-page border rounded-lg overflow-hidden bg-background"
                          >
                            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                              <div className="font-semibold text-sm">
                                {d.page_number}. {label}
                              </div>
                              <Badge variant="secondary">
                                {d.diagram_type}
                              </Badge>
                            </div>
                            {showFailedWatermark && (
                              <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-xs font-bold uppercase tracking-wide text-destructive">
                                INTERNAL DEBUG — FAILED GEOMETRY — NOT CUSTOMER
                                READY
                              </div>
                            )}
                            <div
                              className="relative w-full bg-white p-2 [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-h-[80vh] [&_svg]:block"
                              dangerouslySetInnerHTML={{ __html: safeSvg }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default MeasurementReportDialog;
