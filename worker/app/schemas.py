from typing import Any, Literal
from pydantic import BaseModel, Field


class SkillRequest(BaseModel):
    """Canonical payload accepted by every /skills/* endpoint."""
    skill_run_id: str
    measurement_request_id: str
    request_hash: str
    measurement_job_id: str
    lidar_window_id: str | None = None
    roof_surface_asset_id: str | None = None
    source_url: str | None = None
    asset_type: str | None = None  # las|laz|copc|ept|geotiff|...
    aoi_geojson: dict[str, Any] | None = None
    parcel_geojson: dict[str, Any] | None = None
    building_footprint_geojson: dict[str, Any] | None = None
    roof_edge_candidate_geojson: dict[str, Any] | None = None
    target_crs: str | None = None
    target_resolution: float | None = None
    inputs: dict[str, Any] = Field(default_factory=dict)


class Artifact(BaseModel):
    artifact_type: str
    storage_path: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    measurement_request_id: str
    request_hash: str
    measurement_job_id: str
    skill_run_id: str


SkillStatus = Literal["completed", "failed", "needs_review", "needs_implementation"]


class SkillResponse(BaseModel):
    skill_run_id: str
    status: SkillStatus
    output_payload: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[Artifact] = Field(default_factory=list)
    qa_flags: list[str] = Field(default_factory=list)
    error_message: str | None = None
    worker_version: str


class CapabilitySkill(BaseModel):
    name: str
    path: str
    implemented: bool
    notes: str | None = None


class CapabilitiesResponse(BaseModel):
    worker_version: str
    worker_mode: str
    skills: list[CapabilitySkill]
