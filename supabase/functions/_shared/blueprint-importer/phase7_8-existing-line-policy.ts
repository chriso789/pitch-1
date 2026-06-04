// Blueprint Importer v2 — Phase 7.8 existing-line-at-key resolution policy.
//
// PURE decision helper. No DB IO. No mutation of estimate_line_items or
// blueprint_estimate_line_provenance. Implements the locked existing-line
// policy from docs/blueprint-existing-line-resolution-policy.md.
//
// HARD RULES:
//   - Never destructively overwrite a user-edited live line.
//   - Missing provenance for an existing live line at the same key is a hard
//     block (cannot prove the line is ours to touch).
//   - Tenant mismatch is a hard block.
//   - Target (canonical_estimate_target_id) mismatch is a hard block.
//   - Deterministic-key collision against a different candidate is a hard block.
//   - Quantity / formula changes require user choice (never silent re-write).

export const PHASE_7_8_EXISTING_LINE_POLICY_VERSION =
  "v2.0-existing-line-phase-7.8" as const;

export type ExistingLineOutcome =
  | "skip_if_identical"
  | "block_if_live_line_user_edited"
  | "require_user_choice_if_quantity_changed"
  | "require_user_choice_if_formula_changed"
  | "block_missing_provenance"
  | "block_tenant_mismatch"
  | "block_target_mismatch"
  | "block_key_collision"
  | "create_new_version_requires_approval"
  | "update_live_line_requires_approval";

export const PHASE_7_8_EXISTING_LINE_BLOCKER_CODES = [
  "EXISTING_LINE_USER_EDITED",
  "EXISTING_LINE_MISSING_PROVENANCE",
  "EXISTING_LINE_TENANT_MISMATCH",
  "EXISTING_LINE_TARGET_MISMATCH",
  "EXISTING_LINE_KEY_COLLISION",
  "DETERMINISTIC_HANDOFF_KEY_COLLISION",
] as const;
export type Phase7_8ExistingLineBlocker =
  typeof PHASE_7_8_EXISTING_LINE_POLICY_VERSION extends string
    ? typeof PHASE_7_8_EXISTING_LINE_BLOCKER_CODES[number]
    : never;

export interface CandidateForExistingLine {
  candidate_id: string;
  tenant_id: string;
  canonical_estimate_target_id: string;
  deterministic_handoff_key: string;
  source_draft_hash: string;
  quantity: number | null;
  formula_key: string | null;
  formula_inputs: Record<string, unknown>;
}

export interface ProvenanceBridgeSnapshot {
  id: string;
  tenant_id: string;
  deterministic_handoff_key: string;
  canonical_estimate_target_id: string | null;
  live_estimate_line_item_id: string | null;
  line_candidate_id: string;
  source_draft_hash?: string | null;
}

export interface ExistingEstimateLineSnapshot {
  id: string;
  tenant_id: string;
  estimate_id: string;
  quantity: number;
  user_edited: boolean;
  formula_key?: string | null;
  formula_inputs?: Record<string, unknown> | null;
}

export interface ExistingLinePolicyInput {
  candidate: CandidateForExistingLine;
  /** Bridge rows for the candidate's deterministic key (any tenant). */
  bridge_rows_for_key: ProvenanceBridgeSnapshot[];
  /** Live line at the same target+key, if any. */
  live_line: ExistingEstimateLineSnapshot | null;
}

export interface ExistingLinePolicyResult {
  policy_version: typeof PHASE_7_8_EXISTING_LINE_POLICY_VERSION;
  outcome: ExistingLineOutcome;
  blockers: typeof PHASE_7_8_EXISTING_LINE_BLOCKER_CODES[number][];
  requires_user_approval: boolean;
  notes: string[];
}

