

## Stage 4: Spatial Alignment Engine for Training Data Generation

### The Core Problem

Your current alignment in `geometry-alignment.ts` is a naive proportional scale (`inferAlignmentTransform` just divides target/source dimensions). This works for calibration math but does NOT spatially align vendor diagram geometry onto aerial imagery. The vendor diagram coordinate system (pixel space from a PDF) has no relationship to the aerial image coordinate system (pixel space from Mapbox at zoom 20). You need an actual geometric transform that maps one to the other using shared reference points -- the roof footprint.

### What Exists vs. What's Missing

| Capability | Status | Location |
|---|---|---|
| Mapbox satellite imagery fetch | Built | `fetch-mapbox-imagery/index.ts` |
| Footprint polygon (authoritative vertices) | Built | `footprint-resolver.ts` → returns geo coords |
| Vendor geometry (ridges/valleys/etc from PDF) | Built | `parse-roof-report-geometry` output |
| Roof segmentation (AI edge detection on aerial) | Built | `roof-segmentation/index.ts` |
| Geo bounds calculation (image pixel ↔ lat/lng) | Built | `fetch-mapbox-imagery` returns bounds + metersPerPixel |
| **Affine/homography transform (diagram → aerial)** | **Missing** | Need control-point-based mapping |
| **Training mask generation (per-class raster masks)** | **Missing** | Need ridge/valley/hip/eave binary masks |
| **Alignment preview/validation overlay** | **Missing** | Need visual QA output |
| **Training pair storage (aerial + masks + labels)** | **Missing** | Need DB table + storage bucket |

### The Breakthrough: Two-Stage Spatial Registration

The key insight is that BOTH the vendor diagram AND the aerial image contain the same roof footprint. The footprint is the shared anchor:

```text
Vendor Diagram (PDF pixels)     Aerial Image (Mapbox pixels)
┌──────────────────┐            ┌──────────────────┐
│    ┌────────┐    │            │    ┌────────┐    │
│    │  ROOF  │    │  ──────►   │    │  ROOF  │    │
│    │footprint│   │  affine    │    │footprint│   │
│    └────────┘    │  transform │    └────────┘    │
│  + ridge lines   │            │  = aligned lines │
│  + valley lines  │            │  on real imagery │
└──────────────────┘            └──────────────────┘
```

**Step A**: Extract footprint corners from vendor geometry (outermost eave/rake points = perimeter).
**Step B**: Extract footprint corners from aerial (already have authoritative footprint vertices from `footprint-resolver`, convert geo→pixel using image bounds).
**Step C**: Compute affine transform from A→B using least-squares fit (minimum 3 point pairs).
**Step D**: Apply transform to ALL vendor lines (ridges, valleys, hips, eaves, rakes).
**Step E**: Render aligned lines as binary masks on aerial image dimensions.

### Implementation Plan

**1. Create `supabase/functions/_shared/spatial-alignment-engine.ts`**

Core module with:
- `geoToPixel(lat, lng, bounds, imageWidth, imageHeight)` — convert geographic coordinates to aerial image pixel coordinates
- `extractFootprintPixelCoords(footprintVertices, bounds, imageDims)` — convert resolved footprint geo-coords to aerial pixel space
- `extractVendorPerimeter(vendorGeometry)` — derive the outermost polygon from vendor eave/rake segments
- `computeAffineTransform(srcPoints, dstPoints)` — least-squares 2D affine (6-parameter: scale, rotate, translate, shear) using 3+ point correspondences
- `applyAffineTransform(points, matrix)` — transform vendor geometry points into aerial pixel space
- `alignVendorToAerial(vendorGeometry, footprintVertices, imageBounds, imageDims)` — orchestrator that chains the above steps
- `generateAlignmentPreview(alignedGeometry, imageDims)` — returns SVG/JSON overlay data for visual QA
- `computeAlignmentQuality(alignedGeometry, footprintPixels)` — IoU and point-to-edge distance metrics

**2. Create `supabase/functions/_shared/training-mask-generator.ts`**

