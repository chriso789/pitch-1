"""Declarative registry of every compute skill this worker owns.

`implemented = True` means real compute is wired in app/main.py. Stubs return
status="needs_implementation"; the control plane MUST NOT promote a stub.
"""

SKILLS: list[dict] = [
    {"name": "clip_point_cloud",                 "path": "/skills/clip-point-cloud",                 "implemented": True,
     "notes": "PDAL clip LAS/LAZ/COPC/EPT to AOI; emits clipped LAZ + density/bounds/CRS, uploads to Supabase Storage."},
    {"name": "generate_dsm",                     "path": "/skills/generate-dsm",                     "implemented": True,
     "notes": "PDAL writers.gdal output_type=max from clipped LAZ → DSM GeoTIFF."},
    {"name": "generate_dtm",                     "path": "/skills/generate-dtm",                     "implemented": True,
     "notes": "PDAL filters.smrf + writers.gdal output_type=min → bare-earth DTM GeoTIFF."},
    {"name": "generate_chm",                     "path": "/skills/generate-chm",                     "implemented": True,
     "notes": "CHM = DSM − DTM (rasterio, DSM-grid aligned)."},
    {"name": "isolate_roof_points",              "path": "/skills/isolate-roof-points",              "implemented": True,
     "notes": "Crop + hag_nn + DBSCAN + vegetation rejection → roof-only LAZ."},
    {"name": "refine_roof_perimeter_from_surface","path": "/skills/refine-roof-perimeter-from-surface","implemented": True,
     "notes": "Surface-truth perimeter from CHM > 2m threshold + morph close + contour. Outranks math offsets."},
    {"name": "fit_roof_planes",                  "path": "/skills/fit-roof-planes",                  "implemented": True,
     "notes": "RANSAC plane segmentation (sklearn) over roof points; emits normals + RMSE + facet polygons."},
    {"name": "detect_ridges",                    "path": "/skills/detect-ridges",                    "implemented": True,
     "notes": "Plane-plane intersection classifier (shared, both slope away, near-level)."},
    {"name": "detect_hips",                      "path": "/skills/detect-hips",                      "implemented": True,
     "notes": "Plane-plane intersection classifier (shared, exterior, sloped)."},
    {"name": "detect_valleys",                   "path": "/skills/detect-valleys",                   "implemented": True,
     "notes": "Plane-plane intersection classifier (shared, both slope toward, low)."},
    {"name": "detect_eaves",                     "path": "/skills/detect-eaves",                     "implemented": True,
     "notes": "Perimeter edges of facets not covered by shared lines, near-level."},
    {"name": "detect_rakes",                     "path": "/skills/detect-rakes",                     "implemented": True,
     "notes": "Perimeter edges of facets not covered by shared lines, sloped."},
    {"name": "calculate_pitch",                  "path": "/skills/calculate-pitch",                  "implemented": True,
     "notes": "Weighted (by inlier count) predominant pitch from plane normals."},
    {"name": "calculate_roof_area",              "path": "/skills/calculate-roof-area",              "implemented": True,
     "notes": "Slope-adjusted facet area = flat / cos(slope); totals in m² and sqft."},
    {"name": "geometry_quality_score",           "path": "/skills/geometry-quality-score",           "implemented": True,
     "notes": "Nearmap-parity confidence score from source/coverage/RMSE/perimeter/reconciliation. No Nearmap."},
    {"name": "validate_geometry",                "path": "/skills/validate-geometry",                "implemented": False,
     "notes": "Closed polygons, snap tolerance, classification sanity, area reconciliation."},
    {"name": "export_report",                    "path": "/skills/export-report",                    "implemented": False,
     "notes": "Final JSON + GeoJSON + overlay + PDF; only after validate_geometry passes."},
]
