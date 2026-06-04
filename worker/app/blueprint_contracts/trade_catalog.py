"""Trade catalog contract (Python twin). Side-effect free.

Source of truth: docs/blueprint-trade-catalog.md
"""
from __future__ import annotations

from typing import Iterable, Literal, Optional, TypedDict

TradeSupportStatus = Literal[
    "mvp_supported", "measurement_object_only", "future_supported", "unsupported"
]

MVP_SUPPORTED_TRADES: tuple[str, ...] = (
    "roofing",
    "exterior_walls_siding",
    "paint_coatings",
    "gutters_fascia_trim",
)
MEASUREMENT_OBJECT_ONLY_TRADES: tuple[str, ...] = ("windows_doors",)
FUTURE_SUPPORTED_TRADES: tuple[str, ...] = (
    "drywall",
    "framing",
    "insulation",
    "flooring",
    "concrete",
    "electrical",
    "plumbing",
    "hvac",
)
UNSUPPORTED_TRADES: tuple[str, ...] = ()

TRADE_SUPPORT_MAP: dict[str, TradeSupportStatus] = {
    "roofing": "mvp_supported",
    "exterior_walls_siding": "mvp_supported",
    "paint_coatings": "mvp_supported",
    "gutters_fascia_trim": "mvp_supported",
    "windows_doors": "measurement_object_only",
    "drywall": "future_supported",
    "framing": "future_supported",
    "insulation": "future_supported",
    "flooring": "future_supported",
    "concrete": "future_supported",
    "electrical": "future_supported",
    "plumbing": "future_supported",
    "hvac": "future_supported",
}


class AcceptTradeResult(TypedDict, total=False):
    ok: bool
    reason: str
    flag_code: str


def validate_trade_support_status(value: str) -> bool:
    return value in {
        "mvp_supported",
        "measurement_object_only",
        "future_supported",
        "unsupported",
    }


def _status(trade_id: str) -> Optional[TradeSupportStatus]:
    return TRADE_SUPPORT_MAP.get(trade_id)


def is_mvp_supported_trade(trade_id: str) -> bool:
    return _status(trade_id) == "mvp_supported"


def is_measurement_object_only_trade(trade_id: str) -> bool:
    return _status(trade_id) == "measurement_object_only"


def is_future_supported_trade(trade_id: str) -> bool:
    return _status(trade_id) == "future_supported"


def assert_can_accept_trade_for_mvp(
    trade_id: str,
    accepted_trade_ids_in_session: Iterable[str],
    review_state: Optional[str] = None,
) -> AcceptTradeResult:
    status = _status(trade_id)
    accepted = set(accepted_trade_ids_in_session)

    if status == "measurement_object_only":
        return {
            "ok": False,
            "reason": "windows_doors is measurement-object-only and cannot be a top-level accepted trade",
            "flag_code": "windows_doors_selected_as_trade",
        }
    if status == "unsupported" or status is None:
        return {
            "ok": False,
            "reason": "trade is unsupported",
            "flag_code": "unsupported_trade_for_mvp",
        }
    if status == "future_supported":
        if review_state != "manual_only":
            return {
                "ok": False,
                "reason": "future_supported trades require manual_only review_state during MVP",
                "flag_code": "future_trade_requires_sheet_intelligence",
            }
        return {"ok": True}
    if trade_id == "paint_coatings" and "exterior_walls_siding" not in accepted:
        return {
            "ok": False,
            "reason": "paint_coatings is derived from exterior_walls_siding and cannot stand alone",
            "flag_code": "paint_without_wall_source",
        }
    return {"ok": True}
