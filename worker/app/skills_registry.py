"""Declarative registry of every compute skill this worker owns.

`implemented = False` means the endpoint exists and validates payloads,
but returns status="needs_implementation". The control plane MUST NOT
promote a skill_run to "completed" from a stub response.
"""

SKILLS: list[dict] = [
    {"name": "clip_point_cloud",     "path": "/skills/clip-point-cloud",     "implemented": True,
     "notes": "PDAL clip LAS/LAZ/COPC/EPT to AOI; emits clipped LAZ + density/bounds/CRS, uploads to Supabase Storage."},
    {"name": "generate_dsm",         "path": "/skills/generate-dsm",         "implemented": False,
     "notes": "First/highest returns → DSM GeoTIFF (COG)."},
    {"name": "generate_dtm",         "path": "/skills/generate-dtm",         "implemented": False,
     "notes": "Ground-classified returns → DTM GeoTIFF (COG)."},
    {"name": "generate_chm",         "path": "/skills/generate-chm",         "implemented": False,
     "notes": "CHM = DSM − DTM (height above ground)."},
    {"name": "isolate_roof_points",  "path": "/skills/isolate-roof-points",  "implemented": False,
     "notes": "Mask roof points using footprint + CHM thresholds; reject vegetation/ground."},
    {"name": "fit_roof_planes",      "path": "/skills/fit-roof-planes",      "implemented": False,
     "notes": "RANSAC/Open3D plane segmentation; emits plane equations + facet polygons."},
    {"name": "detect_ridges",        "path": "/skills/detect-ridges",        "implemented": False,
     "notes": "High plane-plane intersections, both planes slope away."},
    {"name": "detect_hips",          "path": "/skills/detect-hips",          "implemented": False,
     "notes": "Exterior sloped plane intersections."},
    {"name": "detect_valleys",       "path": "/skills/detect-valleys",       "implemented": False,
     "notes": "Low plane-plane intersections, both planes slope toward line."},
    {"name": "detect_eaves",         "path": "/skills/detect-eaves",         "implemented": False,
     "notes": "Low perimeter edges from approved roof edge candidate (NOT footprint)."},
    {"name": "detect_rakes",         "path": "/skills/detect-rakes",         "implemented": False,
     "notes": "Sloped gable perimeter edges."},
    {"name": "calculate_pitch",      "path": "/skills/calculate-pitch",      "implemented": False,
     "notes": "pitch = tan(slope_deg) * 12 from plane normals."},
    {"name": "calculate_roof_area",  "path": "/skills/calculate-roof-area",  "implemented": False,
     "notes": "Slope-adjusted facet area = flat_area / cos(slope)."},
    {"name": "validate_geometry",    "path": "/skills/validate-geometry",    "implemented": False,
     "notes": "Closed polygons, snap tolerance, classification sanity, area reconciliation."},
    {"name": "export_report",        "path": "/skills/export-report",        "implemented": False,
     "notes": "Final JSON + GeoJSON + overlay + PDF; only after validate_geometry passes."},
]
