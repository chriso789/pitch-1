"""PlanPath provenance contract twin (Phase 1)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional, TypedDict

PlanPathType = Literal[
    "report_page", "blueprint_sheet", "spec_section", "user_entry", "derived"
]


@dataclass
class BlueprintPlanPath:
    import_session_id: str
    path_type: PlanPathType
    confidence: float = 0.0
    source_document_id: Optional[str] = None
    file_name: Optional[str] = None
    document_type: Optional[str] = None
    provider: Optional[str] = None
    page_number: Optional[int] = None
    section_label: Optional[str] = None
    table_label: Optional[str] = None
    diagram_label: Optional[str] = None
    source_text_excerpt: Optional[str] = None
    source_coordinates: Optional[dict[str, Any]] = None
    id: Optional[str] = None


class PlanPathValidation(TypedDict, total=False):
    ok: bool
    reason: str


def validate_plan_path_present(plan_path: Optional[dict[str, Any] | BlueprintPlanPath]) -> PlanPathValidation:
    if plan_path is None:
        return {"ok": False, "reason": "plan_path is missing"}
    if isinstance(plan_path, BlueprintPlanPath):
        pp = plan_path.__dict__
    else:
        pp = plan_path
    if not pp.get("path_type"):
        return {"ok": False, "reason": "plan_path.path_type is required"}
    has_anchor = any(
        pp.get(k)
        for k in (
            "source_document_id",
            "file_name",
            "section_label",
            "table_label",
            "diagram_label",
            "source_text_excerpt",
        )
    ) or isinstance(pp.get("page_number"), int)
    if not has_anchor:
        return {
            "ok": False,
            "reason": "plan_path needs at least one anchor (source_document_id, page_number, section_label, table_label, diagram_label, source_text_excerpt, or file_name)",
        }
    confidence = pp.get("confidence")
    if isinstance(confidence, (int, float)) and (confidence < 0 or confidence > 1):
        return {"ok": False, "reason": "plan_path.confidence must be in [0,1]"}
    return {"ok": True}


def requires_plan_path(_trade_id: str) -> bool:
    return True
