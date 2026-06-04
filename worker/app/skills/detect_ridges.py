"""detect_ridges skill — interior shared edges where both planes slope away (near-level top).

Public skill entrypoint: run_detect_ridges. Routed to /skills/detect-ridges
in worker/app/main.py and registered as `detect_ridges` in skills_registry.py.

Classification math is shared with the other four perimeter/intersection
skills via _segments_core.compute_all_segments because correct ridge
detection requires examining ALL plane pairs simultaneously.
"""
from __future__ import annotations

from ..schemas import SkillRequest, SkillResponse
from ._segments_core import compute_all_segments


def run_detect_ridges(req: SkillRequest) -> SkillResponse:
    return compute_all_segments(req, skill_name="detect_ridges")
