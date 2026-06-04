// Blueprint Importer v2 — Phase 4 in-code MVP template + rule registry.
// Deterministic, side-effect-free. No DB, no IO, no AI.
//
// Why in-code:
//   The repo does not yet have an approved assembly_template / material_rule /
//   labor_rule schema in production. Per Phase 4 contract, "Prefer deterministic
//   in-code MVP template definitions if no template table is ready." Each rule
//   declares its inputs, formula, coverage assumption keys, rounding, and unit
//   so the generator can resolve assumptions vs measurements vs review flags
//   without any branching outside this file.

import type { TradeId } from "./trade-catalog.ts";
import type { Phase4FormulaKey, Phase4RoundingRule } from "./phase4-formulas.ts";

/** Where an assumption value can come from. */
export type AssumptionSource = "template_default" | "user_assumption" | "report";

export interface AssumptionSpec {
  /** Key used to lookup the value in user_assumptions / template_defaults. */
  key: string;
  /** Human label shown to the user. */
  label: string;
  /** Required vs optional. Missing required → blocking review flag. */
  required: boolean;
  /** Optional template-default value. If absent the user MUST supply it. */
  template_default?: number | string | null;
  /** Free-form description. */
  description?: string;
}

/** Measurement key (canonical) -> input key name expected by the formula. */
export interface InputMeasurementBinding {
  measurement_key: string;
  /** Name used in formula input.values. */
  formula_input_key: string;
  /** When the measurement is missing, is the line blocked? */
  required: boolean;
}

export interface MaterialRuleDef {
  rule_id: string; // stable string id ("roofing.architectural_shingles" etc.)
  item_key: string; // short key used in DB ("architectural_shingles")
  item_name: string;
  unit: string;
  formula_key: Phase4FormulaKey;
  rounding: Phase4RoundingRule;
  /** Measurement-driven inputs. */
  measurement_inputs: InputMeasurementBinding[];
  /** Coverage assumption key from template/user_assumptions. */
  coverage_assumption_key?: string | null;
  /** Waste assumption key from template/user_assumptions. */
  waste_assumption_key?: string | null;
  /** When true, the rule may use the report waste table if present (via report_waste_table_lookup). */
  allow_report_waste_table?: boolean;
  /** Notes surfaced into formula_inputs metadata. */
  notes?: string;
}

export interface LaborRuleDef {
  rule_id: string;
  labor_key: string;
  labor_name: string;
  unit: string;
  formula_key: Phase4FormulaKey;
  rounding: Phase4RoundingRule;
  measurement_inputs: InputMeasurementBinding[];
  /** Optional complexity flag key — surfaced into formula_inputs.complexity_flags. */
  complexity_flag_keys?: string[];
  notes?: string;
}

export interface Phase4TradeTemplate {
  /** Internal MVP template key. selected_template_id stays nullable in DB. */
  internal_template_key: string;
  trade_id: TradeId;
  name: string;
  required_assumptions: AssumptionSpec[];
  optional_assumptions: AssumptionSpec[];
  material_rules: MaterialRuleDef[];
  labor_rules: LaborRuleDef[];
}

// -------------------- ROOFING --------------------