function approxEq(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

function shallowEqJson(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean {
  const A = a ?? {};
  const B = b ?? {};
  const ak = Object.keys(A).sort();
  const bk = Object.keys(B).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (JSON.stringify(A[ak[i]]) !== JSON.stringify(B[bk[i]])) return false;
  }
  return true;
}

export function evaluateExistingLinePolicy(
  input: ExistingLinePolicyInput,
): ExistingLinePolicyResult {
  const blockers: typeof PHASE_7_8_EXISTING_LINE_BLOCKER_CODES[number][] = [];
  const notes: string[] = [];
  const c = input.candidate;

  // 1. Deterministic-key collision: bridge row for the same key belongs to a
  //    *different* candidate (in the same tenant) AND we have no matching row
  //    for our own candidate. That's a hard block.
  const ownRow = input.bridge_rows_for_key.find(
    (r) => r.tenant_id === c.tenant_id && r.line_candidate_id === c.candidate_id,
  );
  const otherTenantSameKey = input.bridge_rows_for_key.find(
    (r) => r.deterministic_handoff_key === c.deterministic_handoff_key &&
           r.tenant_id !== c.tenant_id,
  );
  if (otherTenantSameKey) {
    blockers.push("EXISTING_LINE_TENANT_MISMATCH");
  }
  const conflictingOwnTenantRow = input.bridge_rows_for_key.find(
    (r) => r.tenant_id === c.tenant_id &&
           r.deterministic_handoff_key === c.deterministic_handoff_key &&
           r.line_candidate_id !== c.candidate_id,
  );
  if (conflictingOwnTenantRow && !ownRow) {
    blockers.push("DETERMINISTIC_HANDOFF_KEY_COLLISION");
    blockers.push("EXISTING_LINE_KEY_COLLISION");
  }

  // 2. Live line present without a provenance bridge row → block.
  if (input.live_line && !ownRow) {
    blockers.push("EXISTING_LINE_MISSING_PROVENANCE");
    notes.push("Live estimate_line_items row exists at key but no provenance bridge row owns it.");
  }

  // 3. Tenant mismatch on the live line itself.
  if (input.live_line && input.live_line.tenant_id !== c.tenant_id) {
    blockers.push("EXISTING_LINE_TENANT_MISMATCH");
  }

  // 4. Target mismatch: bridge row target_id differs from candidate target_id.
  if (ownRow && ownRow.canonical_estimate_target_id &&
      ownRow.canonical_estimate_target_id !== c.canonical_estimate_target_id) {
    blockers.push("EXISTING_LINE_TARGET_MISMATCH");
  }

  if (blockers.length > 0) {
    // Pick the most specific outcome label, otherwise generic.
    const outcome: ExistingLineOutcome =
      blockers.includes("EXISTING_LINE_TENANT_MISMATCH") ? "block_tenant_mismatch" :
      blockers.includes("EXISTING_LINE_TARGET_MISMATCH") ? "block_target_mismatch" :
      blockers.includes("EXISTING_LINE_MISSING_PROVENANCE") ? "block_missing_provenance" :
      "block_key_collision";
    return {
      policy_version: PHASE_7_8_EXISTING_LINE_POLICY_VERSION,
      outcome,
      blockers: Array.from(new Set(blockers)),
      requires_user_approval: false,
      notes,
    };
  }

  // No live line: this would create a new line — requires approval.
  if (!input.live_line) {
    return {
      policy_version: PHASE_7_8_EXISTING_LINE_POLICY_VERSION,
      outcome: "create_new_version_requires_approval",
      blockers: [],
      requires_user_approval: true,
      notes: ["No live line at deterministic key; new estimate_line_items row would be created."],
    };
  }

  // Live line + own bridge row: user edits block.
  if (input.live_line.user_edited) {
    return {
      policy_version: PHASE_7_8_EXISTING_LINE_POLICY_VERSION,
      outcome: "block_if_live_line_user_edited",
      blockers: ["EXISTING_LINE_USER_EDITED"],
      requires_user_approval: false,
      notes: ["Live line was user-edited; never overwrite silently."],
    };
  }

  // Quantity change requires user choice.
  if (!approxEq(input.live_line.quantity, c.quantity)) {
    return {
      policy_version: PHASE_7_8_EXISTING_LINE_POLICY_VERSION,
      outcome: "require_user_choice_if_quantity_changed",
      blockers: [],
      requires_user_approval: true,
      notes: [],
    };
  }

  // Formula change requires user choice.
  const formulaSame =
    (input.live_line.formula_key ?? null) === (c.formula_key ?? null) &&
    shallowEqJson(input.live_line.formula_inputs ?? {}, c.formula_inputs);
  if (!formulaSame) {
    return {
      policy_version: PHASE_7_8_EXISTING_LINE_POLICY_VERSION,
      outcome: "require_user_choice_if_formula_changed",
      blockers: [],
      requires_user_approval: true,
      notes: [],
    };
  }

  // Identical → no-op.
  return {
    policy_version: PHASE_7_8_EXISTING_LINE_POLICY_VERSION,
    outcome: "skip_if_identical",
    blockers: [],
    requires_user_approval: false,
    notes: [],
  };
}
