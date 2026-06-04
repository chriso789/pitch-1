# Measurement Coordinate Contract

**Status:** Phase 1 — contract definition. Some sections describe behavior already implemented by the worker geometry engine (worker version `0.3.0-geometry-engine`); others are explicitly marked **CONTRACT REQUIRED — NOT YET IMPLEMENTED**. Do not treat this document as a description of a finished system.

This document is the source of truth for how every roof measurement artifact represents position, elevation, distance, slope, area, and coordinate transforms across the PITCH internal measurement pipeline (`worker/app/skills/*`, `supabase/functions/_shared/mskill/executors/*`, and the DB tables `mskill_*`).

---

## 1. Purpose

Defines:

- The coordinate frames that artifacts may live in.
- The canonical units for every numeric field.
- The transforms required to move between frames.
- The tolerances validators must use.
- The failure modes the pipeline must reject.

Every skill, validator, exporter, report, and DB row that carries geometry MUST conform to this contract. `validate_geometry.ts` is the gate that enforces it before any customer-facing report can be produced.

---

## 2. Coordinate systems

### 2.1 Source coordinate frame (`source`)
- **Examples in repo:** raw LAZ/LAS point clouds emitted by `clip_point_cloud.py`; vendor GeoTIFF DSMs; county building-footprint GeoJSON (`mskill_building_footprints.geometry_geojson`); geocoded address.
- **Axis orientation:** as supplied by source.
- **Origin:** as supplied by source.
- **CRS:** heterogeneous (WGS84 lon/lat for GeoJSON, state plane or UTM for LiDAR tiles, image pixel for raw rasters).
- **z included?** Optional. LiDAR has z; footprint GeoJSON does not.
- **Status:** Implemented at ingestion only.

### 2.2 Normalized local / project frame (`project_metric`)
- The frame in which `fit_roof_planes`, `_segments_core`, `calculate_roof_area`, and `calculate_pitch` operate.
- **Axis orientation:** right-handed; +x east, +y north, +z up.
- **Origin:** undefined offset within the source CRS (currently inherited from the LAZ file as-is — see §10).
- **Units:** metres.
- **CRS:** **CONTRACT REQUIRED** — must be an equal-area or local-tangent metric CRS (UTM zone or EPSG:3857 with latitude-corrected scale). `calculate_roof_area.py` docstring already assumes "facet polygons are in a metric CRS (UTM / EPSG:3857)" but the pipeline does not yet enforce reprojection. **NOT YET IMPLEMENTED.**
- **z:** required; absolute elevation as carried from source LiDAR.

### 2.3 Raster grid frame (`raster_grid`)
- Used by `generate_dsm.py`, `generate_dtm.py`, `generate_chm.py`, and `isolate_roof_points.py` when rasterized intermediates are produced.
- **Axis orientation:** row index increases downward, column index increases right (rasterio / GDAL convention).
- **Origin:** pixel (0,0) = top-left.
- **Cell anchor:** pixel **center** is canonical for sampling; pixel edges define footprint.
- **Units:** dimensionless indices; metric resolution stored in raster metadata (`cell_size_m`).
- **z:** stored as cell value in DSM/DTM/CHM rasters (metres).

### 2.4 GeoJSON / export frame (`export_geojson`)
- Used by `export_geojson.ts` and stored in `mskill_plane_candidates.polygon_geojson`, `mskill_roof_edge_candidates.geometry_geojson`, `mskill_segments.start_point/end_point`.
- **CRS:** **CONTRACT REQUIRED** — RFC 7946 mandates WGS84 (EPSG:4326, lon/lat decimal degrees). The current exporter passes through whatever CRS the underlying rows hold without an explicit reprojection step. **NOT YET ENFORCED.**
- **Axis orientation:** [longitude, latitude] (and optional elevation in metres as the third coordinate).
- **z:** optional; permitted but not required.
- **Precision:** 7 decimal places of longitude/latitude (≈11 mm) is the contract maximum.

