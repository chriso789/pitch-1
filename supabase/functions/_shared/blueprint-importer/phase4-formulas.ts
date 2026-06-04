// Blueprint Importer v2 — Phase 4 deterministic formula engine.
// Side-effect-free. No AI, no eval, no randomness.
//
// Only the formula categories explicitly approved for Phase 4 are implemented.
// Any unknown formula key returns { ok: false, reason: "unknown_formula_key" }
// so the generator falls back to a review flag rather than silently producing 0.

export type Phase4FormulaKey =
  | "area_with_waste"
  | "linear_feet_with_waste"
  | "count_with_waste"
  | "coverage_division_round_up"
  | "squares_from_sqft"
  | "report_waste_table_lookup"
  | "sum_measurements"
  | "pass_through_quantity";

export type Phase4RoundingRule = "ceil" | "round" | "floor" | "none";

export interface FormulaInput {
  /** Free-form keyed inputs the formula consumes. Values are numbers OR null. */
  values: Record<string, number | null>;
  /** Coverage per unit (e.g. sqft per bundle, lf per roll). May be null. */
  coverage_per_unit?: number | null;
  /** Waste percent expressed as a fraction (0.10 = 10%). May be null. */
  waste_percent?: number | null;
  /** Rounding rule for the final quantity. Defaults to "ceil". */
  rounding?: Phase4RoundingRule;
  /** Optional report waste-table mapping (waste percent string -> adjusted qty). */
  waste_table?: Record<string, number> | null;
  /** When using `report_waste_table_lookup`, the user-selected waste percent label, e.g. "10%". */
  waste_table_pick?: string | null;
}

export type FormulaResult =
  | {
      ok: true;
      quantity: number;
      rounded_quantity: number;
      effective_waste_percent: number | null;
      missing_inputs: string[]; // always empty on ok=true
    }
  | {
      ok: false;
      missing_inputs: string[]; // keys whose values were null/undefined
      reason: string;
    };

function requireNumbers(
  values: Record<string, number | null>,
  keys: readonly string[],
): { missing: string[]; resolved: Record<string, number> } {
  const missing: string[] = [];
  const resolved: Record<string, number> = {};
  for (const k of keys) {
    const v = values[k];
    if (v === null || v === undefined || Number.isNaN(v)) missing.push(k);
    else resolved[k] = v;
  }
  return { missing, resolved };
}

function applyRounding(n: number, rule: Phase4RoundingRule | undefined): number {
  switch (rule) {
    case "floor":
      return Math.floor(n);
    case "round":
      return Math.round(n);
    case "none":
      return n;
    case "ceil":
    default:
      return Math.ceil(n);
  }
}

