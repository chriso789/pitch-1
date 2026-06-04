"""detect_valleys skill — interior shared edges where both planes slope toward (low line).

Public skill entrypoint: run_detect_valleys. Routed to /skills/detect-valleys.
"""
from __future__ import annotations

from ..schemas import SkillRequest, SkillResponse
from ._segments_core import compute_all_segments


def run_detect_valleys(req: SkillRequest) -> SkillResponse:
    return compute_all_segments(req, skill_name="detect_valleys")
