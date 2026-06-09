"""Phase 3 deterministic document classifier — Python twin.

Mirrors supabase/functions/_shared/blueprint-importer/document-classifier.ts.
Pure function; side-effect free. NOT registered in skills_registry.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Literal

DocumentType = Literal[
    "roofr_roof_report",
    "eagleview_roof_report",
    "eagleview_wall_report",
    "blueprint_set",
    "spec_book",
    "unknown",
]

Provider = Literal["roofr", "eagleview", "user_uploaded_blueprint", "unknown"]


@dataclass
class DocumentClassification:
    document_type: DocumentType
    provider: Provider
    confidence: float
    signals: List[str] = field(default_factory=list)
    db_document_type: str = "unknown"
    db_provider: str = "unknown"


_EAGLEVIEW = re.compile(r"eagle[\s-]?view", re.IGNORECASE)
_ROOFR = re.compile(r"\broofr\b", re.IGNORECASE)
_ROOF = re.compile(r"\b(roof\s+report|total\s+roof\s+area|predominant\s+pitch|ridges?\s*\(ft\)|hips?\s*\(ft\))", re.IGNORECASE)
_WALL = re.compile(r"\b(wall\s+report|total\s+wall\s+area|wall\s+facets|inside\s+corners|outside\s+corners|window\s+&\s+door\s+area|fascia)", re.IGNORECASE)
_SPEC = re.compile(r"\b(specifications|spec\s+book|division\s+\d{2}|section\s+\d{6})", re.IGNORECASE)
_BLUEPRINT = re.compile(r"\b(sheet\s+(a|s|e|m|p)-?\d+|architectural\s+plans?|plan\s+set)", re.IGNORECASE)


def classify_blueprint_document(text: str) -> DocumentClassification:
    text = text or ""
    signals: List[str] = []
    ev = bool(_EAGLEVIEW.search(text))
    rf = bool(_ROOFR.search(text))
    roof = bool(_ROOF.search(text))
    wall = bool(_WALL.search(text))
    spec = bool(_SPEC.search(text))
    bp = bool(_BLUEPRINT.search(text))
    if ev: signals.append("brand:eagleview")
    if rf: signals.append("brand:roofr")
    if roof: signals.append("section:roof_report")
    if wall: signals.append("section:wall_report")
    if spec: signals.append("section:spec_book")
    if bp: signals.append("section:blueprint_set")

    if ev and wall and not roof:
        return DocumentClassification("eagleview_wall_report", "eagleview", 0.95, signals, "wall_report", "eagleview")
    if ev and roof:
        return DocumentClassification("eagleview_roof_report", "eagleview", 0.95, signals, "roof_report", "eagleview")
    if rf and roof:
        return DocumentClassification("roofr_roof_report", "roofr", 0.95, signals, "roof_report", "roofr")
    if bp:
        return DocumentClassification("blueprint_set", "user_uploaded_blueprint", 0.6, signals, "blueprint_set", "user_uploaded_blueprint")
    if roof and not wall:
        return DocumentClassification("eagleview_roof_report", "unknown", 0.55, signals, "roof_report", "unknown")
    if wall:
        return DocumentClassification("eagleview_wall_report", "unknown", 0.55, signals, "wall_report", "unknown")
    if spec:
        return DocumentClassification("spec_book", "user_uploaded_blueprint", 0.6, signals, "spec_book", "user_uploaded_blueprint")
    return DocumentClassification("unknown", "unknown", 0.0, signals, "unknown", "unknown")
