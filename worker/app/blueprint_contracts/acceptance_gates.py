"""Phase 3 runtime acceptance gates — Python twin.

Mirrors supabase/functions/_shared/blueprint-importer/acceptance-gates.ts.
Pure function; NOT registered in skills_registry.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Literal, Optional

from .trade_catalog import TRADE_SUPPORT_MAP

ReviewState = Literal["pending_review", "blocked", "cleared", "manual_only"]


@dataclass
class AcceptanceContext:
    trade_id: str
    already_accepted_trade_ids: List[str]
    detected_support_status: Optional[str]
    has_exterior_walls_siding_source: bool
    has_plan_paths_for_trade: bool
    requested_review_state: Optional[ReviewState] = None


@dataclass
class Verdict:
    ok: bool
    review_state: Optional[ReviewState] = None
    flag_code: Optional[str] = None
    reason: Optional[str] = None
    http_status: Optional[int] = None


FLAG_UNSUPPORTED = "unsupported_trade_for_mvp"
FLAG_WD = "windows_doors_selected_as_trade"
FLAG_FUTURE = "future_trade_requires_sheet_intelligence"
FLAG_PAINT = "paint_without_wall_source"
FLAG_PP = "missing_plan_path"


def evaluate_trade_acceptance(ctx: AcceptanceContext) -> Verdict:
    support = TRADE_SUPPORT_MAP.get(ctx.trade_id)
    if support is None:
        return Verdict(False, flag_code=FLAG_UNSUPPORTED, reason=f"trade '{ctx.trade_id}' not in catalog", http_status=400)
    if support == "measurement_object_only":
        return Verdict(False, flag_code=FLAG_WD, reason="windows_doors cannot be a top-level accepted trade", http_status=422)
    if support == "unsupported":
        return Verdict(False, flag_code=FLAG_UNSUPPORTED, reason="trade is unsupported", http_status=422)
    if support == "future_supported":
        if ctx.requested_review_state != "manual_only":
            return Verdict(False, flag_code=FLAG_FUTURE, reason="future_supported trades require manual_only", http_status=422)
        return Verdict(True, review_state="manual_only")
    if ctx.trade_id == "paint_coatings":
        if not ctx.has_exterior_walls_siding_source and "exterior_walls_siding" not in ctx.already_accepted_trade_ids:
            return Verdict(False, flag_code=FLAG_PAINT, reason="paint_coatings requires exterior_walls_siding source", http_status=422)
    if not ctx.has_plan_paths_for_trade:
        return Verdict(False, flag_code=FLAG_PP, reason="no measurement objects with PlanPath for this trade", http_status=422)
    return Verdict(True, review_state="pending_review")
