import { TRADE_SUPPORT_MAP, type TradeId } from "./trade-catalog.ts";
import { getPhase4Template } from "./phase4-templates.ts";

export type TakeoffStatus = "ready" | "needs_review" | "manual_only" | "blocked";

export interface MeasurementInput {
  id: string;
  trade_id: string | null;
  measurement_key: string;
  quantity: number | null;
  unit: string;
  confidence?: number | null;
  plan_path_id?: string | null;
}

export interface MaterialEvidence {
  page_number?: number | null;
  material?: string | null;
  specification?: string | null;
  manufacturer?: string | null;
  product?: string | null;
  brand_explicit?: boolean | null;
  evidence?: string | null;
}

export interface TakeoffLine {
  key: string;
  quantity: number;
  unit: string;
  derived: boolean;
  formula: string | null;
  source_measurement_ids: string[];
  source_plan_path_ids: string[];
  confidence: number;
}

export interface TradeTakeoff {
  trade_id: TradeId;
  support_status: string;
  status: TakeoffStatus;
  template_key: string | null;
  template_compatible: boolean;
  template_block_reason: string | null;
  measurements: TakeoffLine[];
  material_specs: MaterialEvidence[];
  explicit_brands: MaterialEvidence[];
  required_measurement_keys: string[];
  missing_required_measurement_keys: string[];
  calculations: Record<string, number>;
  blockers: string[];
  warnings: string[];
  source_measurement_ids: string[];
  source_plan_path_ids: string[];
}

function validRows(rows: MeasurementInput[], trade: TradeId) {
  return rows.filter((r) => r.trade_id === trade && r.quantity != null && Number.isFinite(Number(r.quantity)));
}

function summarize(rows: MeasurementInput[]): TakeoffLine[] {
  const canonical = new Map<string, MeasurementInput>();
  const vision: MeasurementInput[] = [];
  for (const row of rows) {
    if (row.measurement_key.startsWith("vision.")) {
      vision.push(row);
      continue;
    }
    const prior = canonical.get(row.measurement_key);
    if (!prior || Number(row.confidence ?? 0) > Number(prior.confidence ?? 0)) canonical.set(row.measurement_key, row);
  }
  const toLine = (r: MeasurementInput): TakeoffLine => ({
    key: r.measurement_key,
    quantity: Number(r.quantity),
    unit: r.unit,
    derived: false,
    formula: null,
    source_measurement_ids: [r.id],
    source_plan_path_ids: r.plan_path_id ? [r.plan_path_id] : [],
    confidence: Number(r.confidence ?? 0.5),
  });
  return [...Array.from(canonical.values()).map(toLine), ...vision.map(toLine)];
}

function find(lines: TakeoffLine[], key: string) {
  return lines.find((x) => x.key === key) ?? null;
}

function derived(key: string, quantity: number, unit: string, formula: string, source: TakeoffLine[]): TakeoffLine {
  return {
    key,
    quantity,
    unit,
    derived: true,
    formula,
    source_measurement_ids: Array.from(new Set(source.flatMap((s) => s.source_measurement_ids))),
    source_plan_path_ids: Array.from(new Set(source.flatMap((s) => s.source_plan_path_ids))),
    confidence: source.length ? Math.min(...source.map((s) => s.confidence)) : 0.5,
  };
}

function requiredKeys(trade: TradeId): string[] {
  const template = getPhase4Template(trade);
  if (!template) return [];
  const keys = new Set<string>();
  for (const rule of [...template.material_rules, ...template.labor_rules]) {
    for (const input of rule.measurement_inputs) if (input.required) keys.add(input.measurement_key);
  }
  return Array.from(keys);
}

function compatibility(trade: TradeId, materials: MaterialEvidence[]) {
  const template = getPhase4Template(trade);
  if (!template) return { key: null, ok: false, reason: "no_phase4_template" as string | null };
  const text = materials.map((m) => [m.material, m.specification, m.manufacturer, m.product, m.evidence].filter(Boolean).join(" ")).join(" ").toLowerCase();
  if (trade === "roofing" && /\b(tile|clay|concrete tile|metal roof|standing seam|tpo|pvc|epdm|modified bitumen|mod[- ]?bit|built[- ]?up)\b/.test(text)) {
    return { key: template.internal_template_key, ok: false, reason: "explicit_roof_system_conflicts_with_asphalt_shingle_template" };
  }
  if (trade === "exterior_walls_siding" && /\b(stucco|eifs|three[- ]coat|3[- ]coat|metal lath|weep screed)\b/.test(text)) {
    return { key: template.internal_template_key, ok: false, reason: "explicit_stucco_or_eifs_system_requires_trade_specific_template" };
  }
  return { key: template.internal_template_key, ok: true, reason: null };
}