### 2.5 Report / display frame (`report_display`)
- Used by `export_report.ts` and any customer-facing PDF / UI renderer.
- **Units:** imperial — feet, square feet, roofing squares, rise-over-12 pitch.
- **Coordinate values:** not exported; only scalar totals (`roof.plan_sqft`, `roof.total_sqft`, `lf.ridge`, etc.).
- **Status:** Implemented for JSON totals; PDF rendering still deferred (`pdf_pending` flag in `export_report.ts`).

---

## 3. Units

| Quantity              | Canonical internal unit | Canonical report unit | Implemented? |
|-----------------------|-------------------------|-----------------------|--------------|
| Horizontal distance   | metres                  | feet                  | partial — metric assumed but not enforced |
| Elevation (z)         | metres                  | feet                  | partial |
| Slope                 | degrees                 | rise-over-12          | yes (`fit_roof_planes`, `calculate_pitch`) |
| Pitch                 | rise-over-12 (float)    | rise-over-12 (int rounded) | yes |
| Plan area             | square metres           | square feet           | yes (`calculate_roof_area`) |
| Sloped roof area      | square metres           | square feet / squares | yes |
| Raster cell size      | metres / pixel          | n/a                   | yes (DSM/DTM/CHM metadata) |
| Confidence / quality  | unitless 0.0 – 1.0      | n/a                   | partial — emitted by some skills, no global enum |
| Linear segment length | metres                  | feet                  | yes (segments emit `length_m` and `length_ft`) |

**Gap:** No code path currently asserts CRS-is-metric before computing area. **CONTRACT REQUIRED — NOT YET IMPLEMENTED.**

---

## 4. Elevation convention

- `z` in the project frame is **absolute elevation above the source LiDAR datum** (typically NAVD88 metres for US public LiDAR).
- DSM raster cell value = elevation of the highest return (roof / canopy / structure) at that cell, in metres.
- DTM raster cell value = bare-earth ground elevation in metres.
- CHM raster cell value = DSM − DTM = height-above-ground in metres (≥ 0; negatives clamped to 0 / no-data).
- Roof plane elevations come from the LAZ z values used in `fit_roof_planes._ransac_plane`; the plane equation `z = a*x + b*y + c` reproduces absolute elevation at any (x,y).
- **No-data:** rasters use `numpy.nan` in memory and a sentinel value written by rasterio (`nodata=-9999.0` recommended). **CONTRACT REQUIRED** — the no-data sentinel is not yet uniformly declared by all three raster skills.

---

## 5. Raster / grid convention

- Row/column ordering: rasterio convention (row 0 at top).
- Cell anchor: pixel **center** for value sampling; pixel **edge** for footprint geometry.
- Grid origin: defined by the rasterio `transform` affine in raster metadata.
- Resolution: stored as `cell_size_m` in the raster metadata block; recommended 0.25–0.5 m for residential roofs.
- No-data: a single per-raster sentinel, declared in metadata.
- Project-frame mapping: `(x_proj, y_proj) = transform * (col + 0.5, row + 0.5)`.

**Status:** Implemented in `generate_dsm.py` / `generate_dtm.py` / `generate_chm.py` via rasterio; **CONTRACT REQUIRED** that every emitted raster artifact carries `{cell_size_m, transform, crs, nodata, bounds}` in its `metadata` envelope. Today only a subset of these fields is consistently written.

---

## 6. Polygon / ring convention

- Exterior ring winding: counter-clockwise (RFC 7946 §3.1.6).
- Interior holes (rings): clockwise. **CONTRACT REQUIRED — NOT YET ENFORCED.** Holes are currently lost by `fit_roof_planes._facet_polygon` (which uses `MultiPoint.buffer` and discards holes).
- Rings MUST be closed (first coord == last coord).
- Self-intersections forbidden; if produced, the polygon MUST be rejected by `validate_geometry`.
- Minimum viable polygon: ≥ 4 coordinates after closure; non-zero area; ≥ 0.5 m² in the project frame.
- 2D vs 3D: facet polygons are stored 2D in `mskill_plane_candidates.polygon_geojson`; elevation is recovered via the parent plane equation (§8). Storing 3D polygons is permitted but not required.

