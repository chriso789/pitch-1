"""PITCH-owned roof damage recognition (no external AI API).

Loads PITCH-controlled ONNX detector weights from PITCH_VISION_MODEL_PATH and
returns normalized bbox detections in the Photo Intelligence contract.
Classes are only reported once listed in PITCH_VISION_TRAINED_CLASSES (i.e.
validated on inspector-labeled originals). Without weights, it returns no
detections and status "model_not_trained" — never invented findings.
"""
from __future__ import annotations

import io
import os
from typing import Any

DAMAGE_CLASSES = [
    "missing_shingles", "displaced_shingles", "cracked_tile", "displaced_tile",
    "ridge_cap_loss", "open_ridge_vent", "displaced_siding", "exposed_sheathing",
    "torn_house_wrap", "exposed_underlayment",
]

_session = None


def _trained_classes() -> set[str]:
    raw = os.environ.get("PITCH_VISION_TRAINED_CLASSES", "")
    return {c.strip() for c in raw.split(",") if c.strip() in DAMAGE_CLASSES}


def _load_session():
    global _session
    path = os.environ.get("PITCH_VISION_MODEL_PATH")
    if not path or not os.path.exists(path):
        return None
    if _session is None:
        import onnxruntime as ort  # local inference only
        _session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    return _session


def detect_damage(image_bytes: bytes, min_confidence: float = 0.5) -> dict[str, Any]:
    session = _load_session()
    trained = _trained_classes()
    if session is None or not trained:
        return {"status": "model_not_trained", "detections": [], "trained_classes": sorted(trained),
                "warnings": ["No validated PITCH damage model is installed; no automated findings produced."]}

    import numpy as np
    from PIL import Image, ImageOps

    img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    size = int(os.environ.get("PITCH_VISION_INPUT_SIZE", "640"))
    arr = np.asarray(img.resize((size, size)), dtype=np.float32) / 255.0
    tensor = arr.transpose(2, 0, 1)[None]
    # Expected export: outputs [boxes(N,4 normalized x1,y1,x2,y2), scores(N), labels(N)]
    boxes, scores, labels = session.run(None, {session.get_inputs()[0].name: tensor})[:3]
    detections = []
    for b, s, l in zip(boxes, scores, labels):
        cls = DAMAGE_CLASSES[int(l)] if 0 <= int(l) < len(DAMAGE_CLASSES) else None
        if cls not in trained or float(s) < min_confidence:
            continue
        x1, y1, x2, y2 = (float(max(0.0, min(1.0, v))) for v in b)
        if x2 <= x1 or y2 <= y1:
            continue
        detections.append({"component": "roof", "condition": cls, "description": cls.replace("_", " "),
                           "confidence": float(s), "bbox": [x1, y1, x2 - x1, y2 - y1]})
    return {"status": "ok", "detections": detections, "trained_classes": sorted(trained), "warnings": []}
