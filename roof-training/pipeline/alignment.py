"""Polygon-to-aerial alignment.

Given a roof footprint polygon (vendor diagram pixel coords) and an aerial
satellite tile, find the best similarity transform (rotate + scale + translate)
that aligns the polygon mask to the roof region detected in the aerial image.

Returns the transformed polygon, the explicit transform parameters, and an
alignment_quality score in [0, 1] (mask IoU against a heuristic roof mask).

The transform maps source polygon coords (vendor diagram space) into the
aerial-image pixel grid:

    x_aerial = cx + s * cos(a) * (x_src - sx) - s * sin(a) * (y_src - sy) + tx
    y_aerial = cy + s * sin(a) * (x_src - sx) + s * cos(a) * (y_src - sy) + ty

where (sx, sy) is the source-polygon centroid and (cx, cy) is the same point
re-anchored at the source-polygon centroid (so translation is in aerial pixels).
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw

try:
    import cv2
    HAS_CV2 = True
except Exception:
    HAS_CV2 = False


Point = Tuple[float, float]


@dataclass
class AlignmentTransform:
    """Explicit similarity transform: source polygon -> aerial image pixels."""
    angle_deg: float
    scale: float
    translation: Tuple[float, float]   # (tx, ty) in aerial-image pixels
    source_center: Tuple[float, float] # rotation pivot in source coords
    image_size: Tuple[int, int]        # (width, height) of aerial grid

    def to_dict(self) -> Dict:
        return {
            "angle_deg": float(self.angle_deg),
            "scale": float(self.scale),
            "translation": [float(self.translation[0]), float(self.translation[1])],
            "source_center": [float(self.source_center[0]), float(self.source_center[1])],
            "image_size": [int(self.image_size[0]), int(self.image_size[1])],
        }

    def apply(self, polygon: Sequence[Point]) -> List[Point]:
        return _transform(polygon, self.angle_deg, self.scale,
                          self.translation[0], self.translation[1], self.source_center)


@dataclass
class AlignmentResult:
    polygon: List[Point]
    transform: AlignmentTransform
    quality: float                  # IoU against heuristic roof mask, 0..1
    target_centroid: Tuple[float, float]
    source_centroid: Tuple[float, float]


def _polygon_mask(polygon: Sequence[Point], size: Tuple[int, int]) -> np.ndarray:
    img = Image.new("L", size, 0)
    if len(polygon) >= 3:
        ImageDraw.Draw(img).polygon([tuple(p) for p in polygon], fill=255)
    return np.array(img, dtype=np.uint8)


def _detect_roof_mask(aerial: Image.Image) -> np.ndarray:
    """Cheap heuristic roof mask used only for alignment scoring."""
    arr = np.array(aerial.convert("RGB"))
    gray = arr.mean(axis=-1)
    if HAS_CV2:
        edges = cv2.Canny(arr, 60, 160)
        kernel = np.ones((5, 5), np.uint8)
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
        h, w = closed.shape
        cy, cx = h // 2, w // 2
        num, labels, stats, _ = cv2.connectedComponentsWithStats(closed)
        if num <= 1:
            return (gray > 80).astype(np.uint8) * 255
        center_label = labels[cy, cx]
        if center_label == 0:
            sizes = stats[1:, cv2.CC_STAT_AREA]
            center_label = 1 + int(np.argmax(sizes))
        return (labels == center_label).astype(np.uint8) * 255
    return (gray > 80).astype(np.uint8) * 255


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    a_b = (a > 0).astype(np.uint8)
    b_b = (b > 0).astype(np.uint8)
    inter = np.logical_and(a_b, b_b).sum()
    union = np.logical_or(a_b, b_b).sum()
    return float(inter / union) if union else 0.0


def _transform(
    polygon: Sequence[Point],
    angle_deg: float,
    scale: float,
    tx: float,
    ty: float,
    center: Tuple[float, float],
) -> List[Point]:
    cx, cy = center
    a = np.deg2rad(angle_deg)
    cos_a, sin_a = np.cos(a) * scale, np.sin(a) * scale
    out: List[Point] = []
    for x, y in polygon:
        x0, y0 = x - cx, y - cy
        out.append((cx + cos_a * x0 - sin_a * y0 + tx,
                    cy + sin_a * x0 + cos_a * y0 + ty))
    return out


def _principal_angle(mask: np.ndarray) -> float:
    """Return PCA principal-axis angle (degrees) of a binary mask, or 0."""
    ys, xs = np.where(mask > 0)
    if xs.size < 10:
        return 0.0
    pts = np.stack([xs - xs.mean(), ys - ys.mean()], axis=1).astype(np.float64)
    cov = np.cov(pts.T)
    if not np.all(np.isfinite(cov)):
        return 0.0
    _, vecs = np.linalg.eigh(cov)
    primary = vecs[:, -1]
    ang = np.degrees(np.arctan2(primary[1], primary[0]))
    # normalize to (-90, 90]
    while ang > 90:
        ang -= 180
    while ang <= -90:
        ang += 180
    return float(ang)


def align_polygon_to_aerial(
    polygon: Sequence[Point],
    aerial: Image.Image,
    coarse_angle_steps: int = 12,
    scale_search: Sequence[float] = (0.5, 0.7, 0.85, 1.0, 1.15, 1.3, 1.6, 2.0),
    refine: bool = True,
) -> AlignmentResult:
    """Coarse-to-fine similarity search for best polygon overlap."""
    size = aerial.size
    target = _detect_roof_mask(aerial)

    if not polygon or len(polygon) < 3:
        return AlignmentResult(
            polygon=list(map(tuple, polygon)),
            transform=AlignmentTransform(0.0, 1.0, (0.0, 0.0), (0.0, 0.0), size),
            quality=0.0,
            target_centroid=(size[0] / 2, size[1] / 2),
            source_centroid=(0.0, 0.0),
        )

    pts = np.asarray(polygon, dtype=float)
    sx, sy = float(pts[:, 0].mean()), float(pts[:, 1].mean())
    ys, xs = np.where(target > 0)
    if xs.size == 0:
        return AlignmentResult(
            polygon=list(map(tuple, polygon)),
            transform=AlignmentTransform(0.0, 1.0, (size[0] / 2 - sx, size[1] / 2 - sy),
                                         (sx, sy), size),
            quality=0.0,
            target_centroid=(size[0] / 2, size[1] / 2),
            source_centroid=(sx, sy),
        )
    tx0 = float(xs.mean()) - sx
    ty0 = float(ys.mean()) - sy

    # Seed angle from PCA of target vs polygon
    poly_mask_local = _polygon_mask([(x - sx + size[0] / 2, y - sy + size[1] / 2)
                                     for x, y in polygon], size)
    seed_delta = _principal_angle(target) - _principal_angle(poly_mask_local)

    coarse_angles = sorted({
        round(seed_delta + k * (180.0 / coarse_angle_steps), 2)
        for k in range(-coarse_angle_steps // 2, coarse_angle_steps // 2 + 1)
    })

    best = AlignmentResult(
        polygon=list(map(tuple, polygon)),
        transform=AlignmentTransform(0.0, 1.0, (tx0, ty0), (sx, sy), size),
        quality=0.0,
        target_centroid=(float(xs.mean()), float(ys.mean())),
        source_centroid=(sx, sy),
    )

    def evaluate(ang: float, sc: float, tx: float, ty: float) -> float:
        transformed = _transform(polygon, ang, sc, tx, ty, (sx, sy))
        mask = _polygon_mask(transformed, size)
        return _iou(mask, target), transformed

    # Coarse pass over angle x scale
    for ang in coarse_angles:
        for sc in scale_search:
            iou, transformed = evaluate(ang, sc, tx0, ty0)
            if iou > best.quality:
                best = AlignmentResult(
                    polygon=transformed,
                    transform=AlignmentTransform(ang, sc, (tx0, ty0), (sx, sy), size),
                    quality=iou,
                    target_centroid=best.target_centroid,
                    source_centroid=(sx, sy),
                )

    # Refinement: local search around best
    if refine and best.quality > 0:
        a0 = best.transform.angle_deg
        s0 = best.transform.scale
        tx, ty = best.transform.translation
        for _ in range(2):  # two refinement rounds
            improved = False
            for da in (-3, -1, 0, 1, 3):
                for ds in (-0.1, -0.05, 0, 0.05, 0.1):
                    for dtx in (-6, -2, 0, 2, 6):
                        for dty in (-6, -2, 0, 2, 6):
                            ang = a0 + da
                            sc = max(0.2, s0 + ds)
                            iou, transformed = evaluate(ang, sc, tx + dtx, ty + dty)
                            if iou > best.quality + 1e-4:
                                best = AlignmentResult(
                                    polygon=transformed,
                                    transform=AlignmentTransform(
                                        ang, sc, (tx + dtx, ty + dty), (sx, sy), size,
                                    ),
                                    quality=iou,
                                    target_centroid=best.target_centroid,
                                    source_centroid=(sx, sy),
                                )
                                improved = True
            a0 = best.transform.angle_deg
            s0 = best.transform.scale
            tx, ty = best.transform.translation
            if not improved:
                break

    return best
