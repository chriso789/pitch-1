// Blueprint Importer v2 — Phase 3 canonical review flag codes.
// All Phase 3 runtime review flags MUST use a code from this module.

export const REVIEW_FLAG_CODES = {
  // Phase 0/1 helper-only rules — now enforced as RUNTIME flags.
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
  // Phase 3 gates that explicitly disable Phase 4 functionality in the UI.
  MATERIAL_POPULATION_NOT_ENABLED_PHASE_3: "material_population_not_enabled_phase_3",
  LABOR_PRICING_NOT_ENABLED_PHASE_3: "labor_pricing_not_enabled_phase_3",
} as const;

export type Phase3ReviewFlagCode = typeof REVIEW_FLAG_CODES[keyof typeof REVIEW_FLAG_CODES];

export const PHASE3_BLOCKING_FLAG_CODES = new Set<string>([
  REVIEW_FLAG_CODES.UNSUPPORTED_TRADE_FOR_MVP,
  REVIEW_FLAG_CODES.FUTURE_TRADE_REQUIRES_SHEET_INTELLIGENCE,
  REVIEW_FLAG_CODES.WINDOWS_DOORS_SELECTED_AS_TRADE,
  REVIEW_FLAG_CODES.PAINT_WITHOUT_WALL_SOURCE,
  REVIEW_FLAG_CODES.MISSING_REQUIRED_MEASUREMENT,
  REVIEW_FLAG_CODES.MISSING_PLAN_PATH,
]);
