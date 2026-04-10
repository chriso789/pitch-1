

# Plan: Add Fusion Fetch Script and Requirements

## What's missing
The `roof-training/` directory has the trainer and rule engine but is missing two files the user provided:
1. **`roof-training/fusion_fetch.py`** -- The Mapbox + Google Solar data fusion script
2. **`roof-training/requirements.txt`** -- Python dependencies

## What to create

### 1. `roof-training/fusion_fetch.py`
Drop-in the exact script the user provided. It calls:
- Google Solar `buildingInsights:findClosest` and `dataLayers:get`
- Mapbox Static Images API (`@2x` satellite tiles)
- Mapbox Tilequery API (vector building footprints)
- Mapbox Terrain-RGB tile fetch + decode for elevation sampling

Outputs a `FusionResult` dataclass with building insights, data layers metadata, footprint GeoJSON, image metadata, and terrain elevation samples. CLI entry point: `python fusion_fetch.py --lat X --lng Y --out ./dir`

### 2. `roof-training/requirements.txt`
```
torch
torchvision
numpy
pillow
opencv-python
requests
```

### No other files change
The directory structure (masks/, labels/, metadata/, exports/, splits/) is already correct. The trainer and rule engine are already in place from the previous step.

