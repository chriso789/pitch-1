"""Blueprint Importer v2 — Phase 5.5 CRM handoff contracts (Python twin).

Pure dataclasses + helpers. NOT registered in skills_registry.py. NOT
imported by worker/app/main.py. Side-effect-free.

Parity with supabase/functions/_shared/blueprint-importer/crm-handoff.ts.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

CanonicalEstimateTarget = Literal["enhanced_estimates"]
CANONICAL_ESTIMATE_TARGET: CanonicalEstimateTarget = "enhanced_estimates"

SourceDraftLineType = Literal["material", "labor"]

HandoffBatchStatus = Literal[
    "draft",
    "preview_requested",
    "preview_created",
    "user_review_required",
    "user_approved_for_estimate",
    "live_write_requested",
    "live_written",
    "superseded",
    "cancelled",
    "failed",
]

EstimateLineCandidateStatus = Literal[
    "draft",
    "preview",
    "blocked",
    "user_review_required",
    "user_approved",
    "superseded",
    "cancelled",
    "failed",
    "live_written",
]

CatalogResolutionStatus = Literal[
    "unresolved", "matched", "ambiguous", "missing", "manual_override"
]

PricingStatus = Literal[
    "quantity_only",
    "cost_unresolved",
    "catalog_resolved_cost_missing",
    "catalog_resolved_cost_available",
    "labor_rate_missing",
    "ready_for_pricing_review",
    "ready_for_live_handoff",
    "blocked",
]

CostStatus = Literal[
    "not_attempted", "unavailable", "available_from_catalog", "available_from_user_override"
]

UserReviewStatus = Literal["pending", "reviewed", "approved", "excluded"]

CatalogHandoffMode = Literal[
    "catalog_resolved_only", "user_approved_custom_lines", "preview_only"
]

PricingMode = Literal["quantity_only", "ready_for_pricing_review"]

CustomLineMode = Literal["disabled", "enabled"]


@dataclass
class BlueprintEstimateHandoffBatch:
    tenant_id: str
    import_session_id: str
    target_context_type: str
    canonical_estimate_target_table: CanonicalEstimateTarget
    status: HandoffBatchStatus
    pricing_mode: PricingMode
    catalog_mode: CatalogHandoffMode
    custom_line_mode: CustomLineMode
    deterministic_batch_key: str
    target_context_id: Optional[str] = None
    canonical_estimate_target_id: Optional[str] = None
    created_by: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    source_draft_hash: Optional[str] = None
    blocking_review_flag_ids: list[str] = field(default_factory=list)
    warning_review_flag_ids: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    id: Optional[str] = None


@dataclass
class BlueprintEstimateLineCandidate:
    tenant_id: str
    handoff_batch_id: str
    import_session_id: str
    accepted_trade_id: str
    source_draft_line_id: str
    source_draft_line_type: SourceDraftLineType
    trade_id: str
    item_key: str
    source_measurement_ids: list[str]
    plan_path_ids: list[str]
    deterministic_handoff_key: str
    catalog_resolution_status: CatalogResolutionStatus = "unresolved"
    pricing_status: PricingStatus = "quantity_only"
    cost_status: CostStatus = "not_attempted"
    user_review_status: UserReviewStatus = "pending"
    handoff_allowed: bool = False
    handoff_blockers: list[str] = field(default_factory=list)
    blocking_review_flag_ids: list[str] = field(default_factory=list)
    warning_review_flag_ids: list[str] = field(default_factory=list)
    source_document_ids: list[str] = field(default_factory=list)
    template_binding_id: Optional[str] = None
    item_name: Optional[str] = None
    description: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    formula_key: Optional[str] = None
    formula_inputs: dict[str, Any] = field(default_factory=dict)
    catalog_item_id: Optional[str] = None
    provenance_summary: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    status: EstimateLineCandidateStatus = "draft"
    id: Optional[str] = None


@dataclass
class BlueprintEstimateLineProvenance:
    tenant_id: str
    handoff_batch_id: str
    line_candidate_id: str
    canonical_estimate_target_table: CanonicalEstimateTarget
    deterministic_handoff_key: str
    import_session_id: str
    accepted_trade_id: str
    source_draft_line_id: str
    source_draft_line_type: SourceDraftLineType
    source_measurement_ids: list[str]
    plan_path_ids: list[str]
    canonical_estimate_target_id: Optional[str] = None
    live_estimate_line_item_id: Optional[str] = None
    template_binding_id: Optional[str] = None
    source_document_ids: list[str] = field(default_factory=list)
    formula_key: Optional[str] = None
    formula_inputs: dict[str, Any] = field(default_factory=dict)
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    live_written_by: Optional[str] = None
    live_written_at: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)
    id: Optional[str] = None


# ---------------------------------------------------------------------------
# Deterministic key builders
# ---------------------------------------------------------------------------

def _canonical_decimal(n: Optional[float]) -> str:
    if n is None:
        return "null"
    return ("%.6f" % float(n)).rstrip("0").rstrip(".")


def _sorted_uuid_list(ids: list[str]) -> str:
    return ",".join(sorted(ids))


def _canonical_json(value: Any) -> str:
    return json.dumps(value or {}, sort_keys=True, separators=(",", ":"))


def _sha256(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def create_deterministic_batch_key(
    *,
    tenant_id: str,
    import_session_id: str,
    target_context_type: str,
    target_context_id: Optional[str],
    canonical_estimate_target_table: CanonicalEstimateTarget,
    canonical_estimate_target_id: Optional[str],
    pricing_mode: PricingMode,
    catalog_mode: CatalogHandoffMode,
    custom_line_mode: CustomLineMode,
    source_draft_hash: Optional[str],
) -> str:
    payload = ":".join([
        tenant_id,
        import_session_id,
        target_context_type,
        target_context_id or "null",
        canonical_estimate_target_table,
        canonical_estimate_target_id or "null",
        pricing_mode,
        catalog_mode,
        custom_line_mode,
        source_draft_hash or "null",
    ])
    return _sha256(payload)


def create_deterministic_handoff_key(
    *,
    tenant_id: str,
    import_session_id: str,
    accepted_trade_id: str,
    template_binding_id: Optional[str],
    source_draft_line_id: str,
    source_draft_line_type: SourceDraftLineType,
    formula_key: Optional[str],
    quantity: Optional[float],
    unit: Optional[str],
    source_measurement_ids: list[str],
    plan_path_ids: list[str],
    template_version: Optional[str],
    user_assumptions: Optional[dict[str, Any]],
) -> str:
    payload = ":".join([
        tenant_id,
        import_session_id,
        accepted_trade_id,
        template_binding_id or "null",
        source_draft_line_id,
        source_draft_line_type,
        formula_key or "null",
        _canonical_decimal(quantity),
        unit or "null",
        _sorted_uuid_list(source_measurement_ids),
        _sorted_uuid_list(plan_path_ids),
        template_version or "null",
        _canonical_json(user_assumptions or {}),
    ])
    return _sha256(payload)


# ---------------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------------

MEASUREMENT_ONLY_TRADES = {"windows_doors"}
FUTURE_TRADES = {
    "drywall", "framing", "insulation", "flooring", "concrete",
    "electrical", "plumbing", "hvac",
}


def validate_candidate_has_plan_path(candidate: BlueprintEstimateLineCandidate) -> list[str]:
    return [] if candidate.plan_path_ids else ["MISSING_PLAN_PATH"]


def validate_candidate_has_measurements(candidate: BlueprintEstimateLineCandidate) -> list[str]:
    return [] if candidate.source_measurement_ids else ["MISSING_SOURCE_MEASUREMENT_IDS"]


def validate_candidate_trade_allowed(candidate: BlueprintEstimateLineCandidate) -> list[str]:
    blockers: list[str] = []
    if candidate.trade_id in MEASUREMENT_ONLY_TRADES:
        blockers.append("WINDOWS_DOORS_STANDALONE_TRADE")
    if candidate.trade_id in FUTURE_TRADES:
        blockers.append("FUTURE_SUPPORTED_TRADE")
    return blockers


def validate_candidate_catalog_gate(
    candidate: BlueprintEstimateLineCandidate,
    mode: CatalogHandoffMode,
    user_approved_custom_line: bool = False,
) -> list[str]:
    if candidate.catalog_resolution_status in ("matched", "manual_override"):
        return []
    if mode == "catalog_resolved_only":
        return ["CATALOG_UNRESOLVED_LIVE_HANDOFF"]
    if mode == "preview_only":
        return ["CATALOG_UNRESOLVED_LIVE_HANDOFF"]
    if mode == "user_approved_custom_lines" and not user_approved_custom_line:
        return ["CUSTOM_LINE_WITHOUT_USER_APPROVAL"]
    return []


def validate_candidate_review_gates(candidate: BlueprintEstimateLineCandidate) -> list[str]:
    blockers: list[str] = []
    if candidate.quantity is None:
        blockers.append("MISSING_QUANTITY")
    if not candidate.unit:
        blockers.append("MISSING_UNIT")
    return blockers


def summarize_candidate_provenance(candidate: BlueprintEstimateLineCandidate) -> dict[str, Any]:
    return {
        "source_document_ids": candidate.source_document_ids,
        "plan_path_ids": candidate.plan_path_ids,
        "source_measurement_ids": candidate.source_measurement_ids,
        "formula_key": candidate.formula_key,
        "draft_line_id": candidate.source_draft_line_id,
        "draft_line_type": candidate.source_draft_line_type,
        "template_binding_id": candidate.template_binding_id,
        "accepted_trade_id": candidate.accepted_trade_id,
    }


# ===========================================================================
# Phase 7.5 — Approval object + resolver + pricing contract (shape only).
# Pure helpers. Side-effect free. NOT registered or imported by worker runtime.
# ===========================================================================

ApprovalStatus = Literal[
    "approval_not_started",
    "approval_in_review",
    "approval_ready",
    "approved_for_live_handoff",
    "approval_revoked",
    "approval_superseded",
    "approval_failed",
]

CatalogResolverMatchStatus = Literal[
    "resolved",
    "unresolved",
    "ambiguous",
    "inactive_item",
    "missing_labor_rate",
    "blocked",
]

QuantityOnlySafetyStatus = Literal[
    "blocked_quantity_only_unsafe",
    "allowed_pricing_required",
    "deferred_pending_pricing_contract",
]


@dataclass
class ApprovalObject:
    contract_version: str
    approval_statement_version: str
    import_session_id: str
    handoff_batch_id: str
    catalog_mode: CatalogHandoffMode
    pricing_mode: PricingMode
    custom_line_mode: CustomLineMode
    approval_status: ApprovalStatus
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    target_enhanced_estimate_id: Optional[str] = None
    included_candidate_ids: list[str] = field(default_factory=list)
    excluded_candidate_ids: list[str] = field(default_factory=list)
    acknowledged_warning_ids: list[str] = field(default_factory=list)
    resolved_blocker_ids: list[str] = field(default_factory=list)
    source_draft_hash: Optional[str] = None
    approval_blockers: list[str] = field(default_factory=list)
    approval_warnings: list[str] = field(default_factory=list)
    deterministic_approval_hash: Optional[str] = None


def create_deterministic_approval_hash(
    *,
    contract_version: str,
    approval_statement_version: str,
    import_session_id: str,
    handoff_batch_id: str,
    target_enhanced_estimate_id: Optional[str],
    included_candidate_ids: list[str],
    excluded_candidate_ids: list[str],
    acknowledged_warning_ids: list[str],
    resolved_blocker_ids: list[str],
    catalog_mode: CatalogHandoffMode,
    pricing_mode: PricingMode,
    custom_line_mode: CustomLineMode,
    source_draft_hash: Optional[str],
) -> str:
    payload = ":".join([
        contract_version,
        approval_statement_version,
        import_session_id,
        handoff_batch_id,
        target_enhanced_estimate_id or "null",
        _sorted_uuid_list(included_candidate_ids),
        _sorted_uuid_list(excluded_candidate_ids),
        _sorted_uuid_list(acknowledged_warning_ids),
        _sorted_uuid_list(resolved_blocker_ids),
        catalog_mode,
        pricing_mode,
        custom_line_mode,
        source_draft_hash or "null",
    ])
    return _sha256(payload)


def validate_approval_object_shape(a: ApprovalObject) -> list[str]:
    blockers: list[str] = []
    if not a.included_candidate_ids:
        blockers.append("APPROVAL_MISSING_INCLUDED_CANDIDATES")
    if a.approval_blockers:
        blockers.append("APPROVAL_UNRESOLVED_BLOCKERS_REMAIN")
    if a.catalog_mode != "catalog_resolved_only" and a.custom_line_mode != "enabled":
        blockers.append("APPROVAL_CATALOG_MODE_REQUIRES_RESOLVER")
    if a.custom_line_mode == "enabled" and "CUSTOM_LINE_MODE_REVIEWED" not in a.resolved_blocker_ids:
        blockers.append("APPROVAL_CUSTOM_LINE_MODE_NOT_APPROVED")
    return blockers


def validate_target_status_for_live_write(status: str) -> dict[str, Any]:
    if status == "draft":
        return {"can_live_write": True, "blocker": None}
    if status == "sent":
        return {"can_live_write": False, "blocker": "TARGET_ESTIMATE_SENT"}
    if status == "signed":
        return {"can_live_write": False, "blocker": "TARGET_ESTIMATE_APPROVED"}
    return {"can_live_write": False, "blocker": "TARGET_ESTIMATE_STATUS_UNKNOWN"}


def validate_source_draft_hash_fresh(approval_hash: Optional[str], current_hash: Optional[str]) -> bool:
    return approval_hash is not None and approval_hash == current_hash


def decide_quantity_only_safety(mode: PricingMode) -> QuantityOnlySafetyStatus:
    # estimate_line_items unit_cost/extended_cost/total_price are NOT NULL
    # default 0 in the live schema; quantity-only writes would corrupt totals.
    if mode == "quantity_only":
        return "blocked_quantity_only_unsafe"
    if mode == "ready_for_pricing_review":
        return "allowed_pricing_required"
    return "deferred_pending_pricing_contract"


def validate_quantity_only_mode_allowed(mode: PricingMode) -> list[str]:
    if decide_quantity_only_safety(mode) == "blocked_quantity_only_unsafe":
        return ["PRICING_REQUIRED_BUT_UNAVAILABLE"]
    return []


@dataclass
class CatalogResolverOutput:
    resolver_version: str
    resolver_mode: Literal[
        "deterministic_catalog_only", "deterministic_with_user_confirmation"
    ]
    tenant_id: str
    source_candidate_id: str
    trade_id: str
    item_key: str
    candidate_type: SourceDraftLineType
    match_status: CatalogResolverMatchStatus
    match_confidence: float
    normalized_item_name: Optional[str] = None
    matched_catalog_table: Optional[str] = None
    matched_catalog_item_id: Optional[str] = None
    labor_rate_id: Optional[str] = None
    match_rule_id: Optional[str] = None
    blockers: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict)


def validate_catalog_resolver_output(o: CatalogResolverOutput) -> list[str]:
    blockers = list(o.blockers or [])

    def _add(code: str) -> None:
        if code not in blockers:
            blockers.append(code)

    if o.match_status == "ambiguous":
        _add("CATALOG_MATCH_AMBIGUOUS")
    if o.match_status == "inactive_item":
        _add("CATALOG_ITEM_INACTIVE")
    if o.match_status == "missing_labor_rate":
        _add("LABOR_RATE_MISSING")
    if o.match_status == "unresolved":
        _add("CATALOG_UNRESOLVED_LIVE_HANDOFF")
    if o.match_status == "resolved" and o.match_confidence < 0.9:
        _add("CATALOG_MATCH_AMBIGUOUS")
    return blockers
