

## Port Stage 3: Geometry Cleanup, Confidence Scoring & Training Export

### What Stage 3 adds (not yet in TypeScript)

| Python Stage 3 Concept | TypeScript Status |
|---|---|
| `cleanup_geometry()` — snap segments to anchor angles (0/45/90), drop short segments | Missing |
| `automatic_roof_footprint_bbox()` — fallback bbox from imagery contrast analysis | Missing (we have footprint-resolver but no image-based fallback) |
| `estimate_control_point_alignment()` — score how well geometry lands on roof region | Missing |
| `score_confidence()` — composite confidence from alignment + calibration + geometry agreement | Missing (fusion has per-source confidence but no overall pipeline score) |
| `export_training_pack()` — manifest.json, labels.json, geometry.geojson for model training | Missing |
| `iou_bbox()` / `bbox_from_points()` — geometric utility functions | Missing |

### Implementation Plan

**1. Extend `geometry-alignment.ts` with Stage 3 utilities**

Add the following functions:
- `cleanupGeometry(grouped, minSegmentPx)` — simplify polylines to start/end, snap to nearest anchor angle (0/45/90/135...), discard segments shorter than threshold
- `bboxFromPoints()`, `bboxArea()`, `iouBbox()` — bounding box helpers
- `estimateControlPointAlignment()` — score whether transformed geometry lands within the expected roof region (uses bbox overlap IoU)
- `scoreConfidence()` — composite `ConfidenceScore` (overall = 0.4*alignment + 0.3*calibration + 0.3*geometry) with quality notes
- `buildTrainingExportPack()` — returns structured manifest with labels, geometry GeoJSON, and confidence metadata

New types: `ConfidenceScore { overall, alignment, calibration, geometry, notes }`, `TrainingPack { manifest, labels, geometryGeoJSON }`

**2. Wire Stage 3 into the unified pipeline**

After Step 6 (calibration), add Step 6.5:
- Run `cleanupGeometry()` on the grouped/transformed geometry
- Compute `estimateControlPointAlignment()` using the cleaned geometry and footprint bbox
- Compute `scoreConfidence()` from alignment debug, calibration debug, and measurement-vs-vendor disagreement
- Build training export pack
- Attach `confidence` and `trainingPack` to the pipeline result

Update `UnifiedMeasurementResult`:
- Add `confidence: ConfidenceScore | null`
- Add `trainingPack: TrainingPack | null`

**3. Update `FinalReportPayload` to include confidence**

Add `confidence` field to the report so downstream consumers (generate-roofr-style-report) can surface quality scores.

### Files to modify

| File | Change |
|------|--------|
| `supabase/functions/_shared/geometry-alignment.ts` | Add cleanup, bbox, alignment scoring, confidence scoring, training export functions |
| `supabase/functions/_shared/unified-measurement-pipeline.ts` | Add Step 6.5, new result fields |

### Technical Details

- Anchor angle snapping uses nearest of [0, 45, 90, 135, 180, 225, 270, 315] degrees — matching Python's `nearest_axis_angle_deg()`
- Confidence scoring formula: `overall = 0.4 * alignment + 0.3 * calibration + 0.3 * geometry`, clamped [0, 1]
- Calibration confidence: `0.35 + min(0.65, 0.15 * candidateCount)` — more line types used = higher confidence
- Geometry confidence penalizes by 0.12 per line type where calibrated vs vendor disagrees by >18%
- Training pack is a JSON-only export (no image copy in edge function context) — manifest references the aerial imagery URL
- `automatic_roof_footprint_bbox()` from Python uses PIL/numpy for image analysis — we skip this since the TypeScript pipeline already has `footprint-resolver` with multiple authoritative sources; the Python version is explicitly described as "brutally simple fallback"

