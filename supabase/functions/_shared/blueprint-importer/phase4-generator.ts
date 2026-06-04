// Blueprint Importer v2 — Phase 4 pure draft generator.
// Side-effect-free. No DB, no IO. Given an accepted-trade context, returns:
//   - one template binding (with required_inputs / missing_inputs / assumptions),
//   - material draft lines (deterministic quantities or "blocked" rows),
//   - labor draft lines,
//   - review flags that explain every missing input.
//
// Rules enforced here (mirror Phase 4 contract):
//   * windows_doors NEVER produces drafts (caller must filter; generator also guards).
//   * future_supported trades NEVER produce drafts.
//   * paint_coatings is allowed only when caller asserts a wall source/accepted siding.
//   * Every emitted draft row carries non-empty source_measurement_ids + plan_path_ids
//     OR is emitted as status='blocked' with a review flag and zero quantity.
//   * No formula runs without its required measurements.

import type { TradeId } from "./trade-catalog.ts";
import { isMvpSupportedTrade } from "./trade-catalog.ts";
import {
  evaluateFormula,
  type Phase4FormulaKey,
} from "./phase4-formulas.ts";
import {
  getPhase4Template,
  type Phase4TradeTemplate,
  type MaterialRuleDef,
  type LaborRuleDef,
  type AssumptionSpec,
} from "./phase4-templates.ts";
import { REVIEW_FLAG_CODES } from "./review-flag-codes.ts";

// Minimal measurement shape we accept from the DB (a subset of
// blueprint_measurement_objects rows for the current session).
export interface SessionMeasurementRow {
  id: string;
  trade_id: TradeId | null;
  measurement_key: string;
  quantity: number | null;
  unit: string | null;
  plan_path_id: string | null;
  normalized_value: Record<string, unknown> | null;
}

export interface GenerateInput {
  trade_id: TradeId;
  accepted_trade_id: string;
  measurements: SessionMeasurementRow[];
  /** Caller-supplied user assumptions for this accepted trade. */
  user_assumptions: Record<string, unknown>;
  /** Whether paint may run (a wall_report source OR accepted siding exists). */
  paint_source_present: boolean;
  /** Whether a generic catalog/template table is wired. Phase 4 is always false. */
  catalog_wired?: boolean;
}

export interface DraftMaterialOut {
  rule_id: string;
  item_key: string;
  item_name: string;
  unit: string;
  formula_key: string;
  formula_inputs: Record<string, unknown>;
  quantity: number | null;
  rounding_rule: string;
  waste_percent: number | null;
  source_measurement_ids: string[];
  plan_path_ids: string[];
  catalog_resolution_status: "unresolved" | "matched" | "ambiguous" | "missing" | "manual_override";
  catalog_item_id: string | null;
  status: "draft" | "ready" | "blocked";
}

export interface DraftLaborOut {
  rule_id: string;
  labor_key: string;
  labor_name: string;
  unit: string;
  formula_key: string;
  formula_inputs: Record<string, unknown>;
  quantity: number | null;
  complexity_flags: string[];
  source_measurement_ids: string[];
  plan_path_ids: string[];
  status: "draft" | "ready" | "blocked";
}

export interface DraftFlagOut {
  related_entity_type:
    | "import_session"
    | "accepted_trade"
    | "template_binding"
    | "material_draft_line"
    | "labor_draft_line";
  /** Stable correlation key the caller resolves to a row id post-insert. */
  related_entity_local_key: string;
  severity: "info" | "warning" | "error" | "blocker";
  flag_code: string;
  message: string;
  blocking: boolean;
}

export interface TemplateBindingOut {
  trade_id: TradeId;
  internal_template_key: string | null;
  template_name: string | null;
  required_inputs: Record<string, AssumptionSpec & { resolved_value: unknown; source: string }>;
  optional_inputs: Record<string, AssumptionSpec & { resolved_value: unknown; source: string }>;
  missing_inputs: string[];
  binding_status: "pending" | "ready" | "blocked";
  user_assumptions: Record<string, unknown>;
}

