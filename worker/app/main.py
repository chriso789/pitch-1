"""PITCH Measure internal worker — FastAPI entrypoint.

Scaffold only. Every /skills/* endpoint validates the canonical
SkillRequest payload and returns status="needs_implementation". When
real compute lands, replace the stub bodies in `app/skills/<name>.py`.
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

app = FastAPI(
    title="PITCH Measure Worker",
    version=get_settings().worker_version,
    description="Internal Python compute service for PITCH Measure skills.",
)


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


def _register_stub(path: str, name: str):
    async def handler(req: SkillRequest, _=Depends(require_worker_key)):
        return _stub(req, name)
    handler.__name__ = f"skill_{name}"
    app.post(path, response_model=SkillResponse, tags=["skills"])(handler)


for sk in SKILLS:
    _register_stub(sk["path"], sk["name"])


@app.exception_handler(Exception)
async def _unhandled(_, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": str(exc), "code": "worker_unhandled"},
    )
