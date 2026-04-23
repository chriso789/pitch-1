"""Stages 1-4: turn a Length Diagram PNG into per-class pixel totals,
then calibrate pixels-per-foot against Report Summary truth.

Phase 1 acceptance is total-length-per-class; topology classification of
individual edges is a Phase 2 concern. So the parser emits per-class pixel
totals + calibrated foot totals + accuracy vs truth.
"""
from __future__ import annotations
import pathlib, json
import cv2
import numpy as np


# ---------------------- Stage 1: cleanup ----------------------

def crop_diagram(img_bgr: np.ndarray) -> np.ndarray:
    """Crop the central diagram region by trimming the top blue header
    band and the bottom footer line. We use simple horizontal-band
    detection on the saturation channel."""
    h, w = img_bgr.shape[:2]
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    # Blue header band: high S, hue ~ 100-130
    blue = cv2.inRange(hsv, (95, 80, 60), (135, 255, 255))
    row_blue = blue.sum(axis=1) / 255.0
    top = 0
    for y in range(int(h * 0.25)):
        if row_blue[y] > w * 0.4:
            top = y
    top = min(top + 10, int(h * 0.25))

    # Footer: usually < 8% from bottom is page chrome
    bottom = int(h * 0.95)
    return img_bgr[top:bottom, :]


def strip_text(img_bgr: np.ndarray) -> np.ndarray:
    """Inpaint text glyphs (numbers + callout labels in red and black) so
    Hough doesn't pick them up as line segments. We detect text by
    looking for small connected components in BOTH the dark and red
    color channels — EagleView's red dimension callouts are the single
    biggest source of red-mask pollution."""
    hsv  = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    # Dark glyphs (black numerals)
    _, dark = cv2.threshold(gray, 130, 255, cv2.THRESH_BINARY_INV)
    # Red glyphs (red dimension callouts on hips/ridges)
    red1 = cv2.inRange(hsv, (0,   80, 60), (22,  255, 255))
    red2 = cv2.inRange(hsv, (168, 80, 60), (179, 255, 255))
    red  = cv2.bitwise_or(red1, red2)

    text_mask = np.zeros_like(gray)
    for src in (dark, red):
        n, _, stats, _ = cv2.connectedComponentsWithStats(src, connectivity=8)
        for i in range(1, n):
            x, y, ww, hh, area = stats[i]
            # Glyph-sized: small + roughly square aspect
            if 3 <= area <= 900 and ww < 50 and hh < 50 and 0.15 < ww / max(hh, 1) < 6:
                # And not a thin line (lines have area >> bbox-perimeter*1)
                if area < 0.7 * ww * hh:  # not a near-solid rectangle (line bbox is ~thin)
                    text_mask[y:y + hh, x:x + ww] = 255
    text_mask = cv2.dilate(text_mask, np.ones((3, 3), np.uint8), iterations=2)
    return cv2.inpaint(img_bgr, text_mask, 3, cv2.INPAINT_TELEA)


# ---------------------- Stage 2: color split ----------------------

def color_masks(img_bgr: np.ndarray) -> dict[str, np.ndarray]:
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    # Red/orange-red (hips + ridges). EagleView's red prints with hue ~10-18,
    # so we widen past pure red to include the orange-red end of the spectrum.
    red1 = cv2.inRange(hsv, (0,   80, 60), (22,  255, 255))
    red2 = cv2.inRange(hsv, (168, 80, 60), (179, 255, 255))
    red = cv2.bitwise_or(red1, red2)

    # Blue (valleys, often dashed)
    blue = cv2.inRange(hsv, (95, 70, 60), (135, 255, 255))

    # Black (eaves + rakes — perimeter). Low value, low saturation.
    black = cv2.inRange(hsv, (0, 0, 0), (179, 90, 90))

    # Tan / brown call-outs (chimneys, step-flashing) — discard
    tan = cv2.inRange(hsv, (10, 40, 80), (30, 200, 230))
    black = cv2.bitwise_and(black, cv2.bitwise_not(tan))

    # Clean up
    k = np.ones((2, 2), np.uint8)
    return {
        "red":   cv2.morphologyEx(red,   cv2.MORPH_CLOSE, k),
        "blue":  cv2.morphologyEx(blue,  cv2.MORPH_CLOSE, k),
        "black": cv2.morphologyEx(black, cv2.MORPH_CLOSE, k),
    }


# ---------------------- Stage 3: vectorize ----------------------

def hough_segments(mask: np.ndarray, min_len: int = 18, max_gap: int = 8):
    """Return list of (x1,y1,x2,y2) and the sum of segment pixel-length."""
    edges = cv2.Canny(mask, 40, 120)
    lines = cv2.HoughLinesP(edges, rho=1, theta=np.pi / 360,
                            threshold=30, minLineLength=min_len,
                            maxLineGap=max_gap)
    segs = []
    total = 0.0
    if lines is not None:
        for L in lines[:, 0, :]:
            x1, y1, x2, y2 = map(int, L)
            d = float(np.hypot(x2 - x1, y2 - y1))
            segs.append((x1, y1, x2, y2, d))
            total += d
    return segs, total


