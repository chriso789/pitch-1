// Blueprint Importer v2 — Phase 7.8 final live-handoff readiness evaluator.
//
// PURE helper. No DB IO. No API calls. Centralises Phase 7.7's readiness
// matrix into one decision used by future Phase 8 implementation.
//
// Phase 8 is allowed to attempt a live write only when this evaluator returns
// ready_for_phase_8_candidate=true AND blockers.length===0.

import type { SupplierValidationResult } from "./phase7_8-supplier-validation.ts";
import type { AbcValidationResult } from "./phase7_8-abc-validation.ts";
import type { ExistingLinePolicyResult } from "./phase7_8-existing-line-policy.ts";
import type { WriteMappingResult } from "./phase7_8-write-mapping.ts";
import type { PreflightCandidateResult } from "./phase7_6c-preflight.ts";
import { getTierSideEffectsReport } from "./phase7_8-tier-side-effects.ts";

export const PHASE_7_8_READINESS_VERSION =
  "v2.0-readiness-phase-7.8" as const;

export interface ReadinessInput {
  candidate_id: string;
  tenant_id: string;
  source_draft_hash: string | null;
  /** Preflight (Phase 7.6c) result. */
  preflight: PreflightCandidateResult | null;
  /** Supplier validator result if target_kind=supplier_catalog_item, else null. */
  supplier: SupplierValidationResult | null;
  /** ABC validator result if target_kind=abc_catalog_item, else null. */
  abc: AbcValidationResult | null;
  /** Existing-line policy decision for this candidate. */
  existing_line: ExistingLinePolicyResult;
  /** Write-mapping result. */
  write_mapping: WriteMappingResult;
  /** Approval object — must include user, signed_at, deterministic batch key. */
  approval: {
    signed: boolean;
    approved_by: string | null;
    approved_at: string | null;
    batch_source_draft_hash: string | null;
  };
}

export interface ReadinessResult {
  evaluator_version: typeof PHASE_7_8_READINESS_VERSION;
  ready_for_phase_8_candidate: boolean;
  blocked: boolean;
  blockers: string[];
  warnings: string[];
  missing_evidence: string[];
  readiness_matrix_result: Record<string, "pass" | "fail" | "skip">;
}

export function evaluateBlueprintLiveHandoffReadiness(
  input: ReadinessInput,
): ReadinessResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];
  const matrix: Record<string, "pass" | "fail" | "skip"> = {};

  // Gate: preflight present and passed (pricing_status not blocked).
  if (!input.preflight) {
    matrix["gate_preflight"] = "fail";
    blockers.push("PRICING_PREFLIGHT_MISSING");
    missing.push("phase_7_6c_preflight_result");
  } else if (
    input.preflight.pricing_status === "blocked" ||
    input.preflight.pricing_status === "blocked_quantity_only_unsafe"
  ) {
    matrix["gate_preflight"] = "fail";
    blockers.push(...input.preflight.blockers);
  } else {
    matrix["gate_preflight"] = "pass";
  }

  // Gate: supplier (if applicable).
  if (input.supplier) {
    matrix["gate_supplier"] = input.supplier.ok ? "pass" : "fail";
    if (!input.supplier.ok) blockers.push(...input.supplier.blockers);
  } else {
    matrix["gate_supplier"] = "skip";
  }

  // Gate: ABC (if applicable).
  if (input.abc) {
    matrix["gate_abc"] = input.abc.ok ? "pass" : "fail";
    if (!input.abc.ok) blockers.push(...input.abc.blockers);
    warnings.push(...input.abc.warnings);
  } else {
    matrix["gate_abc"] = "skip";
  }

  // Gate: existing-line policy.
  if (input.existing_line.blockers.length > 0) {
    matrix["gate_existing_line"] = "fail";
    blockers.push(...input.existing_line.blockers);
  } else {
    matrix["gate_existing_line"] = "pass";
  }

  // Gate: write mapping.
  matrix["gate_write_mapping"] = input.write_mapping.ok ? "pass" : "fail";
  if (!input.write_mapping.ok) blockers.push(...input.write_mapping.blockers);

  // Gate: approval object signed AND draft hash matches.
  if (!input.approval.signed || !input.approval.approved_by || !input.approval.approved_at) {
    matrix["gate_approval"] = "fail";
    blockers.push("HANDOFF_APPROVAL_OBJECT_MISSING");
    missing.push("approval_signature");
  } else if (
    input.approval.batch_source_draft_hash &&
    input.source_draft_hash &&
    input.approval.batch_source_draft_hash !== input.source_draft_hash
  ) {
    matrix["gate_approval"] = "fail";
    blockers.push("SOURCE_DRAFT_HASH_MISMATCH");
  } else {
    matrix["gate_approval"] = "pass";
  }

  // Gate: tier side-effect verdict.
  const tier = getTierSideEffectsReport();
  if (
    tier.verdict === "unsafe_without_phase_7_9_contract" ||
    tier.verdict === "ambiguous_block_phase_8"
  ) {
    matrix["gate_tier_side_effects"] = "fail";
    blockers.push("ENHANCED_ESTIMATES_TIER_CONTRACT_REQUIRED_PHASE_7_9");
  } else {
    matrix["gate_tier_side_effects"] = "pass";
  }

  const blocked = blockers.length > 0;
  return {
    evaluator_version: PHASE_7_8_READINESS_VERSION,
    ready_for_phase_8_candidate: !blocked,
    blocked,
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    missing_evidence: missing,
    readiness_matrix_result: matrix,
  };
}
