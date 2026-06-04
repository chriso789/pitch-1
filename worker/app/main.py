"""PITCH Measure internal worker — FastAPI entrypoint.

Mixed implementation status. Real skill handlers are imported from
`app/skills/<name>.py` and registered through `REAL_HANDLERS` (see
`skills_registry.py` for the authoritative status map). Any `/skills/*`
endpoint without a real handler still falls back to the canonical
SkillRequest stub returning status="needs_implementation".

Live worker endpoints do NOT yet emit the canonical measurement artifact
envelope (see docs/measurement-artifact-envelope.md). Adoption is gated
to a later phase per the hardening contract.
"""
from fastapi import FastAPI, Depends
from fastapi.responses import JSONResponse

from .auth import require_worker_key
from .config import get_settings
from .schemas import (
    SkillRequest,
    SkillResponse,
    CapabilitiesResponse,
    CapabilitySkill,
)
from .skills_registry import SKILLS
from .skills.clip_point_cloud import run_clip_point_cloud
from .skills.generate_dsm import run_generate_dsm
from .skills.generate_dtm import run_generate_dtm
from .skills.generate_chm import run_generate_chm
from .skills.isolate_roof_points import run_isolate_roof_points
from .skills.refine_roof_perimeter_from_surface import run_refine_roof_perimeter_from_surface
from .skills.fit_roof_planes import run_fit_roof_planes
from .skills.detect_ridges import run_detect_ridges
from .skills.detect_hips import run_detect_hips
from .skills.detect_valleys import run_detect_valleys
from .skills.detect_eaves import run_detect_eaves
from .skills.detect_rakes import run_detect_rakes
from .skills.calculate_pitch import run_calculate_pitch
from .skills.calculate_roof_area import run_calculate_roof_area
from .skills.geometry_quality_score import run_geometry_quality_score
from .test_routes import router as test_router

# Map skill_name → real handler. Anything not in this map falls back to a stub.
REAL_HANDLERS = {
    "clip_point_cloud": run_clip_point_cloud,
    "generate_dsm": run_generate_dsm,
    "generate_dtm": run_generate_dtm,
    "generate_chm": run_generate_chm,
    "isolate_roof_points": run_isolate_roof_points,
    "refine_roof_perimeter_from_surface": run_refine_roof_perimeter_from_surface,
    "fit_roof_planes": run_fit_roof_planes,
    "detect_ridges": run_detect_ridges,
    "detect_hips": run_detect_hips,
    "detect_valleys": run_detect_valleys,
    "detect_eaves": run_detect_eaves,
    "detect_rakes": run_detect_rakes,
    "calculate_pitch": run_calculate_pitch,
    "calculate_roof_area": run_calculate_roof_area,
    "geometry_quality_score": run_geometry_quality_score,
}

app = FastAPI(
    title="PITCH Measure Worker",
    version=get_settings().worker_version,
    description="Internal Python compute service for PITCH Measure skills.",
)

# Test-only routes — every route inside guards against worker_mode=production.
if get_settings().is_non_prod:
    app.include_router(test_router)


@app.get("/health")
async def health():
    s = get_settings()
    return {
        "ok": True,
        "worker_version": s.worker_version,
        "worker_mode": s.worker_mode,
        "auth_required": bool(s.worker_api_key),
    }


@app.get("/capabilities", response_model=CapabilitiesResponse)
async def capabilities():
    s = get_settings()
    return CapabilitiesResponse(
        worker_version=s.worker_version,
        worker_mode=s.worker_mode,
        skills=[CapabilitySkill(**sk) for sk in SKILLS],
    )


# ---------------------------------------------------------------------------
# Real handlers registered from REAL_HANDLERS map; everything else gets a stub.
# Stubs return needs_implementation → control plane refuses to promote.
# ---------------------------------------------------------------------------
def _stub(req: SkillRequest, skill_name: str) -> SkillResponse:
    return SkillResponse(
        skill_run_id=req.skill_run_id,
        status="needs_implementation",
        output_payload={"skill": skill_name, "received": True},
        artifacts=[],
        qa_flags=["stub", "no_real_compute"],
        error_message=(
            f"Skill '{skill_name}' is scaffolded but not implemented. "
            "Control plane MUST NOT mark this skill_run as completed."
        ),
        worker_version=get_settings().worker_version,
    )


def _register_real(path: str, name: str, fn):
    async def handler(req: SkillRequest, _=Depends(require_worker_key)):
        return fn(req)
    handler.__name__ = f"skill_{name}"
    app.post(path, response_model=SkillResponse, tags=["skills"])(handler)


def _register_stub(path: str, name: str):
    async def handler(req: SkillRequest, _=Depends(require_worker_key)):
        return _stub(req, name)
    handler.__name__ = f"skill_{name}_stub"
    app.post(path, response_model=SkillResponse, tags=["skills"])(handler)


for sk in SKILLS:
    if sk["implemented"] and sk["name"] in REAL_HANDLERS:
        _register_real(sk["path"], sk["name"], REAL_HANDLERS[sk["name"]])
    else:
        _register_stub(sk["path"], sk["name"])


@app.exception_handler(Exception)
async def _unhandled(_, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": str(exc), "code": "worker_unhandled"},
    )
