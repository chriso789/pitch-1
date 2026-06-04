"""detect_eaves skill — facet perimeter edges, near-level, not covered by a shared edge.

Public skill entrypoint: run_detect_eaves. Routed to /skills/detect-eaves.
Per architectural contract, eaves are NEVER classified from footprint
geometry alone — only after roof planes exist.
"""
from __future__ import annotations

from ..schemas import SkillRequest, SkillResponse
from ._segments_core import compute_all_segments


def run_detect_eaves(req: SkillRequest) -> SkillResponse:
    return compute_all_segments(req, skill_name="detect_eaves")