const ROOFING_TEMPLATE: Phase4TradeTemplate = {
  internal_template_key: "mvp.roofing.asphalt_shingle_v1",
  trade_id: "roofing",
  name: "MVP Asphalt Shingle Roof",
  required_assumptions: [
    {
      key: "waste_percent",
      label: "Waste percent (fraction, e.g. 0.10)",
      required: true,
      template_default: null,
      description: "Required. Pull from report waste table or user input — never silently defaulted.",
    },
    {
      key: "shingle_coverage_sqft_per_bundle",
      label: "Shingles coverage (sqft per bundle)",
      required: true,
      template_default: 33.3,
    },
    {
      key: "underlayment_coverage_sqft_per_roll",
      label: "Synthetic underlayment coverage (sqft per roll)",
      required: true,
      template_default: 1000,
    },
    {
      key: "starter_coverage_lf_per_bundle",
      label: "Starter strip coverage (lf per bundle)",
      required: true,
      template_default: 105,
    },
    {
      key: "hip_ridge_coverage_lf_per_bundle",
      label: "Hip/ridge cap coverage (lf per bundle)",
      required: true,
      template_default: 20,
    },
    {
      key: "valley_metal_lf_per_unit",
      label: "Valley metal length per unit (lf)",
      required: true,
      template_default: 10,
    },
    {
      key: "drip_edge_lf_per_unit",
      label: "Drip edge length per unit (lf)",
      required: true,
      template_default: 10,
    },
  ],
  optional_assumptions: [
    {
      key: "ice_and_water_coverage_sqft_per_roll",
      label: "Ice & water shield coverage (sqft per roll)",
      required: false,
      template_default: 200,
    },
    {
      key: "ice_and_water_lf",
      label: "Ice & water shield linear feet (defaults to eaves_lf if not provided)",
      required: false,
      template_default: null,
    },
    {
      key: "step_flashing_coverage_lf_per_bundle",
      label: "Step flashing per bundle (lf)",
      required: false,
      template_default: 10,
    },
    {
      key: "penetration_boot_count",
      label: "Pipe boots / penetration allowance",
      required: false,
      template_default: null,
    },
    {
      key: "include_pitched_area_only",
      label: "Use pitched_roof_area only (exclude flat)",
      required: false,
      template_default: 1,
    },
  ],
  material_rules: [
    {
      rule_id: "roofing.waste_adjusted_roof_squares",
      item_key: "waste_adjusted_roof_squares",
      item_name: "Waste-adjusted roof area (squares)",
      unit: "SQ",
      formula_key: "squares_from_sqft",
      rounding: "round",
      measurement_inputs: [
        { measurement_key: "pitched_roof_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
      waste_assumption_key: "waste_percent",
      allow_report_waste_table: true,
    },
    {
      rule_id: "roofing.architectural_shingles",
      item_key: "architectural_shingles",
      item_name: "Architectural shingles",
      unit: "BUNDLE",
      formula_key: "area_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "pitched_roof_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
      coverage_assumption_key: "shingle_coverage_sqft_per_bundle",
      waste_assumption_key: "waste_percent",
      allow_report_waste_table: true,
    },
    {
      rule_id: "roofing.synthetic_underlayment",
      item_key: "synthetic_underlayment",
      item_name: "Synthetic underlayment",
      unit: "ROLL",
      formula_key: "area_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "pitched_roof_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
      coverage_assumption_key: "underlayment_coverage_sqft_per_roll",
      waste_assumption_key: "waste_percent",
    },
    {
      rule_id: "roofing.starter_strip",
      item_key: "starter_strip",
      item_name: "Starter strip",
      unit: "BUNDLE",
      formula_key: "linear_feet_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "eaves_lf", formula_input_key: "eaves_lf", required: true },
        { measurement_key: "rakes_lf", formula_input_key: "rakes_lf", required: true },
      ],
      coverage_assumption_key: "starter_coverage_lf_per_bundle",
      waste_assumption_key: "waste_percent",
    },
    {
      rule_id: "roofing.hip_ridge_cap",
      item_key: "hip_ridge_cap",
      item_name: "Hip and ridge cap",
      unit: "BUNDLE",
      formula_key: "linear_feet_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "hips_lf", formula_input_key: "hips_lf", required: true },
        { measurement_key: "ridges_lf", formula_input_key: "ridges_lf", required: true },
      ],
      coverage_assumption_key: "hip_ridge_coverage_lf_per_bundle",
      waste_assumption_key: "waste_percent",
    },
    {
      rule_id: "roofing.valley_metal",
      item_key: "valley_metal",
      item_name: "Valley metal",
      unit: "EA",
      formula_key: "linear_feet_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "valleys_lf", formula_input_key: "valleys_lf", required: true },
      ],
      coverage_assumption_key: "valley_metal_lf_per_unit",
      waste_assumption_key: "waste_percent",
    },
    {
      rule_id: "roofing.drip_edge",
      item_key: "drip_edge",
      item_name: "Drip edge",
      unit: "EA",
      formula_key: "linear_feet_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "eaves_lf", formula_input_key: "eaves_lf", required: true },
        { measurement_key: "rakes_lf", formula_input_key: "rakes_lf", required: true },
      ],
      coverage_assumption_key: "drip_edge_lf_per_unit",
      waste_assumption_key: "waste_percent",
    },
    {
      rule_id: "roofing.step_flashing",
      item_key: "step_flashing",
      item_name: "Step flashing",
      unit: "BUNDLE",
      formula_key: "linear_feet_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "step_flashing_lf", formula_input_key: "step_flashing_lf", required: true },
      ],
      coverage_assumption_key: "step_flashing_coverage_lf_per_bundle",
      waste_assumption_key: "waste_percent",
    },
    {
      rule_id: "roofing.wall_flashing",
      item_key: "wall_flashing",
      item_name: "Wall flashing",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "flashing_lf", formula_input_key: "quantity", required: true },
      ],
    },
    {
      rule_id: "roofing.ice_and_water_shield",
      item_key: "ice_and_water_shield",
      item_name: "Ice & water shield",
      unit: "ROLL",
      formula_key: "linear_feet_with_waste",
      rounding: "ceil",
      // Special-case in generator: if "ice_and_water_lf" assumption set, use it;
      // else fall back to eaves_lf. Generator routes accordingly.
      measurement_inputs: [
        { measurement_key: "eaves_lf", formula_input_key: "eaves_lf", required: true },
      ],
      coverage_assumption_key: "ice_and_water_coverage_sqft_per_roll",
      waste_assumption_key: "waste_percent",
      notes: "Uses eaves_lf unless ice_and_water_lf assumption is provided.",
    },
    {
      rule_id: "roofing.penetration_allowance",
      item_key: "pipe_boots_or_penetration_allowance",
      item_name: "Pipe boots / penetration allowance",
      unit: "EA",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        // Generator may inject from report's penetrations_count OR user assumption.
        { measurement_key: "penetrations_count", formula_input_key: "quantity", required: false },
      ],
    },
  ],
  labor_rules: [
    {
      rule_id: "roofing.tearoff_squares",
      labor_key: "roof_tearoff_squares",
      labor_name: "Roof tear-off",
      unit: "SQ",
      formula_key: "squares_from_sqft",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "pitched_roof_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
    },
    {
      rule_id: "roofing.install_shingles_squares",
      labor_key: "install_shingles_squares",
      labor_name: "Install shingles",
      unit: "SQ",
      formula_key: "squares_from_sqft",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "pitched_roof_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
      complexity_flag_keys: ["steep_pitch_complexity_flag", "high_facet_complexity_flag", "multi_story_complexity_flag"],
    },
    {
      rule_id: "roofing.install_underlayment_squares",
      labor_key: "install_underlayment_squares",
      labor_name: "Install underlayment",
      unit: "SQ",
      formula_key: "squares_from_sqft",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "pitched_roof_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
    },
    {
      rule_id: "roofing.install_starter_lf",
      labor_key: "install_starter_lf",
      labor_name: "Install starter strip",
      unit: "LF",
      formula_key: "sum_measurements",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "eaves_lf", formula_input_key: "eaves_lf", required: true },
        { measurement_key: "rakes_lf", formula_input_key: "rakes_lf", required: true },
      ],
    },
    {
      rule_id: "roofing.install_drip_edge_lf",
      labor_key: "install_drip_edge_lf",
      labor_name: "Install drip edge",
      unit: "LF",
      formula_key: "sum_measurements",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "eaves_lf", formula_input_key: "eaves_lf", required: true },
        { measurement_key: "rakes_lf", formula_input_key: "rakes_lf", required: true },
      ],
    },
    {
      rule_id: "roofing.install_valley_treatment_lf",
      labor_key: "install_valley_treatment_lf",
      labor_name: "Install valley treatment",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "valleys_lf", formula_input_key: "quantity", required: true },
      ],
    },
    {
      rule_id: "roofing.install_hip_ridge_cap_lf",
      labor_key: "install_hip_ridge_cap_lf",
      labor_name: "Install hip / ridge cap",
      unit: "LF",
      formula_key: "sum_measurements",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "hips_lf", formula_input_key: "hips_lf", required: true },
        { measurement_key: "ridges_lf", formula_input_key: "ridges_lf", required: true },
      ],
    },
    {
      rule_id: "roofing.install_step_flashing_lf",
      labor_key: "install_step_flashing_lf",
      labor_name: "Install step flashing",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "step_flashing_lf", formula_input_key: "quantity", required: true },
      ],
    },
    {
      rule_id: "roofing.install_wall_flashing_lf",
      labor_key: "install_wall_flashing_lf",
      labor_name: "Install wall flashing",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "flashing_lf", formula_input_key: "quantity", required: true },
      ],
    },
    {
      rule_id: "roofing.penetration_flashing_count",
      labor_key: "penetration_flashing_count_or_allowance",
      labor_name: "Penetration flashing",
      unit: "EA",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "penetrations_count", formula_input_key: "quantity", required: false },
      ],
    },
  ],
};

