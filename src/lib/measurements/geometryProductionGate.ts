/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  GEOMETRY PRODUCTION GATE                                          ║
 * ║                                                                    ║
 * ║  Enforces the architectural contract:                              ║
 * ║    "If a measurement cannot be derived from validated geometry,    ║
 * ║     DO NOT present it as a customer measurement."                  ║
 * ║                                                                    ║
 * ║  This is the SINGLE checkpoint that prevents heuristic estimates   ║
 * ║  from reaching customer-facing outputs (PDFs, reports, materials). ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export type GeometrySource = 'heuristic_estimate' | 'dsm_validated' | 'vendor_verified';

export interface GeometryGateInput {
  geometry_source?: GeometrySource | string | null;
  customer_report_ready?: boolean | null;
  overall_score?: number | null;
  report_blocked?: boolean | null;
  needs_review?: boolean | null;
}

export interface GeometryGateResult {
  /** Whether this geometry may be used in customer-facing reports */
  allowed: boolean;
  /** Human-readable reason if blocked */
  reason: string;
  /** The resolved geometry source */
  source: GeometrySource;
}

/**
 * Evaluate whether a measurement's geometry is production-grade.
 *
 * Rules:
 * 1. geometry_source must be 'dsm_validated' or 'vendor_verified'
 * 2. customer_report_ready must be explicitly true
 * 3. No report_blocked or needs_review flags
 * 4. overall_score (if present) must be >= 0.65
 *
 * Heuristic estimates (bbox formulas, ridge=75%×width, etc.) are
 * ALWAYS blocked from customer reports regardless of other flags.
 */
export function evaluateGeometryGate(input: GeometryGateInput): GeometryGateResult {
  const source = resolveSource(input.geometry_source);

  if (source === 'heuristic_estimate') {
    return {
      allowed: false,
      reason: 'Geometry derived from heuristic estimates (not validated DSM/vendor). Cannot be used for customer reports.',
      source,
    };
  }

  if (input.report_blocked || input.needs_review) {
    return {
      allowed: false,
      reason: 'Report is blocked or flagged for review.',
      source,
    };
  }

  if (typeof input.overall_score === 'number' && input.overall_score < 0.65) {
    return {
      allowed: false,
      reason: `Overall score ${input.overall_score.toFixed(2)} below 0.65 threshold.`,
      source,
    };
  }

  if (input.customer_report_ready === false) {
    return {
      allowed: false,
      reason: 'customer_report_ready is explicitly false.',
      source,
    };
  }

  return {
    allowed: true,
    reason: 'Geometry is validated and report-ready.',
    source,
  };
}

function resolveSource(raw: GeometrySource | string | null | undefined): GeometrySource {
  if (raw === 'dsm_validated') return 'dsm_validated';
  if (raw === 'vendor_verified') return 'vendor_verified';
  return 'heuristic_estimate';
}

/**
 * Quick boolean check for use in components.
 * Returns true only if geometry is production-grade.
 */
export function isGeometryProductionReady(input: GeometryGateInput): boolean {
  return evaluateGeometryGate(input).allowed;
}
