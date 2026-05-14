// Cross-cutting customer-ready gate.
// Single entrypoint that every code path MUST call before flipping a
// measurement to `customer_report_ready`. Any failure returns a specific
// `block_customer_report_reason` string.

export interface CustomerReadyInput {
  user_confirmed_roof_target: boolean;
  roof_target_admin_override?: boolean;

  layer1_present: boolean;
  layer1_source_allowed: boolean;

  roof_lines_count: number;
  reportable_totals_have_typed_backing: boolean;

  per_plane_pitch_sources: string[]; // any 'collapsed_plane_fit' or '' fails
  ai_gates_passed: boolean;
  override_validation_status?: 'pending' | 'passed' | 'failed' | null;
}

export interface CustomerReadyResult {
  ready: boolean;
  block_customer_report_reason: string | null;
  failures: string[];
}

const COLLAPSED_PITCH_SOURCES = new Set(['collapsed_plane_fit', '', 'unavailable']);

export function assertCustomerReportReady(input: CustomerReadyInput): CustomerReadyResult {
  const failures: string[] = [];

  // Rule 1
  if (!input.user_confirmed_roof_target && !input.roof_target_admin_override) {
    failures.push('target_unconfirmed');
  }

  // Rule 2
  if (!input.layer1_present) failures.push('layer1_missing');
  else if (!input.layer1_source_allowed) failures.push('layer1_source_forbidden');

  // Rule 3
  if (input.roof_lines_count <= 0) failures.push('typed_roof_lines_missing');
  else if (!input.reportable_totals_have_typed_backing) {
    failures.push('untyped_edge_totals_blocked');
  }

  // Rule 4
  const badPitch = input.per_plane_pitch_sources.filter((s) =>
    COLLAPSED_PITCH_SOURCES.has(s)
  );
  if (badPitch.length > 0) failures.push(`collapsed_plane_pitch:${badPitch.length}`);

  // Rule 5: AI passed OR overrides validated
  const aiOk = input.ai_gates_passed;
  const overridesOk = input.override_validation_status === 'passed';
  if (!aiOk && !overridesOk) failures.push('ai_failed_no_validated_overrides');

  return {
    ready: failures.length === 0,
    block_customer_report_reason: failures[0] ?? null,
    failures,
  };
}