export function evaluateFormula(
  formula_key: Phase4FormulaKey | string,
  input: FormulaInput,
): FormulaResult {
  const rounding = input.rounding ?? "ceil";

  switch (formula_key) {
    case "area_with_waste": {
      const { missing, resolved } = requireNumbers(input.values, ["area_sqft"]);
      if (input.waste_percent == null) missing.push("waste_percent");
      if (input.coverage_per_unit == null || input.coverage_per_unit === 0) missing.push("coverage_per_unit");
      if (missing.length) return { ok: false, missing_inputs: missing, reason: "missing_inputs" };
      const adjusted = resolved.area_sqft * (1 + (input.waste_percent as number));
      const qty = adjusted / (input.coverage_per_unit as number);
      return {
        ok: true,
        quantity: qty,
        rounded_quantity: applyRounding(qty, rounding),
        effective_waste_percent: input.waste_percent ?? null,
        missing_inputs: [],
      };
    }
    case "linear_feet_with_waste": {
      const keys = Object.keys(input.values);
      const { missing, resolved } = requireNumbers(input.values, keys);
      const waste = input.waste_percent ?? 0;
      const coverage = input.coverage_per_unit ?? 1;
      if (missing.length) return { ok: false, missing_inputs: missing, reason: "missing_inputs" };
      const sum = keys.reduce((acc, k) => acc + resolved[k], 0);
      const adjusted = sum * (1 + waste);
      const qty = adjusted / coverage;
      return {
        ok: true,
        quantity: qty,
        rounded_quantity: applyRounding(qty, rounding),
        effective_waste_percent: waste,
        missing_inputs: [],
      };
    }
    case "count_with_waste": {
      const { missing, resolved } = requireNumbers(input.values, ["count"]);
      if (missing.length) return { ok: false, missing_inputs: missing, reason: "missing_inputs" };
      const waste = input.waste_percent ?? 0;
      const qty = resolved.count * (1 + waste);
      return {
        ok: true,
        quantity: qty,
        rounded_quantity: applyRounding(qty, rounding),
        effective_waste_percent: waste,
        missing_inputs: [],
      };
    }
    case "coverage_division_round_up": {
      const { missing, resolved } = requireNumbers(input.values, ["quantity"]);
      if (input.coverage_per_unit == null || input.coverage_per_unit === 0) missing.push("coverage_per_unit");
      if (missing.length) return { ok: false, missing_inputs: missing, reason: "missing_inputs" };
      const qty = resolved.quantity / (input.coverage_per_unit as number);
      return {
        ok: true,
        quantity: qty,
        rounded_quantity: applyRounding(qty, "ceil"),
        effective_waste_percent: null,
        missing_inputs: [],
      };
    }
    case "squares_from_sqft": {
      const { missing, resolved } = requireNumbers(input.values, ["area_sqft"]);
      if (missing.length) return { ok: false, missing_inputs: missing, reason: "missing_inputs" };
      const waste = input.waste_percent ?? 0;
      const adjusted = resolved.area_sqft * (1 + waste);
      const sq = adjusted / 100;
      return {
        ok: true,
        quantity: sq,
        rounded_quantity: applyRounding(sq, rounding),
        effective_waste_percent: waste,
        missing_inputs: [],
      };
    }
    case "report_waste_table_lookup": {
      if (!input.waste_table) {
        return { ok: false, missing_inputs: ["waste_table"], reason: "missing_inputs" };
      }
      const pick = input.waste_table_pick ?? null;
      if (!pick) return { ok: false, missing_inputs: ["waste_table_pick"], reason: "missing_inputs" };
      const value = input.waste_table[pick];
      if (value == null) return { ok: false, missing_inputs: ["waste_table_pick"], reason: "unknown_waste_table_key" };
      // Effective waste percent recovered from the key when it parses as percent.
      const m = /([\d.]+)\s*%/.exec(pick);
      const eff = m ? Number(m[1]) / 100 : null;
      return {
        ok: true,
        quantity: value,
        rounded_quantity: applyRounding(value, rounding),
        effective_waste_percent: eff,
        missing_inputs: [],
      };
    }
    case "sum_measurements": {
      const keys = Object.keys(input.values);
      if (keys.length === 0) return { ok: false, missing_inputs: ["values"], reason: "no_inputs_supplied" };
      const { missing, resolved } = requireNumbers(input.values, keys);
      if (missing.length) return { ok: false, missing_inputs: missing, reason: "missing_inputs" };
      const sum = keys.reduce((acc, k) => acc + resolved[k], 0);
      return {
        ok: true,
        quantity: sum,
        rounded_quantity: applyRounding(sum, rounding ?? "none"),
        effective_waste_percent: null,
        missing_inputs: [],
      };
    }
    case "pass_through_quantity": {
      const { missing, resolved } = requireNumbers(input.values, ["quantity"]);
      if (missing.length) return { ok: false, missing_inputs: missing, reason: "missing_inputs" };
      return {
        ok: true,
        quantity: resolved.quantity,
        rounded_quantity: applyRounding(resolved.quantity, rounding ?? "none"),
        effective_waste_percent: null,
        missing_inputs: [],
      };
    }
    default:
      return { ok: false, missing_inputs: [], reason: "unknown_formula_key" };
  }
}
