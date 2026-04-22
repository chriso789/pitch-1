"""Rasterize footprint polygons and structural lines into 512x512 PNG masks."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Sequence, Tuple

from PIL import Image, ImageDraw

CLASSES = ("footprint", "ridge", "hip", "valley", "eave", "rake")


def _mask_image(size: Tuple[int, int]) -> Image.Image:
    return Image.new("L", size, 0)


def rasterize_sample(
    canonical: Dict,
    out_dir: Path,
    sample_id: str,
    size: Tuple[int, int] = (512, 512),
    line_width: int = 4,
) -> Dict[str, Path]:
    """Produce one PNG per class. Returns map of class -> path."""
    out: Dict[str, Path] = {}
    geom = canonical.get("geometry") or {}
    polygon: List[List[float]] = geom.get("footprint_polygon") or []
    features = geom.get("features") or []

    # footprint
    fp = _mask_image(size)
    if len(polygon) >= 3:
        ImageDraw.Draw(fp).polygon([tuple(p) for p in polygon], fill=255)
    fp_path = out_dir / "footprint" / f"{sample_id}.png"
    fp_path.parent.mkdir(parents=True, exist_ok=True)
    fp.save(fp_path)
    out["footprint"] = fp_path

    # line classes
    for cls in CLASSES[1:]:
        img = _mask_image(size)
        draw = ImageDraw.Draw(img)
        for f in features:
            if f.get("type") != cls:
                continue
            p1 = f.get("p1")
            p2 = f.get("p2")
            if not p1 or not p2:
                continue
            draw.line([tuple(p1), tuple(p2)], fill=255, width=line_width)
        path = out_dir / cls / f"{sample_id}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path)
        out[cls] = path

    return out