// -------------------- EXTERIOR WALLS / SIDING --------------------

const WALLS_TEMPLATE: Phase4TradeTemplate = {
  internal_template_key: "mvp.exterior_walls_siding.generic_v1",
  trade_id: "exterior_walls_siding",
  name: "MVP Exterior Walls / Siding",
  required_assumptions: [
    { key: "waste_percent", label: "Siding waste percent", required: true, template_default: null },
    {
      key: "wall_area_basis",
      label: "Wall area basis (gross | net)",
      required: true,
      template_default: "net",
      description: "gross = wall_area_with_windows_doors_sqft, net = wall_area_sqft.",
    },
    {
      key: "siding_coverage_sqft_per_unit",
      label: "Siding panel/board coverage (sqft per unit)",
      required: true,
      template_default: null,
    },
    {
      key: "wrb_coverage_sqft_per_roll",
      label: "WRB / housewrap coverage (sqft per roll)",
      required: true,
      template_default: 900,
    },
  ],
  optional_assumptions: [
    { key: "outside_corner_trim_lf_per_unit", label: "Outside corner trim length per unit", required: false, template_default: 10 },
    { key: "inside_corner_trim_lf_per_unit", label: "Inside corner trim length per unit", required: false, template_default: 10 },
    { key: "include_window_door_trim", label: "Include window/door trim", required: false, template_default: 1 },
  ],
  material_rules: [
    {
      rule_id: "walls.siding_area",
      item_key: "siding_area",
      item_name: "Siding area (waste-adjusted)",
      unit: "SQFT",
      formula_key: "area_with_waste",
      rounding: "ceil",
      // generator picks gross vs net measurement based on assumption
      measurement_inputs: [
        { measurement_key: "wall_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
      coverage_assumption_key: undefined,
      waste_assumption_key: "waste_percent",
      notes: "Generator selects wall_area_sqft (net) or wall_area_with_windows_doors_sqft (gross) per wall_area_basis.",
    },
    {
      rule_id: "walls.siding_units",
      item_key: "siding_panels_or_boards",
      item_name: "Siding panels / boards",
      unit: "EA",
      formula_key: "area_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "wall_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
      coverage_assumption_key: "siding_coverage_sqft_per_unit",
      waste_assumption_key: "waste_percent",
    },
    {
      rule_id: "walls.wrb",
      item_key: "housewrap_wrb",
      item_name: "Housewrap / WRB",
      unit: "ROLL",
      formula_key: "area_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "wall_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
      coverage_assumption_key: "wrb_coverage_sqft_per_roll",
      waste_assumption_key: "waste_percent",
    },
    {
      rule_id: "walls.outside_corner_trim",
      item_key: "outside_corner_trim",
      item_name: "Outside corner trim",
      unit: "EA",
      formula_key: "coverage_division_round_up",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "outside_corners_lf", formula_input_key: "quantity", required: true },
      ],
      coverage_assumption_key: "outside_corner_trim_lf_per_unit",
    },
    {
      rule_id: "walls.inside_corner_trim",
      item_key: "inside_corner_trim",
      item_name: "Inside corner trim",
      unit: "EA",
      formula_key: "coverage_division_round_up",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "inside_corners_lf", formula_input_key: "quantity", required: true },
      ],
      coverage_assumption_key: "inside_corner_trim_lf_per_unit",
    },
    {
      rule_id: "walls.window_door_trim_lf",
      item_key: "window_door_trim_or_deduction_input",
      item_name: "Window/door trim or deduction (lf)",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "window_door_perimeter_lf", formula_input_key: "quantity", required: false },
      ],
    },
    {
      rule_id: "walls.caulk_window_door",
      item_key: "caulk_allowance_from_window_door_perimeter",
      item_name: "Window/door caulk allowance",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "window_door_perimeter_lf", formula_input_key: "quantity", required: false },
      ],
    },
    {
      rule_id: "walls.fascia_or_trim_lf",
      item_key: "fascia_or_trim_lf",
      item_name: "Fascia / trim (lf)",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "fascia_eaves_rake_lf", formula_input_key: "quantity", required: false },
      ],
    },
  ],
  labor_rules: [
    {
      rule_id: "walls.install_siding_area_sqft",
      labor_key: "install_siding_area_sqft",
      labor_name: "Install siding",
      unit: "SQFT",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "wall_area_sqft", formula_input_key: "quantity", required: true },
      ],
      complexity_flag_keys: ["high_wall_facet_complexity_flag", "multi_story_complexity_flag"],
    },
    {
      rule_id: "walls.install_housewrap_area_sqft",
      labor_key: "install_housewrap_area_sqft",
      labor_name: "Install housewrap",
      unit: "SQFT",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "wall_area_sqft", formula_input_key: "quantity", required: true },
      ],
    },
    {
      rule_id: "walls.install_corner_trim_lf",
      labor_key: "install_corner_trim_lf",
      labor_name: "Install corner trim",
      unit: "LF",
      formula_key: "sum_measurements",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "outside_corners_lf", formula_input_key: "outside_corners_lf", required: true },
        { measurement_key: "inside_corners_lf", formula_input_key: "inside_corners_lf", required: true },
      ],
    },
    {
      rule_id: "walls.install_window_door_trim_lf",
      labor_key: "install_window_door_trim_lf",
      labor_name: "Install window/door trim",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "window_door_perimeter_lf", formula_input_key: "quantity", required: false },
      ],
    },
    {
      rule_id: "walls.caulk_window_door_lf",
      labor_key: "caulk_window_door_perimeter_lf",
      labor_name: "Caulk window/door perimeter",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "window_door_perimeter_lf", formula_input_key: "quantity", required: false },
      ],
    },
    {
      rule_id: "walls.fascia_trim_lf",
      labor_key: "fascia_trim_lf",
      labor_name: "Fascia / trim install",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "fascia_eaves_rake_lf", formula_input_key: "quantity", required: false },
      ],
    },
  ],
};

