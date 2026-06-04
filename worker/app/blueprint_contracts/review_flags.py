"""Review flag contract twin (Phase 1)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

ReviewFlagSeverity = Literal["info", "warning", "error", "blocker"]

ReviewFlagRelatedEntityType = Literal[
    "import_session",
    "source_document",
    "detected_trade",
    "accepted_trade",
    "measurement_object",
    "template_binding",
    "material_draft_line",
    "labor_draft_line",
    "plan_path",
]

BLOCKING_FLAG_CODES: frozenset[str] = frozenset(
    {
        "missing_required_measurement",
        "unsupported_trade_for_mvp",
        "paint_without_wall_source",
        "windows_doors_selected_as_trade",
        "missing_plan_path",
        "future_trade_requires_sheet_intelligence",
        "formula_input_missing",
        "template_required_assumption_missing",
    }
)


@dataclass
class BlueprintReviewFlag:
    import_session_id: str
    related_entity_type: ReviewFlagRelatedEntityType
    flag_code: str
    message: str
    severity: ReviewFlagSeverity = "warning"
    blocking: bool = False
    related_entity_id: Optional[str] = None
    resolved: bool = False
    resolved_by: Optional[str] = None
    resolved_at: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)
    id: Optional[str] = None


def create_review_flag(
    *,
    import_session_id: str,
    related_entity_type: ReviewFlagRelatedEntityType,
    flag_code: str,
    message: str,
    related_entity_id: Optional[str] = None,
    severity: Optional[ReviewFlagSeverity] = None,
    blocking: Optional[bool] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> BlueprintReviewFlag:
    inferred_blocking = blocking if blocking is not None else flag_code in BLOCKING_FLAG_CODES
    inferred_severity: ReviewFlagSeverity = severity if severity is not None else (
        "blocker" if inferred_blocking else "warning"
    )
    return BlueprintReviewFlag(
        import_session_id=import_session_id,
        related_entity_type=related_entity_type,
        flag_code=flag_code,
        message=message,
        severity=inferred_severity,
        blocking=inferred_blocking,
        related_entity_id=related_entity_id,
        metadata=metadata or {},
    )
