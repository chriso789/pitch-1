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

## Pipeline (vendor PDF → training set)
```bash
cd roof-training
source .venv/bin/activate

# 1. Pull vendor PDFs + diagrams from the unet-training-data bucket
#    (places files under data/raw/<sample_id>/)
python -c "from pipeline.bucket_loader import discover_samples, cache_sample; \
           [cache_sample(s, [s + '/report.pdf', s + '/diagram.png', s + '/aerial.png']) \
            for s in discover_samples()]"

# 2. Run alignment + raster + scoring + split-writing
python pipeline/run_pipeline.py

# 3. Train footprint-only U-Net (first curriculum stage)
python train_footprint_unet.py

# 4. Train full multi-class roof net (footprint + ridge/hip/valley/eave/rake + regression)
python train_lovable_roofnet.py
```

The pipeline writes:
- `data/processed/<id>.json` - canonical roof JSON
- `images/<id>.png` - aerial tile (model input)
- `masks/<class>/<id>.png` - per-class binary masks
- `labels/<id>.json` - regression targets + alignment_quality
- `splits/{train,val}.txt` - filtered, accepted samples only
- `exports/metrics/pipeline_summary.json` - dataset stats + rejection breakdown

## Environment variables
- `MODEL_PATH` - path to best_roofnet.pt (default: `./roof-training/exports/checkpoints/best_roofnet.pt`)
- `MODEL_VERSION` - version tag (default: `lovable-roofnet-v1`)
- `INTERNAL_UNET_API_KEY` - bearer token for auth
- `MAPBOX_ACCESS_TOKEN` - for satellite imagery
- `GOOGLE_SOLAR_API_KEY` - for Solar API data