- `generateLineMasks(alignedGeometry, width, height, lineWidth)` — produce per-class binary mask data (ridge, valley, hip, eave, rake) as run-length encoded arrays (not full bitmaps -- edge functions can't handle 1280x1280 pixel arrays efficiently)
- `generateFootprintMask(footprintPixels, width, height)` — binary roof/not-roof mask
- `packTrainingPair(aerialImageUrl, masks, labels, metadata)` — assemble complete training record

**3. Create `supabase/functions/generate-training-pair/index.ts`**

New edge function that:
- Takes `{ lat, lng, address, vendorGeometry, vendorTruth }` as input
- Fetches Mapbox aerial image via `fetch-mapbox-imagery`
- Resolves authoritative footprint via `footprint-resolver`
- Runs spatial alignment engine
- Generates per-class line masks
- Stores training pair in Supabase Storage (`training-pairs` bucket)
- Records metadata in a new `training_pairs` table
- Returns alignment preview for visual QA

**4. Database migration: `training_pairs` table**

```sql
CREATE TABLE training_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address TEXT NOT NULL,
  lat DECIMAL(10,8) NOT NULL,
  lng DECIMAL(11,8) NOT NULL,
  aerial_image_url TEXT NOT NULL,
  mask_storage_path TEXT,
  vendor_source TEXT,
  alignment_quality DECIMAL(5,4),
  alignment_matrix JSONB,
  labels JSONB NOT NULL,
  confidence_score DECIMAL(5,4),
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**5. Update `unified-measurement-pipeline.ts`**

- After Step 6.5, when vendor geometry is present, optionally run the spatial alignment engine
- Replace the current naive `inferAlignmentTransform` call with the proper affine alignment when footprint data is available
- Store alignment quality metrics on the pipeline result

### What We Are NOT Doing
- Not running OpenCV in Deno -- the affine transform is pure math (6 linear equations, solvable with a 3x3 matrix inverse). No image processing library needed.
- Not generating full bitmap masks in edge functions -- we output run-length encoded or vector masks (coordinate arrays) that can be rasterized client-side or in a batch job.
- Not building U-Net training yet (that's Stage 5) -- this stage produces the clean, aligned training data that makes Stage 5 possible.
- Not doing contour detection on aerial images -- we already have authoritative footprint polygons from `footprint-resolver`.

### Technical Details

- Affine transform computation: Given N≥3 point pairs (src→dst), solve the overdetermined system `[x' y'] = [a b c; d e f] * [x y 1]^T` via least squares. For exactly 3 points this is a direct 6x6 solve; for more points use pseudoinverse.
- Coordinate pipeline: vendor PDF pixels → affine → aerial image pixels. The aerial image pixels ↔ geo-coords mapping uses the `bounds` and `metersPerPixel` from `fetch-mapbox-imagery`.
- Vendor perimeter extraction: take all eave and rake segments, chain them into a closed polygon by nearest-endpoint linking, extract corners via Douglas-Peucker simplification.
- Alignment quality metric: mean distance from aligned vendor perimeter points to nearest authoritative footprint edge, normalized by footprint perimeter length. Target: < 3% of perimeter = "good alignment".
- Mask encoding: vector format (arrays of pixel coordinates per line segment per class), not raster bitmaps. This keeps edge function memory usage under 50MB.

### Files to Create/Modify

| File | Change |
|------|--------|
| `supabase/functions/_shared/spatial-alignment-engine.ts` | New -- affine transform, geo↔pixel conversion, vendor perimeter extraction, alignment orchestrator |
| `supabase/functions/_shared/training-mask-generator.ts` | New -- per-class line mask generation, footprint mask, training pair packaging |
| `supabase/functions/generate-training-pair/index.ts` | New edge function -- end-to-end training pair generation |
| `supabase/functions/_shared/unified-measurement-pipeline.ts` | Wire spatial alignment into Step 6 when footprint + vendor geometry both available |
| `supabase/functions/_shared/geometry-alignment.ts` | Update `inferAlignmentTransform` to delegate to affine engine when control points available |
| Database migration | Create `training_pairs` table |

