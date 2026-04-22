"""End-to-end orchestrator: bucket -> parsed canonical -> aligned -> rasterized -> scored.

Layout produced under roof-training/:
  data/raw/<id>/         - original PDFs/diagrams/aerials cached from bucket
  data/processed/        - canonical JSON per sample
  images/<id>.png        - aerial tile (input to U-Net)
  masks/<class>/<id>.png - per-class binary masks
  labels/<id>.json       - regression targets + alignment quality
  splits/{train,val}.txt - sample id splits (auto)
  exports/metrics/       - dataset summary + per-sample scores
"""

from __future__ import annotations

import json
import os
import random
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional

from PIL import Image

from .alignment import align_polygon_to_aerial
from .rasterize import rasterize_sample, CLASSES
from .scoring import REQUIRED_TARGETS, score_sample

ROOT = Path(os.environ.get("ROOF_DATASET_ROOT", "./roof-training"))
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"
IMAGES = ROOT / "images"
MASKS = ROOT / "masks"
LABELS = ROOT / "labels"
SPLITS = ROOT / "splits"
METRICS = ROOT / "exports" / "metrics"

for p in (DATA_RAW, DATA_PROCESSED, IMAGES, MASKS, LABELS, SPLITS, METRICS):
    p.mkdir(parents=True, exist_ok=True)


def _label_payload(sample_id: str, canonical: Dict, quality: float) -> Dict:
    m = canonical.get("measurements") or {}
    lengths = m.get("lengths_ft") or {}
    targets = {
        "total_area_sqft": m.get("area_sqft") or 0.0,
        "ridge_ft": lengths.get("ridge") or 0.0,
        "hip_ft": lengths.get("hip") or 0.0,
        "valley_ft": lengths.get("valley") or 0.0,
        "eave_ft": lengths.get("eave") or 0.0,
        "rake_ft": lengths.get("rake") or 0.0,
        "predominant_pitch": m.get("predominant_pitch") or 0.0,
    }
    return {
        "sample_id": sample_id,
        "targets": targets,
        "quality": {"alignment_quality": round(quality, 4)},
        "vendor": (canonical.get("meta") or {}).get("vendor"),
        "address": (canonical.get("location") or {}).get("address"),
    }


def process_sample(
    sample_id: str,
    canonical: Dict,
    aerial_path: Path,
    out_size: tuple = (512, 512),
) -> Dict:
    """Run alignment + rasterize + score for a single sample."""
    aerial = Image.open(aerial_path).convert("RGB")
    if aerial.size != out_size:
        aerial = aerial.resize(out_size)
    aerial_out = IMAGES / f"{sample_id}.png"
    aerial.save(aerial_out)

    polygon = (canonical.get("geometry") or {}).get("footprint_polygon") or []
    align = align_polygon_to_aerial(polygon, aerial) if polygon else None
    quality = align.quality if align else 0.0

    aligned_canonical = dict(canonical)
    if align and align.polygon:
        aligned_canonical["geometry"] = {
            **(canonical.get("geometry") or {}),
            "footprint_polygon": [list(p) for p in align.polygon],
        }

    rasterize_sample(aligned_canonical, MASKS, sample_id, size=out_size)

    score = score_sample(sample_id, aligned_canonical, quality, MASKS)

    label = _label_payload(sample_id, aligned_canonical, quality)
    (LABELS / f"{sample_id}.json").write_text(json.dumps(label, indent=2))
    (DATA_PROCESSED / f"{sample_id}.json").write_text(json.dumps(aligned_canonical, indent=2))

    return {"sample_id": sample_id, "score": asdict(score), "alignment_quality": quality}


def write_splits(accepted_ids: List[str], val_ratio: float = 0.15, seed: int = 42) -> None:
    random.Random(seed).shuffle(accepted_ids)
    n_val = max(1, int(len(accepted_ids) * val_ratio)) if accepted_ids else 0
    val = accepted_ids[:n_val]
    train = accepted_ids[n_val:]
    (SPLITS / "train.txt").write_text("\n".join(train))
    (SPLITS / "val.txt").write_text("\n".join(val))


def summarize(results: List[Dict]) -> Dict:
    accepted = [r for r in results if r["score"]["accepted"]]
    summary = {
        "total": len(results),
        "accepted": len(accepted),
        "rejected": len(results) - len(accepted),
        "mean_alignment": (
            sum(r["alignment_quality"] for r in results) / len(results)
            if results else 0.0
        ),
        "mean_score": (
            sum(r["score"]["composite_score"] for r in results) / len(results)
            if results else 0.0
        ),
        "rejections": {},
    }
    for r in results:
        reason = r["score"]["rejection_reason"]
        if reason:
            summary["rejections"][reason] = summary["rejections"].get(reason, 0) + 1

    (METRICS / "pipeline_summary.json").write_text(json.dumps(summary, indent=2))
    (METRICS / "per_sample_scores.json").write_text(json.dumps(results, indent=2))

    write_splits([r["sample_id"] for r in accepted])
    return summary
