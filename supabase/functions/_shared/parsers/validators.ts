// Cross-field validation rules for parsed roof/wall reports.
// Validators NEVER fabricate data — they return errors that callers attach to the parser run.

export interface ValidationError {
  field: string;
  rule: string;
  message: string;
  severity: "warn" | "error";
}

export function validateRoofTotals(data: {
  hips_ft?: number | null;
  ridges_ft?: number | null;
  hips_ridges_combined_ft?: number | null;
  eaves_ft?: number | null;
  rakes_ft?: number | null;
  drip_edge_ft?: number | null;
  total_area_sqft?: number | null;
  waste_table?: Record<string, number> | null;
}): ValidationError[] {
  const errors: ValidationError[] = [];
  const eps = 1.5; // ft tolerance for rounding

  if (
    typeof data.hips_ft === "number" &&
    typeof data.ridges_ft === "number" &&
    typeof data.hips_ridges_combined_ft === "number"
  ) {
    const sum = data.hips_ft + data.ridges_ft;
    if (Math.abs(sum - data.hips_ridges_combined_ft) > eps) {
      errors.push({
        field: "hips_ridges_combined_ft",
        rule: "hips_plus_ridges_equals_combined",
        message: `hips (${data.hips_ft}) + ridges (${data.ridges_ft}) = ${sum} ≠ combined ${data.hips_ridges_combined_ft}`,
        severity: "warn",
      });
    }
  }

  if (
    typeof data.eaves_ft === "number" &&
    typeof data.rakes_ft === "number" &&
    typeof data.drip_edge_ft === "number"
  ) {
    const sum = data.eaves_ft + data.rakes_ft;
    if (Math.abs(sum - data.drip_edge_ft) > eps) {
      errors.push({
        field: "drip_edge_ft",
        rule: "eaves_plus_rakes_equals_drip_edge",
        message: `eaves (${data.eaves_ft}) + rakes (${data.rakes_ft}) = ${sum} ≠ drip_edge ${data.drip_edge_ft}`,
        severity: "warn",
      });
    }
  }

  if (typeof data.total_area_sqft === "number" && data.waste_table) {
    const zero = data.waste_table["0"] ?? data.waste_table["0%"];
    if (typeof zero === "number" && Math.abs(zero - data.total_area_sqft) > Math.max(1, data.total_area_sqft * 0.005)) {
      errors.push({
        field: "total_area_sqft",
        rule: "total_area_matches_waste_table_zero",
        message: `total_area ${data.total_area_sqft} ≠ waste_table[0%] ${zero}`,
        severity: "warn",
      });
    }
  }

  // Reject impossible negatives
  for (const k of ["total_area_sqft", "hips_ft", "ridges_ft", "valleys_ft", "eaves_ft", "rakes_ft"] as const) {
    const v = (data as Record<string, unknown>)[k];
    if (typeof v === "number" && v < 0) {
      errors.push({ field: k, rule: "non_negative", message: `${k} is negative (${v})`, severity: "error" });
    }
  }

  return errors;
}
