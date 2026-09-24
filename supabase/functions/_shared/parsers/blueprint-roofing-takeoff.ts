// Roofing trade takeoff engine built on Blueprint F1 evidence.
// Quantity policy: only explicit dimensions or calibrated geometry can emit LF/SF.
// Text labels may emit counts/spec candidates but never inferred lengths/areas.

import type { PdfLayoutPage, PdfLayoutTextItem } from "./pdf-layout.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";
import { calibratePolygonArea } from "./blueprint-dimensions.ts";
import type { BlueprintSpecCandidate } from "./blueprint-spec-intelligence.ts";
import type { BlueprintMeasurementObject, MeasurementGroup } from "../blueprint-importer/measurement-objects.ts";
import type { BlueprintPlanPath } from "../blueprint-importer/plan-path.ts";
import type { BlueprintTradeSpecification } from "../blueprint-importer/trade-specifications.ts";

export const BLUEPRINT_ROOFING_TAKEOFF_VERSION = "roofing-blueprint-v1";

export type RoofingGeometryClass =
  | "outline" | "eave" | "rake" | "ridge" | "hip" | "valley" | "facet"
  | "penetration" | "drain" | "roof_to_wall" | "parapet" | "flashing" | "step_flashing";

export interface RoofingGeometryEvidence {
  page_number: number;
  viewport_key: string;
  geometry_class: RoofingGeometryClass;
  points: Array<{ x: number; y: number }>;
  length_ft?: number | null;
  confidence: number;
  source: "f1_calibrated_geometry" | "reviewed_plan_geometry";
  metadata?: Record<string, unknown>;
}

export interface RoofingTakeoffInput {
  import_session_id: string;
  source_document_id: string;
  file_name?: string | null;
  pages: PdfLayoutPage[];
  viewports_by_page: Map<number, DrawingViewport[]> | Record<number, DrawingViewport[]>;
  specification_candidates?: BlueprintSpecCandidate[];
  geometry_evidence?: RoofingGeometryEvidence[];
}

