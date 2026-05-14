// Canonical result_state contract.
//
// The DB CHECK constraints on roof_measurements / ai_measurement_jobs /
// measurement_jobs only accept the 10 stable values in ALLOWED_RESULT_STATES.
// Specific solver failure reasons MUST live in
//   - hard_fail_reason
//   - block_customer_report_reason
//   - failure_stage
//   - validation_status
//   - geometry_report_json.failure_details
// They MUST NOT be written into result_state itself.
//
// All edge-function code paths that write result_state must go through
// `normalizeResultState()` (or `normalizeResultStateForWrite()` when a
// geometry_report_json bag is also being persisted).

export const ALLOWED_RESULT_STATES = [
  'customer_report_ready',
  'perimeter_only',
  'diagnostic_only',
  'ai_failed_target_unconfirmed',
  'ai_failed_source_acquisition',
  'ai_failed_perimeter',
  'ai_failed_topology',
  'ai_failed_pitch',
  'ai_failed_schema',
  'ai_failed_unknown',
] as const;

export type ResultState = (typeof ALLOWED_RESULT_STATES)[number];

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_RESULT_STATES);

/**
 * Map any raw failure reason or status string into one of the canonical
 * result_state buckets. Unknown values become `ai_failed_unknown`.
 */
export function normalizeResultState(raw: unknown): ResultState {
  if (raw == null) return 'ai_failed_unknown';
  const s = String(raw).toLowerCase().trim();
  if (!s) return 'ai_failed_unknown';
  if (ALLOWED_SET.has(s)) return s as ResultState;

  // Order matters: most-specific rules first.
  if (s.includes('target') && s.includes('unconfirm')) return 'ai_failed_target_unconfirmed';
  if (s.includes('target_unconfirmed')) return 'ai_failed_target_unconfirmed';

  if (
    s.includes('source_acquisition') ||
    s.includes('acquisition') ||
    s.includes('dsm_fetch') ||
    s.includes('no_dsm_coverage') ||
    s.includes('source_failed') ||
    s.includes('imagery_unavailable')
  ) return 'ai_failed_source_acquisition';

  if (
    s.includes('perimeter') ||
    s.includes('target_mask') ||
    s.includes('inner_trace') ||
    s.includes('layer1') ||
    s.includes('invalid_roof_footprint') ||
    s.includes('footprint_invalid') ||
    s.includes('classification_invalid') ||
    s.includes('eave_rake') ||
    s.includes('all_rake_no_eave')
  ) return 'ai_failed_perimeter';

  if (
    s.includes('topology') ||
    s.includes('undersegment') ||
    s.includes('complex_topology') ||
    s.includes('invalid_edge_classification') ||
    s.includes('ridge_network_missing') ||
    s.includes('graph_fragment') ||
    s.includes('insufficient_structural_signal') ||
    s.includes('invalid_roof_graph') ||
    s.includes('backbone') ||
    s.includes('connectivity_collapse') ||
    s.includes('seed_collapse') ||
    s.includes('patent')
  ) return 'ai_failed_topology';

  if (s.includes('pitch') || s.includes('collapsed_plane')) return 'ai_failed_pitch';

  if (
    s.includes('schema') ||
    s.includes('constraint') ||
    s.includes('cache') ||
    s.includes('db_insert') ||
    s.includes('db insert')
  ) return 'ai_failed_schema';

  // Runtime / unhandled exceptions: DB CHECK only allows 10 buckets, so we
  // funnel runtime failures into ai_failed_unknown and let the specific
  // reason live in hard_fail_reason. NEVER expand the constraint.
  if (s.includes('runtime') || s.includes('exception')) return 'ai_failed_unknown';

  if (s === 'ready' || s.includes('customer_report_ready')) return 'customer_report_ready';
  if (s.includes('perimeter_only')) return 'perimeter_only';
  if (s.includes('diagnostic')) return 'diagnostic_only';

  return 'ai_failed_unknown';
}

/**
 * Final safety guard for a result_state value about to be written to the DB.
 * Returns the normalized value AND mutates the supplied geometry_report_json
 * bag with forensic context when the input was non-canonical, so the original
 * intent is never lost.
 */
export function normalizeResultStateForWrite(
  raw: unknown,
  geometryReportJson?: Record<string, any> | null,
): ResultState {
  const normalized = normalizeResultState(raw);
  const original = raw == null ? null : String(raw);
  if (geometryReportJson && original && original !== normalized) {
    geometryReportJson.raw_result_state_attempted = original;
    if (!ALLOWED_SET.has(original)) {
      geometryReportJson.result_state_normalization_error = true;
    }
  }
  return normalized;
}

export function isAllowedResultState(value: unknown): value is ResultState {
  return typeof value === 'string' && ALLOWED_SET.has(value);
}
