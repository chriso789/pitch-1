"""
Roof Geometry Rule Engine

Converts model-predicted segmentation masks into classified roof features
(ridge, hip, valley, eave, rake) with deterministic geometric validation.

Usage:
    from rule_engine import classify_lines
    result = classify_lines(footprint_mask, ridge_mask, hip_mask, valley_mask, eave_mask, rake_mask)
"""

import math
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional

import cv2
import numpy as np

Point = Tuple[float, float]
Line = Tuple[Point, Point]


@dataclass
class FeatureLine:
    p1: Point
    p2: Point
    kind: str = "unknown"
    length_px: float = 0.0
    confidence: float = 0.0
    meta: Dict = field(default_factory=dict)

    def as_dict(self):
        return {
            "p1": [float(self.p1[0]), float(self.p1[1])],
            "p2": [float(self.p2[0]), float(self.p2[1])],
            "kind": self.kind,
            "length_px": float(self.length_px),
            "confidence": float(self.confidence),
            "meta": self.meta,
        }


def line_length(line: Line) -> float:
    (x1, y1), (x2, y2) = line
    return float(math.hypot(x2 - x1, y2 - y1))


def line_angle_deg(line: Line) -> float:
    (x1, y1), (x2, y2) = line
    angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
    if angle < 0:
        angle += 180
    return angle


def point_to_segment_distance(p: Point, line: Line) -> float:
    px, py = p
    (x1, y1), (x2, y2) = line
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    proj = (x1 + t * dx, y1 + t * dy)
    return math.hypot(px - proj[0], py - proj[1])


def line_midpoint(line: Line) -> Point:
    (x1, y1), (x2, y2) = line
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def extract_largest_contour(mask: np.ndarray) -> Optional[np.ndarray]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    return max(contours, key=cv2.contourArea)


def simplify_polygon(contour: np.ndarray, epsilon_ratio: float = 0.003) -> np.ndarray:
    peri = cv2.arcLength(contour, True)
    epsilon = peri * epsilon_ratio
    return cv2.approxPolyDP(contour, epsilon, True)


def contour_to_points(contour: np.ndarray) -> List[Point]:
    return [(float(pt[0][0]), float(pt[0][1])) for pt in contour]


def extract_perimeter_edges(polygon: List[Point]) -> List[Line]:
    edges = []
    for i in range(len(polygon)):
        p1 = polygon[i]
        p2 = polygon[(i + 1) % len(polygon)]
        edges.append((p1, p2))
    return edges


def detect_lines_from_mask(mask: np.ndarray,
                           threshold: int = 30,
                           min_line_length: int = 20,
                           max_line_gap: int = 10) -> List[Line]:
    lines = cv2.HoughLinesP(mask, 1, np.pi / 180, threshold,
                            minLineLength=min_line_length,
                            maxLineGap=max_line_gap)
    out = []
    if lines is None:
        return out
    for l in lines:
        x1, y1, x2, y2 = l[0]
        out.append(((float(x1), float(y1)), (float(x2), float(y2))))
    return out


def merge_similar_lines(lines: List[Line], angle_tol: float = 8.0, dist_tol: float = 10.0) -> List[Line]:
    if not lines:
        return []

    used = [False] * len(lines)
    merged = []

    for i, line_i in enumerate(lines):
        if used[i]:
            continue

        group = [line_i]
        used[i] = True
        angle_i = line_angle_deg(line_i)
        mid_i = line_midpoint(line_i)

        for j in range(i + 1, len(lines)):
            if used[j]:
                continue
            angle_j = line_angle_deg(lines[j])
            mid_j = line_midpoint(lines[j])

            angle_diff = min(abs(angle_i - angle_j), 180 - abs(angle_i - angle_j))
            dist = math.hypot(mid_i[0] - mid_j[0], mid_i[1] - mid_j[1])
            if angle_diff <= angle_tol and dist <= dist_tol:
                group.append(lines[j])
                used[j] = True

        pts = []
        for g in group:
            pts.extend([g[0], g[1]])

        angles = [line_angle_deg(g) for g in group]
        mean_angle = sum(angles) / len(angles)

        if 45 < mean_angle < 135:
            pts_sorted = sorted(pts, key=lambda p: p[1])
        else:
            pts_sorted = sorted(pts, key=lambda p: p[0])

        merged.append((pts_sorted[0], pts_sorted[-1]))

    return merged