export interface GenerateOutput {
  template_binding: TemplateBindingOut;
  material_drafts: DraftMaterialOut[];
  labor_drafts: DraftLaborOut[];
  review_flags: DraftFlagOut[];
  /** Reasons that any line was marked blocked. */
  blocked_summary: string[];
}

// ---------------- helpers ----------------

function measurementByKey(
  measurements: SessionMeasurementRow[],
  key: string,
): SessionMeasurementRow | null {
  return measurements.find((m) => m.measurement_key === key) ?? null;
}

function resolveAssumption(
  spec: AssumptionSpec,
  user_assumptions: Record<string, unknown>,
): { value: unknown; source: string } {
  if (Object.prototype.hasOwnProperty.call(user_assumptions, spec.key)) {
    const v = user_assumptions[spec.key];
    if (v !== null && v !== undefined && v !== "") return { value: v, source: "user_assumption" };
  }
  if (spec.template_default !== null && spec.template_default !== undefined) {
    return { value: spec.template_default, source: "template_default" };
  }
  return { value: null, source: "unresolved" };
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildBinding(
  template: Phase4TradeTemplate,
  user_assumptions: Record<string, unknown>,
): TemplateBindingOut {
  const required_inputs: TemplateBindingOut["required_inputs"] = {};
  const optional_inputs: TemplateBindingOut["optional_inputs"] = {};
  const missing: string[] = [];

  for (const spec of template.required_assumptions) {
    const r = resolveAssumption(spec, user_assumptions);
    required_inputs[spec.key] = { ...spec, resolved_value: r.value, source: r.source };
    if (r.source === "unresolved") missing.push(spec.key);
  }
  for (const spec of template.optional_assumptions) {
    const r = resolveAssumption(spec, user_assumptions);
    optional_inputs[spec.key] = { ...spec, resolved_value: r.value, source: r.source };
  }

  return {
    trade_id: template.trade_id,
    internal_template_key: template.internal_template_key,
    template_name: template.name,
    required_inputs,
    optional_inputs,
    missing_inputs: missing,
    binding_status: missing.length === 0 ? "ready" : "blocked",
    user_assumptions,
  };
}

/** Resolve coverage / waste percent from the binding for a rule. */
function resolveRuleAssumptionValues(
  rule: MaterialRuleDef,
  binding: TemplateBindingOut,
): { coverage: number | null; waste: number | null; missingAssumption: string[] } {
  const missing: string[] = [];
  let coverage: number | null = null;
  let waste: number | null = null;

  if (rule.coverage_assumption_key) {
    const slot = binding.required_inputs[rule.coverage_assumption_key]
      ?? binding.optional_inputs[rule.coverage_assumption_key];
    coverage = slot ? asNumberOrNull(slot.resolved_value) : null;
    if (coverage == null) missing.push(rule.coverage_assumption_key);
  }
  if (rule.waste_assumption_key) {
    const slot = binding.required_inputs[rule.waste_assumption_key]
      ?? binding.optional_inputs[rule.waste_assumption_key];
    waste = slot ? asNumberOrNull(slot.resolved_value) : null;
    if (waste == null && rule.waste_assumption_key === "waste_percent") {
      missing.push("waste_percent");
    }
  }
  return { coverage, waste, missingAssumption: missing };
}

// Special-case helpers for trade quirks.

function rewriteMeasurementInputsForTrade(
  trade_id: TradeId,
  rule: MaterialRuleDef,
  binding: TemplateBindingOut,
  measurements: SessionMeasurementRow[],
): Array<{ formula_input_key: string; measurement: SessionMeasurementRow | null; required: boolean }> {
  // Walls: pick gross or net measurement based on wall_area_basis.
  if (trade_id === "exterior_walls_siding" && rule.measurement_inputs.some((m) => m.measurement_key === "wall_area_sqft")) {
    const basisSlot = binding.required_inputs["wall_area_basis"];
    const basis = basisSlot?.resolved_value === "gross" ? "wall_area_with_windows_doors_sqft" : "wall_area_sqft";
    return rule.measurement_inputs.map((m) =>
      m.measurement_key === "wall_area_sqft"
        ? { formula_input_key: m.formula_input_key, measurement: measurementByKey(measurements, basis), required: m.required }
        : { formula_input_key: m.formula_input_key, measurement: measurementByKey(measurements, m.measurement_key), required: m.required }
    );
  }
  // Paint: same gross/net switch driven by paintable_area_basis.
  if (trade_id === "paint_coatings" && rule.measurement_inputs.some((m) => m.measurement_key === "wall_area_sqft")) {
    const basisSlot = binding.required_inputs["paintable_area_basis"];
    const basis = basisSlot?.resolved_value === "gross" ? "wall_area_with_windows_doors_sqft" : "wall_area_sqft";
    return rule.measurement_inputs.map((m) =>
      m.measurement_key === "wall_area_sqft"
        ? { formula_input_key: m.formula_input_key, measurement: measurementByKey(measurements, basis), required: m.required }
        : { formula_input_key: m.formula_input_key, measurement: measurementByKey(measurements, m.measurement_key), required: m.required }
    );
  }
  // Gutters: gutter_lf_source overrides the eaves_lf default for the gutter rule.
  if (trade_id === "gutters_fascia_trim" && rule.item_key === "gutter_lf") {
    const src = (binding.required_inputs["gutter_lf_source"]?.resolved_value as string) ?? "eaves_lf";
    return [
      { formula_input_key: "quantity", measurement: measurementByKey(measurements, src), required: true },
    ];
  }
  // Default — direct mapping.
  return rule.measurement_inputs.map((m) => ({
    formula_input_key: m.formula_input_key,
    measurement: measurementByKey(measurements, m.measurement_key),
    required: m.required,
  }));
}

function rewriteMeasurementInputsForLabor(
  trade_id: TradeId,
  rule: LaborRuleDef,
  binding: TemplateBindingOut,
  measurements: SessionMeasurementRow[],
): Array<{ formula_input_key: string; measurement: SessionMeasurementRow | null; required: boolean }> {
  if ((trade_id === "exterior_walls_siding" || trade_id === "paint_coatings") &&
      rule.measurement_inputs.some((m) => m.measurement_key === "wall_area_sqft")) {
    const slot = trade_id === "exterior_walls_siding"
      ? binding.required_inputs["wall_area_basis"]
      : binding.required_inputs["paintable_area_basis"];
    const basis = slot?.resolved_value === "gross" ? "wall_area_with_windows_doors_sqft" : "wall_area_sqft";
    return rule.measurement_inputs.map((m) =>
      m.measurement_key === "wall_area_sqft"
        ? { formula_input_key: m.formula_input_key, measurement: measurementByKey(measurements, basis), required: m.required }
        : { formula_input_key: m.formula_input_key, measurement: measurementByKey(measurements, m.measurement_key), required: m.required }
    );
  }
  return rule.measurement_inputs.map((m) => ({
    formula_input_key: m.formula_input_key,
    measurement: measurementByKey(measurements, m.measurement_key),
    required: m.required,
  }));
}

// ---------------- main entry points ----------------

/**
 * Generate a template binding row only. Does NOT generate draft lines.
 * Caller uses this when the user clicks "Bind template" separately.
 */
export function generateTemplateBindingOnly(input: GenerateInput): {
  binding: TemplateBindingOut | null;
  flags: DraftFlagOut[];
  blocked_reason: string | null;
} {
  const flags: DraftFlagOut[] = [];
  const localKey = `binding:${input.accepted_trade_id}`;

  if (!isMvpSupportedTrade(input.trade_id)) {
    if (input.trade_id === "windows_doors") {
      flags.push({
        related_entity_type: "accepted_trade",
        related_entity_local_key: localKey,
        severity: "blocker",
        flag_code: REVIEW_FLAG_CODES.WINDOWS_DOORS_SELECTED_AS_TRADE,
        message: "windows_doors is measurement-object-only and cannot bind a template.",
        blocking: true,
      });
      return { binding: null, flags, blocked_reason: "windows_doors_selected_as_trade" };
    }
    flags.push({
      related_entity_type: "accepted_trade",
      related_entity_local_key: localKey,
      severity: "blocker",
      flag_code: REVIEW_FLAG_CODES.FUTURE_TRADE_REQUIRES_SHEET_INTELLIGENCE,
      message: "Trade is future-supported and cannot auto-bind a template in Phase 4.",
      blocking: true,
    });
    return { binding: null, flags, blocked_reason: "future_trade_requires_sheet_intelligence" };
  }
  if (input.trade_id === "paint_coatings" && !input.paint_source_present) {
    flags.push({
      related_entity_type: "accepted_trade",
      related_entity_local_key: localKey,
      severity: "blocker",
      flag_code: REVIEW_FLAG_CODES.PAINT_WITHOUT_WALL_SOURCE,
      message: "Paint cannot bind a template without a wall report or accepted siding source.",
      blocking: true,
    });
    return { binding: null, flags, blocked_reason: "paint_without_wall_source" };
  }

  const template = getPhase4Template(input.trade_id);
  if (!template) {
    return { binding: null, flags, blocked_reason: "no_template" };
  }

  const binding = buildBinding(template, input.user_assumptions);
  for (const k of binding.missing_inputs) {
    flags.push({
      related_entity_type: "template_binding",
      related_entity_local_key: localKey,
      severity: "blocker",
      flag_code: REVIEW_FLAG_CODES.TEMPLATE_REQUIRED_ASSUMPTION_MISSING,
      message: `Required assumption missing: ${k}`,
      blocking: true,
    });
  }
  // waste_percent gets its own explicit code if missing.
  if (binding.missing_inputs.includes("waste_percent")) {
    flags.push({
      related_entity_type: "template_binding",
      related_entity_local_key: localKey,
      severity: "blocker",
      flag_code: REVIEW_FLAG_CODES.WASTE_PERCENT_REQUIRED,
      message: "Waste percent must be supplied (from report waste table or user assumption).",
      blocking: true,
    });
  }
  return { binding, flags, blocked_reason: null };
}

export function generateDraftsForAcceptedTrade(input: GenerateInput): GenerateOutput {
  const flags: DraftFlagOut[] = [];
  const blocked_summary: string[] = [];
  const localKey = `binding:${input.accepted_trade_id}`;
  const empty: GenerateOutput = {
    template_binding: {
      trade_id: input.trade_id,
      internal_template_key: null,
      template_name: null,
      required_inputs: {},
      optional_inputs: {},
      missing_inputs: [],
      binding_status: "blocked",
      user_assumptions: input.user_assumptions,
    },
    material_drafts: [],
    labor_drafts: [],
    review_flags: flags,
    blocked_summary,
  };

  // Hard gates first.
  if (input.trade_id === "windows_doors") {
    flags.push({
      related_entity_type: "accepted_trade",
      related_entity_local_key: localKey,
      severity: "blocker",
      flag_code: REVIEW_FLAG_CODES.WINDOWS_DOORS_SELECTED_AS_TRADE,
      message: "windows_doors is measurement-only — no draft generation.",
      blocking: true,
    });
    blocked_summary.push("windows_doors_selected_as_trade");
    return empty;
  }
  if (!isMvpSupportedTrade(input.trade_id)) {
    flags.push({
      related_entity_type: "accepted_trade",
      related_entity_local_key: localKey,
      severity: "blocker",
      flag_code: REVIEW_FLAG_CODES.FUTURE_TRADE_REQUIRES_SHEET_INTELLIGENCE,
      message: "Future-supported trade — no Phase 4 draft generation.",
      blocking: true,
    });
    blocked_summary.push("future_trade_requires_sheet_intelligence");
    return empty;
  }
  if (input.trade_id === "paint_coatings" && !input.paint_source_present) {
    flags.push({
      related_entity_type: "accepted_trade",
      related_entity_local_key: localKey,
      severity: "blocker",
      flag_code: REVIEW_FLAG_CODES.PAINT_WITHOUT_WALL_SOURCE,
      message: "Paint cannot generate drafts without a wall report or accepted siding.",
      blocking: true,
    });
    blocked_summary.push("paint_without_wall_source");
    return empty;
  }

  const template = getPhase4Template(input.trade_id);
  if (!template) {
    blocked_summary.push("no_template");
    return empty;
  }
  const binding = buildBinding(template, input.user_assumptions);

  // Emit assumption-missing flags up front.
  for (const k of binding.missing_inputs) {
    flags.push({
      related_entity_type: "template_binding",
      related_entity_local_key: localKey,
      severity: "blocker",
      flag_code: REVIEW_FLAG_CODES.TEMPLATE_REQUIRED_ASSUMPTION_MISSING,
      message: `Required assumption missing: ${k}`,
      blocking: true,
    });
  }
  if (binding.missing_inputs.includes("waste_percent")) {
    flags.push({
      related_entity_type: "template_binding",
      related_entity_local_key: localKey,
      severity: "blocker",
      flag_code: REVIEW_FLAG_CODES.WASTE_PERCENT_REQUIRED,
      message: "Waste percent must be supplied (from report waste table or user assumption).",
      blocking: true,
    });
  }

  // Generate material drafts.
  const material_drafts: DraftMaterialOut[] = [];
  for (const rule of template.material_rules) {
    // Paint-specific skip rules.
    if (input.trade_id === "paint_coatings") {
      const primerEnabled = asNumberOrNull(binding.required_inputs["primer_enabled"]?.resolved_value);
      if (rule.item_key === "primer_gallons" && primerEnabled === 0) continue;
    }

    const inputsRewritten = rewriteMeasurementInputsForTrade(input.trade_id, rule, binding, input.measurements);
    const { coverage, waste, missingAssumption } = resolveRuleAssumptionValues(rule, binding);

    const values: Record<string, number | null> = {};
    const source_measurement_ids: string[] = [];
    const plan_path_ids: string[] = [];
    const missing_measurements: string[] = [];
    for (const inp of inputsRewritten) {
      if (!inp.measurement) {
        if (inp.required) missing_measurements.push(inp.formula_input_key);
        values[inp.formula_input_key] = null;
        continue;
      }
      values[inp.formula_input_key] = inp.measurement.quantity;
      source_measurement_ids.push(inp.measurement.id);
      if (inp.measurement.plan_path_id) plan_path_ids.push(inp.measurement.plan_path_id);
    }

    // Build draft row scaffold; status decided after evaluation.
    const draftLocalKey = `material:${input.accepted_trade_id}:${rule.rule_id}`;
    const baseRow: DraftMaterialOut = {
      rule_id: rule.rule_id,
      item_key: rule.item_key,
      item_name: rule.item_name,
      unit: rule.unit,
      formula_key: rule.formula_key,
      rounding_rule: rule.rounding,
      waste_percent: waste,
      formula_inputs: {
        values,
        coverage_per_unit: coverage,
        waste_percent: waste,
        rounding: rule.rounding,
        notes: rule.notes ?? null,
        rule_id: rule.rule_id,
        // computed quantities (set on success)
        computed_quantity: null as number | null,
        computed_rounded_quantity: null as number | null,
        effective_waste_percent: null as number | null,
        missing_measurements,
        missing_assumptions: missingAssumption,
      },
      quantity: null,
      source_measurement_ids,
      plan_path_ids,
      catalog_resolution_status: "unresolved",
      catalog_item_id: null,
      status: "draft",
    };

    if (missing_measurements.length || missingAssumption.length || source_measurement_ids.length === 0) {
      baseRow.status = "blocked";
      for (const k of missing_measurements) {
        flags.push({
          related_entity_type: "material_draft_line",
          related_entity_local_key: draftLocalKey,
          severity: "blocker",
          flag_code: REVIEW_FLAG_CODES.FORMULA_INPUT_MISSING,
          message: `Material rule ${rule.rule_id} missing measurement input ${k}.`,
          blocking: true,
        });
      }
      for (const k of missingAssumption) {
        flags.push({
          related_entity_type: "material_draft_line",
          related_entity_local_key: draftLocalKey,
          severity: "blocker",
          flag_code: REVIEW_FLAG_CODES.TEMPLATE_REQUIRED_ASSUMPTION_MISSING,
          message: `Material rule ${rule.rule_id} missing assumption ${k}.`,
          blocking: true,
        });
      }
      if (source_measurement_ids.length === 0) {
        blocked_summary.push(`${rule.rule_id}: no source measurements`);
      }
      material_drafts.push(baseRow);
      continue;
    }

    const evalResult = evaluateFormula(rule.formula_key as Phase4FormulaKey, {
      values,
      coverage_per_unit: coverage,
      waste_percent: waste,
      rounding: rule.rounding,
    });
    if (!evalResult.ok) {
      baseRow.status = "blocked";
      flags.push({
        related_entity_type: "material_draft_line",
        related_entity_local_key: draftLocalKey,
        severity: "blocker",
        flag_code: REVIEW_FLAG_CODES.FORMULA_INPUT_MISSING,
        message: `Material rule ${rule.rule_id} formula failed: ${evalResult.reason} (${evalResult.missing_inputs.join(",")})`,
        blocking: true,
      });
      material_drafts.push(baseRow);
      continue;
    }

    let qty = evalResult.rounded_quantity;
    // Paint finish coats multiplier.
    if (input.trade_id === "paint_coatings" && rule.item_key === "finish_paint_gallons") {
      const coats = asNumberOrNull(binding.required_inputs["finish_coats_count"]?.resolved_value);
      if (coats && coats > 0) qty = Math.ceil(evalResult.quantity * coats);
    }

    baseRow.quantity = qty;
    baseRow.formula_inputs = {
      ...baseRow.formula_inputs,
      computed_quantity: evalResult.quantity,
      computed_rounded_quantity: evalResult.rounded_quantity,
      effective_waste_percent: evalResult.effective_waste_percent,
    };
    // Catalog: not wired in Phase 4 → emit non-blocking catalog_item_unresolved flag once per draft.
    flags.push({
      related_entity_type: "material_draft_line",
      related_entity_local_key: draftLocalKey,
      severity: "info",
      flag_code: REVIEW_FLAG_CODES.CATALOG_ITEM_UNRESOLVED,
      message: `${rule.item_key}: catalog item resolution deferred until tenant catalog mapping is wired.`,
      blocking: false,
    });
    baseRow.status = "ready";
    material_drafts.push(baseRow);
  }

  // Generate labor drafts.
  const labor_drafts: DraftLaborOut[] = [];
  for (const rule of template.labor_rules) {
    if (input.trade_id === "paint_coatings") {
      const primerEnabled = asNumberOrNull(binding.required_inputs["primer_enabled"]?.resolved_value);
      if (rule.labor_key === "prime_wall_area_sqft" && primerEnabled === 0) continue;
    }

    const inputsRewritten = rewriteMeasurementInputsForLabor(input.trade_id, rule, binding, input.measurements);
    const values: Record<string, number | null> = {};
    const source_measurement_ids: string[] = [];
    const plan_path_ids: string[] = [];
    const missing_measurements: string[] = [];
    for (const inp of inputsRewritten) {
      if (!inp.measurement) {
        if (inp.required) missing_measurements.push(inp.formula_input_key);
        values[inp.formula_input_key] = null;
        continue;
      }
      values[inp.formula_input_key] = inp.measurement.quantity;
      source_measurement_ids.push(inp.measurement.id);
      if (inp.measurement.plan_path_id) plan_path_ids.push(inp.measurement.plan_path_id);
    }
    const draftLocalKey = `labor:${input.accepted_trade_id}:${rule.rule_id}`;
    const baseRow: DraftLaborOut = {
      rule_id: rule.rule_id,
      labor_key: rule.labor_key,
      labor_name: rule.labor_name,
      unit: rule.unit,
      formula_key: rule.formula_key,
      formula_inputs: {
        values,
        rounding: rule.rounding,
        rule_id: rule.rule_id,
        notes: rule.notes ?? null,
        computed_quantity: null as number | null,
        computed_rounded_quantity: null as number | null,
        missing_measurements,
      },
      quantity: null,
      complexity_flags: rule.complexity_flag_keys ?? [],
      source_measurement_ids,
      plan_path_ids,
      status: "draft",
    };

    if (missing_measurements.length || source_measurement_ids.length === 0) {
      baseRow.status = "blocked";
      for (const k of missing_measurements) {
        flags.push({
          related_entity_type: "labor_draft_line",
          related_entity_local_key: draftLocalKey,
          severity: "blocker",
          flag_code: REVIEW_FLAG_CODES.FORMULA_INPUT_MISSING,
          message: `Labor rule ${rule.rule_id} missing measurement input ${k}.`,
          blocking: true,
        });
      }
      labor_drafts.push(baseRow);
      continue;
    }

    const evalResult = evaluateFormula(rule.formula_key as Phase4FormulaKey, {
      values,
      rounding: rule.rounding,
    });
    if (!evalResult.ok) {
      baseRow.status = "blocked";
      flags.push({
        related_entity_type: "labor_draft_line",
        related_entity_local_key: draftLocalKey,
        severity: "blocker",
        flag_code: REVIEW_FLAG_CODES.FORMULA_INPUT_MISSING,
        message: `Labor rule ${rule.rule_id} formula failed: ${evalResult.reason}`,
        blocking: true,
      });
      labor_drafts.push(baseRow);
      continue;
    }
    let qty = evalResult.rounded_quantity;
    if (input.trade_id === "paint_coatings" && rule.labor_key === "paint_finish_coat_area_sqft") {
      const coats = asNumberOrNull(binding.required_inputs["finish_coats_count"]?.resolved_value);
      if (coats && coats > 0) qty = Math.ceil(evalResult.quantity * coats);
    }
    baseRow.quantity = qty;
    baseRow.formula_inputs = {
      ...baseRow.formula_inputs,
      computed_quantity: evalResult.quantity,
      computed_rounded_quantity: evalResult.rounded_quantity,
    };
    baseRow.status = "ready";
    labor_drafts.push(baseRow);
  }

  return {
    template_binding: binding,
    material_drafts,
    labor_drafts,
    review_flags: flags,
    blocked_summary,
  };
}

// Always-on informational flags for Phase 4 to make the UI honest.
export function phase4InformationalSessionFlags(import_session_id: string): DraftFlagOut[] {
  return [
    {
      related_entity_type: "import_session",
      related_entity_local_key: `session:${import_session_id}`,
      severity: "info",
      flag_code: REVIEW_FLAG_CODES.FINAL_PRICING_NOT_ENABLED_PHASE_4,
      message: "Final pricing is not enabled in Phase 4 — drafts only.",
      blocking: false,
    },
    {
      related_entity_type: "import_session",
      related_entity_local_key: `session:${import_session_id}`,
      severity: "info",
      flag_code: REVIEW_FLAG_CODES.CRM_HANDOFF_NOT_ENABLED_PHASE_4,
      message: "CRM estimate handoff is not enabled in Phase 4.",
      blocking: false,
    },
  ];
}
