"""Roof training pipeline package.

Stages:
  1. ingest        - pull vendor PDFs/diagrams from Supabase storage to local cache
  2. parse         - call parse-roof-report-geometry edge fn -> canonical JSON
  3. align         - fit canonical polygon to aerial tile, score quality
  4. rasterize     - write 512x512 PNG masks per class
  5. score         - compute per-sample score + filter
  6. train         - footprint U-Net (run train_footprint_unet.py)
"""