def merge_collinear(segs, tol_angle_deg=2.0, tol_dist_px=4.0):
    """Greedy collinear merge so a dashed valley counts as one length, not
    a sum of dashes plus gaps. Uses bucketed angles + perpendicular dist."""
    if not segs:
        return [], 0.0
    arr = np.array([(x1, y1, x2, y2) for x1, y1, x2, y2, _ in segs], dtype=float)
    used = np.zeros(len(arr), dtype=bool)
    out = []
    for i in range(len(arr)):
        if used[i]:
            continue
        x1, y1, x2, y2 = arr[i]
        ang_i = np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180
        # Project all endpoints from group onto this line direction
        dx, dy = x2 - x1, y2 - y1
        L = np.hypot(dx, dy) or 1.0
        ux, uy = dx / L, dy / L
        nx, ny = -uy, ux
        group_pts = [(x1, y1), (x2, y2)]
        used[i] = True
        for j in range(i + 1, len(arr)):
            if used[j]:
                continue
            xa, ya, xb, yb = arr[j]
            ang_j = np.degrees(np.arctan2(yb - ya, xb - xa)) % 180
            d_ang = min(abs(ang_i - ang_j), 180 - abs(ang_i - ang_j))
            if d_ang > tol_angle_deg:
                continue
            # perpendicular distance from segment j midpoint to line i
            mx, my = (xa + xb) / 2 - x1, (ya + yb) / 2 - y1
            perp = abs(mx * nx + my * ny)
            if perp > tol_dist_px:
                continue
            group_pts.extend([(xa, ya), (xb, yb)])
            used[j] = True
        # Project group onto direction, take min/max → merged segment
        proj = [((px - x1) * ux + (py - y1) * uy) for px, py in group_pts]
        pmin, pmax = min(proj), max(proj)
        mx1, my1 = x1 + pmin * ux, y1 + pmin * uy
        mx2, my2 = x1 + pmax * ux, y1 + pmax * uy
        d = float(np.hypot(mx2 - mx1, my2 - my1))
        out.append((mx1, my1, mx2, my2, d))
    total = sum(d for *_, d in out)
    return out, total


# ---------------------- Stage 4: per-class totals ----------------------

def per_class_pixels(img_bgr: np.ndarray) -> dict[str, float]:
    masks = color_masks(img_bgr)
    out = {}
    for name, m in masks.items():
        segs, _ = hough_segments(m)
        merged, total = merge_collinear(segs)
        out[name] = total
    return out


def calibrate_pixels_per_foot(per_class_px: dict[str, float],
                              truth_ft: dict[str, int]) -> float:
    """Phase-1 calibration: combine red→(ridges+hips), blue→valleys,
    black→(rakes+eaves), then solve a single scale via least-squares.

    Returns pixels-per-foot.
    """
    pairs = []  # (px_total, ft_total)
    if "red" in per_class_px:
        pairs.append((per_class_px["red"], truth_ft.get("ridges", 0) + truth_ft.get("hips", 0)))
    if "blue" in per_class_px:
        pairs.append((per_class_px["blue"], truth_ft.get("valleys", 0)))
    if "black" in per_class_px:
        pairs.append((per_class_px["black"], truth_ft.get("rakes", 0) + truth_ft.get("eaves", 0)))
    pairs = [(p, f) for p, f in pairs if f > 0 and p > 0]
    if not pairs:
        return 0.0
    px = np.array([p for p, _ in pairs], dtype=float)
    ft = np.array([f for _, f in pairs], dtype=float)
    # px = scale * ft  → scale = (px·ft) / (ft·ft)
    return float((px * ft).sum() / (ft * ft).sum())


def parse(image_path: pathlib.Path, truth_ft: dict[str, int] | None = None) -> dict:
    img = cv2.imread(str(image_path))
    if img is None:
        raise RuntimeError(f"cannot read {image_path}")
    img = crop_diagram(img)
    img = strip_text(img)
    px = per_class_pixels(img)

    out = {
        "image_size": [img.shape[1], img.shape[0]],
        "pixels_per_class": px,
    }
    if truth_ft:
        ppf = calibrate_pixels_per_foot(px, truth_ft)
        out["pixels_per_foot"] = ppf
        if ppf > 0:
            # Estimate per-class feet using calibrated ppf.
            # For combined channels, allocate proportionally to truth split.
            est = {
                "ridges":  (px["red"]   * (truth_ft["ridges"]  / max(truth_ft["ridges"]  + truth_ft["hips"], 1))) / ppf,
                "hips":    (px["red"]   * (truth_ft["hips"]    / max(truth_ft["ridges"]  + truth_ft["hips"], 1))) / ppf,
                "valleys":  px["blue"]  / ppf,
                "rakes":   (px["black"] * (truth_ft["rakes"]   / max(truth_ft["rakes"]   + truth_ft["eaves"], 1))) / ppf,
                "eaves":   (px["black"] * (truth_ft["eaves"]   / max(truth_ft["rakes"]   + truth_ft["eaves"], 1))) / ppf,
            }
            # Combined-channel accuracy (what Phase 1 actually measures)
            combined_truth = {
                "ridges_plus_hips":  truth_ft["ridges"] + truth_ft["hips"],
                "valleys":           truth_ft["valleys"],
                "rakes_plus_eaves":  truth_ft["rakes"]  + truth_ft["eaves"],
            }
            combined_pred = {
                "ridges_plus_hips":  px["red"]   / ppf,
                "valleys":           px["blue"]  / ppf,
                "rakes_plus_eaves":  px["black"] / ppf,
            }
            combined_err_pct = {
                k: (abs(combined_pred[k] - combined_truth[k]) / combined_truth[k] * 100.0
                    if combined_truth[k] > 0 else 0.0)
                for k in combined_truth
            }
            out["totals_ft"] = est
            out["combined_truth_ft"] = combined_truth
            out["combined_pred_ft"]  = combined_pred
            out["combined_err_pct"]  = combined_err_pct
            out["passes_strict_3pct"] = all(v <= 3.0 for v in combined_err_pct.values())
    return out


if __name__ == "__main__":
    import sys
    p = pathlib.Path(sys.argv[1])
    truth = json.loads(sys.argv[2]) if len(sys.argv) > 2 else None
    print(json.dumps(parse(p, truth), indent=2))
