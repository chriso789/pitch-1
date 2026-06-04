"""Blueprint Importer v2 — Phase 1 Python contract twins.

These modules are pure type/enum/helper contracts. They MUST NOT be:
  * registered in ``skills_registry.py``
  * imported by ``main.py`` as route handlers
  * used to perform extraction, scraping, DB calls, or estimate generation

Keep parity with ``supabase/functions/_shared/blueprint-importer/*``.
"""

from .trade_catalog import (
    TradeSupportStatus,
    MVP_SUPPORTED_TRADES,
    MEASUREMENT_OBJECT_ONLY_TRADES,
    FUTURE_SUPPORTED_TRADES,
    UNSUPPORTED_TRADES,
    TRADE_SUPPORT_MAP,
    validate_trade_support_status,
    is_mvp_supported_trade,
    is_measurement_object_only_trade,
    is_future_supported_trade,
    assert_can_accept_trade_for_mvp,
)
from .plan_path import (
    PlanPathType,
    BlueprintPlanPath,
    validate_plan_path_present,
    requires_plan_path,
)
from .review_flags import (
    ReviewFlagSeverity,
    BLOCKING_FLAG_CODES,
    BlueprintReviewFlag,
    create_review_flag,
)
# Phase 3 additions — pure contracts, NOT registered in skills_registry.
from .document_classifier import (
    DocumentClassification,
    classify_blueprint_document,
)
from .acceptance_gates import (
    AcceptanceContext,
    Verdict,
    evaluate_trade_acceptance,
)
# Phase 7.6a — catalog binding contracts (pure twins; NOT registered).
from .catalog_bindings import (
    BlueprintCatalogBinding,
    create_deterministic_binding_key,
    validate_binding_shape,
    validate_binding_tenant_scope,
    validate_binding_trade_allowed,
    validate_binding_unit_compatibility,
    validate_binding_active_for_resolver,
    summarize_binding_target,
    assert_binding_can_resolve_candidate,
)
# Phase 5.5 — CRM handoff contracts (pure twins; NOT registered in skills_registry).
from .crm_handoff import (
    CANONICAL_ESTIMATE_TARGET,
    BlueprintEstimateHandoffBatch,
    BlueprintEstimateLineCandidate,
    BlueprintEstimateLineProvenance,
    create_deterministic_batch_key,
    create_deterministic_handoff_key,
    validate_candidate_has_plan_path,
    validate_candidate_has_measurements,
    validate_candidate_trade_allowed,
    validate_candidate_catalog_gate,
    validate_candidate_review_gates,
    summarize_candidate_provenance,
)


__all__ = [
    "TradeSupportStatus",
    "MVP_SUPPORTED_TRADES",
    "MEASUREMENT_OBJECT_ONLY_TRADES",
    "FUTURE_SUPPORTED_TRADES",
    "UNSUPPORTED_TRADES",
    "TRADE_SUPPORT_MAP",
    "validate_trade_support_status",
    "is_mvp_supported_trade",
    "is_measurement_object_only_trade",
    "is_future_supported_trade",
    "assert_can_accept_trade_for_mvp",
    "PlanPathType",
    "BlueprintPlanPath",
    "validate_plan_path_present",
    "requires_plan_path",
    "ReviewFlagSeverity",
    "BLOCKING_FLAG_CODES",
    "BlueprintReviewFlag",
    "create_review_flag",
    "DocumentClassification",
    "classify_blueprint_document",
    "AcceptanceContext",
    "Verdict",
    "evaluate_trade_acceptance",
    "CANONICAL_ESTIMATE_TARGET",
    "BlueprintEstimateHandoffBatch",
    "BlueprintEstimateLineCandidate",
    "BlueprintEstimateLineProvenance",
    "create_deterministic_batch_key",
    "create_deterministic_handoff_key",
    "validate_candidate_has_plan_path",
    "validate_candidate_has_measurements",
    "validate_candidate_trade_allowed",
    "validate_candidate_catalog_gate",
    "validate_candidate_review_gates",
    "summarize_candidate_provenance",
]
