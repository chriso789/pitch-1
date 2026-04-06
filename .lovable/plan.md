

## Stage 5: Filtered Export + Multi-Channel Training Pipeline

### Dataset Reality Check

- **173 samples** pass quality filter (alignment_quality >= 0.02 + ridge >= 1)
- Of those: **161 have valleys**, **166 have hips** — excellent coverage
- Labels are nested: `labels->'lineLengths'->'ridge'` etc., pitch as string `"6/12"`
- Aerial URLs use Mapbox with embedded token (valid)
- No `ml/` directory exists yet — creating from scratch

### Plan

**Step 1 — Create export script** (`/tmp/export_dataset.py`)

Python script that:
1. Queries 173 filtered training pairs via psql (alignment_quality >= 0.02, ridge count >= 1)
2. Downloads each aerial image URL, resizes to 512x512 PNG
3. Rasterizes vector masks into **4 per-class PNGs** using `cv2.polylines(thickness=3)`:
   - `{id}_ridge.png`, `{id}_valley.png`, `{id}_hip.png`, `{id}_eave.png`
4. Exports `labels.json` with parsed values:
   - `area` from `labels.totalAreaSqft`
   - `ridge/valley/hip/eave` from `labels.lineLengths.*`
   - `pitch` parsed from `"6/12"` → `6.0`
5. Output to `/tmp/training_data/images/` and `/tmp/training_data/masks/`

**Step 2 — Create ML pipeline** (4 files in `ml/`)

- `ml/dataset_v2.py` — Multi-channel dataset (4 mask classes), loads per-class PNGs
- `ml/model_v3.py` — RoofNetV3: ResNet50 encoder + **upsampling** seg head (bilinear to 512x512) with 4 output channels + 6-value regression head
- `ml/loss_v2.py` — BCE (seg) + MSE (reg) combined loss
- `ml/train_v3.py` — 20 epochs on CPU (sandbox constraint), AdamW lr=2e-4, batch=4, saves checkpoint

Key fix vs user-provided model: the seg head needs `F.interpolate(seg, size=(512,512))` since ResNet50 produces 16x16 feature maps from 512x512 input.

**Step 3 — Run export + train**

1. Export filtered dataset (~173 samples)
2. Train 20 epochs (CPU, ~30-40 min)
3. Save checkpoint to `/mnt/documents/roofnet_v3.pth`
4. Generate sample visualization: input image + 4-channel mask overlay + prediction overlay → `/mnt/documents/sample_prediction.png`

### Technical Details

- **Rasterization**: Each mask segment has `points: [[x1,y1],[x2,y2],...]` in 512px space. Drawn as polylines on blank 512x512 canvas, thickness=3
- **Seg head upsampling**: ResNet50 `[:-2]` gives 2048x16x16. Seg head: Conv2d(2048,512,3,pad=1) → ReLU → Conv2d(512,4,1) → bilinear upsample to 512x512
- **Label normalization**: area/1000, lengths/100, pitch as-is (keeps values in reasonable range for MSE)
- **CPU training**: batch_size=4, 20 epochs achievable in sandbox. Full script provided for user to run 80 epochs on MPS

### Expected Output

- `/tmp/training_data/` — 173 images + 692 mask PNGs + labels.json
- `ml/` — 4 Python files (dataset, model, loss, train)
- `/mnt/documents/roofnet_v3.pth` — trained checkpoint
- `/mnt/documents/sample_prediction.png` — visual QA

