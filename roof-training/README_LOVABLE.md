# Pitch Internal Roof U-Net

This service is the internal segmentation engine for Pitch AI Measurement.

## Responsibilities
- Train on internal roof dataset only
- Predict roof footprint and linear component masks
- Export inference bundle for the Supabase `measure` function
- Never rely on prompt-only vision estimation as authoritative geometry

## Required segmentation classes
- footprint
- ridge
- hip
- valley
- eave
- rake

## Required regression targets
- total_area_sqft
- ridge_ft
- hip_ft
- valley_ft
- eave_ft
- rake_ft
- predominant_pitch

## Dataset quality gate
Only train on samples where:
- alignment_quality >= 0.50
- all 7 regression targets are present
- footprint mask exists
- at least one structural line mask exists

## Inference contract
The inference service must return canonical `RoofMeasurementData` and `RoofOverlaySchema`.

## Architecture
```
Lead Details Page
  -> AI Measurement button
    -> supabase/functions/measure
      -> internal imagery + solar fusion
      -> internal U-Net inference (this service)
      -> rule engine / topology cleanup
      -> vendor cross-check
      -> persist canonical roof_measurements record
      -> generate overlay schema
      -> optionally generate PDF
```

## Running locally
```bash
cd roof-training
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python inference_service.py
```

## Training
```bash
cd roof-training
source .venv/bin/activate
python train_lovable_roofnet.py
```

## Environment variables
- `MODEL_PATH` - path to best_roofnet.pt (default: `./roof-training/exports/checkpoints/best_roofnet.pt`)
- `MODEL_VERSION` - version tag (default: `lovable-roofnet-v1`)
- `INTERNAL_UNET_API_KEY` - bearer token for auth
- `MAPBOX_ACCESS_TOKEN` - for satellite imagery
- `GOOGLE_SOLAR_API_KEY` - for Solar API data
