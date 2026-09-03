// Blueprint Importer v2 — deterministic trade takeoff synthesis.
// Pure module: no DB, network, AI, pricing, or catalog mutation.
// Converts consolidated measurement/spec evidence into a reviewable trade takeoff
// and explicitly gates incompatible Phase 4 templates.

import { TRADE_SUPPORT_MAP, type TradeId } from "./trade-catalog.ts";
import { getPhase4Template } from "./phase4-templates.ts";

export interface TakeoffMeasurementInput {
  id: string;
  trade_id: string | null;
  measurement_key: string;
  quantity: number | null;
  unit: string;
  confidence: number | null;
  plan_path_id: string | null;
  page_number?: number | null;
  source_value_raw?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TakeoffMaterialEvidence {
  page_number?: number | null;
  material?: string | null;
  specification?: string | null;
  manufacturer?: string | null;
  product?: string | null;
  brand_explicit?: boolean | null;
  evidence?: string | null;
}

export interface TakeoffDetectedTradeInput {
  id: string;
  trade_id: string;
  support_status?: string | null;
  confidence?: number | null;
  detection_signals?: Record<string, unknown> | null;
}

export interface TakeoffAcceptedTradeInput {
  id: string;
  trade_id: string;
  review_state?: string | null;
  user_assumptions?: Record<string, unknown> | null;
}

export interface TradeTakeoffLine {
  key: string;
  label: string;
  quantity: number;
  unit: string;
  source_measurement_ids: string[];
  source_plan_path_ids: string[];
  derived: boolean;
  formula: string | null;
  confidence: number;
}

export interface TradeTakeoffSynthesis {
  trade_id: TradeId;
  support_status: string;
  status: "ready" | "needs_review" | "manual_only" | "blocked";
  template_key: string | null;
  template_compatible: boolean;
  template_block_reason: string | null;
  measurements: TradeTakeoffLine[];
  material_specs: TakeoffMaterialEvidence[];
  explicit_brands: TakeoffMaterialEvidence[];
  required_measurement_keys: string[];
  missing_required_measurement_keys: string[];
  assumptions: Record<string, unknown>;
  calculations: Record<string, number>;
  blockers: string[];
  warnings: string[];
  source_measurement_ids: string[];
  source_plan_path_ids: string[];
}

function avgConfidence(rows: TakeoffMeasurementInput[]): number {
  const vals = rows.map((r) => Number(r.confidence)).filter((n) => Number.isFinite(n));
  if (!vals.length) return 0.5;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function groupByKey(rows: TakeoffMeasurementInput[]) {
  const out = new Map<string, TakeoffMeasurementInput[]>();
  for (const row of rows) {
    if (row.quantity == null || !Number.isFinite(Number(row.quantity))) continue;
    const arr = out.get(row.measurement_key) ?? [];
    arr.push(row);
    out.set(row.measurement_key, arr);
  }
  return out;
}

function canonicalLabel(key: string): string {
  return key.replace(/^vision\.[^.]+\./, "").replace(/\.p\d+\.\d+$/, "").replace(/_/g, " ");
}

function summarizeMeasurements(rows: TakeoffMeasurementInput[]): TradeTakeoffLine[] {
  const grouped = groupByKey(rows);
  const lines: TradeTakeoffLine[] = [];
  for (const [key, source] of grouped) {
    // Canonical keys should be one authoritative measurement. Vision fallback
    // keys may legitimately appear multiple times, so preserve each rather than sum.
    const canonical = !key.startsWith("vision.");
    if (canonical) {
      const best = [...source].sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0))[0];
      lines.push({
        key,
        label: canonicalLabel(key),
        quantity: Number(best.quantity),
        unit: best.unit,
        source_measurement_ids: [best.id],
        source_plan_path_ids: best.plan_path_id ? [best.plan_path_id] : [],
        derived: false,
        formula: null,
        confidence: Number(best.confidence ?? 0.5),
      });
    } else {
      for (const row of source) {
        lines.push({
          key,
          label: canonicalLabel(key),
          quantity: Number(row.quantity),
          unit: row.unit,
          source_measurement_ids: [row.id],
          source_plan_path_ids: row.plan_path_id ? [row.plan_path_id] : [],
          derived: false,
          formula: null,
          confidence: Number(row.confidence ?? 0.5),
        });
      }
    }
  }
  return lines;
}