// -------------------- PAINT / COATINGS --------------------

const PAINT_TEMPLATE: Phase4TradeTemplate = {
  internal_template_key: "mvp.paint_coatings.exterior_v1",
  trade_id: "paint_coatings",
  name: "MVP Exterior Paint",
  required_assumptions: [
    { key: "waste_percent", label: "Paint waste percent", required: true, template_default: null },
    {
      key: "paintable_area_basis",
      label: "Paintable area basis (gross | net)",
      required: true,
      template_default: "net",
    },
    { key: "finish_coats_count", label: "Finish coats count", required: true, template_default: null },
    {
      key: "finish_coverage_sqft_per_gallon",
      label: "Finish paint coverage (sqft / gallon)",
      required: true,
      template_default: null,
    },
    {
      key: "primer_enabled",
      label: "Primer enabled? (1 yes / 0 no)",
      required: true,
      template_default: null,
    },
  ],
  optional_assumptions: [
    {
      key: "primer_coverage_sqft_per_gallon",
      label: "Primer coverage (sqft / gallon)",
      required: false,
      template_default: 200,
    },
  ],
  material_rules: [
    {
      rule_id: "paint.primer_gallons",
      item_key: "primer_gallons",
      item_name: "Primer (gallons)",
      unit: "GAL",
      formula_key: "area_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "wall_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
      coverage_assumption_key: "primer_coverage_sqft_per_gallon",
      waste_assumption_key: "waste_percent",
      notes: "Generator skips when primer_enabled=0.",
    },
    {
      rule_id: "paint.finish_gallons",
      item_key: "finish_paint_gallons",
      item_name: "Finish paint (gallons)",
      unit: "GAL",
      formula_key: "area_with_waste",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "wall_area_sqft", formula_input_key: "area_sqft", required: true },
      ],
      coverage_assumption_key: "finish_coverage_sqft_per_gallon",
      waste_assumption_key: "waste_percent",
      notes: "Quantity multiplied by finish_coats_count in generator post-processing.",
    },
    {
      rule_id: "paint.caulk_allowance",
      item_key: "caulk_allowance",
      item_name: "Caulk allowance (lf)",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "window_door_perimeter_lf", formula_input_key: "quantity", required: false },
      ],
    },
  ],
  labor_rules: [
    {
      rule_id: "paint.prep_area",
      labor_key: "prep_wall_area_sqft",
      labor_name: "Prep wall area",
      unit: "SQFT",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "wall_area_sqft", formula_input_key: "quantity", required: true },
      ],
    },
    {
      rule_id: "paint.prime_area",
      labor_key: "prime_wall_area_sqft",
      labor_name: "Prime wall area",
      unit: "SQFT",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "wall_area_sqft", formula_input_key: "quantity", required: true },
      ],
      notes: "Generator skips when primer_enabled=0.",
    },
    {
      rule_id: "paint.finish_coat",
      labor_key: "paint_finish_coat_area_sqft",
      labor_name: "Paint finish coat(s)",
      unit: "SQFT",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "wall_area_sqft", formula_input_key: "quantity", required: true },
      ],
      notes: "Generator multiplies by finish_coats_count.",
    },
    {
      rule_id: "paint.caulk_lf",
      labor_key: "caulk_window_door_perimeter_lf",
      labor_name: "Caulk window/door perimeter",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "window_door_perimeter_lf", formula_input_key: "quantity", required: false },
      ],
    },
  ],
};

