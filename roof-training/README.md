# Roof Training Dataset

## Structure

```
roof-training/
├── classes.json          # Segmentation + regression target definitions
├── splits/               # train.txt, val.txt, test.txt (sample IDs)
├── images/               # Square PNG satellite crops (north-up, same size)
├── masks/                # Per-class binary masks
│   ├── footprint/
│   ├── ridge/
│   ├── hip/
│   ├── valley/
│   ├── eave/
│   └── rake/
├── labels/               # Per-sample JSON with regression targets + quality
├── overlays/             # Visual QA overlays
├── metadata/             # Per-sample geo/source metadata
└── exports/
    ├── checkpoints/      # Model weights
    ├── previews/         # Epoch preview images
    └── metrics/          # Training history JSON
```

## Quality Gates

- `alignment_quality >= 0.50`
- All 7 regression targets present
- Footprint mask exists
- At least one structural line mask exists
- Line masks must be thickened binary (not 1px)
- Images must be square, same size, north-up

## Training

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install torch torchvision pillow numpy opencv-python
export ROOF_DATASET_ROOT=/path/to/roof-training
python train_lovable_roofnet.py
```

## Rule Engine

After model inference, run `rule_engine.py` to classify predicted masks
into typed roof features (ridge, hip, valley, eave, rake) with geometric
validation rules.
