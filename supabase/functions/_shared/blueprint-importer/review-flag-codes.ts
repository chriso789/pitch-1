// Blueprint Importer v2 — canonical review flag codes (Phase 3 + Phase 4).
// All runtime review flags MUST use a code from this module.

export const REVIEW_FLAG_CODES = {
  // Phase 0/1 helper-only rules — enforced as RUNTIME flags in Phase 3.
  UNSUPPORTED_TRADE_FOR_MVP: "unsupported_trade_for_mvp",
  FUTURE_TRADE_REQUIRES_SHEET_INTELLIGENCE: "future_trade_requires_sheet_intelligence",
  WINDOWS_DOORS_SELECTED_AS_TRADE: "windows_doors_selected_as_trade",
  PAINT_WITHOUT_WALL_SOURCE: "paint_without_wall_source",
  MISSING_REQUIRED_MEASUREMENT: "missing_required_measurement",
  MISSING_PLAN_PATH: "missing_plan_path",
  LOW_CONFIDENCE_MEASUREMENT: "low_confidence_measurement",
  // EagleView / Roofr report-side warnings surfaced as review flags.
  REPORT_FIELD_VERIFICATION_REQUIRED: "report_field_verification_required",
  WALL_IMAGE_OBSTRUCTION_WARNING: "wall_image_obstruction_warning",
  WALL_SOFFIT_ASSUMPTION_WARNING: "wall_soffit_assumption_warning",
  ROOF_PENETRATION_FIELD_VERIFICATION_REQUIRED: "roof_penetration_field_verification_required",
  // Phase 3 informational gates.
  MATERIAL_POPULATION_NOT_ENABLED_PHASE_3: "material_population_not_enabled_phase_3",
  LABOR_PRICING_NOT_ENABLED_PHASE_3: "labor_pricing_not_enabled_phase_3",

  // Phase 4 — draft generation flags.
  TEMPLATE_REQUIRED_ASSUMPTION_MISSING: "template_required_assumption_missing",
  FORMULA_INPUT_MISSING: "formula_input_missing",
  CATALOG_ITEM_UNRESOLVED: "catalog_item_unresolved",
  PRODUCT_SELECTION_REQUIRED: "product_selection_required",
  WASTE_PERCENT_REQUIRED: "waste_percent_required",
  MATERIAL_POPULATION_BLOCKED_BY_REVIEW: "material_population_blocked_by_review",
  LABOR_GENERATION_BLOCKED_BY_REVIEW: "labor_generation_blocked_by_review",
  FINAL_PRICING_NOT_ENABLED_PHASE_4: "final_pricing_not_enabled_phase_4",
  CRM_HANDOFF_NOT_ENABLED_PHASE_4: "crm_handoff_not_enabled_phase_4",
} as const;

export type ReviewFlagCode = typeof REVIEW_FLAG_CODES[keyof typeof REVIEW_FLAG_CODES];
// Back-compat alias used by Phase 3 test suite.
export type Phase3ReviewFlagCode = ReviewFlagCode;

export const PHASE3_BLOCKING_FLAG_CODES = new Set<string>([
  REVIEW_FLAG_CODES.UNSUPPORTED_TRADE_FOR_MVP,
  REVIEW_FLAG_CODES.FUTURE_TRADE_REQUIRES_SHEET_INTELLIGENCE,
  REVIEW_FLAG_CODES.WINDOWS_DOORS_SELECTED_AS_TRADE,
  REVIEW_FLAG_CODES.PAINT_WITHOUT_WALL_SOURCE,
  REVIEW_FLAG_CODES.MISSING_REQUIRED_MEASUREMENT,
  REVIEW_FLAG_CODES.MISSING_PLAN_PATH,
]);

// Phase 4 blocking set — these prevent draft rows from reaching `ready` status.
export const PHASE4_BLOCKING_FLAG_CODES = new Set<string>([
  REVIEW_FLAG_CODES.TEMPLATE_REQUIRED_ASSUMPTION_MISSING,
  REVIEW_FLAG_CODES.FORMULA_INPUT_MISSING,
  REVIEW_FLAG_CODES.WASTE_PERCENT_REQUIRED,
  REVIEW_FLAG_CODES.PRODUCT_SELECTION_REQUIRED,
  REVIEW_FLAG_CODES.MATERIAL_POPULATION_BLOCKED_BY_REVIEW,
  REVIEW_FLAG_CODES.LABOR_GENERATION_BLOCKED_BY_REVIEW,
]);
