// Canonical roofing blueprint engine entrypoint.
// Prevents outline + facet double-counting, applies pitch-aware facet surface area,
// and merges review-gated graphic symbol counts.

import {
  buildRoofingTakeoff,
  type RoofingTakeoffInput,
  type RoofingTakeoffResult,
} from "./blueprint-roofing-takeoff.ts";
import type { RoofSymbolCandidate } from "./blueprint-roofing-topology.ts";

export interface RoofingGraphicSymbolInput extends RoofSymbolCandidate {
  page_number: number;
  viewport_key: string;
}
export type SafeRoofingTakeoffInput = RoofingTakeoffInput & { symbol_candidates?: RoofingGraphicSymbolInput[] };

function centerText(item: { x:number;y:number;width:number;height:number }) { return { x:item.x + item.width/2, y:item.y + item.height/2 }; }
function distance(a:{x:number;y:number}, b:{x:number;y:number}) { return Math.hypot(a.x-b.x,a.y-b.y); }
function positiveNumber(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null; }
function hasNearbyExplicitLabel(input: SafeRoofingTakeoffInput, symbol: RoofingGraphicSymbolInput): boolean {
  const page = input.pages.find((p) => p.page_number === symbol.page_number); if (!page) return false;
  const patterns: Record<RoofSymbolCandidate["kind"], RegExp> = {
    roof_drain: /\b(?:RD[-\s]?\d+|ROOF\s+DRAIN)\b/i, scupper: /\bSCUPPER\b/i,
    curb: /\b(?:RTU|AHU|EF|CU|ROOF\s+CURB)\b/i, penetration: /\b(?:VTR|ROOF\s+VENT|PIPE\s+PENETRATION|PIPE\s+BOOT)\b/i,
  };
  return page.text_items.some((item) => patterns[symbol.kind].test(item.text) && distance(centerText(item), symbol.center) <= 50);
}

function applyFacetSurfaceArea(result: RoofingTakeoffResult, input: SafeRoofingTakeoffInput) {
  const facets = (input.geometry_evidence ?? []).filter((g) => g.geometry_class === "facet");
  if (!facets.length) return;

  const surfaceRows = facets.map((facet) => ({
    facet,
    plan: positiveNumber(facet.metadata?.plan_area_sqft),
    surface: positiveNumber(facet.metadata?.surface_area_sqft),
    pitchRise: positiveNumber(facet.metadata?.pitch_rise),
    pitchRun: positiveNumber(facet.metadata?.pitch_run),
  }));
  const surfaceTotal = surfaceRows.reduce((sum, row) => sum + (row.surface ?? 0), 0);
  const planTotal = surfaceRows.reduce((sum, row) => sum + (row.plan ?? 0), 0);
  const missingPitch = surfaceRows.filter((row) => row.surface == null);
  const areaMeasurement = result.measurements.find((m) => m.measurement_key === "total_roof_area_sqft" && m.unit === "sqft");

  if (surfaceTotal > 0 && missingPitch.length === 0 && areaMeasurement) {
    areaMeasurement.quantity = Number(surfaceTotal.toFixed(2));
    areaMeasurement.source_value_raw = `${surfaceTotal.toFixed(2)} SF slope-adjusted facet surface area`;
    areaMeasurement.normalized_value = {
      plan_area_sqft: Number(planTotal.toFixed(2)),
      surface_area_sqft: Number(surfaceTotal.toFixed(2)),
      facet_count: surfaceRows.length,
      pitch_adjusted: true,
    };
    areaMeasurement.metadata = {
      ...(areaMeasurement.metadata ?? {}),
      area_basis: "slope_adjusted_facets",
      facet_count: surfaceRows.length,
      plan_area_sqft: Number(planTotal.toFixed(2)),
      surface_area_sqft: Number(surfaceTotal.toFixed(2)),
      review_required: true,
    };
    result.summary.roof_area_sqft = Number(surfaceTotal.toFixed(2));
    result.review_flags.push({
      flag_code: "ROOF_AREA_SLOPE_ADJUSTED_FROM_FACETS",
      severity: "info",
      blocking: false,
      message: `Roof area was adjusted from ${planTotal.toFixed(2)} SF plan area to ${surfaceTotal.toFixed(2)} SF surface area using facet pitch evidence.`,
      metadata: { facet_count: surfaceRows.length, plan_area_sqft: Number(planTotal.toFixed(2)), surface_area_sqft: Number(surfaceTotal.toFixed(2)) },
    });
    return;
  }

  if (missingPitch.length > 0) {
    result.review_flags.push({
      flag_code: "ROOF_SURFACE_AREA_INCOMPLETE_PITCH",
      severity: "blocker",
      blocking: true,
      message: `${missingPitch.length} of ${surfaceRows.length} roof facet(s) lack defensible pitch evidence. Flat plan area must not be treated as final pitched-roof material area.`,
      metadata: {
        facet_count: surfaceRows.length,
        missing_pitch_facets: missingPitch.length,
        known_surface_area_sqft: Number(surfaceTotal.toFixed(2)),
        known_plan_area_sqft: Number(planTotal.toFixed(2)),
      },
    });
    if (areaMeasurement) {
      areaMeasurement.metadata = { ...(areaMeasurement.metadata ?? {}), area_basis: "plan_area_pending_pitch_review", pitch_adjusted: false, review_required: true };
    }
  }
}