export interface RoofingTakeoffResult {
  version: string;
  trade_id: "roofing";
  measurements: BlueprintMeasurementObject[];
  specifications: BlueprintTradeSpecification[];
  plan_paths: Array<BlueprintPlanPath & { _key: string }>;
  review_flags: Array<{
    flag_code: string;
    severity: "info" | "warning" | "error" | "blocker";
    blocking: boolean;
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  summary: {
    roof_area_sqft: number | null;
    linear_measurements: number;
    count_measurements: number;
    spec_candidates: number;
    calibrated_geometry_items: number;
  };
}

const ROOF_PAGE_RE = /\b(ROOF\s+PLAN|ROOFING|TPO|EPDM|PVC|SHINGLE|STANDING\s+SEAM|RIDGE|VALLEY|EAVE|RAKE|ROOF\s+DRAIN|SCUPPER|PARAPET)\b/i;
const DRAIN_RE = /^(?:RD[-\s]?\d+|ROOF\s+DRAIN(?:\s*[-:]?\s*\d+)?)$/i;
const SCUPPER_RE = /^(?:SCUPPER(?:\s*[-:]?\s*\d+)?)$/i;
const CURB_RE = /^(?:(?:RTU|AHU|EF|CU)[-\s]?\d+|ROOF\s+CURB(?:\s*[-:]?\s*\d+)?)$/i;
const PENETRATION_RE = /^(?:PIPE\s+PENETRATION|ROOF\s+VENT|VENT\s+THRU\s+ROOF|VTR|PIPE\s+BOOT)(?:\s*[-:]?\s*\d+)?$/i;
const PITCH_RE = /\b(?:PITCH|SLOPE)?\s*:?[ ]*(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(?:"|IN)?\s*(?:\/|:|IN\s+12|PER)\s*12\b/i;
const WARRANTY_RE = /\b(10|15|20|25|30)\s*[- ]?(?:YEAR|YR)\s+(NDL\s+)?WARRANTY\b/i;

function fraction(raw: string): number | null {
  const f = raw.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (f) return Number(f[2]) === 0 ? null : Number(f[1]) / Number(f[2]);
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function pageViewports(input: RoofingTakeoffInput, pageNumber: number): DrawingViewport[] {
  if (input.viewports_by_page instanceof Map) return input.viewports_by_page.get(pageNumber) ?? [];
  return input.viewports_by_page[pageNumber] ?? [];
}

function isRoofViewport(viewport: DrawingViewport): boolean {
  return ROOF_PAGE_RE.test(`${viewport.title ?? ""} ${viewport.metadata.title_item_text ?? ""}`);
}

function center(item: PdfLayoutTextItem) {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 };
}

function contains(viewport: DrawingViewport, item: PdfLayoutTextItem): boolean {
  const c = center(item);
  return c.x >= viewport.bbox.x && c.x <= viewport.bbox.x + viewport.bbox.width && c.y >= viewport.bbox.y && c.y <= viewport.bbox.y + viewport.bbox.height;
}

function ownerViewport(item: PdfLayoutTextItem, viewports: DrawingViewport[]): DrawingViewport | null {
  const matches = viewports.filter((viewport) => contains(viewport, item));
  matches.sort((a, b) => a.bbox.width * a.bbox.height - b.bbox.width * b.bbox.height);
  return matches[0] ?? null;
}

function planPathKey(pageNumber: number, viewportKey: string | null, kind: string, token: string): string {
  return `roof|p${pageNumber}|${viewportKey ?? "page"}|${kind}|${token}`;
}

function buildPlanPath(input: RoofingTakeoffInput, pageNumber: number, viewport: DrawingViewport | null, sourceText: string | null, coords: Record<string, unknown> | null, confidence: number, kind: string, token: string) {
  const _key = planPathKey(pageNumber, viewport?.viewport_key ?? null, kind, token);
  const path: BlueprintPlanPath & { _key: string } = {
    _key,
    import_session_id: input.import_session_id,
    source_document_id: input.source_document_id,
    path_type: "blueprint_sheet",
    file_name: input.file_name ?? null,
    document_type: "blueprint_set",
    provider: "user_uploaded_blueprint",
    page_number: pageNumber,
    diagram_label: viewport?.title ?? null,
    source_text_excerpt: sourceText,
    source_coordinates: coords,
    confidence,
  };
  return path;
}

function measurement(input: RoofingTakeoffInput, key: string, group: MeasurementGroup, quantity: number | null, unit: BlueprintMeasurementObject["unit"], confidence: number, pageNumber: number, raw: string | null, normalized: Record<string, unknown> | null, pathKey: string, metadata: Record<string, unknown> = {}): BlueprintMeasurementObject {
  return {
    import_session_id: input.import_session_id,
    source_document_id: input.source_document_id,
    trade_id: "roofing",
    measurement_key: key,
    measurement_group: group,
    quantity,
    unit,
    precision: unit === "sqft" || unit === "lf" ? 2 : 0,
    confidence,
    source_value_raw: raw,
    normalized_value: normalized,
    page_number: pageNumber,
    metadata: {
      engine_version: BLUEPRINT_ROOFING_TAKEOFF_VERSION,
      plan_path_key: pathKey,
      review_required: true,
      ...metadata,
    },
  };
}

function geometryKey(geometryClass: RoofingGeometryClass): { key: string; group: MeasurementGroup } | null {
  switch (geometryClass) {
    case "eave": return { key: "eaves_lf", group: "roof_edges" };
    case "rake": return { key: "rakes_lf", group: "roof_edges" };
    case "ridge": return { key: "ridges_lf", group: "roof_edges" };
    case "hip": return { key: "hips_lf", group: "roof_edges" };
    case "valley": return { key: "valleys_lf", group: "roof_edges" };
    case "roof_to_wall": return { key: "roof_to_wall_lf", group: "roof_flashing" };
    case "parapet": return { key: "parapet_lf", group: "roof_flashing" };
    case "flashing": return { key: "flashing_lf", group: "roof_flashing" };
    case "step_flashing": return { key: "step_flashing_lf", group: "roof_flashing" };
    default: return null;
  }
}

function aggregateMeasurements(objects: BlueprintMeasurementObject[]): BlueprintMeasurementObject[] {
  const aggregatable = new Set([
    "total_roof_area_sqft", "eaves_lf", "rakes_lf", "ridges_lf", "hips_lf", "valleys_lf",
    "roof_to_wall_lf", "parapet_lf", "flashing_lf", "step_flashing_lf",
    "drains_count", "scuppers_count", "curbs_count", "penetrations_count",
  ]);
  const grouped = new Map<string, BlueprintMeasurementObject[]>();
  const passthrough: BlueprintMeasurementObject[] = [];
  for (const obj of objects) {
    if (!aggregatable.has(obj.measurement_key) || obj.quantity == null) { passthrough.push(obj); continue; }
    const list = grouped.get(obj.measurement_key) ?? [];
    list.push(obj);
    grouped.set(obj.measurement_key, list);
  }
  const aggregated: BlueprintMeasurementObject[] = [];
  for (const [key, rows] of grouped) {
    const first = rows[0];
    const quantity = rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    aggregated.push({
      ...first,
      quantity: Number(quantity.toFixed(first.unit === "count" ? 0 : 2)),
      confidence: Math.min(...rows.map((row) => row.confidence)),
      page_number: rows.length === 1 ? first.page_number : null,
      source_value_raw: rows.length === 1 ? first.source_value_raw : `${rows.length} source items`,
      metadata: {
        ...first.metadata,
        aggregate: true,
        source_item_count: rows.length,
        source_pages: [...new Set(rows.map((row) => row.page_number).filter((v) => v != null))],
        constituent_plan_path_keys: rows.map((row) => row.metadata?.plan_path_key).filter(Boolean),
      },
    });
  }
  return [...aggregated, ...passthrough];
}

function roofingSpecs(input: RoofingTakeoffInput, roofPages: Set<number>, paths: Array<BlueprintPlanPath & { _key: string }>): BlueprintTradeSpecification[] {
  const out: BlueprintTradeSpecification[] = [];
  for (const spec of input.specification_candidates ?? []) {
    if (!roofPages.has(spec.page_number)) continue;
    if (!["roofing", "insulation", "deck"].includes(spec.category)) continue;
    const viewport = pageViewports(input, spec.page_number).find((v) => v.viewport_key === spec.viewport_key) ?? null;
    const path = buildPlanPath(input, spec.page_number, viewport, spec.source_text, spec.bbox, spec.confidence, "spec", spec.key_name);
    paths.push(path);
    out.push({
      import_session_id: input.import_session_id,
      source_document_id: input.source_document_id,
      trade_id: "roofing",
      spec_key: spec.key_name,
      category: spec.category,
      value_text: spec.value_text,
      normalized_value: spec.normalized_value,
      confidence: spec.confidence,
      page_number: spec.page_number,
      review_state: "pending_review",
      metadata: {
        engine_version: BLUEPRINT_ROOFING_TAKEOFF_VERSION,
        plan_path_key: path._key,
        viewport_key: spec.viewport_key,
        source_bbox: spec.bbox,
      },
    });
  }

  for (const page of input.pages) {
    if (!roofPages.has(page.page_number)) continue;
    const viewports = pageViewports(input, page.page_number);
    for (const item of page.text_items) {
      const text = item.text.replace(/\s+/g, " ").trim();
      const warranty = text.match(WARRANTY_RE);
      if (!warranty) continue;
      const viewport = ownerViewport(item, viewports);
      const path = buildPlanPath(input, page.page_number, viewport, text, { x: item.x, y: item.y, width: item.width, height: item.height }, 0.9, "spec", "roof_warranty");
      paths.push(path);
      out.push({
        import_session_id: input.import_session_id,
        source_document_id: input.source_document_id,
        trade_id: "roofing",
        spec_key: "roof_warranty",
        category: "roofing",
        value_text: warranty[0],
        normalized_value: { years: Number(warranty[1]), ndl: Boolean(warranty[2]) },
        confidence: 0.9,
        page_number: page.page_number,
        review_state: "pending_review",
        metadata: { engine_version: BLUEPRINT_ROOFING_TAKEOFF_VERSION, plan_path_key: path._key, viewport_key: viewport?.viewport_key ?? null },
      });
    }
  }
  return out;
}

export function buildRoofingTakeoff(input: RoofingTakeoffInput): RoofingTakeoffResult {
  const rawMeasurements: BlueprintMeasurementObject[] = [];
  const paths: Array<BlueprintPlanPath & { _key: string }> = [];
  const reviewFlags: RoofingTakeoffResult["review_flags"] = [];
  const roofPages = new Set<number>();

  for (const page of input.pages) {
    const viewports = pageViewports(input, page.page_number);
    if (ROOF_PAGE_RE.test(page.text) || viewports.some(isRoofViewport)) roofPages.add(page.page_number);
  }

  let calibratedGeometryItems = 0;
  for (const geometry of input.geometry_evidence ?? []) {
    if (!roofPages.has(geometry.page_number)) continue;
    const viewport = pageViewports(input, geometry.page_number).find((v) => v.viewport_key === geometry.viewport_key) ?? null;
    if (!viewport) {
      reviewFlags.push({ flag_code: "ROOF_GEOMETRY_VIEWPORT_MISSING", severity: "error", blocking: true, message: `Roof geometry on page ${geometry.page_number} has no matching viewport.`, metadata: { geometry_class: geometry.geometry_class, viewport_key: geometry.viewport_key } });
      continue;
    }

    if (geometry.geometry_class === "facet" || geometry.geometry_class === "outline") {
      const area = calibratePolygonArea({ viewport, points: geometry.points });
      if (!area) {
        reviewFlags.push({ flag_code: "ROOF_AREA_SCALE_REQUIRED", severity: "blocker", blocking: true, message: `Roof area geometry on page ${geometry.page_number} is not backed by a valid architectural viewport scale.`, metadata: { viewport_key: viewport.viewport_key } });
        continue;
      }
      calibratedGeometryItems += 1;
      const path = buildPlanPath(input, geometry.page_number, viewport, null, { points: geometry.points }, geometry.confidence, "geometry", `area-${calibratedGeometryItems}`);
      paths.push(path);
      rawMeasurements.push(measurement(input, "total_roof_area_sqft", "roof_area", area.area_sqft, "sqft", geometry.confidence, geometry.page_number, `${area.area_sqft.toFixed(2)} SF`, { area_sqft: area.area_sqft, scale_raw: area.scale_raw }, path._key, { geometry_class: geometry.geometry_class, viewport_key: viewport.viewport_key, geometry_source: geometry.source }));
      continue;
    }

    const linear = geometryKey(geometry.geometry_class);
    if (linear) {
      if (!geometry.length_ft || geometry.length_ft <= 0 || !geometry.source) {
        reviewFlags.push({ flag_code: "ROOF_LINEAR_CALIBRATION_REQUIRED", severity: "blocker", blocking: true, message: `${geometry.geometry_class} geometry on page ${geometry.page_number} lacks a calibrated/reviewed length.`, metadata: { viewport_key: viewport.viewport_key } });
        continue;
      }
      calibratedGeometryItems += 1;
      const path = buildPlanPath(input, geometry.page_number, viewport, null, { points: geometry.points }, geometry.confidence, "geometry", `${geometry.geometry_class}-${calibratedGeometryItems}`);
      paths.push(path);
      rawMeasurements.push(measurement(input, linear.key, linear.group, geometry.length_ft, "lf", geometry.confidence, geometry.page_number, `${geometry.length_ft.toFixed(2)} LF`, { length_ft: geometry.length_ft }, path._key, { geometry_class: geometry.geometry_class, viewport_key: viewport.viewport_key, geometry_source: geometry.source }));
    }
  }

  for (const page of input.pages) {
    if (!roofPages.has(page.page_number)) continue;
    const viewports = pageViewports(input, page.page_number);
    for (const item of page.text_items) {
      const text = item.text.replace(/\s+/g, " ").trim();
      if (!text || text.length > 48) continue;
      const viewport = ownerViewport(item, viewports);
      if (viewport && !isRoofViewport(viewport) && !ROOF_PAGE_RE.test(page.text)) continue;

      const countType = DRAIN_RE.test(text) ? { key: "drains_count", group: "roof_drainage" as MeasurementGroup, label: "roof drain" }
        : SCUPPER_RE.test(text) ? { key: "scuppers_count", group: "roof_drainage" as MeasurementGroup, label: "scupper" }
        : CURB_RE.test(text) ? { key: "curbs_count", group: "roof_equipment" as MeasurementGroup, label: "roof curb/equipment" }
        : PENETRATION_RE.test(text) ? { key: "penetrations_count", group: "roof_penetrations" as MeasurementGroup, label: "penetration" }
        : null;
      if (countType) {
        const bbox = { x: item.x, y: item.y, width: item.width, height: item.height };
        const path = buildPlanPath(input, page.page_number, viewport, text, bbox, 0.86, "count", `${countType.key}-${Math.round(item.x)}-${Math.round(item.y)}`);
        paths.push(path);
        rawMeasurements.push(measurement(input, countType.key, countType.group, 1, "count", 0.86, page.page_number, text, { label_type: countType.label }, path._key, { viewport_key: viewport?.viewport_key ?? null, source_bbox: bbox, count_source: "discrete_pdf_label" }));
      }

      const pitch = text.match(PITCH_RE);
      if (pitch) {
        const rise = fraction(pitch[1]);
        if (rise != null && rise >= 0 && rise <= 24) {
          const bbox = { x: item.x, y: item.y, width: item.width, height: item.height };
          const path = buildPlanPath(input, page.page_number, viewport, text, bbox, 0.9, "pitch", `${rise}-12`);
          paths.push(path);
          rawMeasurements.push(measurement(input, "predominant_pitch", "roof_pitch", rise, "pitch_ratio", 0.9, page.page_number, pitch[0], { rise, run: 12, pitch: `${rise}/12` }, path._key, { viewport_key: viewport?.viewport_key ?? null }));
        }
      }
    }
  }

  const measurements = aggregateMeasurements(rawMeasurements);
  const specifications = roofingSpecs(input, roofPages, paths);

  if (!measurements.some((m) => m.measurement_key === "total_roof_area_sqft")) {
    reviewFlags.push({ flag_code: "ROOF_AREA_NOT_AVAILABLE", severity: "blocker", blocking: true, message: "No calibrated roof area is available from the blueprint. Do not generate area-based roofing materials yet." });
  }
  if (!specifications.some((s) => s.spec_key === "roof_membrane" || s.spec_key === "roof_system_type")) {
    reviewFlags.push({ flag_code: "ROOF_SYSTEM_SPEC_MISSING", severity: "warning", blocking: false, message: "No deterministic roof membrane/system specification was found; material selection requires review." });
  }

  const roofArea = measurements.find((m) => m.measurement_key === "total_roof_area_sqft")?.quantity ?? null;
  return {
    version: BLUEPRINT_ROOFING_TAKEOFF_VERSION,
    trade_id: "roofing",
    measurements,
    specifications,
    plan_paths: paths,
    review_flags: reviewFlags,
    summary: {
      roof_area_sqft: roofArea,
      linear_measurements: measurements.filter((m) => m.unit === "lf").length,
      count_measurements: measurements.filter((m) => m.unit === "count").length,
      spec_candidates: specifications.length,
      calibrated_geometry_items: calibratedGeometryItems,
    },
  };
}
