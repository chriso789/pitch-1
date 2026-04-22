"""Rasterize footprint polygons and structural lines into binary masks
aligned to the aerial image grid.

All masks are written at the same `size` (default 512x512) so the channels
stack pixel-for-pixel with the corresponding `images/<id>.png` aerial tile.

If a `transform` (from alignment.AlignmentTransform.to_dict()) is provided,
each source-coord point is mapped into the aerial grid with the same
similarity transform used to align the footprint, ensuring features stay
in registration with the footprint mask.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from PIL import Image, ImageDraw

CLASSES = ("footprint", "ridge", "hip", "valley", "eave", "rake")

Point = Tuple[float, float]


def _mask_image(size: Tuple[int, int]) -> Image.Image:
    return Image.new("L", size, 0)


def _apply_transform(point: Sequence[float], t: Optional[Dict]) -> Point:
    if not t:
        return (float(point[0]), float(point[1]))
    a = math.radians(t["angle_deg"])
    s = float(t["scale"])
    cx, cy = t["source_center"]
    tx, ty = t["translation"]
    x0 = float(point[0]) - cx
    y0 = float(point[1]) - cy
    return (
        cx + s * math.cos(a) * x0 - s * math.sin(a) * y0 + tx,
        cy + s * math.sin(a) * x0 + s * math.cos(a) * y0 + ty,
    )


def _clip_to_size(pts: Iterable[Point], size: Tuple[int, int]) -> List[Tuple[int, int]]:
    w, h = size
    out: List[Tuple[int, int]] = []
    for x, y in pts:
        out.append((int(round(max(0, min(w - 1, x)))),
                    int(round(max(0, min(h - 1, y))))))
    return out


def rasterize_sample(
    canonical: Dict,
    out_dir: Path,
    sample_id: str,
    size: Tuple[int, int] = (512, 512),
    line_width: int = 4,
    transform: Optional[Dict] = None,
) -> Dict[str, Path]:
    """Produce one PNG per class at consistent resolution. Returns map class -> path.

    `transform` is the source->aerial similarity transform (see alignment.py).
    Pass None if `canonical.geometry` is already in aerial-pixel coords.
    """
    out: Dict[str, Path] = {}
    geom = canonical.get("geometry") or {}
    polygon: List[List[float]] = geom.get("footprint_polygon") or []
    features = geom.get("features") or []

    # ---- footprint ----
    fp = _mask_image(size)
    if len(polygon) >= 3:
        mapped = [_apply_transform(p, transform) for p in polygon]
        ImageDraw.Draw(fp).polygon(_clip_to_size(mapped, size), fill=255)
    fp_path = out_dir / "footprint" / f"{sample_id}.png"
    fp_path.parent.mkdir(parents=True, exist_ok=True)
    fp.save(fp_path)
    out["footprint"] = fp_path

    # ---- structural lines ----
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
            q1 = _apply_transform(p1, transform)
            q2 = _apply_transform(p2, transform)
            (x1, y1), (x2, y2) = _clip_to_size([q1, q2], size)
            draw.line([(x1, y1), (x2, y2)], fill=255, width=line_width)
        path = out_dir / cls / f"{sample_id}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path)
        out[cls] = path

    return out
