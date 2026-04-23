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

try:
    import pytesseract
    _HAS_OCR = True
except Exception:
    _HAS_OCR = False


# ---------------------- Stage 0: OCR-anchored legend/scale masking ----------------------

# Anything inside an axis-aligned bbox containing one of these tokens is NOT roof geometry.
_LEGEND_TOKENS = (
    "LEGEND", "Legend",
    "Ridge", "Ridges", "Hip", "Hips", "Valley", "Valleys",
    "Rake", "Rakes", "Eave", "Eaves", "Flashing", "Step",
    "NORTH", "North",
    "Note:", "Notes:",
)
# Scale-bar tokens (always near a horizontal black bar with tick marks).
_SCALE_TOKENS = ("ft", "feet", "Scale", "SCALE")


def _ocr_boxes(img_bgr: np.ndarray):
    """Return list of (x, y, w, h, text) for every recognised word."""
    if not _HAS_OCR:
        return []
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    try:
        data = pytesseract.image_to_data(
            gray, output_type=pytesseract.Output.DICT,
            config="--psm 11"  # sparse text — find as many words as possible
        )
    except Exception:
        return []
    out = []
    for i, txt in enumerate(data["text"]):
        if not txt or not txt.strip():
            continue
        try:
            conf = float(data["conf"][i])
        except Exception:
            conf = -1
        if conf < 30:
            continue
        out.append((
            int(data["left"][i]), int(data["top"][i]),
            int(data["width"][i]), int(data["height"][i]),
            txt.strip(),
        ))
    return out


def mask_legend_and_scale(img_bgr: np.ndarray) -> np.ndarray:
    """Use OCR to find the LEGEND block + scale-bar, then white them out.

    Strategy:
      1. OCR the page; collect word bboxes.
      2. If we see a LEGEND token, expand its bbox to include every word
         within ~14% of page width / 35% of page height of it (the legend
         is a tight cluster of class names).
      3. If we see a scale token ('ft' / 'Scale'), expand around it to cover
         the scale-bar tick row (usually a thin horizontal strip).
      4. Paint each cluster bbox + a small margin to white.
    """
    h, w = img_bgr.shape[:2]
    out = img_bgr.copy()
    boxes = _ocr_boxes(img_bgr)
    if not boxes:
        return out

    def cluster(seed_idx: int, max_dx: float, max_dy: float):
        sx, sy, sw, sh, _ = boxes[seed_idx]
        cx, cy = sx + sw / 2, sy + sh / 2
        xs0, ys0, xs1, ys1 = sx, sy, sx + sw, sy + sh
        for j, (bx, by, bw, bh, _t) in enumerate(boxes):
            mx, my = bx + bw / 2, by + bh / 2
            if abs(mx - cx) <= max_dx and abs(my - cy) <= max_dy:
                xs0 = min(xs0, bx)
                ys0 = min(ys0, by)
                xs1 = max(xs1, bx + bw)
                ys1 = max(ys1, by + bh)
        return xs0, ys0, xs1, ys1

    rects: list[tuple[int, int, int, int]] = []
    for idx, (_x, _y, _w, _h, t) in enumerate(boxes):
        if any(tok in t for tok in _LEGEND_TOKENS):
            rects.append(cluster(idx, w * 0.14, h * 0.30))
        elif any(tok == t or tok in t for tok in _SCALE_TOKENS):
            rects.append(cluster(idx, w * 0.18, h * 0.04))

    margin_x, margin_y = int(w * 0.012), int(h * 0.012)
    for x0, y0, x1, y1 in rects:
        x0 = max(0, x0 - margin_x)
        y0 = max(0, y0 - margin_y)
        x1 = min(w, x1 + margin_x)
        y1 = min(h, y1 + margin_y)
        out[y0:y1, x0:x1] = (255, 255, 255)
    return out


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


