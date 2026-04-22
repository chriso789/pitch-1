"""Per-sample quality scoring + filtering.

Quality gate (per README_LOVABLE):
  - alignment_quality >= 0.50
  - all 7 regression targets present
  - footprint mask exists
  - >= 1 structural line mask exists
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional

REQUIRED_TARGETS = (
    "total_area_sqft",
    "ridge_ft",
    "hip_ft",
    "valley_ft",
    "eave_ft",
    "rake_ft",
    "predominant_pitch",
)
LINE_CLASSES = ("ridge", "hip", "valley", "eave", "rake")


@dataclass
class SampleScore:
    sample_id: str
    alignment_quality: float
    targets_present: int
    has_footprint_mask: bool
    line_classes_present: int
    accepted: bool
    rejection_reason: Optional[str]
    composite_score: float


def _targets_from_canonical(canonical: Dict) -> Dict[str, float]:
    m = (canonical or {}).get("measurements") or {}
    lengths = m.get("lengths_ft") or {}
    return {
        "total_area_sqft": m.get("area_sqft"),
        "ridge_ft": lengths.get("ridge"),
        "hip_ft": lengths.get("hip"),
        "valley_ft": lengths.get("valley"),
        "eave_ft": lengths.get("eave"),
        "rake_ft": lengths.get("rake"),
        "predominant_pitch": m.get("predominant_pitch"),
    }


def score_sample(
    sample_id: str,
    canonical: Dict,
    alignment_quality: float,
    masks_dir: Path,
    min_alignment: float = 0.5,
) -> SampleScore:
    targets = _targets_from_canonical(canonical)
    targets_present = sum(1 for v in targets.values() if v is not None)

    fp_path = masks_dir / "footprint" / f"{sample_id}.png"
    has_fp = fp_path.exists() and fp_path.stat().st_size > 0

    line_present = 0
    for cls in LINE_CLASSES:
        p = masks_dir / cls / f"{sample_id}.png"
        if p.exists() and p.stat().st_size > 200:  # > 200B implies non-blank png
            line_present += 1

    rejection: Optional[str] = None
    if alignment_quality < min_alignment:
        rejection = f"alignment_quality<{min_alignment}"
    elif targets_present < len(REQUIRED_TARGETS):
        rejection = "missing_regression_targets"
    elif not has_fp:
        rejection = "missing_footprint_mask"
    elif line_present < 1:
        rejection = "no_structural_line_masks"

    composite = (
        0.5 * alignment_quality
        + 0.3 * (targets_present / len(REQUIRED_TARGETS))
        + 0.1 * (1.0 if has_fp else 0.0)
        + 0.1 * min(1.0, line_present / len(LINE_CLASSES))
    )

    return SampleScore(
        sample_id=sample_id,
        alignment_quality=round(alignment_quality, 4),
        targets_present=targets_present,
        has_footprint_mask=has_fp,
        line_classes_present=line_present,
        accepted=rejection is None,
        rejection_reason=rejection,
        composite_score=round(composite, 4),
    )


def filter_accepted(scores: List[SampleScore]) -> List[SampleScore]:
    return [s for s in scores if s.accepted]