---

## 7. Segment / line convention

Applies to `_segments_core.compute_all_segments` output and the `mskill_segments` table.

- Each segment is a 3D line `{p1: [x,y,z], p2: [x,y,z]}` in the project frame plus a typed classification.
- `type ∈ {"ridge", "hip", "valley", "eave", "rake"}`.
- Start/end ordering: as emitted by `_segment_intersection_in_facets`; no canonical sort. **CONTRACT REQUIRED** that consumers do not rely on direction.
- Minimum segment length: 0.5 m (matches `_segment_intersection_in_facets` early-reject).
- Snapping / merge tolerance: 0.3 m planar (matches `_perimeter_segments` `buffer(0.3)` cover test).
- Overlap rule: a perimeter edge that is already covered by a shared (ridge/hip/valley) segment is suppressed from eave/rake — already implemented.
- Plane references: every shared segment carries `facet_a` and `facet_b`; every perimeter segment carries `facet`. References MUST resolve to a plane that exists in the same job's `planes.json`.

---

## 8. Pitch / slope convention

- Canonical internal slope: `slope_deg` in degrees, derived from plane normal: `acos(|n_z|)`.
- Canonical internal pitch: `pitch_rise_per_12 = tan(slope_deg) * 12`, stored as float (2-decimal precision).
- Per-plane pitch is computed in `fit_roof_planes._ransac_plane`; whole-roof predominant pitch is computed in `calculate_pitch.py` as the **inlier-count-weighted mean** of `pitch_rise_per_12`.
- Report rounding: predominant pitch is rounded to the nearest integer rise-over-12 in `export_report.ts`.
- **CONTRACT REQUIRED:** any pitch < 1/12 is reported as "flat" (1/12 minimum). Not yet implemented.

---

## 9. Area convention

- Plan-view area: 2D polygon area of `facet_polygon` in the project metric frame (`shape(p["facet_polygon"]).area`).
- Sloped roof area: `plan_area / cos(slope_rad)` per facet.
- Totals: sum of per-facet plan and sloped area, no overlap deduplication. **CONTRACT REQUIRED** — overlap detection across planes is not yet implemented; `validate_geometry` must eventually reject jobs where facets self-overlap > 1 %.
- Waste factor: NOT applied at this layer. Estimating waste is an estimate-builder concern, not a measurement concern.
- Report rounding: nearest 1 sqft in `export_report.ts`.

---

## 10. Transform requirements

Every geometry artifact MUST carry enough metadata to be transformed to any other frame. Required metadata block (**CONTRACT REQUIRED — NOT YET ENFORCED EVERYWHERE**):

```jsonc
"coordinate_frame": "project_metric" | "raster_grid" | "export_geojson" | "report_display" | "source",
"crs": "EPSG:32616" | "EPSG:4326" | ...,
"units": { "xy": "m" | "deg" | "px", "z": "m" | null, "area": "m2" | null },
"transform": null | [ a, b, c, d, e, f ],   // affine for rasters
"origin": null | [ x0, y0 ],                  // for project_metric if shifted
"bounds": [ minx, miny, maxx, maxy ]
```

Currently:
- `clip_point_cloud.py` writes a `coverage` block (bbox, point count) but not a full transform block.
- `fit_roof_planes.py` does NOT carry CRS metadata into `planes.json`.
- `export_geojson.ts` does NOT stamp the FeatureCollection with a CRS member.

All three are gaps.

---

## 11. Tolerance rules

Contract defaults (used by validators):

