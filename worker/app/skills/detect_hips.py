"""detect_hips skill — exterior shared edges, sloped (descend ridge→eave).

Public skill entrypoint: run_detect_hips. Routed to /skills/detect-hips.
Delegates to _segments_core.compute_all_segments; see detect_ridges.py
for the rationale on shared core math.
"""
from __future__ import annotations

from ..schemas import SkillRequest, SkillResponse
from ._segments_core import compute_all_segments


def run_detect_hips(req: SkillRequest) -> SkillResponse:
    return compute_all_segments(req, skill_name="detect_hips")