export function synthesizeTradeTakeoff(input: {
  trade_id: TradeId;
  measurements: MeasurementInput[];
  materials?: MaterialEvidence[];
  assumptions?: Record<string, unknown> | null;
}): TradeTakeoff {
  const trade = input.trade_id;
  const support = TRADE_SUPPORT_MAP[trade];
  const rows = validRows(input.measurements, trade);
  const materials = input.materials ?? [];
  const lines = summarize(rows);
  const calculations: Record<string, number> = {};
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (trade === "roofing") {
    const area = find(lines, "pitched_roof_area_sqft") ?? find(lines, "total_roof_area_sqft");
    if (area?.unit === "sqft") {
      calculations.roof_squares = area.quantity / 100;
      lines.push(derived("derived.roof_squares", calculations.roof_squares, "SQ", "area_sqft / 100", [area]));
      const waste = Number(input.assumptions?.waste_percent);
      if (Number.isFinite(waste) && waste >= 0 && waste <= 0.5) {
        calculations.waste_adjusted_roof_squares = area.quantity * (1 + waste) / 100;
        lines.push(derived("derived.waste_adjusted_roof_squares", calculations.waste_adjusted_roof_squares, "SQ", `area_sqft * (1 + ${waste}) / 100`, [area]));
      } else warnings.push("waste_percent_not_resolved");
    }
    const eaves = find(lines, "eaves_lf");
    const rakes = find(lines, "rakes_lf");
    if (eaves?.unit === "lf" && rakes?.unit === "lf") {
      calculations.eaves_plus_rakes_lf = eaves.quantity + rakes.quantity;
      lines.push(derived("derived.eaves_plus_rakes_lf", calculations.eaves_plus_rakes_lf, "lf", "eaves_lf + rakes_lf", [eaves, rakes]));
    }
    const hips = find(lines, "hips_lf");
    const ridges = find(lines, "ridges_lf");
    if (hips?.unit === "lf" && ridges?.unit === "lf") {
      calculations.hips_plus_ridges_lf = hips.quantity + ridges.quantity;
      lines.push(derived("derived.hips_plus_ridges_lf", calculations.hips_plus_ridges_lf, "lf", "hips_lf + ridges_lf", [hips, ridges]));
    }
  }

  if (trade === "exterior_walls_siding" || trade === "paint_coatings") {
    const net = find(lines, "wall_area_sqft");
    const gross = find(lines, "wall_area_with_windows_doors_sqft");
    if (net?.unit === "sqft" && gross?.unit === "sqft" && gross.quantity >= net.quantity) {
      calculations.openings_area_sqft = gross.quantity - net.quantity;
      lines.push(derived("derived.openings_area_sqft", calculations.openings_area_sqft, "sqft", "gross_wall_area - net_wall_area", [gross, net]));
    }
  }

  const comp = compatibility(trade, materials);
  if (!comp.ok && comp.reason !== "no_phase4_template") blockers.push(comp.reason!);
  if (!rows.length) blockers.push("no_normalized_measurements_for_trade");

  const required = requiredKeys(trade);
  const available = new Set(lines.filter((l) => !l.derived).map((l) => l.key));
  const missing = required.filter((k) => !available.has(k));
  if (missing.length) warnings.push(`missing_required_measurements:${missing.join(",")}`);
  if (support === "future_supported") warnings.push("future_supported_trade_requires_manual_review");
  if (support === "measurement_object_only") warnings.push("measurement_object_only_trade");

  let status: TakeoffStatus = "ready";
  if (blockers.length) status = "blocked";
  else if (support === "future_supported" || support === "measurement_object_only") status = "manual_only";
  else if (warnings.length) status = "needs_review";

  return {
    trade_id: trade,
    support_status: support,
    status,
    template_key: comp.key,
    template_compatible: comp.ok,
    template_block_reason: comp.reason,
    measurements: lines,
    material_specs: materials,
    explicit_brands: materials.filter((m) => m.brand_explicit === true && !!(m.manufacturer || m.product)),
    required_measurement_keys: required,
    missing_required_measurement_keys: missing,
    calculations,
    blockers,
    warnings,
    source_measurement_ids: Array.from(new Set(lines.flatMap((l) => l.source_measurement_ids))),
    source_plan_path_ids: Array.from(new Set(lines.flatMap((l) => l.source_plan_path_ids))),
  };
}
