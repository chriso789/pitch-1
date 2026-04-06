

## Fix 3 Training Issues + Retrain RoofNetV3

### Problems Identified

1. **Label scaling too weak** — Currently dividing area by 1000 and lengths by 100. With areas ~10,000+ and lengths ~300+, normalized values are still 10+ and 3+, causing MSE to dominate. Need much more aggressive normalization.
2. **Loss weighting backwards** — `reg_weight=1.2` makes regression overpower segmentation. Segmentation head starves, produces near-blank outputs.
3. **Visualization threshold** — Sample prediction likely uses 0.5 threshold on weak logits, showing blank masks.

### Changes

**File 1: `ml/dataset_v2.py`** — Fix label scaling (lines 42-49)
```python
reg = torch.tensor([
    lbl.get('area', 0) / 10000.0,    # was /1000
    lbl.get('ridge', 0) / 500.0,     # was /100
    lbl.get('valley', 0) / 500.0,    # was /100
    lbl.get('hip', 0) / 500.0,       # was /100
    lbl.get('eave', 0) / 500.0,      # was /100
    lbl.get('pitch', 0) / 12.0,      # was raw
], dtype=torch.float32)
```

**File 2: `ml/loss_v2.py`** — Flip loss weighting
```python
# seg_weight=2.0 (was 1.0), reg_weight=0.5 (was 1.2)
# Forces model to learn shapes first, regression secondary
```

**File 3: `ml/train_v3.py`** — Train 10 epochs (sandbox max ~10 min), generate improved visualization with threshold=0.2 and raw logit heatmaps

**File 4: Generate new `/mnt/documents/sample_prediction_v2.png`** — Show:
- Input image
- Ground truth masks (4-channel overlay)
- Predicted masks at threshold 0.2
- Raw logit heatmaps (no threshold)
- Regression values with proper de-scaling (`pred[0] * 10000`, `pred[1:5] * 500`, `pred[5] * 12`)

### Why This Works
- Scaling all labels to 0-1 range means MSE loss stays small, doesn't drown segmentation
- 2x seg weight forces the model to prioritize learning mask structure
- Lower threshold (0.2) reveals what the model actually learned vs what was hidden by harsh cutoff
- 10 epochs on CPU is still limited — the script will be ready for 80+ epochs on user's MPS machine

### Deliverables
- Updated `ml/dataset_v2.py`, `ml/loss_v2.py`, `ml/train_v3.py`
- New checkpoint: `/mnt/documents/roofnet_v3_v2.pth`
- New QA image: `/mnt/documents/sample_prediction_v2.png`

