"""
Pitch Internal U-Net Inference Service
=======================================
Production inference server that chains:
  fusion_fetch -> LovableRoofNet -> rule_engine -> canonical output

Start: python inference_service.py
Endpoint: POST /infer  { lead_id, address, lat, lng }
"""

import os
import json
import tempfile
from datetime import datetime, timezone

import numpy as np
import torch
from flask import Flask, request, jsonify
from PIL import Image, ImageDraw

from fusion_fetch import run_fusion, FusionResult
from rule_engine import classify_lines

DEVICE = "cuda" if torch.cuda.is_available() else ("mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
MODEL_PATH = os.environ.get("MODEL_PATH", "./roof-training/exports/checkpoints/best_roofnet.pt")
MODEL_VERSION = os.environ.get("MODEL_VERSION", "lovable-roofnet-v1")
INTERNAL_API_KEY = os.environ.get("INTERNAL_UNET_API_KEY", "")

app = Flask(__name__)

# Lazy model loading
_model = None

def get_model():
    global _model
    if _model is None:
        from train_lovable_roofnet import LovableRoofNet
        _model = LovableRoofNet()
        if os.path.exists(MODEL_PATH):
            checkpoint = torch.load(MODEL_PATH, map_location=DEVICE)
            state = checkpoint.get("model_state_dict", checkpoint)
            _model.load_state_dict(state)
        _model.to(DEVICE)
        _model.eval()
    return _model


def preprocess(img: Image.Image) -> torch.Tensor:
    img = img.resize((512, 512))
    arr = np.asarray(img).astype(np.float32) / 255.0
    arr = np.transpose(arr, (2, 0, 1))
    return torch.tensor(arr, dtype=torch.float32).unsqueeze(0).to(DEVICE)


def save_overlay(image_pil: Image.Image, polygon, features) -> str:
    img = image_pil.copy().convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")

    if polygon and len(polygon) > 2:
        pts = [(int(p[0]), int(p[1])) for p in polygon]
        draw.polygon(pts, outline=(34, 197, 94, 255), fill=(34, 197, 94, 30))

    color_map = {
        "ridge": (239, 68, 68, 255),
        "hip": (245, 158, 11, 255),
        "valley": (59, 130, 246, 255),
        "eave": (34, 197, 94, 255),
        "rake": (168, 85, 247, 255),
    }

    for f in features:
        p1 = (int(f["p1"][0]), int(f["p1"][1]))
        p2 = (int(f["p2"][0]), int(f["p2"][1]))
        color = color_map.get(f.get("kind", f.get("type", "")), (255, 255, 255, 255))
        draw.line([p1, p2], fill=color, width=4)

    out = Image.alpha_composite(img, overlay)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
    out.save(tmp.name)
    return tmp.name


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model_version": MODEL_VERSION})


@app.route("/infer", methods=["POST"])
def infer():
    # Auth check
    auth = request.headers.get("Authorization", "")
    if INTERNAL_API_KEY and auth != f"Bearer {INTERNAL_API_KEY}":
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.json or {}
    lead_id = payload.get("lead_id")
    address = payload.get("address")
    lat = payload.get("lat")
    lng = payload.get("lng")

    if lat is None or lng is None:
        return jsonify({"error": "Missing coordinates"}), 400

    # Step 1: Fusion fetch
    fusion = run_fusion(lat, lng)

    # Step 2: Get satellite image
    # fusion_fetch saves mapbox_satellite.png by default
    img_path = "mapbox_satellite.png"
    if not os.path.exists(img_path):
        return jsonify({"error": "Satellite image not retrieved"}), 500

    image = Image.open(img_path).convert("RGB")
    img_w, img_h = image.size

    # Step 3: Model inference
    model = get_model()
    x = preprocess(image)

    with torch.no_grad():
        seg_logits, reg_pred = model(x)

    seg = torch.sigmoid(seg_logits)[0].cpu().numpy()
    reg = reg_pred[0].cpu().numpy().tolist()

    # Threshold masks
    footprint_mask = (seg[0] > 0.5).astype(np.uint8)
    ridge_mask = (seg[1] > 0.5).astype(np.uint8)
    hip_mask = (seg[2] > 0.5).astype(np.uint8)
    valley_mask = (seg[3] > 0.5).astype(np.uint8)
    eave_mask = (seg[4] > 0.5).astype(np.uint8)
    rake_mask = (seg[5] > 0.5).astype(np.uint8)

    # Step 4: Rule engine
    mpp = fusion.mapbox_image_metadata.get("meters_per_pixel", 0.14) if fusion.mapbox_image_metadata else 0.14
    roof_stats = []
    if fusion.building_insights and isinstance(fusion.building_insights, dict):
        roof_stats = fusion.building_insights.get("roof_segment_stats", [])

    classified = classify_lines(
        footprint_mask=footprint_mask,
        ridge_mask=ridge_mask,
        hip_mask=hip_mask,
        valley_mask=valley_mask,
        eave_mask=eave_mask,
        rake_mask=rake_mask,
        roof_segment_stats=roof_stats,
        meters_per_pixel=mpp,
    )

    # Extract results
    pitch = classified.get("predominant_pitch_degrees")
    if pitch is None and len(reg) > 6:
        pitch = reg[6]

    # Compute area from footprint mask
    area_sqft = None
    fp_pixels = int(np.sum(footprint_mask))
    if fp_pixels > 0 and mpp > 0:
        # Scale mask from 512x512 back to image dimensions
        scale_x = img_w / 512.0
        scale_y = img_h / 512.0
        area_m2 = fp_pixels * (mpp * scale_x) * (mpp * scale_y)
        area_sqft = area_m2 * 10.7639
        if pitch and pitch > 0:
            import math
            pitch_rad = math.atan(pitch / 12.0)
            area_sqft = area_sqft / math.cos(pitch_rad)

    # Build features list
    features = []
    for f in classified.get("features", []):
        length_ft = None
        if mpp > 0:
            length_ft = f.get("length_px", 0) * mpp * 3.28084
        features.append({
            "type": f.get("kind", f.get("type", "unknown")),
            "p1": [float(f["p1"][0]), float(f["p1"][1])],
            "p2": [float(f["p2"][0]), float(f["p2"][1])],
            "length_px": float(f.get("length_px", 0)),
            "length_ft": float(length_ft) if length_ft is not None else None,
            "confidence": float(f.get("confidence", 0.5)),
            "source": "rule_engine",
        })

    polygon = [[float(p[0]), float(p[1])] for p in classified.get("polygon", [])]

    # Compute length totals
    lengths_ft = classified.get("totals_ft") or {}
    if not lengths_ft and len(reg) >= 6:
        lengths_ft = {
            "ridge": reg[1], "hip": reg[2], "valley": reg[3],
            "eave": reg[4], "rake": reg[5]
        }
    lengths_ft.setdefault("ridge", 0)
    lengths_ft.setdefault("hip", 0)
    lengths_ft.setdefault("valley", 0)
    lengths_ft.setdefault("eave", 0)
    lengths_ft.setdefault("rake", 0)
    lengths_ft["perimeter"] = lengths_ft.get("eave", 0) + lengths_ft.get("rake", 0)

    confidence = 0.55
    if classified.get("features"):
        confs = [f.get("confidence", 0.5) for f in classified["features"]]
        confidence = float(min(0.99, max(0.40, sum(confs) / len(confs))))

    zoom = fusion.mapbox_image_metadata.get("zoom", 19) if fusion.mapbox_image_metadata else 19

    measurement_data = {
        "meta": {
            "version": "v1",
            "source": "pitch-internal-unet",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model_version": MODEL_VERSION,
            "rule_engine_version": "v1",
            "fusion_version": "v1",
        },
        "location": {
            "address": address,
            "lat": float(lat),
            "lng": float(lng),
        },
        "roof": {
            "type": classified.get("roof_type", "unknown"),
            "confidence": confidence,
        },
        "measurements": {
            "area_sqft": float(area_sqft) if area_sqft is not None else None,
            "predominant_pitch": float(pitch) if pitch is not None else None,
            "facets": len(roof_stats) if roof_stats else None,
            "lengths_ft": {k: float(v) for k, v in lengths_ft.items()},
        },
        "geometry": {
            "footprint_polygon": polygon,
            "features": features,
        },
        "overlay": {
            "version": "v1",
            "image": {
                "url": None,
                "width": img_w,
                "height": img_h,
                "center_lat": float(lat),
                "center_lng": float(lng),
                "zoom": float(zoom),
                "meters_per_pixel": float(mpp),
            },
            "polygon": polygon,
            "features": features,
        },
        "debug": {
            "meters_per_pixel": float(mpp),
            "solar_pitch_used": classified.get("predominant_pitch_degrees") is not None,
            "alignment_score": None,
            "imagery_source": "mapbox_satellite",
            "warnings": [],
        },
    }

    return jsonify({
        "measurement_data": measurement_data,
        "overlay_schema": measurement_data["overlay"],
        "satellite_overlay_url": None,
        "perimeter_wkt": None,
        "linear_features_wkt": None,
        "roof_type": measurement_data["roof"]["type"],
        "total_area_sqft": measurement_data["measurements"]["area_sqft"],
        "predominant_pitch": measurement_data["measurements"]["predominant_pitch"],
        "ridge_length_ft": lengths_ft.get("ridge", 0),
        "hip_length_ft": lengths_ft.get("hip", 0),
        "valley_length_ft": lengths_ft.get("valley", 0),
        "eave_length_ft": lengths_ft.get("eave", 0),
        "rake_length_ft": lengths_ft.get("rake", 0),
        "confidence": confidence,
        "model_version": MODEL_VERSION,
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
