// ============================================================================
// Registration Gate v2 — frontend mirror.
// ----------------------------------------------------------------------------
// Reads geometry_report_json.registration (written by start-ai-measurement /
// autonomous-graph-solver) and exposes:
//   - canApproveManualPerimeter(reg): boolean — gate for Save/Approve/Rerun
//   - registrationBanner(reg): { variant; title; description } | null
//
// MUST stay in sync with supabase/functions/_shared/registration-gate.ts.
// ============================================================================

export interface RegistrationBlock {
  version?: string;
  user_confirmed_roof_target?: boolean | null;
  roof_target_admin_override?: boolean | null;
  geo_to_dsm_px_success?: boolean | null;
  dsm_pixel_transform_valid?: boolean | null;
  confirmed_center_inside_candidate?: boolean | null;
  coordinate_registration_gate_passed?: boolean | null;
  raster_bounds_contain_confirmed_center?: boolean | null;
  original_geocode_lat_lng?: { lat: number; lng: number } | null;
  confirmed_roof_center_lat_lng?: { lat: number; lng: number } | null;
  confirmed_roof_center_px?: [number, number] | null;
  static_map_center_lat_lng?: { lat: number; lng: number } | null;
  google_solar_building_center_lat_lng?: { lat: number; lng: number } | null;
  candidate_centroid_offset_from_confirmed_center_px?: number | null;
}

/**
 * Extract the registration block from a measurement row. Falls back to the
 * legacy overlay_debug coordinate flags so older runs render the banner too.
 */
export function readRegistrationBlock(measurement: any): RegistrationBlock | null {
  const grj = measurement?.geometry_report_json;
  if (!grj || typeof grj !== "object") return null;
  if (grj.registration && typeof grj.registration === "object") {
    return grj.registration as RegistrationBlock;
  }
  // Legacy fallback — synthesize a minimal block from overlay_debug flags so
  // historical rows still trigger the UI banner / disable approve.
  const ov = grj.overlay_debug ?? {};
  return {
    user_confirmed_roof_target: null,
    geo_to_dsm_px_success: ov.geo_to_dsm_px_success ?? null,
    dsm_pixel_transform_valid: ov.dsm_pixel_transform_valid ?? null,
    confirmed_center_inside_candidate: null,
    coordinate_registration_gate_passed: null,
  };
}

export function canApproveManualPerimeter(reg: RegistrationBlock | null | undefined): boolean {
  if (!reg) return false;
  return (
    !!reg.user_confirmed_roof_target &&
    !!reg.geo_to_dsm_px_success &&
    !!reg.dsm_pixel_transform_valid &&
    !!reg.confirmed_center_inside_candidate &&
    !!reg.coordinate_registration_gate_passed
  );
}

export interface RegistrationBanner {
  variant: "destructive" | "warning";
  title: string;
  description: string;
  failedFlags: string[];
}

export function registrationBanner(reg: RegistrationBlock | null | undefined): RegistrationBanner | null {
  if (!reg) return null;
  const failed: string[] = [];
  if (reg.user_confirmed_roof_target === false) failed.push("user_confirmed_roof_target");
  if (reg.geo_to_dsm_px_success === false) failed.push("geo_to_dsm_px_success");
  if (reg.dsm_pixel_transform_valid === false) failed.push("dsm_pixel_transform_valid");
  if (reg.confirmed_center_inside_candidate === false) failed.push("confirmed_center_inside_candidate");
  if (reg.coordinate_registration_gate_passed === false) failed.push("coordinate_registration_gate_passed");
  if (failed.length === 0) return null;
  return {
    variant: "destructive",
    title: "Coordinate frame mismatch — overlay not eligible for manual approval",
    description:
      "The displayed perimeter may be drawn over the wrong house or in a different coordinate frame than the aerial image. Re-run AI Measurement after re-placing the PIN on the actual roof. Manual approval is disabled until target roof registration passes.",
    failedFlags: failed,
  };
}