function getLine(lines: TradeTakeoffLine[], key: string) {
  return lines.find((l) => l.key === key) ?? null;
}

function addDerived(lines: TradeTakeoffLine[], input: {
  key: string; label: string; unit: string; values: TradeTakeoffLine[]; formula: string; quantity: number;
}) {
  if (!Number.isFinite(input.quantity)) return;
  const ids = Array.from(new Set(input.values.flatMap((v) => v.source_measurement_ids)));
  const paths = Array.from(new Set(input.values.flatMap((v) => v.source_plan_path_ids)));
  lines.push({
    key: input.key,
    label: input.label,
    quantity: input.quantity,
    unit: input.unit,
    source_measurement_ids: ids,
    source_plan_path_ids: paths,
    derived: true,
    formula: input.formula,
    confidence: input.values.length ? Math.min(...input.values.map((v) => v.confidence)) : 0.5,
  });
}

function materialText(materials: TakeoffMaterialEvidence[]): string {
  return materials.map((m) => [m.material, m.specification, m.manufacturer, m.product, m.evidence].filter(Boolean).join(" ")).join(" ").toLowerCase();
}

function phase4TemplateCompatibility(trade: TradeId, materials: TakeoffMaterialEvidence[]) {
  const template = getPhase4Template(trade);
  if (!template) return { template_key: null, compatible: false, reason: "no_phase4_template" };
  const text = materialText(materials);
  if (trade === "roofing") {
    // Current Phase 4 roofing template is explicitly asphalt shingles.
    if (/\b(tile|clay|concrete tile|metal roof|standing seam|tpo|pvc|epdm|modified bitumen|mod[- ]?bit|built[- ]?up)\b/.test(text)) {
      return { template_key: template.internal_template_key, compatible: false, reason: "explicit_roof_system_conflicts_with_asphalt_shingle_template" };
    }
  }
  if (trade === "exterior_walls_siding") {
    // Generic siding rules must not automatically become a stucco/EIFS system.
    if (/\b(stucco|eifs|three[- ]coat|3[- ]coat|metal lath|weep screed)\b/.test(text)) {
      return { template_key: template.internal_template_key, compatible: false, reason: "explicit_stucco_or_eifs_system_requires_trade_specific_template" };
    }
  }
  return { template_key: template.internal_template_key, compatible: true, reason: null };
}

function requiredMeasurementKeys(trade: TradeId): string[] {
  const template = getPhase4Template(trade);
  if (!template) return [];
  const keys = new Set<string>();
  for (const rule of [...template.material_rules, ...template.labor_rules]) {
    for (const input of rule.measurement_inputs) if (input.required) keys.add(input.measurement_key);
  }
  return Array.from(keys);
}

function safeWastePercent(assumptions: Record<string, unknown>): number | null {
  const n = Number(assumptions.waste_percent);
  if (!Number.isFinite(n) || n < 0 || n > 0.5) return null;
  return n;
}

