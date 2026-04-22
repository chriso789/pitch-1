"""CLI entry point: build the U-Net training dataset end-to-end.

Reads existing labels/canonical produced by build_alignment_dataset_db.py OR
re-processes raw cached samples through the full pipeline.

Usage:
  python -m roof_training.pipeline.run_pipeline
or:
  python roof-training/pipeline/run_pipeline.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Dict, List

# Allow running as a script
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from roof_training.pipeline import orchestrator  # type: ignore  # noqa
else:
    from . import orchestrator  # type: ignore

from PIL import Image

ROOT = Path(os.environ.get("ROOF_DATASET_ROOT", "./roof-training"))
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
IMAGES = ROOT / "images"


def _find_aerial(sample_dir: Path) -> Path | None:
    for ext in ("aerial.png", "aerial.jpg", "satellite.png", "satellite.jpg"):
        p = sample_dir / ext
        if p.exists():
            return p
    # fallback: first png/jpg in dir
    for p in sample_dir.iterdir():
        if p.suffix.lower() in {".png", ".jpg", ".jpeg"}:
            return p
    return None


def _load_canonical(sample_id: str, sample_dir: Path) -> Dict | None:
    candidates = [
        sample_dir / "canonical.json",
        PROCESSED / f"{sample_id}.json",
    ]
    for c in candidates:
        if c.exists():
            return json.loads(c.read_text())
    return None


def main() -> None:
    sample_dirs = sorted([p for p in RAW.iterdir() if p.is_dir()]) if RAW.exists() else []
    if not sample_dirs:
        print(f"No raw samples in {RAW}. Run bucket_loader first or place samples manually.")
        sys.exit(0)

    results: List[Dict] = []
    for sd in sample_dirs:
        sample_id = sd.name
        canonical = _load_canonical(sample_id, sd)
        if not canonical:
            print(f"[skip] {sample_id}: no canonical.json")
            continue
        aerial = _find_aerial(sd)
        if not aerial:
            print(f"[skip] {sample_id}: no aerial image found")
            continue
        try:
            res = orchestrator.process_sample(sample_id, canonical, aerial)
            results.append(res)
            print(
                f"[ok ] {sample_id} align={res['alignment_quality']:.2f} "
                f"score={res['score']['composite_score']:.2f} "
                f"accepted={res['score']['accepted']}"
            )
        except Exception as e:
            print(f"[err] {sample_id}: {e}")

    summary = orchestrator.summarize(results)
    print("\n=== PIPELINE SUMMARY ===")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
