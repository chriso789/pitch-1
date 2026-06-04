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
]
