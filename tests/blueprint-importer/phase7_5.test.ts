// Phase 7.5 — Schema hardening + approval/resolver/pricing contract tests.
// Pure functions, no DB.
import { describe, it, expect } from "vitest";
import {
  createDeterministicBatchKey,
  createDeterministicApprovalHash,
  validateApprovalObjectShape,
  validateApprovalHash,
  validateTargetStatusForLiveWrite,
  validateSourceDraftHashFresh,
  decideQuantityOnlySafety,
  validateQuantityOnlyModeAllowed,
  validateCatalogResolverOutput,
  type ApprovalObject,
  type CatalogResolverOutput,
} from "../../supabase/functions/_shared/blueprint-importer/crm-handoff.ts";

const T = "11111111-1111-1111-1111-111111111111";
const S = "22222222-2222-2222-2222-222222222222";
const B = "33333333-3333-3333-3333-333333333333";
const E = "44444444-4444-4444-4444-444444444444";
const C1 = "55555555-5555-5555-5555-555555555551";
const C2 = "55555555-5555-5555-5555-555555555552";

function approval(overrides: Partial<ApprovalObject> = {}): ApprovalObject {
  return {
    contract_version: "phase7.5.v1",
    approval_statement_version: "v1.0",
    approved_by: null,
    approved_at: null,
    import_session_id: S,
    handoff_batch_id: B,
    target_enhanced_estimate_id: E,
    included_candidate_ids: [C1, C2],
    excluded_candidate_ids: [],
    acknowledged_warning_ids: [],
    resolved_blocker_ids: [],
    catalog_mode: "catalog_resolved_only",
    pricing_mode: "ready_for_pricing_review",
    custom_line_mode: "disabled",
    source_draft_hash: "sha256:abc",
    approval_status: "approval_ready",
    approval_blockers: [],
    approval_warnings: [],
    deterministic_approval_hash: null,
    ...overrides,
  };
}

describe("Phase 7.5 — enhanced_estimates status mapping", () => {
  it("draft is the only live-write target", () => {
    expect(validateTargetStatusForLiveWrite("draft").can_live_write).toBe(true);
    expect(validateTargetStatusForLiveWrite("sent")).toEqual({ can_live_write: false, blocker: "TARGET_ESTIMATE_SENT" });
    expect(validateTargetStatusForLiveWrite("signed")).toEqual({ can_live_write: false, blocker: "TARGET_ESTIMATE_APPROVED" });
  });

  it("unknown status is blocked defensively", () => {
    const r = validateTargetStatusForLiveWrite("locked");
    expect(r.can_live_write).toBe(false);
    expect(r.blocker).toBe("TARGET_ESTIMATE_STATUS_UNKNOWN");
  });
});

describe("Phase 7.5 — deterministic batch key with source_draft_hash", () => {
  const base = {
    tenant_id: T,
    import_session_id: S,
    target_context_type: "project",
    target_context_id: null,
    canonical_estimate_target_table: "enhanced_estimates" as const,
    canonical_estimate_target_id: E,
    pricing_mode: "ready_for_pricing_review" as const,
    catalog_mode: "catalog_resolved_only" as const,
    custom_line_mode: "disabled" as const,
  };

  it("stable when source_draft_hash unchanged", async () => {
    const a = await createDeterministicBatchKey({ ...base, source_draft_hash: "sha256:abc" });
    const b = await createDeterministicBatchKey({ ...base, source_draft_hash: "sha256:abc" });
    expect(a).toEqual(b);
  });

  it("changes when source_draft_hash changes", async () => {
    const a = await createDeterministicBatchKey({ ...base, source_draft_hash: "sha256:abc" });
    const b = await createDeterministicBatchKey({ ...base, source_draft_hash: "sha256:xyz" });
    expect(a).not.toEqual(b);
  });

  it("null hash differs from a real hash", async () => {
    const a = await createDeterministicBatchKey({ ...base, source_draft_hash: null });
    const b = await createDeterministicBatchKey({ ...base, source_draft_hash: "sha256:abc" });
    expect(a).not.toEqual(b);
  });
});

