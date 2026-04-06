

## ✅ Stage 4: Spatial Alignment Engine (COMPLETED)

### What was built

| Component | File | Description |
|---|---|---|
| Spatial Alignment Engine | `_shared/spatial-alignment-engine.ts` | Affine transform computation, geo↔pixel conversion, vendor perimeter extraction, corner matching, alignment quality scoring |
| Training Mask Generator | `_shared/training-mask-generator.ts` | Per-class vector line masks, footprint mask, training pair packaging |
| Training Pair Function | `generate-training-pair/index.ts` | End-to-end orchestrator: fetch imagery → resolve footprint → align → generate masks → store |
| DB Table | `training_pairs` | Stores alignment matrix, quality scores, labels, confidence |
| Pipeline Integration | `_shared/unified-measurement-pipeline.ts` | Step 6.5 now runs spatial alignment when footprint + vendor geometry are both available |

### Key Technical Details

- **Affine transform**: Pure math 6-parameter solve (no OpenCV). Least-squares via 3x3 matrix inverse for N≥3 control points.
- **Vendor perimeter extraction**: Chains eave/rake segments by nearest-endpoint linking, simplifies with Douglas-Peucker, falls back to convex hull.
- **Corner matching**: Normalizes both vendor and footprint corners to [0,1] bbox space, then greedy nearest-neighbor correspondence.
- **BBox fallback**: When corner matching yields <3 pairs, uses bounding box corners as control points.
- **Quality grading**: `good` (<3% normalized error), `acceptable` (<8%), `poor` (≥8%).
- **Vector masks**: Coordinate arrays per line class, not raster bitmaps. Edge function memory stays under 50MB.

### Stage 5 Preview (Not Yet Built)

Once 100+ training pairs have `quality=good`:
- U-Net segmentation model (footprint + per-class lines)
- Regression head (area, pitch, lengths)
- Training pipeline using the aligned data from `training_pairs` table
