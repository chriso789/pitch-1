"""Measurement Artifact Envelope — Python contract twin.

Phase 2 contract layer. Defines dataclasses, enums, and lightweight helpers
for the canonical measurement-pipeline artifact envelope.

This module is NOT a skill. It must not be routed by FastAPI and must not
appear in `worker/app/skills_registry.py`. It exists so future phases can
construct envelopes from worker skills without re-declaring the contract.

Authoritative spec:  docs/measurement-artifact-envelope.md
JSON schema:         docs/schemas/measurement-artifact-envelope.schema.json
TypeScript twin:     supabase/functions/_shared/mskill/artifact-envelope.ts
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Literal, Optional

SCHEMA_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Enums (string literals — matches worker/app/schemas.py Literal style)
# ---------------------------------------------------------------------------

ARTIFACT_TYPES = (
    "source_surface_data", "dsm", "dtm", "chm",
    "roof_points", "roof_mask", "roof_perimeter", "roof_planes",
    "ridge_segments", "hip_segments", "valley_segments",
    "eave_segments", "rake_segments",
    "pitch_measurements", "roof_area_measurements",
    "geometry_quality_score",
    "geojson_export", "report_export",
)

ARTIFACT_STAGES = (
    "ingest", "generate_dsm", "generate_dtm", "generate_chm",
    "isolate_roof_points", "refine_roof_perimeter", "fit_roof_planes",
    "detect_ridges", "detect_hips", "detect_valleys",
    "detect_eaves", "detect_rakes",
    "calculate_pitch", "calculate_roof_area", "geometry_quality_score",
    "validate_geometry", "export_geojson", "export_report",
)

ARTIFACT_STATUSES = (
    "created", "partial", "complete",
    "validation_pending", "validated", "rejected",
    "exportable", "reportable", "failed",
)

COORDINATE_FRAME_TYPES = (
    "source", "project_metric", "raster_grid", "export_geojson", "report_display",
)
COORDINATE_FRAME_STATUSES = ("complete", "partial", "unknown")
VALIDATION_STATUSES = ("pending", "passed", "failed", "skipped")
ISSUE_SEVERITIES = ("info", "warning", "error", "blocker")
PRODUCER_KINDS = ("worker", "control_plane", "external")

ArtifactType = Literal[
    "source_surface_data", "dsm", "dtm", "chm",
    "roof_points", "roof_mask", "roof_perimeter", "roof_planes",
    "ridge_segments", "hip_segments", "valley_segments",
    "eave_segments", "rake_segments",
    "pitch_measurements", "roof_area_measurements",
    "geometry_quality_score",
    "geojson_export", "report_export",
]
ArtifactStage = Literal[
    "ingest", "generate_dsm", "generate_dtm", "generate_chm",
    "isolate_roof_points", "refine_roof_perimeter", "fit_roof_planes",
    "detect_ridges", "detect_hips", "detect_valleys",
    "detect_eaves", "detect_rakes",
    "calculate_pitch", "calculate_roof_area", "geometry_quality_score",
    "validate_geometry", "export_geojson", "export_report",
]
ArtifactStatus = Literal[
    "created", "partial", "complete",
    "validation_pending", "validated", "rejected",
    "exportable", "reportable", "failed",
]

DEFAULT_UNITS: dict[str, str] = {
    "horizontal_distance": "m",
    "vertical_distance": "m",
    "area": "m^2",
    "slope": "deg",
    "pitch": "rise_per_12",
    "angle": "deg",
    "raster_resolution": "m_per_px",
    "confidence": "ratio_0_1",
    "quality_score": "ratio_0_1",
}


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class Producer:
    kind: str  # PRODUCER_KINDS
    name: str
    version: str


@dataclass
class CoordinateFrame:
    frame_id: str = "unknown"
    frame_type: str = "project_metric"
    crs: Optional[str] = None
    origin: Optional[list[float]] = None
    axis_orientation: Optional[str] = None
    units: str = "m"
    has_z: bool = False
    z_convention: Optional[str] = None
    transform_to_source: Optional[dict[str, Any]] = None
    transform_to_local: Optional[dict[str, Any]] = None
    transform_to_raster: Optional[dict[str, Any]] = None
    transform_to_export: Optional[dict[str, Any]] = None
    precision: Optional[dict[str, float]] = None
    status: str = "unknown"  # COORDINATE_FRAME_STATUSES


@dataclass
class GeometryBlock:
    geometry_type: str = "none"
    coordinate_frame: str = "unknown"
    dimensions: Optional[dict[str, Any]] = None
    bbox: Optional[list[float]] = None
    value: Any = None
    storage_ref: Optional[str] = None
    precision: Optional[dict[str, float]] = None
    no_data_policy: Optional[dict[str, Any]] = None


@dataclass
class QualityBlock:
    overall_score: float = 0.0
    confidence: float = 0.0
    component_scores: dict[str, float] = field(default_factory=dict)
    completeness: float = 0.0
    coordinate_integrity: float = 0.0
    geometry_validity: float = 0.0
    plane_fit_quality: float = 0.0
    segment_consistency: float = 0.0
    warnings_count: int = 0
    blockers_count: int = 0


@dataclass
class ArtifactIssue:
    severity: str  # ISSUE_SEVERITIES
    code: str
    message: str
    blocking: bool = False
    object_type: Optional[str] = None
    object_id: Optional[str] = None
    source_skill: Optional[str] = None
    suggested_fix: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ValidationBlock:
    validation_status: str = "pending"  # VALIDATION_STATUSES
    validated_at: Optional[str] = None
    validator_version: Optional[str] = None
    errors: list[ArtifactIssue] = field(default_factory=list)
    warnings: list[ArtifactIssue] = field(default_factory=list)
    blockers: list[ArtifactIssue] = field(default_factory=list)
    export_allowed: bool = False
    report_allowed: bool = False


@dataclass
class LineageBlock:
    input_artifact_ids: list[str] = field(default_factory=list)
    source_files: list[str] = field(default_factory=list)
    source_job_id: Optional[str] = None
    parameters: dict[str, Any] = field(default_factory=dict)
    skill_version: str = "0.0.0"
    code_version: Optional[str] = None
    runtime: Optional[dict[str, str]] = None
    created_by: str = "worker"  # PRODUCER_KINDS
    dependencies: list[str] = field(default_factory=list)


@dataclass
class StorageBlock:
    storage_type: str = "inline"
    uri: Optional[str] = None
    bucket: Optional[str] = None
    path: Optional[str] = None
    mime_type: Optional[str] = None
    checksum: Optional[dict[str, str]] = None
    byte_size: Optional[int] = None
    compression: Optional[str] = "none"
    encoding: Optional[str] = "utf-8"


@dataclass
class DisplayBlock:
    display_units: dict[str, str] = field(default_factory=dict)
    rounding_rules: dict[str, int] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    report_visibility: Optional[str] = None
    map_visibility: Optional[str] = None


@dataclass
class MeasurementArtifactEnvelope:
    job_id: str
    artifact_type: str
    stage: str
    source_skill: str
    producer: Producer
    coordinate_frame: CoordinateFrame
    units: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_UNITS))
    geometry: GeometryBlock = field(default_factory=GeometryBlock)
    data: dict[str, Any] = field(default_factory=dict)
    quality: QualityBlock = field(default_factory=QualityBlock)
    validation: ValidationBlock = field(default_factory=ValidationBlock)
    lineage: LineageBlock = field(default_factory=LineageBlock)
    warnings: list[ArtifactIssue] = field(default_factory=list)
    errors: list[ArtifactIssue] = field(default_factory=list)
    storage: Optional[StorageBlock] = None
    display: Optional[DisplayBlock] = None
    parent_artifact_ids: list[str] = field(default_factory=list)
    schema_version: str = SCHEMA_VERSION
    envelope_version: int = 1
    artifact_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: str = "created"
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        # drop optional Nones for cleaner serialization
        if d.get("storage") is None:
            d.pop("storage", None)
        if d.get("display") is None:
            d.pop("display", None)
        return d


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def create_artifact_id() -> str:
    return str(uuid.uuid4())


def create_base_envelope(
    *,
    job_id: str,
    artifact_type: str,
    stage: str,
    source_skill: str,
    producer: Producer,
    parent_artifact_ids: Optional[list[str]] = None,
    coordinate_frame: Optional[CoordinateFrame] = None,
    data: Optional[dict[str, Any]] = None,
) -> MeasurementArtifactEnvelope:
    parents = list(parent_artifact_ids or [])
    cf = coordinate_frame or CoordinateFrame()
    env = MeasurementArtifactEnvelope(
        job_id=job_id,
        artifact_type=artifact_type,
        stage=stage,
        source_skill=source_skill,
        producer=producer,
        coordinate_frame=cf,
        parent_artifact_ids=parents,
        data=data or {},
    )
    env.geometry.coordinate_frame = cf.frame_id
    env.lineage.input_artifact_ids = parents
    env.lineage.skill_version = producer.version
    env.lineage.created_by = producer.kind
    return env


def make_issue(
    severity: str,
    code: str,
    message: str,
    *,
    blocking: Optional[bool] = None,
    **extra: Any,
) -> ArtifactIssue:
    if blocking is None:
        blocking = severity == "blocker"
    return ArtifactIssue(
        severity=severity, code=code, message=message, blocking=blocking, **extra
    )


def validate_envelope(value: Any) -> list[str]:
    """Lightweight structural check. Returns list of missing/invalid field paths."""
    errs: list[str] = []
    if not isinstance(value, dict):
        return ["root: not a dict"]

    def need(key: str, ok: bool) -> None:
        if not ok:
            errs.append(key)

    need("schema_version", isinstance(value.get("schema_version"), str))
    need("envelope_version", isinstance(value.get("envelope_version"), int) and value["envelope_version"] >= 1)
    need("artifact_id", isinstance(value.get("artifact_id"), str))
    need("job_id", isinstance(value.get("job_id"), str))
    need("parent_artifact_ids", isinstance(value.get("parent_artifact_ids"), list))
    need("artifact_type", value.get("artifact_type") in ARTIFACT_TYPES)
    need("stage", value.get("stage") in ARTIFACT_STAGES)
    need("source_skill", isinstance(value.get("source_skill"), str))
    need("producer", isinstance(value.get("producer"), dict))
    need("status", value.get("status") in ARTIFACT_STATUSES)
    need("created_at", isinstance(value.get("created_at"), str))
    for k in ("coordinate_frame", "units", "geometry", "data", "quality", "validation", "lineage"):
        need(k, isinstance(value.get(k), dict))
    for k in ("warnings", "errors"):
        need(k, isinstance(value.get(k), list))
    return errs


def is_envelope(value: Any) -> bool:
    return not validate_envelope(value)


def summarize_envelope(env: MeasurementArtifactEnvelope) -> dict[str, Any]:
    return {
        "artifact_id": env.artifact_id,
        "artifact_type": env.artifact_type,
        "stage": env.stage,
        "status": env.status,
        "overall_score": env.quality.overall_score,
        "warnings_count": env.quality.warnings_count,
        "blockers_count": env.quality.blockers_count,
        "validation_status": env.validation.validation_status,
        "export_allowed": env.validation.export_allowed,
        "report_allowed": env.validation.report_allowed,
    }