| Tolerance                          | Value      | Source / status |
|------------------------------------|------------|------------------|
| Coordinate snap (planar)           | 0.30 m     | matches `_perimeter_segments` buffer |
| Duplicate point distance           | 0.05 m     | recommended; not enforced |
| Plane fit RMSE warning             | 0.12 m     | `fit_roof_planes` flags `high_plane_rmse` |
| Plane fit RMSE hard fail           | 0.25 m     | **CONTRACT REQUIRED — NOT YET IMPLEMENTED** |
| Segment merge tolerance            | 0.30 m     | matches `_segments_core` |
| Minimum segment length             | 0.5 m      | matches `_segments_core` |
| Polygon closure tolerance          | 0.01 m     | recommended |
| Area equality tolerance            | ± 2 %      | recommended for cross-checks |
| Pitch equality tolerance           | ± 0.5/12   | recommended |
| Facet coverage warning             | < 0.60     | `fit_roof_planes` flags `low_plane_coverage` |
| Facet coverage hard fail           | < 0.40     | **CONTRACT REQUIRED — NOT YET IMPLEMENTED** |

---

## 12. Validation requirements

`validate_geometry.ts` MUST eventually verify (current implementation in **bold** is artifact-presence-only):

1. **Every required upstream skill ran to `completed`.** ✅ implemented
2. **Every required artifact type is present (`roof_planes`, `*_segments`, `pitch_results`, `roof_area_results`).** ✅ implemented
3. Every artifact declares `coordinate_frame`, `crs`, and `units` per §10. ❌ contract required
4. All raster artifacts carry the metadata block per §5. ❌ contract required
5. All facet polygons are closed, non-self-intersecting, CCW-wound, ≥ 0.5 m². ❌ contract required
6. All segments reference plane ids that exist in `planes.json`. ❌ contract required
7. Plane RMSE ≤ 0.25 m and coverage ≥ 0.40. ❌ contract required
8. Per-facet sloped area equals `plan_area / cos(slope)` within ± 2 %. ❌ contract required
9. Predominant pitch is in [1/12, 18/12]. ❌ contract required
10. No segment is shorter than 0.5 m. ❌ contract required

The current executor explicitly admits this gap by tagging its output `"confidence_source": "artifact_presence_only"`.

---

## 13. Failure handling

The pipeline MUST treat the following as hard failures (status `failed`, no customer report):

- Missing CRS on any artifact that participates in area/length computation.
- Mixed units within a single artifact.
- Missing z values where required (plane fit, CHM).
- Invalid / self-intersecting / open polygons.
- Plane equations with `|n_z| < 0.5` (vertical planes — outside the `z = ax+by+c` parameterization).
- Out-of-bounds raster sample requests.
- Excessive raster no-data holes (> 25 % of footprint) — **CONTRACT REQUIRED**.
- Non-transformable artifacts (missing `transform` for rasters, missing CRS for vectors).

Soft failures (`needs_review`) are reserved for the existing `high_plane_rmse`, `low_plane_coverage`, and `zero_planes` flags emitted by `fit_roof_planes`.

---

## 14. Open implementation gaps

Aggregated from the sections above; these MUST be closed before the AI Measurement button can be rewired:

1. Enforce a metric CRS on all `fit_roof_planes` / `calculate_roof_area` inputs.
2. Stamp every artifact with the `{coordinate_frame, crs, units, transform, origin, bounds}` block from §10.
3. Declare a uniform raster no-data sentinel in DSM / DTM / CHM metadata.
4. Preserve interior polygon holes through `fit_roof_planes._facet_polygon`.
5. Add hard-fail thresholds for plane RMSE and facet coverage (§11).
6. Reproject GeoJSON exports to EPSG:4326 and stamp the FeatureCollection CRS.
7. Implement per-facet area cross-check (§12 #8).
8. Reject vertical planes in `fit_roof_planes` (`|n_z| < 0.5`).
9. Implement raster no-data coverage gate (§13).
10. Round predominant pitch to a minimum of 1/12 in `export_report.ts`.

These are tracked here only — no code changes in Phase 1.
