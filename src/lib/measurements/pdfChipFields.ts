// ============================================================================
// pdfChipFields
// ----------------------------------------------------------------------------
// Pure resolvers for the PDF-only diagnostic chips. Centralized so the PDF
// export and the live UI cannot drift, and so the field-path priorities are
// covered by unit tests.
//
// Display-only. No backend, no geometry.
// ============================================================================

import { resolveAerialCandidateGraph } from "./aerialCandidateGraphResolver";
import { resolveDsmStatusFields } from "@/lib/measurement/resolveDsmStatusFields";

const pickSize = (v: any): { width: number; height: number } | null => {
  if (!v || typeof v !== "object") return null;
  const w = v.width ?? v.w;
  const h = v.height ?? v.h;
  if (typeof w === "number" && typeof h === "number" && Number.isFinite(w) && Number.isFinite(h)) {
    return { width: w, height: h };
  }
  return null;
};

/**
 * DSM size resolution. Mirrors `resolveDsmStatusFields` priority order and
 * deliberately ignores `registration.size` (that field stores the Google
 * Static Maps request size, not the DSM raster size).
 */
export function resolveDsmSize(
  grj: any,
): { width: number; height: number } | null {
  const g = grj ?? {};
  return (
    pickSize(g.registration?.dsm?.dsm_size_px) ??
    pickSize(g.registration?.dsm_size_px) ??
    pickSize(g.registration?.transform_package?.dsm_size_px) ??
    pickSize(g.dsm_split_status?.dsm_size_px) ??
    pickSize(g.registration_gate?.dsm_size_px) ??
    pickSize(g.registration_gate?.transform_package?.dsm_size_px) ??
    pickSize(g.dsm_size_px) ??
    pickSize(g.dsm_size) ??
    pickSize(g.dsm?.size) ??
    null
  );
}

/**
 * Debug roof line count. Never falls back to the aerial candidate graph
 * edge count — that is a different concept and using it as a fallback
 * masks real "no debug lines persisted" cases.
 */
export function resolveDebugRoofLinesCount(grj: any): number {
  const g = grj ?? {};
  if (typeof g.debug_roof_lines_count === "number") return g.debug_roof_lines_count;
  if (Array.isArray(g.debug_roof_lines)) return g.debug_roof_lines.length;
  if (Array.isArray(g.dsm_planar_graph_debug?.debug_roof_lines)) {
    return g.dsm_planar_graph_debug.debug_roof_lines.length;
  }
  if (typeof g.terminal_debug_payload?.debug_roof_lines_count === "number") {
    return g.terminal_debug_payload.debug_roof_lines_count;
  }
  if (
    typeof g.terminal_debug_payload?.raw_debug?.debug_roof_lines_count ===
      "number"
  ) {
    return g.terminal_debug_payload.raw_debug.debug_roof_lines_count;
  }
  return 0;
}

export function resolveAerialCandidateEdgeCount(grj: any): number {
  return resolveAerialCandidateGraph(grj).edgeCount;
}

export function resolveDsmStatusLabel(grj: any): string {
  return resolveDsmStatusFields(grj).statusLabel;
}

export function formatDsmSize(grj: any): string {
  const s = resolveDsmSize(grj);
  return s ? `${s.width}×${s.height}` : "—";
}
