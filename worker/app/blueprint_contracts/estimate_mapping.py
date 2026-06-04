"""Estimate mapping contract twins (Phase 1). Side-effect free."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

ImportSessionStatus = Literal[
    "draft",
    "parsed",
    "trades_detected",
    "user_review_required",
    "accepted",
    "rejected",
    "superseded",
    "failed",
]

SourceContextType = Literal[
    "project", "opportunity", "lead", "estimate", "contact", "standalone"
]

DocumentType = Literal[
    "roof_report", "wall_report", "blueprint_set", "spec_book", "addendum", "unknown"
]

SourceProvider = Literal[
    "roofr", "eagleview", "internal_geometry", "user_uploaded_blueprint", "unknown"
]


@dataclass
class BlueprintImportSession:
    tenant_id: str
    source_context_type: SourceContextType
    status: ImportSessionStatus = "draft"
    contract_version: str = "blueprint-importer-v2"
    source_context_id: Optional[str] = None
    deterministic_hash: Optional[str] = None
    notes: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_by: Optional[str] = None
    id: Optional[str] = None


@dataclass
class BlueprintSourceDocument:
    import_session_id: str
    tenant_id: str
    document_type: DocumentType
    provider: SourceProvider
    extraction_status: Literal[
        "pending", "in_progress", "succeeded", "failed", "skipped"
    ] = "pending"
    file_id: Optional[str] = None
    storage_path: Optional[str] = None
    document_reference: Optional[str] = None
    original_filename: Optional[str] = None
    page_count: Optional[int] = None
    report_date: Optional[str] = None
    property_address: Optional[str] = None
    property_latitude: Optional[float] = None
    property_longitude: Optional[float] = None
    content_hash: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)
    id: Optional[str] = None


@dataclass
class BlueprintDetectedTrade:
    import_session_id: str
    tenant_id: str
    trade_id: str
    support_status: str
    confidence: float = 0.0
    detection_signals: dict[str, Any] = field(default_factory=dict)
    source_document_ids: list[str] = field(default_factory=list)
    status: Literal["detected", "dismissed", "superseded", "promoted"] = "detected"
    id: Optional[str] = None


@dataclass
class BlueprintAcceptedTrade:
    import_session_id: str
    tenant_id: str
    trade_id: str
    review_state: Literal["pending_review", "blocked", "cleared", "manual_only"] = "pending_review"
    status: Literal["accepted", "rejected", "superseded"] = "accepted"
    detected_trade_id: Optional[str] = None
    accepted_by: Optional[str] = None
    accepted_at: Optional[str] = None
    selected_template_id: Optional[str] = None
    user_assumptions: dict[str, Any] = field(default_factory=dict)
    id: Optional[str] = None


@dataclass
class BlueprintTemplateBinding:
    import_session_id: str
    tenant_id: str
    accepted_trade_id: str
    trade_id: str
    binding_status: Literal["pending", "ready", "blocked", "rejected", "superseded"] = "pending"
    required_inputs: dict[str, Any] = field(default_factory=dict)
    optional_inputs: dict[str, Any] = field(default_factory=dict)
    missing_inputs: list[str] = field(default_factory=list)
    user_assumptions: dict[str, Any] = field(default_factory=dict)
    template_id: Optional[str] = None
    template_version: Optional[str] = None
    id: Optional[str] = None


@dataclass
class BlueprintMaterialDraftLine:
    """Schema-only twin; NOT populated in Phase 1."""
    import_session_id: str
    tenant_id: str
    accepted_trade_id: str
    item_key: str
    source_measurement_ids: list[str] = field(default_factory=list)
    plan_path_ids: list[str] = field(default_factory=list)
    template_binding_id: Optional[str] = None
    material_rule_id: Optional[str] = None
    item_name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    rounding_rule: Optional[str] = None
    waste_percent: Optional[float] = None
    formula_key: Optional[str] = None
    formula_inputs: dict[str, Any] = field(default_factory=dict)
    catalog_resolution_status: Literal[
        "unresolved", "matched", "ambiguous", "missing", "manual_override"
    ] = "unresolved"
    catalog_item_id: Optional[str] = None
    status: Literal["draft", "ready", "blocked", "rejected", "superseded"] = "draft"
    id: Optional[str] = None


@dataclass
class BlueprintLaborDraftLine:
    """Schema-only twin; NOT populated in Phase 1."""
    import_session_id: str
    tenant_id: str
    accepted_trade_id: str
    labor_key: str
    source_measurement_ids: list[str] = field(default_factory=list)
    plan_path_ids: list[str] = field(default_factory=list)
    template_binding_id: Optional[str] = None
    labor_rule_id: Optional[str] = None
    labor_name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    base_rate: Optional[float] = None
    complexity_multiplier: Optional[float] = None
    formula_key: Optional[str] = None
    formula_inputs: dict[str, Any] = field(default_factory=dict)
    status: Literal["draft", "ready", "blocked", "rejected", "superseded"] = "draft"
    id: Optional[str] = None