// -------------------- GUTTERS / FASCIA / TRIM --------------------

const GUTTERS_TEMPLATE: Phase4TradeTemplate = {
  internal_template_key: "mvp.gutters_fascia_trim.v1",
  trade_id: "gutters_fascia_trim",
  name: "MVP Gutters / Fascia / Trim",
  required_assumptions: [
    { key: "gutter_lf_source", label: "Gutter LF source measurement key", required: true, template_default: "eaves_lf" },
  ],
  optional_assumptions: [
    { key: "fascia_lf_source", label: "Fascia LF source measurement key", required: false, template_default: "fascia_eaves_rake_lf" },
    { key: "rake_trim_lf_source", label: "Rake trim LF source measurement key", required: false, template_default: "rakes_lf" },
    { key: "downspout_spacing_lf", label: "Downspout spacing (lf)", required: false, template_default: null },
    { key: "downspout_count_override", label: "Downspout count override", required: false, template_default: null },
  ],
  material_rules: [
    {
      rule_id: "gutters.gutter_lf",
      item_key: "gutter_lf",
      item_name: "Gutter (lf)",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        // Generator overrides which measurement_key is used based on gutter_lf_source assumption.
        { measurement_key: "eaves_lf", formula_input_key: "quantity", required: true },
      ],
    },
    {
      rule_id: "gutters.fascia_lf",
      item_key: "fascia_lf",
      item_name: "Fascia (lf)",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "fascia_eaves_rake_lf", formula_input_key: "quantity", required: false },
      ],
    },
    {
      rule_id: "gutters.rake_trim_lf",
      item_key: "rake_trim_lf",
      item_name: "Rake trim (lf)",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "rakes_lf", formula_input_key: "quantity", required: false },
      ],
    },
    {
      rule_id: "gutters.downspout_count_placeholder",
      item_key: "downspout_count_placeholder",
      item_name: "Downspouts (placeholder — requires spacing/count)",
      unit: "EA",
      formula_key: "coverage_division_round_up",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "eaves_lf", formula_input_key: "quantity", required: true },
      ],
      coverage_assumption_key: "downspout_spacing_lf",
    },
  ],
  labor_rules: [
    {
      rule_id: "gutters.install_gutter_lf",
      labor_key: "install_gutter_lf",
      labor_name: "Install gutter",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "eaves_lf", formula_input_key: "quantity", required: true },
      ],
    },
    {
      rule_id: "gutters.install_fascia_lf",
      labor_key: "install_fascia_lf",
      labor_name: "Install fascia",
      unit: "LF",
      formula_key: "pass_through_quantity",
      rounding: "ceil",
      measurement_inputs: [
        { measurement_key: "fascia_eaves_rake_lf", formula_input_key: "quantity", required: false },
      ],
    },
  ],
};

export const PHASE4_TEMPLATES: Readonly<Record<TradeId, Phase4TradeTemplate | null>> = {
  roofing: ROOFING_TEMPLATE,
  exterior_walls_siding: WALLS_TEMPLATE,
  paint_coatings: PAINT_TEMPLATE,
  gutters_fascia_trim: GUTTERS_TEMPLATE,
  // Measurement-only / future — no template.
  windows_doors: null,
  drywall: null,
  framing: null,
  insulation: null,
  flooring: null,
  concrete: null,
  electrical: null,
  plumbing: null,
  hvac: null,
};

export function getPhase4Template(trade_id: TradeId): Phase4TradeTemplate | null {
  return PHASE4_TEMPLATES[trade_id] ?? null;
}
