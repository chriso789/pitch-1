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
  /** "ok" when raster overlay frame matches; any other value indicates aerial/raster mismatch. */
  frame_mismatch?: string | null;
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
  const reg = (grj as any).registration ?? (grj as any).registration_gate ?? null;
  const ov = (grj as any).overlay_debug ?? {};
  const ot = (grj as any).overlay_transform ?? {};
  // frame_mismatch may live on the registration block, overlay_debug, or
  // overlay_transform. Treat the string "ok" as the explicit pass marker.
  const frameMismatch =
    reg?.frame_mismatch ??
    ov?.frame_mismatch ??
    ot?.frame_mismatch ??
    null;
  if (reg && typeof reg === "object") {
    return { ...(reg as RegistrationBlock), frame_mismatch: frameMismatch ?? (reg as any).frame_mismatch ?? null };
  }
  // Legacy fallback — synthesize a minimal block from overlay_debug flags so
  // historical rows still trigger the UI banner / disable approve.
  const sourceDebug = (grj as any).source_acquisition_debug ?? measurement?.source_context?.debug?.source_acquisition_debug ?? {};
  return {
    user_confirmed_roof_target: (grj as any).user_confirmed_roof_target ?? sourceDebug.user_confirmed_roof_target ?? null,
    geo_to_dsm_px_success: (grj as any).geo_to_dsm_px_success ?? ov.geo_to_dsm_px_success ?? null,
    dsm_pixel_transform_valid: (grj as any).dsm_pixel_transform_valid ?? ov.dsm_pixel_transform_valid ?? null,
    confirmed_center_inside_candidate: (grj as any).confirmed_center_inside_candidate ?? null,
    coordinate_registration_gate_passed: (grj as any).coordinate_registration_gate_passed ?? false,
    frame_mismatch: frameMismatch ?? null,
  };
}


/**
 * True when a measurement row has a registration-class failure — used by
 * the UI to hide the editable perimeter and disable manual approval even
 * when the failure is mis-classified upstream as `ai_failed_perimeter`.
 */
export function isRegistrationFailure(measurement: any): boolean {
  const grj = measurement?.geometry_report_json;
  const hardFail = String(
    measurement?.hard_fail_reason ?? grj?.hard_fail_reason ?? "",
  );
  const resultState = String(measurement?.result_state ?? grj?.result_state ?? "");
  if (
    resultState === "ai_failed_target_unconfirmed" ||
    resultState === "ai_failed_source_acquisition"
  ) return true;
  if (
    hardFail === "target_roof_not_confirmed" ||
    hardFail === "coordinate_registration_failed" ||
    hardFail === "candidate_does_not_contain_confirmed_roof_center" ||
    grj?.geo_to_dsm_px_success === false ||
    grj?.dsm_pixel_transform_valid === false
  ) return true;
  const reg = readRegistrationBlock(measurement);
  if (reg?.coordinate_registration_gate_passed === false) return true;
  return false;
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

  // Classify into the actual failure bucket so the banner copy matches reality.
  // IMPORTANT: only call it a coordinate-frame mismatch when frame evidence is
  // explicitly bad (confirmed_center_inside_candidate === false). The aggregate
  // `coordinate_registration_gate_passed` flag can be false purely because DSM
  // sub-flags failed — in that case the user-facing message must blame DSM, not
  // the raster frame.
  const targetFailed = reg.user_confirmed_roof_target === false;
  const frameFailed = reg.confirmed_center_inside_candidate === false;
  const dsmFailed =
    reg.geo_to_dsm_px_success === false ||
    reg.dsm_pixel_transform_valid === false;
  const dsmOnly = !targetFailed && !frameFailed && dsmFailed;


  if (targetFailed) {
    return {
      variant: "destructive",
      title: "Roof target not confirmed — re-place PIN to continue",
      description:
        "The AI measurement cannot proceed until the operator confirms which roof to measure. Re-open Structure Selection and drop the PIN on the target building.",
      failedFlags: failed,
    };
  }

  if (dsmOnly) {
    return {
      variant: "warning",
      title: "DSM registration incomplete — overlay locked from approval",
      description:
        "Raster overlay aligned successfully. DSM georegistration transform is incomplete or invalid, so topology cannot be promoted to a customer report. Re-run AI Measurement once DSM coverage is available.",
      failedFlags: failed,
    };
  }

  // Default: aggregate gate failed but neither target nor frame nor DSM is the
  // explicit cause — prefer the DSM-incomplete copy (safer; matches the most
  // common cause) rather than incorrectly accusing the coordinate frame.
  if (frameFailed) {
    return {
      variant: "destructive",
      title: "Coordinate frame mismatch — overlay not eligible for manual approval",
      description:
        "The displayed perimeter may be drawn over the wrong house or in a different coordinate frame than the aerial image. Re-run AI Measurement after re-placing the PIN on the actual roof. Manual approval is disabled until target roof registration passes.",
      failedFlags: failed,
    };
  }
  return {
    variant: "warning",
    title: "DSM registration incomplete — overlay locked from approval",
    description:
      "Raster overlay aligned successfully. DSM georegistration transform is incomplete or invalid, so topology cannot be promoted to a customer report. Re-run AI Measurement once DSM coverage is available.",
    failedFlags: failed,
  };
}

