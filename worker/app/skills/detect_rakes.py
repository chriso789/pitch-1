"""detect_rakes skill — facet perimeter edges, sloped (gable ends), not covered by a shared edge.

Public skill entrypoint: run_detect_rakes. Routed to /skills/detect-rakes.
"""
from __future__ import annotations

from ..schemas import SkillRequest, SkillResponse
from ._segments_core import compute_all_segments


def run_detect_rakes(req: SkillRequest) -> SkillResponse:
    return compute_all_segments(req, skill_name="detect_rakes")
