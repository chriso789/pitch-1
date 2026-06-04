"""Blueprint Importer v2 — Phase 7.6a catalog binding contracts (Python twin).

Pure type + helper module. Side-effect-free. No DB, no IO, no estimate writes.
Mirrors `supabase/functions/_shared/blueprint-importer/catalog-bindings.ts`.

NOT registered in skills_registry.py. NOT imported by worker/app/main.py.
No runtime resolver lives here.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal, Optional, TypedDict

from .trade_catalog import is_future_supported_trade, is_measurement_object_only_trade

# ---------------------------------------------------------------------------
# Enums (parity with TS)
# ---------------------------------------------------------------------------

BlueprintCatalogBindingScope = Literal[
    "tenant", "template", "trade", "global_fallback_disabled"
]
BlueprintCatalogBindingType = Literal["material", "labor", "accessory", "allowance"]
BlueprintCatalogSourceCandidateType = Literal["material", "labor"]
BlueprintCatalogTargetKind = Literal[
    "product_catalog",
    "supplier_catalog_item",
    "abc_catalog_item",
    "labor_rate",
    "custom_line_disabled",
    "unresolved",
]
BlueprintCatalogTargetTable = Literal[
    "product_catalog", "supplier_catalog_items", "abc_catalog_items", "labor_rates"
]
BlueprintCatalogBindingStatus = Literal[
    "draft", "active", "inactive", "superseded", "blocked", "needs_review"
]
BlueprintCatalogPricingSourceType = Literal[
    "catalog_cost", "labor_rate", "manual_approved", "unresolved", "disabled"
]
BlueprintCatalogCostSourceType = Literal[
    "catalog", "labor_rate", "fixed", "unresolved", "disabled"
]
BlueprintCatalogBindingEventType = Literal[
    "created", "status_changed", "target_changed", "pricing_changed",
    "approved", "superseded", "deactivated", "reactivated", "blocked", "note",
]

BlueprintResolverV2Status = Literal[
    "resolved", "unresolved", "ambiguous", "inactive_binding", "inactive_target",
    "unit_mismatch", "tenant_scope_mismatch", "missing_labor_rate", "blocked",
]
BlueprintResolverV2BlockerCode = Literal[
    "BLUEPRINT_CATALOG_BINDING_MISSING",
    "BLUEPRINT_CATALOG_BINDING_AMBIGUOUS",
    "BLUEPRINT_CATALOG_BINDING_INACTIVE",
    "BLUEPRINT_CATALOG_TARGET_INACTIVE",
    "BLUEPRINT_CATALOG_UNIT_MISMATCH",
    "BLUEPRINT_LABOR_RATE_MISSING",
    "BLUEPRINT_LABOR_RATE_INACTIVE",
    "TENANT_COMPANY_SCOPE_UNRESOLVED",
    "CATALOG_UNRESOLVED_LIVE_HANDOFF",
    "CUSTOM_LINE_MODE_NOT_APPROVED",
]
BlueprintResolverV2WarningCode = Literal[
    "BLUEPRINT_CATALOG_BINDING_NEEDS_REVIEW",
    "BLUEPRINT_CATALOG_BINDING_LOW_CONFIDENCE",
    "BLUEPRINT_CATALOG_BINDING_EFFECTIVE_DATE_NEAR_EXPIRY",
    "BLUEPRINT_CATALOG_TARGET_UNIT_REQUIRES_CONVERSION",
]

# Public constants for runtime parity tests:
BINDING_SCOPES = ("tenant", "template", "trade", "global_fallback_disabled")
BINDING_TYPES = ("material", "labor", "accessory", "allowance")
SOURCE_CANDIDATE_TYPES = ("material", "labor")
TARGET_KINDS = (
    "product_catalog", "supplier_catalog_item", "abc_catalog_item",
    "labor_rate", "custom_line_disabled", "unresolved",
)
TARGET_TABLES = (
    "product_catalog", "supplier_catalog_items", "abc_catalog_items", "labor_rates",
)
BINDING_STATUSES = ("draft", "active", "inactive", "superseded", "blocked", "needs_review")
PRICING_SOURCE_TYPES = ("catalog_cost", "labor_rate", "manual_approved", "unresolved", "disabled")
COST_SOURCE_TYPES = ("catalog", "labor_rate", "fixed", "unresolved", "disabled")
EVENT_TYPES = (
    "created", "status_changed", "target_changed", "pricing_changed",
    "approved", "superseded", "deactivated", "reactivated", "blocked", "note",
)
RESOLVER_V2_STATUSES = (
    "resolved", "unresolved", "ambiguous", "inactive_binding", "inactive_target",
    "unit_mismatch", "tenant_scope_mismatch", "missing_labor_rate", "blocked",
)
RESOLVER_V2_BLOCKER_CODES = (
    "BLUEPRINT_CATALOG_BINDING_MISSING",
    "BLUEPRINT_CATALOG_BINDING_AMBIGUOUS",
    "BLUEPRINT_CATALOG_BINDING_INACTIVE",
    "BLUEPRINT_CATALOG_TARGET_INACTIVE",
    "BLUEPRINT_CATALOG_UNIT_MISMATCH",
    "BLUEPRINT_LABOR_RATE_MISSING",
    "BLUEPRINT_LABOR_RATE_INACTIVE",
    "TENANT_COMPANY_SCOPE_UNRESOLVED",
    "CATALOG_UNRESOLVED_LIVE_HANDOFF",
    "CUSTOM_LINE_MODE_NOT_APPROVED",
)

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


@dataclass
class BlueprintCatalogBinding:
    id: str
    tenant_id: str
    binding_scope: str
    binding_type: str
    trade_id: str
    source_candidate_type: str
    source_item_key: str
    source_unit: str
    target_kind: str
    deterministic_binding_key: str
    source_item_name: Optional[str] = None
    source_template_key: Optional[str] = None
    source_template_version: Optional[str] = None
    source_formula_key: Optional[str] = None
    target_table: Optional[str] = None
    target_item_id: Optional[str] = None
    target_abc_item_number: Optional[str] = None
    target_unit: Optional[str] = None
    unit_conversion_rule: dict = field(default_factory=dict)
    pricing_source_type: str = "unresolved"
    cost_source_type: str = "unresolved"
    unit_cost: Optional[float] = None
    labor_rate_id: Optional[str] = None
    markup_rule_id: Optional[str] = None
    tax_rule_id: Optional[str] = None
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    status: str = "draft"
    resolver_priority: int = 100
    match_confidence: float = 1.0
    requires_user_confirmation: bool = False
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    metadata: dict = field(default_factory=dict)


class ValidationResult(TypedDict):
    ok: bool
    errors: list[str]


def create_deterministic_binding_key(
    *,
    tenant_id: str,
    trade_id: str,
    source_candidate_type: str,
    source_item_key: str,
    source_unit: str,
    target_kind: str,
    source_template_key: Optional[str] = None,
    source_template_version: Optional[str] = None,
    target_table: Optional[str] = None,
    target_item_id: Optional[str] = None,
    target_abc_item_number: Optional[str] = None,
    target_unit: Optional[str] = None,
) -> str:
    parts = [
        "bpcb",
        tenant_id,
        trade_id,
        source_candidate_type,
        source_item_key,
        source_template_key or "-",
        source_template_version or "-",
        source_unit,
        target_kind,
        target_table or "-",
        target_item_id or "-",
        target_abc_item_number or "-",
        target_unit or "-",
    ]
    return "|".join(parts)


def validate_binding_shape(b: dict) -> ValidationResult:
    errors: list[str] = []
    if not b.get("tenant_id") or not UUID_RE.match(b["tenant_id"]):
        errors.append("tenant_id_required_uuid")
    if not b.get("trade_id"):
        errors.append("trade_id_required")
    if not b.get("source_item_key"):
        errors.append("source_item_key_required")
    if not b.get("source_candidate_type"):
        errors.append("source_candidate_type_required")
    if not b.get("source_unit"):
        errors.append("source_unit_required")
    if not b.get("target_kind"):
        errors.append("target_kind_required")
    if not b.get("deterministic_binding_key"):
        errors.append("deterministic_binding_key_required")
    mc = b.get("match_confidence")
    if mc is not None and (mc < 0 or mc > 1):
        errors.append("match_confidence_out_of_range")
    if b.get("trade_id") == "windows_doors":
        errors.append("windows_doors_cannot_be_standalone_binding")
    return {"ok": not errors, "errors": errors}


def validate_binding_tenant_scope(b: dict, resolved_tenant_id: str) -> ValidationResult:
    if not resolved_tenant_id or not UUID_RE.match(resolved_tenant_id):
        return {"ok": False, "errors": ["resolved_tenant_id_invalid"]}
    if b.get("tenant_id") != resolved_tenant_id:
        return {"ok": False, "errors": ["tenant_scope_mismatch"]}
    return {"ok": True, "errors": []}


def validate_binding_trade_allowed(b: dict) -> ValidationResult:
    errors: list[str] = []
    trade = b.get("trade_id")
    if trade == "windows_doors" or is_measurement_object_only_trade(trade or ""):
        errors.append("trade_is_measurement_object_only")
    if is_future_supported_trade(trade or "") and b.get("status") == "active":
        errors.append("future_supported_trade_cannot_be_active_binding")
    return {"ok": not errors, "errors": errors}


def validate_binding_unit_compatibility(b: dict) -> ValidationResult:
    if not b.get("target_unit"):
        return {"ok": True, "errors": []}
    if b.get("source_unit") == b.get("target_unit"):
        return {"ok": True, "errors": []}
    rule = b.get("unit_conversion_rule") or {}
    if not rule:
        return {"ok": False, "errors": ["unit_mismatch_no_conversion_rule"]}
    return {"ok": True, "errors": []}


def validate_binding_active_for_resolver(b: dict) -> ValidationResult:
    errors: list[str] = []
    if b.get("status") != "active":
        errors.append("binding_not_active")
    if b.get("target_kind") == "unresolved":
        errors.append("target_kind_unresolved")
    if b.get("target_kind") == "custom_line_disabled":
        errors.append("custom_line_disabled_target")
    if b.get("source_candidate_type") == "material":
        if (
            b.get("target_kind") not in ("abc_catalog_item", "custom_line_disabled", "unresolved")
            and not b.get("target_item_id")
        ):
            errors.append("material_binding_requires_target_item_id")
        if b.get("target_kind") == "abc_catalog_item" and not b.get("target_abc_item_number"):
            errors.append("abc_binding_requires_target_abc_item_number")
    if b.get("source_candidate_type") == "labor" and not b.get("labor_rate_id"):
        errors.append("labor_binding_requires_labor_rate_id")
    if b.get("pricing_source_type") == "unresolved":
        errors.append("pricing_source_unresolved")
    if b.get("cost_source_type") == "unresolved":
        errors.append("cost_source_unresolved")
    return {"ok": not errors, "errors": errors}


def summarize_binding_target(b: dict) -> str:
    tk = b.get("target_kind")
    if tk == "unresolved":
        return "unresolved"
    if tk == "custom_line_disabled":
        return "custom_line_disabled"
    if tk == "abc_catalog_item":
        return f"abc:{b.get('target_abc_item_number') or '?'}"
    if tk == "labor_rate":
        return f"labor_rate:{b.get('labor_rate_id') or '?'}"
    return f"{tk}:{b.get('target_item_id') or '?'}"


def assert_binding_can_resolve_candidate(binding: dict, candidate: dict) -> dict:
    blockers: list[str] = []
    if binding.get("tenant_id") != candidate.get("tenant_id"):
        blockers.append("TENANT_COMPANY_SCOPE_UNRESOLVED")
    if binding.get("trade_id") != candidate.get("trade_id"):
        blockers.append("BLUEPRINT_CATALOG_BINDING_MISSING")
    if binding.get("source_item_key") != candidate.get("source_item_key"):
        blockers.append("BLUEPRINT_CATALOG_BINDING_MISSING")
    if binding.get("source_candidate_type") != candidate.get("source_candidate_type"):
        blockers.append("BLUEPRINT_CATALOG_BINDING_MISSING")
    if (
        candidate.get("source_template_key")
        and binding.get("source_template_key")
        and binding["source_template_key"] != candidate["source_template_key"]
    ):
        blockers.append("BLUEPRINT_CATALOG_BINDING_MISSING")
    if not validate_binding_active_for_resolver(binding)["ok"]:
        blockers.append("BLUEPRINT_CATALOG_BINDING_INACTIVE")
    if not validate_binding_unit_compatibility(
        {
            "source_unit": candidate.get("source_unit"),
            "target_unit": binding.get("target_unit"),
            "unit_conversion_rule": binding.get("unit_conversion_rule") or {},
        }
    )["ok"]:
        blockers.append("BLUEPRINT_CATALOG_UNIT_MISMATCH")
    if candidate.get("source_candidate_type") == "labor" and not binding.get("labor_rate_id"):
        blockers.append("BLUEPRINT_LABOR_RATE_MISSING")
    # de-dupe, preserve order
    seen, out = set(), []
    for b in blockers:
        if b not in seen:
            seen.add(b)
            out.append(b)
    return {"ok": not out, "blockers": out}