def classify_edge_as_eave_or_rake(line: Line, roof_center: Point) -> str:
    angle = line_angle_deg(line)
    if angle < 20 or angle > 160 or (70 < angle < 110):
        return "eave"
    return "rake"


def snap_line_to_perimeter_if_close(line: Line, perimeter_edges: List[Line], tol: float = 8.0) -> Optional[Line]:
    mid = line_midpoint(line)
    for edge in perimeter_edges:
        d = point_to_segment_distance(mid, edge)
        if d <= tol:
            return edge
    return None


def inside_contour(point: Point, contour: np.ndarray) -> bool:
    return cv2.pointPolygonTest(contour, point, False) >= 0


def infer_roof_type(features: List[FeatureLine]) -> str:
    counts = {"ridge": 0, "hip": 0, "valley": 0, "eave": 0, "rake": 0}
    for f in features:
        if f.kind in counts:
            counts[f.kind] += 1

    if counts["valley"] >= 1:
        return "complex_valley"
    if counts["hip"] >= 2 and counts["rake"] == 0:
        return "hip"
    if counts["ridge"] >= 1 and counts["rake"] >= 2:
        return "gable"
    if counts["ridge"] == 0 and counts["hip"] == 0 and counts["valley"] == 0:
        return "flat_or_low_slope"
    return "mixed"


def estimate_area_sqft_from_footprint_mask(
    mask: np.ndarray,
    meters_per_pixel: float,
    pitch: Optional[float] = None,
) -> float:
    pixel_area = float(np.sum(mask > 0))
    projected_m2 = pixel_area * (meters_per_pixel ** 2)

    if pitch is None:
        roof_area_m2 = projected_m2
    else:
        pitch_rise = float(pitch)
        slope_factor = math.sqrt(1 + (pitch_rise / 12.0) ** 2)
        roof_area_m2 = projected_m2 * slope_factor

    return roof_area_m2 * 10.7639