def blank_legend(img_bgr: np.ndarray) -> np.ndarray:
    """EagleView Length Diagrams render a legend + scale-bar in a fixed
    rectangle in the lower-left corner. Both contain pure red, blue, and
    black sample lines that are NOT roof edges. We blank that rectangle
    to white before color-splitting.

    Heuristic: scan the lower-left quadrant for a tight cluster of all
    three colors (red + blue + black) inside a small rectangular region
    bordered by a black box. If found, paint it white. If not found,
    fall back to a conservative fixed crop (lower-left 22% W x 18% H).
    """
    h, w = img_bgr.shape[:2]
    out = img_bgr.copy()
    # Conservative fallback rectangle (lower-left)
    x0, y0 = int(w * 0.00), int(h * 0.78)
    x1, y1 = int(w * 0.26), int(h * 1.00)

    # Try to refine: look for a black-bordered box in that quadrant
    quad = cv2.cvtColor(img_bgr[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    _, binv = cv2.threshold(quad, 130, 255, cv2.THRESH_BINARY_INV)
    n, _, stats, _ = cv2.connectedComponentsWithStats(binv, connectivity=8)
    best = None
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if ww > quad.shape[1] * 0.4 and hh > quad.shape[0] * 0.4 and area > 0.02 * quad.size:
            if best is None or area > best[4]:
                best = (x, y, ww, hh, area)
    if best is not None:
        bx, by, bw, bh, _ = best
        x0r, y0r = x0 + bx, y0 + by
        x1r, y1r = x0r + bw, y0r + bh
        out[y0r:y1r, x0r:x1r] = (255, 255, 255)
    else:
        out[y0:y1, x0:x1] = (255, 255, 255)
    return out


def filter_dashed(mask: np.ndarray, min_dashes: int = 3) -> np.ndarray:
    """Keep only line-runs that are actually dashed (real valleys);
    drop solid blue runs (legend swatches, scale bars, north arrows).

    For each connected component on the *raw* (non-bridged) mask,
    measure the ratio of run-length-pixels to bbox diagonal. Solid
    lines have ratio close to 1; dashed lines have ratio ~0.4-0.7.
    Reject components with ratio > 0.85 (solid) or with too few
    distinct dash blobs along their major axis.
    """
    out = np.zeros_like(mask)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        diag = float(np.hypot(ww, hh))
        if diag < 12:
            continue
        fill = area / max(diag, 1.0)
        # Solid sample line in legend: fill ratio is high relative to length
        if ww * hh < 200 and fill > 6.0:
            continue
        # Count dash blobs along the component
        comp = (lbl[y:y+hh, x:x+ww] == i).astype(np.uint8) * 255
        nb, _, _, _ = cv2.connectedComponentsWithStats(comp, connectivity=8)
        # Note: comp itself is one component; re-erode to split dashes
        eroded = cv2.erode(comp, np.ones((2, 2), np.uint8), iterations=1)
        nd, _, _, _ = cv2.connectedComponentsWithStats(eroded, connectivity=8)
        # nd-1 is dash count after erosion. Solid → ~1, dashed → many.
        if (nd - 1) < min_dashes and diag > 40:
            continue
        out[y:y+hh, x:x+ww] |= comp
    return out


def reject_arrows(mask: np.ndarray) -> np.ndarray:
    """Drop tiny arrow-tip blobs from the red channel (leader arrows
    pointing from callouts to edges). Arrows are small + roughly
    triangular (high solidity, small area, low aspect)."""
    out = mask.copy()
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if area < 80 and max(ww, hh) < 18:
            out[y:y+hh, x:x+ww][lbl[y:y+hh, x:x+ww] == i] = 0
    return out


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
    # Round-2: drop only arrow-tip blobs from red. filter_dashed and
    # blank_legend were too aggressive — they killed real valleys and
    # real perimeter — so they are disabled until we can detect the
    # legend rectangle more reliably (Round-3).
    masks["red"]  = reject_arrows(masks["red"])
    out = {}
    for name, m in masks.items():
        if name == "blue":
            m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 9), np.uint8))
            m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 3), np.uint8))
        min_len = 22 if name == "blue" else 18
        max_gap = 12 if name == "blue" else 8
        segs, _ = hough_segments(m, min_len=min_len, max_gap=max_gap)
        _, total = merge_collinear(segs)
        out[name] = total
    return out


def calibrate_per_channel(per_class_px: dict[str, float],
                          truth_ft: dict[str, int]) -> dict[str, float]:
    """One scale per color channel — isolates pure CV-separation error."""
    truth_red   = truth_ft.get("ridges", 0) + truth_ft.get("hips", 0)
    truth_blue  = truth_ft.get("valleys", 0)
    truth_black = truth_ft.get("rakes", 0)  + truth_ft.get("eaves", 0)
    return {
        "red":   (per_class_px.get("red",   0.0) / truth_red)   if truth_red   > 0 else 0.0,
        "blue":  (per_class_px.get("blue",  0.0) / truth_blue)  if truth_blue  > 0 else 0.0,
        "black": (per_class_px.get("black", 0.0) / truth_black) if truth_black > 0 else 0.0,
    }


def parse(image_path: pathlib.Path, truth_ft: dict[str, int] | None = None) -> dict:
    img = cv2.imread(str(image_path))
    if img is None:
        raise RuntimeError(f"cannot read {image_path}")
    img = crop_diagram(img)
    # Round-3: OCR-anchored legend + scale-bar removal (was: heuristic blank_legend).
    img = mask_legend_and_scale(img)
    img = strip_text(img)
    px = per_class_pixels(img)

    out = {
        "image_size": [img.shape[1], img.shape[0]],
        "pixels_per_class": px,
    }
    if truth_ft:
        ppf_per = calibrate_per_channel(px, truth_ft)
        out["pixels_per_foot_per_channel"] = ppf_per

        # Honest signal: residual against a SHARED scale (median of
        # channel scales). Per-channel scales are exact by construction;
        # their spread measures how cleanly each color isolates its lines.
        scales = [s for s in ppf_per.values() if s > 0]
        if scales:
            shared = float(np.median(scales))
            out["pixels_per_foot_shared"] = shared
            combined_truth = {
                "ridges_plus_hips":  truth_ft["ridges"] + truth_ft["hips"],
                "valleys":           truth_ft["valleys"],
                "rakes_plus_eaves":  truth_ft["rakes"]  + truth_ft["eaves"],
            }
            combined_pred = {
                "ridges_plus_hips":  px.get("red",   0) / shared,
                "valleys":           px.get("blue",  0) / shared,
                "rakes_plus_eaves":  px.get("black", 0) / shared,
            }
            combined_err_pct = {
                k: (abs(combined_pred[k] - combined_truth[k]) / combined_truth[k] * 100.0
                    if combined_truth[k] > 0 else 0.0)
                for k in combined_truth
            }
            out["combined_truth_ft"] = combined_truth
            out["combined_pred_ft"]  = combined_pred
            out["combined_err_pct"]  = combined_err_pct
            out["passes_strict_3pct"] = all(v <= 3.0 for v in combined_err_pct.values())
            out["channel_scale_dev_pct"] = {
                ch: (abs(ppf_per[ch] - shared) / shared * 100.0 if shared > 0 else 0.0)
                for ch in ("red", "blue", "black")
            }
    return out


if __name__ == "__main__":
    import sys
    p = pathlib.Path(sys.argv[1])
    truth = json.loads(sys.argv[2]) if len(sys.argv) > 2 else None
    print(json.dumps(parse(p, truth), indent=2))
