"""Train PITCH's roof damage detector from an exported, versioned YOLO dataset.

Open-source only (Ultralytics YOLO segmentation, AGPL — review licence before
commercial distribution; swap for a permissive detector if required). No
external inference API is called. CPU works for development; pass --device 0
only on authorized GPU hosts. Checkpoints resume with --resume.

  python worker/training/train_detector.py --data export/v1/data.yaml \
      --dataset-version v1 --out runs/v1 [--epochs 100] [--device cpu] [--resume]

Writes runs/<v>/pitch_model_manifest.json linking weights ↔ dataset version.
The model is NOT deployable until evaluate_detector.py passes per-class gates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import time


def sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--dataset-version", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="yolov8n-seg.pt")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--resume", action="store_true")
    a = ap.parse_args()

    from ultralytics import YOLO  # installed only on training hosts

    out = pathlib.Path(a.out)
    last = out / "train" / "weights" / "last.pt"
    model = YOLO(str(last) if a.resume and last.exists() else a.base)
    t0 = time.time()
    model.train(data=a.data, epochs=a.epochs, imgsz=a.imgsz, device=a.device,
                project=str(out), name="train", exist_ok=True, save_period=5,
                resume=a.resume and last.exists(), seed=0, deterministic=True)
    best = out / "train" / "weights" / "best.pt"
    onnx = pathlib.Path(YOLO(str(best)).export(format="onnx", imgsz=a.imgsz))
    manifest = {
        "dataset_version": a.dataset_version, "base_model": a.base, "epochs": a.epochs,
        "imgsz": a.imgsz, "device": a.device, "train_seconds": round(time.time() - t0),
        "weights": str(best), "onnx": str(onnx), "onnx_sha256": sha256(onnx),
        "status": "trained_unvalidated",
    }
    (out / "pitch_model_manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
