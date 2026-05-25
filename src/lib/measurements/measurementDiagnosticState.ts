export type ResolvedMeasurementDiagnosticState = {
  result_state: string | null;
  hard_fail_reason: string | null;
  block_customer_report_reason: string | null;
  failure_stage: string | null;
  diagram_render_intent: string | null;
  footprint_source: string | null;
  customer_report_ready: boolean;
  report_blocked: boolean;
  needs_review: boolean;
  final_state_source: string;
  final_state_precedence_version: string;
  source_acquisition_completed: boolean;
  target_confirmation_passed: boolean;
  dsm_loaded: boolean;
  mask_loaded: boolean;
  target_mask_isolation_checked: boolean;
  phase0_incomplete_reason: string | null;
  /**
   * Stable stage id (matches viewer stage ids) that the UI should focus on
   * once the run reaches a terminal state. Drives the AI Process Viewer
   * default-active stage so it reflects the resolved final failure, not
   * the first stage in the timeline.
   */
  active_stage_hint: string | null;
  /** DSM coordinate transform / georegistration is intact. */
  dsm_transform_valid: boolean;
};

const PRECEDENCE_VERSION = "measurement-state-precedence-v3";
const CPU_TIMEOUT_REASON = "ai_measurement_cpu_timeout";
const CPU_TIMEOUT_STAGE = "phase3_5_topology_cpu_budget_exceeded";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function readBool(...values: unknown[]): boolean {
  return values.some((value) => value === true);
}

function hasObjectEvidence(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0;
}

export function resolveMeasurementDiagnosticState(
  payload: Record<string, unknown> | null | undefined,
): ResolvedMeasurementDiagnosticState {
  const row = asRecord(payload);
  const geometry = asRecord(row.geometry_report_json ?? row);
  const sourceContext = asRecord(row.source_context);
  const sourceContextDebug = asRecord(
    sourceContext.debug ?? sourceContext.source_context,
  );
  const dpgd = asRecord(geometry.dsm_planar_graph_debug);
  const overlayDebug = asRecord(geometry.overlay_debug);
  const registration = asRecord(
    geometry.registration ?? geometry.registration_gate,
  );
  const targetMask = asRecord(
    geometry.target_mask_isolation ??
      geometry.perimeter_inner_trace ??
      dpgd.target_mask_isolation,
  );

  const nestedHardFail = readString(
    dpgd.hard_fail_reason,
    dpgd.failure_reason,
    overlayDebug.hard_fail_reason,
    sourceContextDebug.hard_fail_reason,
  );
  const nestedResultState = readString(
    dpgd.result_state,
    overlayDebug.result_state,
    sourceContextDebug.result_state,
  );
  const nestedFailureStage = readString(
    dpgd.failure_stage,
    overlayDebug.failure_stage,
    sourceContextDebug.failure_stage,
  );
  const cpuBudgetStage = readString(
    geometry.cpu_budget_stage,
    dpgd.cpu_budget_stage,
    overlayDebug.cpu_budget_stage,
    sourceContextDebug.cpu_budget_stage,
  );

  const dsmLoaded = readBool(
    geometry.dsm_loaded,
    dpgd.dsm_loaded,
    overlayDebug.dsm_loaded,
    registration.dsm_stage_attempted,
  );
  const maskLoaded = readBool(
    geometry.mask_loaded,
    dpgd.mask_loaded,
    overlayDebug.mask_loaded,
  );
  const targetMaskChecked =
    readBool(targetMask.checked, targetMask.attempted, targetMask.executed) ||
    hasObjectEvidence(targetMask);
  const runtimeEvidence = readString(
        geometry.hard_fail_reason,
        geometry.block_customer_report_reason,
      ) === CPU_TIMEOUT_REASON ||
    nestedHardFail === CPU_TIMEOUT_REASON ||
    readString(geometry.result_state) === "ai_failed_runtime" ||
    nestedResultState === "ai_failed_runtime" ||
    readString(geometry.failure_stage) === CPU_TIMEOUT_STAGE ||
    nestedFailureStage === CPU_TIMEOUT_STAGE ||
    cpuBudgetStage === "phase3_5_perimeter_refinement" ||
    cpuBudgetStage === "autonomous_topology_solver";

  const confirmedCenter = geometry.confirmed_roof_center_lat_lng ??
    registration.confirmed_roof_center_lat_lng ??
    row.confirmed_roof_center_lat_lng ??
    (row.target_lat != null && row.target_lng != null
      ? { lat: row.target_lat, lng: row.target_lng }
      : null);
  const targetConfirmed = readBool(
    row.user_confirmed_roof_target,
    geometry.user_confirmed_roof_target,
    registration.user_confirmed_roof_target,
    row.roof_target_admin_override,
    geometry.roof_target_admin_override,
    registration.roof_target_admin_override,
  ) && !!confirmedCenter;

  const sourceAcquisitionCompleted = dsmLoaded ||
    maskLoaded ||
    readString(
        geometry.google_solar_status,
        dpgd.google_solar_status,
        overlayDebug.google_solar_status,
      ) != null;

  if (runtimeEvidence && (dsmLoaded || maskLoaded || targetMaskChecked)) {
    const footprintSource = readString(
      geometry.footprint_source,
      dpgd.footprint_source,
      overlayDebug.footprint_source,
    );
    return {
      result_state: "ai_failed_runtime",
      hard_fail_reason: CPU_TIMEOUT_REASON,
      block_customer_report_reason: CPU_TIMEOUT_REASON,
      failure_stage: CPU_TIMEOUT_STAGE,
      diagram_render_intent: "debug_only",
      footprint_source: footprintSource === "blocked_by_registration_gate"
        ? "google_solar_roof_mask"
        : readString(footprintSource, "google_solar_roof_mask"),
      customer_report_ready: false,
      report_blocked: true,
      needs_review: true,
      final_state_source: "runtime_cpu_budget_guard",
      final_state_precedence_version: PRECEDENCE_VERSION,
      source_acquisition_completed: true,
      target_confirmation_passed: targetConfirmed,
      dsm_loaded: dsmLoaded,
      mask_loaded: maskLoaded,
      target_mask_isolation_checked: targetMaskChecked,
      phase0_incomplete_reason: "runtime_preemption",
    };
  }

  const hardFail = readString(
    geometry.hard_fail_reason,
    geometry.block_customer_report_reason,
    row.hard_fail_reason,
    row.gate_reason,
    nestedHardFail,
  );

  return {
    result_state: readString(
      geometry.result_state,
      row.result_state,
      nestedResultState,
    ),
    hard_fail_reason: hardFail,
    block_customer_report_reason: readString(
      geometry.block_customer_report_reason,
      hardFail,
    ),
    failure_stage: readString(geometry.failure_stage, nestedFailureStage),
    diagram_render_intent: readString(geometry.diagram_render_intent),
    footprint_source: readString(
      geometry.footprint_source,
      row.footprint_source,
    ),
    customer_report_ready: row.customer_report_ready === true ||
      geometry.customer_report_ready === true,
    report_blocked: row.report_blocked === true ||
      geometry.report_blocked === true || !!hardFail,
    needs_review: row.needs_review === true || geometry.needs_review === true,
    final_state_source: "persisted_top_level",
    final_state_precedence_version: PRECEDENCE_VERSION,
    source_acquisition_completed: sourceAcquisitionCompleted,
    target_confirmation_passed: targetConfirmed,
    dsm_loaded: dsmLoaded,
    mask_loaded: maskLoaded,
    target_mask_isolation_checked: targetMaskChecked,
    phase0_incomplete_reason: null,
  };
}
