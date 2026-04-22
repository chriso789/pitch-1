"""Polygon-to-aerial alignment.

Given a roof footprint polygon (vendor diagram pixel coords) and an aerial
satellite tile, find the best similarity transform (rotate + scale + translate)
that aligns the polygon mask to the roof region detected in the aerial image.

Returns the transformed polygon and an alignment_quality score in [0, 1].
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw

try:
    import cv2
    HAS_CV2 = True
except Exception:
    HAS_CV2 = False


Point = Tuple[float, float]


@dataclass
class AlignmentResult:
    polygon: List[Point]
    angle_deg: float
    scale: float
    translation: Tuple[float, float]
    quality: float          # IoU-based alignment quality 0..1


def _polygon_mask(polygon: Sequence[Point], size: Tuple[int, int]) -> np.ndarray:
    img = Image.new("L", size, 0)
    if len(polygon) >= 3:
        ImageDraw.Draw(img).polygon([tuple(p) for p in polygon], fill=255)
    return np.array(img, dtype=np.uint8)


def _detect_roof_mask(aerial: Image.Image) -> np.ndarray:
    """Cheap heuristic roof mask: high-saturation + edge density.

    Used only for alignment scoring. NOT the training target.
    """
    arr = np.array(aerial.convert("RGB"))
    gray = arr.mean(axis=-1)
    if HAS_CV2:
        edges = cv2.Canny(arr, 60, 160)
        kernel = np.ones((5, 5), np.uint8)
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
        # keep central blob
        h, w = closed.shape
        cy, cx = h // 2, w // 2
        num, labels, stats, _ = cv2.connectedComponentsWithStats(closed)
        if num <= 1:
            return (gray > 80).astype(np.uint8) * 255
        center_label = labels[cy, cx]
        if center_label == 0:
            # pick largest non-background
            sizes = stats[1:, cv2.CC_STAT_AREA]
            center_label = 1 + int(np.argmax(sizes))
        mask = (labels == center_label).astype(np.uint8) * 255
        return mask
    return (gray > 80).astype(np.uint8) * 255


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    a_b = (a > 0).astype(np.uint8)
    b_b = (b > 0).astype(np.uint8)
    inter = np.logical_and(a_b, b_b).sum()
    union = np.logical_or(a_b, b_b).sum()
    return float(inter / union) if union else 0.0


def _transform(polygon: Sequence[Point], angle_deg: float, scale: float, tx: float, ty: float, center: Tuple[float, float]) -> List[Point]:
    cx, cy = center
    a = np.deg2rad(angle_deg)
    cos_a, sin_a = np.cos(a) * scale, np.sin(a) * scale
    out: List[Point] = []
    for x, y in polygon:
        x0, y0 = x - cx, y - cy
        out.append((cx + cos_a * x0 - sin_a * y0 + tx, cy + sin_a * x0 + cos_a * y0 + ty))
    return out


def align_polygon_to_aerial(
    polygon: Sequence[Point],
    aerial: Image.Image,
    angle_search: Sequence[float] = (-30, -15, 0, 15, 30, 45, 60, 75, 90),
    scale_search: Sequence[float] = (0.6, 0.8, 1.0, 1.2, 1.5),
) -> AlignmentResult:
    """Brute-force similarity search for best polygon overlap."""
    if not polygon:
        return AlignmentResult(polygon=[], angle_deg=0, scale=1, translation=(0, 0), quality=0.0)

    size = aerial.size
    target = _detect_roof_mask(aerial)
    h, w = target.shape

    # initial polygon centroid
    pts = np.asarray(polygon, dtype=float)
    px, py = pts[:, 0].mean(), pts[:, 1].mean()

    # target centroid
    ys, xs = np.where(target > 0)
    if xs.size == 0:
        return AlignmentResult(polygon=list(map(tuple, polygon)), angle_deg=0, scale=1,
                               translation=(0, 0), quality=0.0)
    tx0 = xs.mean() - px
    ty0 = ys.mean() - py

    best = AlignmentResult(polygon=list(map(tuple, polygon)), angle_deg=0, scale=1,
                           translation=(tx0, ty0), quality=0.0)

    for ang in angle_search:
        for sc in scale_search:
            transformed = _transform(polygon, ang, sc, tx0, ty0, (px, py))
            mask = _polygon_mask(transformed, size)
            iou = _iou(mask, target)
            if iou > best.quality:
                best = AlignmentResult(polygon=transformed, angle_deg=ang, scale=sc,
                                       translation=(tx0, ty0), quality=iou)
    return best
