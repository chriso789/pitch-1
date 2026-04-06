

## Restart Training Pipeline

### Current State
- **Dataset ready**: 92 images (512x512), 368 per-class masks (ridge/valley/hip/eave), labels.json — all on disk at `/tmp/training_data/`
- **Dependencies installed**: PyTorch 2.11, torchvision 0.26, OpenCV 4.13
- **ML files missing**: The `ml/` directory only has `__pycache__/` — the .py files from the previous interrupted run need to be recreated

### Plan

**Step 1 — Recreate 4 ML files in `ml/`**

- `ml/dataset_v2.py` — Multi-channel dataset loader (reads 4 mask PNGs per sample + labels.json)
- `ml/model_v3.py` — RoofNetV3: ResNet50 encoder, 4-channel seg head with bilinear upsample to 512x512, 6-value regression head
- `ml/loss_v2.py` — BCE (seg) + MSE (reg) combined loss
- `ml/train_v3.py` — Training loop: AdamW lr=2e-4, CosineAnnealingLR, batch=4, 15 epochs (CPU), saves best checkpoint

**Step 2 — Run training (15 epochs on CPU)**

- Train on the 92-sample dataset
- Save checkpoint to `/mnt/documents/roofnet_v3.pth`
- Log per-epoch loss

**Step 3 — Generate sample prediction visualization**

- Run inference on 3 test samples
- Create overlay image showing input + ground truth masks + predicted masks
- Save to `/mnt/documents/sample_prediction.png`

### Key Details
- Seg head must upsample from 16x16 → 512x512 (ResNet50 stride 32)
- Labels normalized: area/1000, lengths/100, pitch raw
- ~15 epochs on CPU should take ~20 min with batch=4

