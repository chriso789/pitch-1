

## Stage 5: Export Filtered Dataset + Multi-Channel Mask Rasterization + Training

### Current State

- **368 total** training pairs, **279 with masks**, **237 pass ridge filter**
- Masks are stored as **vector segments** (coordinate arrays like `[[584, 565.3], [696, 565.3]]`), not raster images
- Labels exist as JSON with `lineLengths.ridge/valley/hip/eave` and `totalAreaSqft`, `predominantPitch`
- `alignment_quality` is numeric (0.0 to 1.0), not text — filtering will use a threshold (e.g., > 0.01 to exclude the 157 zero-quality synthetics, or keep all with ridge >= 1)
- No existing `train_v2.py` or dataset export scripts in the codebase

### Plan

**Step 1 — Export script: query, filter, rasterize, save**

Create `/tmp/export_dataset.py` that:
1. Queries all 237 eligible training pairs (has ridge >= 1, has aerial_image_url, has line_masks)
2. Downloads each aerial image to `data/training/images/{id}.png` (resized to 512x512)
3. Rasterizes vector masks into **4 separate per-class PNGs** using OpenCV `cv2.polylines()`:
   - `data/training/masks/{id}_ridge.png`
   - `data/training/masks/{id}_valley.png`
   - `data/training/masks/{id}_hip.png`
   - `data/training/masks/{id}_eave.png`
   - Line width of 3px for visibility
4. Exports `data/training/labels.json` with normalized values:
   ```json
   { "abc123": { "area": 2200, "ridge": 35, "valley": 0, "hip": 0, "eave": 120, "pitch": 6 } }
   ```
5. Writes summary stats to console

**Step 2 — Training files**

Create in project root `ml/`:
- `ml/dataset_v2.py` — Multi-channel dataset loader (4-class masks)
- `ml/model_v3.py` — RoofNetV3 (ResNet50 encoder, 4-class seg head, 6-value regression head)
- `ml/loss_v2.py` — BCE + MSE combined loss
- `ml/train_v3.py` — Training loop (80 epochs, AdamW, lr=2e-4, batch=6)

**Step 3 — Run export + training**

1. Run export script to materialize dataset to disk
2. Run `train_v3.py` for 80 epochs
3. Save model checkpoint to `/mnt/documents/roofnet_v3.pth`
4. Generate sample predictions: 1 input image, 1 multi-channel mask overlay, 1 prediction overlay

### Key Technical Details

- **Vector-to-raster**: Each mask segment has `points: [[x1,y1],[x2,y2],...]`. These are drawn as polylines on a blank 512x512 canvas with `cv2.polylines(canvas, [pts], False, 255, thickness=3)`
- **Pitch parsing**: `predominantPitch` is stored as string like `"6/12"` — parse to numeric `6.0`
- **Quality filter**: Keep pairs where `ridge_count >= 1` and `aerial_image_url` exists (237 samples). The 157 with `alignment_quality=0.0` still have valid geometry from templates — worth keeping for volume
- **No GPU available** in sandbox — training will use CPU, so batch_size=4 and we may cap at 20-30 epochs for time, then deliver checkpoint + script for full training on user's MPS machine

### Expected Output

- `data/training/images/` — ~237 aerial PNGs (512x512)
- `data/training/masks/` — ~948 per-class mask PNGs
- `data/training/labels.json` — regression labels
- `ml/` — training code (4 files)
- `/mnt/documents/roofnet_v3.pth` — model checkpoint
- `/mnt/documents/sample_prediction.png` — visual QA