export function synthesizeTradeTakeoff(input: {
  trade_id: TradeId;
  detected_trade: TakeoffDetectedTradeInput;
  accepted_trade?: TakeoffAcceptedTradeInput | null;
  measurements: TakeoffMeasurementInput[];
  materials?: TakeoffMaterialEvidence[];
}): TradeTakeoffSynthesis {
  const trade = input.trade_id;
  const support = TRADE_SUPPORT_MAP[trade];
  const rows = input.measurements.filter((m) => m.trade_id === trade);
  const materials = input.materials ?? [];
  const assumptions = { ...(input.accepted_trade?.user_assumptions ?? {}) };
  const lines = summarizeMeasurements(rows);
  const calculations: Record<string, number> = {};
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Safe arithmetic derivations only. These never invent geometry.
  if (trade === "roofing") {
    const area = getLine(lines, "pitched_roof_area_sqft") ?? getLine(lines, "total_roof_area_sqft");
    if (area?.unit === "sqft") {
      calculations.roof_squares = area.quantity / 100;
      addDerived(lines, { key: "derived.roof_squares", label: "roof squares", unit: "SQ", values: [area], formula: "area_sqft / 100", quantity: calculations.roof_squares });
      const waste = safeWastePercent(assumptions);
      if (waste != null) {
        calculations.waste_adjusted_roof_area_sqft = area.quantity * (1 + waste);
        calculations.waste_adjusted_roof_squares = calculations.waste_adjusted_roof_area_sqft / 100;
        addDerived(lines, { key: "derived.waste_adjusted_roof_squares", label: "waste adjusted roof squares", unit: "SQ", values: [area], formula: `area_sqft * (1 + ${waste}) / 100`, quantity: calculations.waste_adjusted_roof_squares });
      } else {
        warnings.push("waste_percent_not_resolved");
      }
    }
    const eaves = getLine(lines, "eaves_lf"); const rakes = getLine(lines, "rakes_lf");
    if (eaves?.unit === "lf" && rakes?.unit === "lf") {
      calculations.eaves_plus_rakes_lf = eaves.quantity + rakes.quantity;
      addDerived(lines, { key: "derived.eaves_plus_rakes_lf", label: "eaves plus rakes", unit: "lf", values: [eaves, rakes], formula: "eaves_lf + rakes_lf", quantity: calculations.eaves_plus_rakes_lf });
    }
    const hips = getLine(lines, "hips_lf"); const ridges = getLine(lines, "ridges_lf");
    if (hips?.unit === "lf" && ridges?.unit === "lf") {
      calculations.hips_plus_ridges_lf = hips.quantity + ridges.quantity;
      addDerived(lines, { key: "derived.hips_plus_ridges_lf", label: "hips plus ridges", unit: "lf", values: [hips, ridges], formula: "hips_lf + ridges_lf", quantity: calculations.hips_plus_ridges_lf });
    }
  }

  if (trade === "exterior_walls_siding" || trade === "paint_coatings") {
    const net = getLine(lines, "wall_area_sqft"); const gross = getLine(lines, "wall_area_with_windows_doors_sqft");
    if (net?.unit === "sqft" && gross?.unit === "sqft" && gross.quantity >= net.quantity) {
      calculations.openings_area_sqft = gross.quantity - net.quantity;
      addDerived(lines, { key: "derived.openings_area_sqft", label: "openings area", unit: "sqft", values: [gross, net], formula: "gross_wall_area - net_wall_area", quantity: calculations.openings_area_sqft });
    }
  }

  const compatibility = phase4TemplateCompatibility(trade, materials);
  if (!compatibility.compatible && compatibility.reason !== "no_phase4_template") blockers.push(compatibility.reason!);

  const requiredKeys = requiredMeasurementKeys(trade);
  const available = new Set(lines.filter((l) => !l.derived).map((l) => l.key));
  const missing = requiredKeys.filter((k) => !available.has(k));
  if (missing.length) warnings.push(`missing_required_measurements:${missing.join(",")}`);

  if (support === "future_supported") warnings.push("future_supported_trade_requires_manual_review");
  if (support === "measurement_object_only") warnings.push("measurement_object_only_trade");
  if (!rows.length) blockers.push("no_normalized_measurements_for_trade");

  const explicitBrands = materials.filter((m) => m.brand_explicit === true && !!(m.manufacturer || m.product));
  const sourceMeasurementIds = Array.from(new Set(lines.flatMap((l) => l.source_measurement_ids)));
  const sourcePlanPathIds = Array.from(new Set(lines.flatMap((l) => l.source_plan_path_ids));

  let status: TradeTakeoffSynthesis["status"] = "ready";
  if (blockers.length) status = "blocked";
  else if (support === "future_supported" || support === "measurement_object_only") status = "manual_only";
  else if (missing.length || warnings.length) status = "needs_review";

  return {
    trade_id: trade,
    support_status: support,
    status,
    template_key: compatibility.template_key,
    template_compatible: compatibility.compatible,
    template_block_reason: compatibility.reason,
    measurements: lines,
    material_specs: materials,
    explicit_brands: explicitBrands,
    required_measurement_keys: requiredKeys,
    missing_required_measurement_keys: missing,
    assumptions,
    calculations,
    blockers,
    warnings,
    source_measurement_ids: sourceMeasurementIds,
    source_plan_path_ids: sourcePlanPathIds,
  };
}
