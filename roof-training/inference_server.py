"""
Pitch AI — Roof Inference Server

Production-ready Flask endpoint that:
  1. Calls the data fusion layer (Mapbox + Google Solar)
  2. Runs the trained LovableRoofNet model
  3. Applies the deterministic rule engine
  4. Returns structured JSON matching Pitch's measurement schema

Start:
    pip install flask torch torchvision numpy pillow opencv-python requests
    export GOOGLE_SOLAR_API_KEY=...
    export MAPBOX_ACCESS_TOKEN=...
    python inference_server.py

Then set PYTHON_INFERENCE_URL=http://localhost:5001/infer in your
Supabase Edge Function secrets.
"""

import os
import json
import math
import traceback
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import torch
from PIL import Image
from flask import Flask, request, jsonify

# Local imports from the roof-training package
from fusion_fetch import run_fusion, get_mapbox_static_image, meters_per_pixel as calc_mpp
from rule_engine import classify_lines, estimate_area_sqft_from_footprint_mask
from train_lovable_roofnet import LovableRoofNet, SEG_CLASSES, REG_TARGETS

# ──────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────

MODEL_PATH = os.environ.get(
    "ROOFNET_MODEL_PATH",
    str(Path(__file__).parent / "exports" / "checkpoints" / "best_roofnet.pt"),
)
IMAGE_SIZE = int(os.environ.get("ROOF_IMAGE_SIZE", "512"))
DEVICE = (
    "cuda"
    if torch.cuda.is_available()
    else ("mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
)

app = Flask(__name__)

# ──────────────────────────────────────────────
# Model loading (once at startup)
# ──────────────────────────────────────────────

_model = None


def get_model() -> LovableRoofNet:
    global _model
    if _model is not None:
        return _model

    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"No trained checkpoint at {MODEL_PATH}. "
            "Run train_lovable_roofnet.py first."
        )

    checkpoint = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=False)
    seg_classes = len(checkpoint.get("config", {}).get("seg_classes", SEG_CLASSES))
    reg_outputs = len(checkpoint.get("config", {}).get("reg_targets", REG_TARGETS))

    model = LovableRoofNet(seg_classes=seg_classes, reg_outputs=reg_outputs)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.to(DEVICE)
    model.eval()
    _model = model
    print(f"✅ Model loaded from {MODEL_PATH} on {DEVICE}")
    return model


# ──────────────────────────────────────────────
# Preprocessing
# ──────────────────────────────────────────────


def preprocess(img: Image.Image) -> torch.Tensor:
    img = img.resize((IMAGE_SIZE, IMAGE_SIZE))
    arr = np.array(img).astype(np.float32) / 255.0
    arr = np.transpose(arr, (2, 0, 1))  # HWC -> CHW
    return torch.tensor(arr).unsqueeze(0).to(DEVICE)


def denormalize_regression(t: torch.Tensor) -> dict:
    scales = [10000.0, 500.0, 500.0, 500.0, 1000.0, 500.0, 12.0]
    values = (t.cpu().numpy() * np.array(scales)).tolist()
    return dict(zip(REG_TARGETS, values))


# ──────────────────────────────────────────────
# Inference endpoint
# ──────────────────────────────────────────────


@app.route("/infer", methods=["POST"])
def infer():
    try:
        data = request.json
        lat = float(data["lat"])
        lng = float(data["lng"])
        address = data.get("address", "Unknown")
        pitch_override = data.get("pitch_override")

        # ── Step 1: Fusion fetch ──
        fusion = run_fusion(lat, lng)

        # Fetch satellite image
        static_img = get_mapbox_static_image(fusion.lat, fusion.lng)
        img = static_img.image
        mpp = static_img.meters_per_pixel

        # ── Step 2: Model inference ──
        model = get_model()
        x = preprocess(img)

        with torch.no_grad():
            seg_logits, reg_pred = model(x)

        seg_probs = torch.sigmoid(seg_logits)[0].cpu().numpy()
        reg_values = denormalize_regression(reg_pred[0])

        # Threshold masks
        masks = {}
        for i, cls in enumerate(SEG_CLASSES):
            masks[cls] = (seg_probs[i] > 0.5).astype(np.uint8) * 255

        # ── Step 3: Rule engine ──
        roof_segment_stats = fusion.building_insights.get("roof_segment_stats", [])
        geometry = classify_lines(
            footprint_mask=masks["footprint"],
            ridge_mask=masks["ridge"],
            hip_mask=masks["hip"],
            valley_mask=masks["valley"],
            eave_mask=masks["eave"],
            rake_mask=masks["rake"],
            roof_segment_stats=roof_segment_stats,
            meters_per_pixel=mpp,
        )

        # Area from footprint mask + pitch
        pitch_deg = geometry.get("predominant_pitch_degrees")
        if pitch_override:
            try:
                pitch_deg = float(pitch_override)
            except ValueError:
                pass

        area_sqft = estimate_area_sqft_from_footprint_mask(
            masks["footprint"], mpp, pitch=pitch_deg
        )

        totals_ft = geometry.get("totals_ft") or {}

        # ── Step 4: Build structured response ──
        output = {
            "meta": {
                "version": "v1",
                "source": "pitch-ai",
                "generated_at": datetime.now(timezone.utc).isoformat(),
            },
            "location": {
                "address": address,
                "lat": lat,
                "lng": lng,
            },
            "roof": {
                "type": geometry.get("roof_type", "unknown"),
                "confidence": round(
                    float(np.mean([f.get("confidence", 0) for f in geometry.get("features", []) if f.get("confidence")])) if geometry.get("features") else 0,
                    3,
                ),
            },
            "measurements": {
                "area_sqft": round(area_sqft, 1),
                "predominant_pitch": round(pitch_deg, 1) if pitch_deg else None,
                "lengths_ft": {
                    "ridge": round(totals_ft.get("ridge", 0), 1),
                    "hip": round(totals_ft.get("hip", 0), 1),
                    "valley": round(totals_ft.get("valley", 0), 1),
                    "eave": round(totals_ft.get("eave", 0), 1),
                    "rake": round(totals_ft.get("rake", 0), 1),
                },
            },
            "geometry": {
                "footprint_polygon": geometry.get("polygon", []),
                "features": geometry.get("features", []),
            },
            "regression": reg_values,
            "debug": {
                "meters_per_pixel": round(mpp, 4),
                "alignment_score": None,
                "solar_pitch_used": pitch_deg is not None and not pitch_override,
                "device": DEVICE,
                "image_size": IMAGE_SIZE,
                "fusion_lat": fusion.lat,
                "fusion_lng": fusion.lng,
            },
        }

        return jsonify(output)

    except FileNotFoundError as e:
        return jsonify({"error": str(e), "hint": "Train the model first"}), 503
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    model_exists = os.path.exists(MODEL_PATH)
    return jsonify({
        "status": "ok",
        "model_loaded": _model is not None,
        "model_path": MODEL_PATH,
        "model_exists": model_exists,
        "device": DEVICE,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    print(f"🚀 Pitch Roof Inference Server starting on port {port}")
    print(f"   Model: {MODEL_PATH}")
    print(f"   Device: {DEVICE}")

    # Pre-load model if checkpoint exists
    if os.path.exists(MODEL_PATH):
        try:
            get_model()
        except Exception as e:
            print(f"⚠️  Model pre-load failed: {e}")

    app.run(host="0.0.0.0", port=port, debug=False)