def classify_lines(
    footprint_mask: np.ndarray,
    ridge_mask: np.ndarray,
    hip_mask: np.ndarray,
    valley_mask: np.ndarray,
    eave_mask: np.ndarray,
    rake_mask: np.ndarray,
    roof_segment_stats: Optional[List[Dict]] = None,
    meters_per_pixel: Optional[float] = None,
) -> Dict:
    """
    Main entry point: takes 6 binary masks and returns classified roof features.

    Returns dict with:
      - roof_type: gable | hip | complex_valley | flat_or_low_slope | mixed
      - polygon: simplified footprint vertices
      - features: list of classified FeatureLine dicts
      - totals_px: per-kind total length in pixels
      - totals_ft: per-kind total length in feet (if meters_per_pixel provided)
      - predominant_pitch_degrees: median pitch from Solar segments (if provided)
    """
    footprint_mask = (footprint_mask > 0).astype(np.uint8) * 255
    contour = extract_largest_contour(footprint_mask)
    if contour is None:
        return {
            "error": "No footprint contour found",
            "features": [],
            "polygon": [],
        }

    poly = simplify_polygon(contour)
    polygon = contour_to_points(poly)
    perimeter_edges = extract_perimeter_edges(polygon)

    ridge_lines = merge_similar_lines(detect_lines_from_mask((ridge_mask > 0).astype(np.uint8) * 255))
    hip_lines = merge_similar_lines(detect_lines_from_mask((hip_mask > 0).astype(np.uint8) * 255))
    valley_lines = merge_similar_lines(detect_lines_from_mask((valley_mask > 0).astype(np.uint8) * 255))
    eave_lines = merge_similar_lines(detect_lines_from_mask((eave_mask > 0).astype(np.uint8) * 255))
    rake_lines = merge_similar_lines(detect_lines_from_mask((rake_mask > 0).astype(np.uint8) * 255))

    roof_center = tuple(np.mean(np.array(polygon), axis=0).tolist())
    features: List[FeatureLine] = []

    # 1. Ridges: interior only, reject perimeter ridges
    for ln in ridge_lines:
        snapped = snap_line_to_perimeter_if_close(ln, perimeter_edges)
        if snapped is None:
            features.append(FeatureLine(
                p1=ln[0], p2=ln[1], kind="ridge",
                length_px=line_length(ln), confidence=0.9,
            ))

    # 2. Valleys: interior, diagonal, not perimeter
    for ln in valley_lines:
        snapped = snap_line_to_perimeter_if_close(ln, perimeter_edges)
        if snapped is None:
            features.append(FeatureLine(
                p1=ln[0], p2=ln[1], kind="valley",
                length_px=line_length(ln), confidence=0.86,
            ))

    # 3. Hips: usually diagonal, can terminate at corners
    for ln in hip_lines:
        features.append(FeatureLine(
            p1=ln[0], p2=ln[1], kind="hip",
            length_px=line_length(ln), confidence=0.84,
        ))

    # 4. Eave/rake: perimeter only
    for ln in eave_lines:
        snapped = snap_line_to_perimeter_if_close(ln, perimeter_edges)
        if snapped is not None:
            features.append(FeatureLine(
                p1=snapped[0], p2=snapped[1], kind="eave",
                length_px=line_length(snapped), confidence=0.88,
            ))

    for ln in rake_lines:
        snapped = snap_line_to_perimeter_if_close(ln, perimeter_edges)
        if snapped is not None:
            features.append(FeatureLine(
                p1=snapped[0], p2=snapped[1], kind="rake",
                length_px=line_length(snapped), confidence=0.83,
            ))

    # 5. Fill missing perimeter edges
    covered = [False] * len(perimeter_edges)
    for i, edge in enumerate(perimeter_edges):
        for feat in features:
            if feat.kind in {"eave", "rake"}:
                d = point_to_segment_distance(line_midpoint(edge), (feat.p1, feat.p2))
                if d < 10:
                    covered[i] = True
                    break

    for i, edge in enumerate(perimeter_edges):
        if not covered[i]:
            kind = classify_edge_as_eave_or_rake(edge, roof_center)
            features.append(FeatureLine(
                p1=edge[0], p2=edge[1], kind=kind,
                length_px=line_length(edge), confidence=0.55,
                meta={"filled_from_perimeter": True},
            ))

    # 6. Google Solar pitch refinement
    predominant_pitch = None
    if roof_segment_stats:
        pitches = [seg.get("pitchDegrees") for seg in roof_segment_stats if seg.get("pitchDegrees") is not None]
        if pitches:
            predominant_pitch = float(np.median(pitches))

    totals_px = {"ridge": 0.0, "hip": 0.0, "valley": 0.0, "eave": 0.0, "rake": 0.0}
    for feat in features:
        if feat.kind in totals_px:
            totals_px[feat.kind] += feat.length_px

    totals_ft = None
    if meters_per_pixel is not None:
        px_to_ft = meters_per_pixel * 3.28084
        totals_ft = {k: v * px_to_ft for k, v in totals_px.items()}

    roof_type = infer_roof_type(features)

    return {
        "roof_type": roof_type,
        "polygon": [[float(x), float(y)] for x, y in polygon],
        "features": [f.as_dict() for f in features],
        "totals_px": totals_px,
        "totals_ft": totals_ft,
        "predominant_pitch_degrees": predominant_pitch,
    }