function appendGraphicSymbolCounts(result: RoofingTakeoffResult, input: SafeRoofingTakeoffInput) {
  const candidates = (input.symbol_candidates ?? []).filter((s) => s.confidence >= 0.6 && !hasNearbyExplicitLabel(input, s));
  const mapping = {
    roof_drain: { key: "drains_count", group: "roof_drainage", label: "roof drain" },
    scupper: { key: "scuppers_count", group: "roof_drainage", label: "scupper" },
    curb: { key: "curbs_count", group: "roof_equipment", label: "roof curb/equipment" },
    penetration: { key: "penetrations_count", group: "roof_penetrations", label: "penetration" },
  } as const;
  const grouped = new Map<RoofSymbolCandidate["kind"], RoofingGraphicSymbolInput[]>();
  for (const candidate of candidates) { const rows = grouped.get(candidate.kind) ?? []; rows.push(candidate); grouped.set(candidate.kind, rows); }

  for (const [kind, list] of grouped) {
    const m = mapping[kind]; const pathKeys: string[] = [];
    for (const [index, symbol] of list.entries()) {
      const key = `roof|p${symbol.page_number}|${symbol.viewport_key}|graphic-symbol|${symbol.kind}-${Math.round(symbol.center.x)}-${Math.round(symbol.center.y)}-${index}`;
      pathKeys.push(key);
      result.plan_paths.push({ _key:key, import_session_id:input.import_session_id, source_document_id:input.source_document_id,
        path_type:"blueprint_sheet", file_name:input.file_name ?? null, document_type:"blueprint_set", provider:"user_uploaded_blueprint",
        page_number:symbol.page_number, diagram_label:null, source_text_excerpt:null, source_coordinates:{bbox:symbol.bbox,center:symbol.center}, confidence:symbol.confidence });
    }
    const existing = result.measurements.find((x) => x.measurement_key === m.key && x.unit === "count");
    if (existing) {
      existing.quantity = Number(existing.quantity ?? 0) + list.length;
      existing.confidence = Math.min(existing.confidence, ...list.map((s) => s.confidence));
      existing.source_value_raw = `${existing.quantity} combined labeled/graphic items`;
      existing.metadata = { ...(existing.metadata ?? {}), graphic_symbol_count:list.length, graphic_symbol_plan_path_keys:pathKeys, review_required:true };
    } else {
      result.measurements.push({ import_session_id:input.import_session_id, source_document_id:input.source_document_id, trade_id:"roofing",
        measurement_key:m.key, measurement_group:m.group, quantity:list.length, unit:"count", precision:0,
        confidence:Math.min(...list.map((s)=>s.confidence)), source_value_raw:`${list.length} graphic ${m.label} candidate(s)`,
        normalized_value:{label_type:m.label,graphic_symbol_count:list.length}, page_number:list.length===1?list[0].page_number:null,
        metadata:{engine_version:"roofing-blueprint-v1+graphic-symbols",review_required:true,count_source:"roof_graphic_symbol",graphic_symbol_plan_path_keys:pathKeys} });
    }
    result.review_flags.push({ flag_code:"ROOF_GRAPHIC_SYMBOL_COUNT_REVIEW", severity:"warning", blocking:false,
      message:`${list.length} ${m.label} count candidate(s) came from graphic-symbol recognition and require review.`, metadata:{kind,count:list.length,plan_path_keys:pathKeys} });
  }
  result.summary.count_measurements = result.measurements.filter((m) => m.unit === "count").length;
}

export function buildSafeRoofingTakeoff(input: SafeRoofingTakeoffInput): RoofingTakeoffResult {
  const evidence = input.geometry_evidence ?? [];
  const facetKeys = new Set(evidence.filter((g) => g.geometry_class === "facet").map((g) => `${g.page_number}|${g.viewport_key}`));
  const filtered = evidence.filter((geometry) => geometry.geometry_class !== "outline" || !facetKeys.has(`${geometry.page_number}|${geometry.viewport_key}`));
  const result = buildRoofingTakeoff({ ...input, geometry_evidence: filtered });
  applyFacetSurfaceArea(result, { ...input, geometry_evidence: filtered });
  appendGraphicSymbolCounts(result, input);
  const removedOutlineCount = evidence.length - filtered.length;
  if (removedOutlineCount > 0) result.review_flags.push({ flag_code:"ROOF_OUTLINE_AREA_SUPERSEDED_BY_FACETS", severity:"info", blocking:false,
    message:`${removedOutlineCount} roof outline area candidate(s) were excluded because calibrated facet geometry exists for the same viewport.`, metadata:{removed_outline_count:removedOutlineCount} });
  return result;
}
