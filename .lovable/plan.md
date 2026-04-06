

## Mass Training Pair Generation from Real Vendor Reports

### Problem
You have **156 vendor reports** with real measurement data (120 with valleys, 123 with hips, 107 with full diagram geometry), but **none** of your 205 training pairs actually use this data. They were all generated with simple synthetic box/gable templates. The vendor reports also lack geocoded coordinates, blocking training pair generation.

### Plan

**Step 1 — Geocode all vendor report addresses**

Create a batch script that:
- Queries all 145 vendor reports that have addresses but no coordinates
- Geocodes each address using the Mapbox geocoding API (already have token)
- Stores `geocoded_lat` and `geocoded_lng` on the vendor report (requires adding these columns via migration)

**Step 2 — Add geocode columns to `roof_vendor_reports`**

Migration to add:
```sql
ALTER TABLE public.roof_vendor_reports
  ADD COLUMN IF NOT EXISTS geocoded_lat double precision,
  ADD COLUMN IF NOT EXISTS geocoded_lng double precision;
```

**Step 3 — Convert diagram_geometry to vendorGeometry format**

The 107 reports with `diagram_geometry` have vertex/edge structures like:
```json
{"vertices": [{"id":"V1","x":0.15,"y":0.2}, ...], "edges": [{"from":"V1","to":"V2","type":"ridge"}, ...]}
```

Build a converter function that:
- Resolves vertex references to coordinate pairs
- Groups edges by type (ridge/valley/hip/eave/rake) into the `vendorGeometry` format: `{ ridge: [[[x1,y1],[x2,y2]]], valley: [...] }`
- Scales relative coordinates to pixel space (512x512)

**Step 4 — Batch generate real training pairs**

Script that processes each geocoded vendor report:
1. Uses the report's `geocoded_lat/lng` for satellite imagery
2. Converts `diagram_geometry` → `vendorGeometry` (for 107 reports with diagrams)
3. Falls back to building geometry from parsed linear measurements for the remaining 49 reports (using `parsed.ridges_ft`, `parsed.valleys_ft`, etc. to create proportional synthetic geometry)
4. Passes real `vendorTruth` labels from `parsed` data (areaSqft, valleyFt, hipFt, etc.)
5. Calls `generate-training-pair` edge function

**Step 5 — Verify dataset quality**

Query to confirm:
- 100+ training pairs with real vendor-sourced labels
- 60+ with valleys > 0
- 60+ with hips > 0
- Mask coverage validation

### Technical Details

- **Geocoding**: Mapbox forward geocoding API — `https://api.mapbox.com/geocoding/v5/mapbox.places/{address}.json`
- **Diagram conversion**: The `diagram_geometry.vertices` use relative coordinates (0-1 range). These get scaled to 512x512 pixel space for the `vendorGeometry` input.
- **Rate limiting**: 1-second delay between geocoding calls (Mapbox TOS), 2-second delay between training pair generation calls (edge function cold starts)
- **Files modified**: One migration (add geocode columns), one batch Python script in `/tmp/`

### Expected Outcome

After completion:
- 100-145 new training pairs using **real** vendor data
- Valleys in 80+ pairs, hips in 80+ pairs
- Labels sourced from actual Roofr/EagleView measurements, not synthetic values
- Dataset ready for meaningful Stage 5 model training

