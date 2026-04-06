

## Complete the Interrupted Training Pipeline

### What's Missing

1. **Training data gone** — `/tmp/training_data/` is empty (ephemeral storage wiped)
2. **Label scaling not applied** — `dataset_v2.py` still uses weak normalization (area/1000, lengths/100)
3. **Loss weighting not applied** — `loss_v2.py` still uses seg=1.0, reg=1.2 (regression dominates)
4. **No v2 visualization** — `sample_prediction_v2.png` never generated

### Steps

**Step 1 — Re-export training dataset from database**
- Query properties with `alignment_quality >= 0.02` and `ridge_count >= 1`
- Download aerial images (512x512) to `/tmp/training_data/images/`
- Rasterize vector masks (ridge/valley/hip/eave) to `/tmp/training_data/masks/`
- Write `labels.json` with area, line lengths, pitch

**Step 2 — Apply the 3 fixes to ML files**
- `ml/dataset_v2.py`: area/10000, lengths/500, pitch/12
- `ml/loss_v2.py`: seg_weight=2.0, reg_weight=0.5
- Visualization threshold lowered to 0.2

**Step 3 — Train 5-10 epochs on CPU**
- Save checkpoint to `/mnt/documents/roofnet_v3_v2.pth`

**Step 4 — Generate improved visualization**
- 3 samples: input + ground truth + prediction (threshold 0.2) + raw logit heatmaps
- De-scaled regression values in readout
- Save to `/mnt/documents/sample_prediction_v2.png`

**Step 5 — Split checkpoint for download**
- Split into 40MB parts for downloadability

### Technical Notes
- Dataset export requires querying Supabase for property records and downloading Mapbox aerial tiles
- The previous export produced 92 high-quality samples; we should get a similar count
- CPU training at batch_size=4 for 5 epochs should complete within sandbox timeout (~5 min)