describe("Phase 7.5 — approval object", () => {
  it("deterministic hash is stable", async () => {
    const a = approval();
    const h1 = await createDeterministicApprovalHash({
      contract_version: a.contract_version,
      approval_statement_version: a.approval_statement_version,
      import_session_id: a.import_session_id,
      handoff_batch_id: a.handoff_batch_id,
      target_enhanced_estimate_id: a.target_enhanced_estimate_id,
      included_candidate_ids: a.included_candidate_ids,
      excluded_candidate_ids: a.excluded_candidate_ids,
      acknowledged_warning_ids: a.acknowledged_warning_ids,
      resolved_blocker_ids: a.resolved_blocker_ids,
      catalog_mode: a.catalog_mode,
      pricing_mode: a.pricing_mode,
      custom_line_mode: a.custom_line_mode,
      source_draft_hash: a.source_draft_hash,
    });
    const a2 = { ...a, included_candidate_ids: [C2, C1] };
    const h2 = await createDeterministicApprovalHash({
      contract_version: a2.contract_version,
      approval_statement_version: a2.approval_statement_version,
      import_session_id: a2.import_session_id,
      handoff_batch_id: a2.handoff_batch_id,
      target_enhanced_estimate_id: a2.target_enhanced_estimate_id,
      included_candidate_ids: a2.included_candidate_ids,
      excluded_candidate_ids: a2.excluded_candidate_ids,
      acknowledged_warning_ids: a2.acknowledged_warning_ids,
      resolved_blocker_ids: a2.resolved_blocker_ids,
      catalog_mode: a2.catalog_mode,
      pricing_mode: a2.pricing_mode,
      custom_line_mode: a2.custom_line_mode,
      source_draft_hash: a2.source_draft_hash,
    });
    expect(h1).toEqual(h2); // order-independent
  });

  it("rejects empty included_candidate_ids", () => {
    const blockers = validateApprovalObjectShape(approval({ included_candidate_ids: [] }));
    expect(blockers).toContain("APPROVAL_MISSING_INCLUDED_CANDIDATES");
  });

  it("rejects approval with unresolved blockers", () => {
    const blockers = validateApprovalObjectShape(approval({ approval_blockers: ["APPROVAL_HASH_MISMATCH"] }));
    expect(blockers).toContain("APPROVAL_UNRESOLVED_BLOCKERS_REMAIN");
  });

  it("requires resolver mode unless custom-line is enabled and reviewed", () => {
    const a = approval({ catalog_mode: "preview_only" });
    expect(validateApprovalObjectShape(a)).toContain("APPROVAL_CATALOG_MODE_REQUIRES_RESOLVER");
  });

  it("validateApprovalHash reports mismatch", async () => {
    const a = approval({ deterministic_approval_hash: "wrong" });
    const r = await validateApprovalHash(a);
    expect(r.ok).toBe(false);
  });
});

describe("Phase 7.5 — quantity-only pricing safety", () => {
  it("quantity_only is blocked unsafe", () => {
    expect(decideQuantityOnlySafety("quantity_only")).toBe("blocked_quantity_only_unsafe");
    expect(validateQuantityOnlyModeAllowed("quantity_only")).toContain("PRICING_REQUIRED_BUT_UNAVAILABLE");
  });
  it("ready_for_pricing_review is allowed (pricing still required upstream)", () => {
    expect(decideQuantityOnlySafety("ready_for_pricing_review")).toBe("allowed_pricing_required");
    expect(validateQuantityOnlyModeAllowed("ready_for_pricing_review")).toHaveLength(0);
  });
});

describe("Phase 7.5 — source_draft_hash freshness", () => {
  it("matches", () => {
    expect(validateSourceDraftHashFresh("a", "a")).toBe(true);
  });
  it("rejects stale or null", () => {
    expect(validateSourceDraftHashFresh("a", "b")).toBe(false);
    expect(validateSourceDraftHashFresh(null, "a")).toBe(false);
  });
});

describe("Phase 7.5 — catalog resolver output validation", () => {
  const base: CatalogResolverOutput = {
    resolver_version: "v0.0",
    resolver_mode: "deterministic_catalog_only",
    tenant_id: T,
    source_candidate_id: C1,
    trade_id: "roofing",
    item_key: "shingles",
    normalized_item_name: "shingles",
    candidate_type: "material",
    match_status: "resolved",
    matched_catalog_table: "product_catalog",
    matched_catalog_item_id: "00000000-0000-0000-0000-000000007101",
    labor_rate_id: null,
    match_rule_id: null,
    match_confidence: 0.97,
    blockers: [],
    warnings: [],
    provenance: { attempted_sources: ["product_catalog"], rejected_matches: [], resolved_at: null },
  };

  it("resolved at high confidence has no blockers", () => {
    expect(validateCatalogResolverOutput(base)).toHaveLength(0);
  });
  it("resolved at low confidence adds CATALOG_MATCH_AMBIGUOUS", () => {
    expect(validateCatalogResolverOutput({ ...base, match_confidence: 0.8 })).toContain("CATALOG_MATCH_AMBIGUOUS");
  });
  it("ambiguous adds blocker", () => {
    expect(validateCatalogResolverOutput({ ...base, match_status: "ambiguous", match_confidence: 0 })).toContain("CATALOG_MATCH_AMBIGUOUS");
  });
  it("inactive_item adds blocker", () => {
    expect(validateCatalogResolverOutput({ ...base, match_status: "inactive_item", match_confidence: 0 })).toContain("CATALOG_ITEM_INACTIVE");
  });
  it("missing_labor_rate adds blocker", () => {
    expect(validateCatalogResolverOutput({ ...base, candidate_type: "labor", match_status: "missing_labor_rate", match_confidence: 0 })).toContain("LABOR_RATE_MISSING");
  });
  it("unresolved adds blocker", () => {
    expect(validateCatalogResolverOutput({ ...base, match_status: "unresolved", match_confidence: 0 })).toContain("CATALOG_UNRESOLVED_LIVE_HANDOFF");
  });
});
