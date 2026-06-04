# Measurement Geometry Objects

**Status:** Phase 1 — contract definition. Sections labelled **IMPLEMENTED** describe shapes the worker (`worker/app/skills/*`) or the mskill executors (`supabase/functions/_shared/mskill/executors/*`) actually emit today. Sections labelled **CONTRACT REQUIRED — NOT YET IMPLEMENTED** describe shapes the rest of the pipeline must produce before `validate_geometry.ts` and `export_report.ts` can be hardened.

This document is the companion to `docs/measurement-coordinate-contract.md`. Coordinates / units / frames live there. Object schemas live here.

---

## 1. Purpose

Defines the canonical geometry objects passed between worker skills, validators, exporters, customer reports, and the `mskill_*` DB tables. Every Python skill response (`SkillResponse.output_payload`, `SkillResponse.artifacts`) and every TypeScript executor (`ExecutorResult.output`, `writeSkillArtifact` payload) MUST conform.

---

## 2. Shared object envelope

**CONTRACT REQUIRED — PARTIALLY IMPLEMENTED.** Today some skills emit ad-hoc payloads (e.g. `planes.json` is a bare list of plane objects with no envelope). The target envelope:

```jsonc
{
  "id": "<uuid>",                           // contract required
  "type": "roof_plane" | "ridge" | ...,     // contract required
  "source_skill": "fit_roof_planes",        // implemented via SkillResponse.skill_run_id chain
  "job_id": "<mskill_job_id uuid>",         // implemented (ctx.mskill_job_id)
  "artifact_id": "<mskill_artifacts.id>",   // implemented after writeSkillArtifact
  "coordinate_frame": "project_metric",      // contract required (see coordinate-contract §10)
  "units": { "xy": "m", "z": "m", "area": "m2" },  // contract required
  "geometry": { ... GeoJSON-shaped or raster-ref ... },
  "properties": { ... type-specific scalars ... },
  "confidence": 0.0,                        // partially implemented
  "quality": { ... },                       // partially implemented
  "warnings": [ "<qa_flag>", ... ],         // implemented via SkillResponse.qa_flags
  "generated_at": "ISO-8601",               // implemented (DB created_at)
  "worker_version": "0.3.0-geometry-engine" // implemented
}
```

Invariant: every geometry object that participates in area / length / pitch computation MUST carry `coordinate_frame` and `units`. **NOT YET ENFORCED.**

---

## 3. Point object

Canonical roof / surface point.

```jsonc
{
  "x": 0.0, "y": 0.0, "z": 0.0,             // metres, project_metric frame
  "row": null, "col": null,                  // optional raster index
  "classification": "roof" | "ground" | "vegetation" | "unclassified",
  "confidence": 0.0,                         // 0..1
  "is_nodata": false                         // contract required for raster-sampled points
}
```

**Status:** LAZ-sourced points (used by `fit_roof_planes`) carry x/y/z and classification natively. Confidence and explicit `is_nodata` are **CONTRACT REQUIRED**.

---

## 4. Raster / surface objects

Every raster artifact (DSM, DTM, CHM, roof mask) MUST carry the metadata block defined in coordinate-contract §5. Target object:

```jsonc
{
  "type": "dsm" | "dtm" | "chm" | "roof_mask",
  "storage_path": "measurement-requests/.../...tif",
  "metadata": {
    "width": 0, "height": 0,
    "cell_size_m": 0.5,
    "crs": "EPSG:32616",
    "transform": [ a, b, c, d, e, f ],
    "nodata": -9999.0,
    "bounds": [ minx, miny, maxx, maxy ],
    "units": "m"
  },
  "source_artifact_refs": [ "<artifact_id>", ... ]
}
```

| Object       | Producer skill                  | Status |
|--------------|----------------------------------|--------|
| DSM          | `generate_dsm.py`                | Implemented (rasterio GeoTIFF); full metadata block partially stamped |
| DTM          | `generate_dtm.py`                | Implemented; full metadata block partially stamped |
| CHM          | `generate_chm.py` (DSM − DTM)    | Implemented |
| Roof mask    | `isolate_roof_points.py` (clustered roof returns) | Implemented as point set; raster mask form is **CONTRACT REQUIRED** |

---

## 5. Roof perimeter object

Stored in `mskill_roof_edge_candidates` and emitted by `create_roof_edge_candidates.ts` / `refine_roof_perimeter_from_surface.py`.

```jsonc
{
  "candidate_id": "<uuid>",
  "source_type": "math_offset" | "surface_refined" | "vendor_report" | "soffit_default",
  "roof_perimeter_geojson": { "type": "Polygon", "coordinates": [...] },
  "simplified_geojson": null,                 // contract required
  "holes": [],                                // contract required to be preserved
  "offset_ft": 0.0,
  "effective_offset_ft": 0.0,
  "eave_offset_ft": 0.0,
  "rake_offset_ft": 0.0,
  "area_sqft": 0.0,
  "perimeter_ft": 0.0,
  "confidence": 0.0,
  "validation_source": "surface" | "report" | "math",
  "status": "candidate" | "selected" | "rejected",
  "is_selected": false
}
```

**Status:** Implemented end-to-end as DB rows; `simplified_geojson` and `holes` preservation are **CONTRACT REQUIRED**.

---

## 6. Roof plane object

Emitted by `fit_roof_planes.py` (as a list in `planes.json`) and persisted to `mskill_plane_candidates`.

```jsonc
{
  "plane_id": 0,                              // integer, unique within job — IMPLEMENTED
  "coef": [ a, b, c ],                        // z = a*x + b*y + c — IMPLEMENTED
  "normal": [ nx, ny, nz ],                   // unit normal, IMPLEMENTED
  "slope_deg": 0.0,                           // IMPLEMENTED
  "pitch_rise_per_12": 0.0,                   // IMPLEMENTED
  "azimuth_deg": null,                        // CONTRACT REQUIRED — not yet computed
  "facet_polygon": { "type": "Polygon", ... },// IMPLEMENTED (no holes — gap)
  "supporting_point_count": 0,                // IMPLEMENTED as `inlier_count`
  "rmse_m": 0.0,                              // IMPLEMENTED
  "plan_area_m2": null,                       // CONTRACT REQUIRED (today computed downstream)
  "slope_area_m2": null,                      // CONTRACT REQUIRED
  "confidence": null,                         // CONTRACT REQUIRED
  "adjacent_plane_ids": []                    // CONTRACT REQUIRED — populated from segment classification
}
```

---

## 7. Roof segment objects

Emitted by `_segments_core.compute_all_segments` and surfaced through `detect_ridges.py`, `detect_hips.py`, `detect_valleys.py`, `detect_eaves.py`, `detect_rakes.py`. Persisted to `mskill_segments`.

Common shape:

```jsonc
{
  "segment_id": "<uuid>",                     // CONTRACT REQUIRED (rows have DB id, payload does not)
  "type": "ridge" | "hip" | "valley" | "eave" | "rake",  // IMPLEMENTED
  "p1": [ x, y, z ], "p2": [ x, y, z ],       // IMPLEMENTED (metres, project_metric)
  "length_m": 0.0,                            // IMPLEMENTED
  "length_ft": 0.0,                           // IMPLEMENTED (downstream)
  "dz": 0.0,                                  // IMPLEMENTED — z2 − z1
  "mid_z": 0.0,                               // IMPLEMENTED
  "connected_plane_ids": [ a, b ] | [ a ],    // IMPLEMENTED as facet_a/facet_b for shared, facet for perimeter
  "confidence": null,                         // CONTRACT REQUIRED
  "supporting_evidence": null                  // CONTRACT REQUIRED — e.g. inlier overlap, mask coverage
}
```

Per-type rules:

- **Ridge:** shared segment with `mid_z` above both adjacent facet centroids AND slope `< 0.15` along its length.
- **Hip:** shared segment with `mid_z` above both adjacent facet centroids AND slope `≥ 0.15` along its length.
- **Valley:** shared segment with `mid_z` below both adjacent facet centroids.
- **Eave:** perimeter segment with along-edge slope `≤ 0.10`.
- **Rake:** perimeter segment with along-edge slope `> 0.10`.

Validation invariants (`validate_geometry` MUST enforce — currently presence-only):

- `connected_plane_ids` reference planes that exist.
- `length_m ≥ 0.5`.
- For shared segments: `facet_a ≠ facet_b`.
- For perimeter segments: edge is not covered by any shared segment (`_perimeter_segments` already filters this).

---

## 8. Pitch object

Emitted by `calculate_pitch.py`.

```jsonc
{
  "predominant_pitch": 6.0,                   // rise/12, inlier-weighted, IMPLEMENTED
  "predominant_slope_deg": 26.57,             // IMPLEMENTED
  "per_plane_pitch": [
    { "plane_id": 0, "pitch_rise_per_12": 6.0, "slope_deg": 26.57, "inlier_count": 1200 }
  ],
  "display_pitch": null,                      // CONTRACT REQUIRED — integer rise/12, clamped ≥ 1
  "confidence": null                          // CONTRACT REQUIRED
}
```

Rounding rule for reports: `display_pitch = max(1, round(predominant_pitch))` — **CONTRACT REQUIRED**.

---

## 9. Area object

Emitted by `calculate_roof_area.py`.

```jsonc
{
  "total_flat_m2": 0.0,                       // IMPLEMENTED
  "total_slope_m2": 0.0,                      // IMPLEMENTED
  "total_flat_sqft": 0.0,                     // IMPLEMENTED downstream
  "total_slope_sqft": 0.0,                    // IMPLEMENTED downstream
  "squares": 0.0,                             // IMPLEMENTED downstream
  "per_facet": [ { "plane_id": 0, "flat_area_m2": 0.0, "slope_area_m2": 0.0 } ],
  "exclusions": [],                           // CONTRACT REQUIRED — e.g. skylights, chimneys
  "waste_factor_applied": false,              // IMPLEMENTED — must always be false at this layer
  "confidence": null,                         // CONTRACT REQUIRED
  "validation_status": "unvalidated" | "passed" | "failed"  // CONTRACT REQUIRED
}
```

Invariant: `total_slope_m2 ≥ total_flat_m2`. **CONTRACT REQUIRED.**

---

## 10. Quality score object

Emitted by `geometry_quality_score.py`.

```jsonc
{
  "overall_score": 0.0,                       // IMPLEMENTED (10-component weighted sum per gap doc)
  "components": {
    "geometry_validity": 0.0,                  // CONTRACT REQUIRED to be itemised
    "plane_fit": 0.0,
    "segment_consistency": 0.0,
    "coordinate_integrity": 0.0,
    "artifact_completeness": 0.0,
    "raster_coverage": 0.0,
    "perimeter_alignment": 0.0,
    "pitch_consistency": 0.0,
    "area_consistency": 0.0,
    "no_data_coverage": 0.0
  },
  "warnings": [ "high_plane_rmse", "low_plane_coverage" ],   // IMPLEMENTED via qa_flags
  "blockers": []                                              // CONTRACT REQUIRED
}
```

---

## 11. Export objects

Emitted by `export_geojson.ts`.

**FeatureCollection target shape (CONTRACT REQUIRED to stamp CRS):**

```jsonc
{
  "type": "FeatureCollection",
  "crs": { "type": "name", "properties": { "name": "EPSG:4326" } },   // CONTRACT REQUIRED
  "metadata": {
    "mskill_job_id": "<uuid>",
    "request_hash": "<hash>",
    "worker_version": "0.3.0-geometry-engine",
    "coordinate_frame": "export_geojson"
  },
  "features": [ ... ]
}
```

Feature kinds the exporter currently emits:

- `building_footprint` — wall-line, not roof edge. IMPLEMENTED.
- `roof_perimeter_candidate` — one per candidate; `is_selected` flagged. IMPLEMENTED.
- `roof_edge` (legacy compat for the selected candidate). IMPLEMENTED.
- `roof_plane` — one per `mskill_plane_candidates` row. IMPLEMENTED.
- `roof_segment` — one per `mskill_segments` row, with `segment_type` property. IMPLEMENTED.

Each feature MUST carry, at minimum: `kind`, `coordinate_frame` (after Phase 2 envelope rollout), `confidence`, and a stable id linking back to its DB row.

Coordinate precision: 7 decimal places of lon/lat. **CONTRACT REQUIRED.**

Report export object (emitted by `export_report.ts`):

```jsonc
{
  "request_hash": "...",
  "mskill_job_id": "...",
  "totals": {
    "roof.plan_sqft": 0,
    "roof.total_sqft": 0,
    "pitch.predominant": 0,
    "lf.ridge": 0, "lf.hip": 0, "lf.valley": 0, "lf.eave": 0, "lf.rake": 0
  },
  "facets": 0,
  "source_pipeline": "mskill",
  "generated_at": "ISO-8601"
}
```

`pdf_pending` flag is intentional — PDF rendering is deferred.

---

## 12. Validation error object

**CONTRACT REQUIRED — NOT YET IMPLEMENTED.** Target shape for `validate_geometry` and downstream consumers:

```jsonc
{
  "severity": "info" | "warning" | "error" | "blocker",
  "code": "PLANE_RMSE_HIGH" | "POLYGON_SELF_INTERSECT" | "MISSING_CRS" | ...,
  "message": "human readable",
  "object_type": "roof_plane" | "ridge" | "raster" | ...,
  "object_id": "<id>",
  "source_skill": "fit_roof_planes",
  "blocking": true,
  "suggested_fix": null | "re-run with finer RANSAC threshold"
}
```

Today `validate_geometry.ts` only throws a single string Error. Replacing that with a list of these objects is part of Phase 4.

---

## 13. Object lifecycle

```
generated   →  refined   →  validated   →  exportable   →  reportable
                              │
                              └──────────→  rejected
```

- **generated:** raw skill output, persisted as artifact.
- **refined:** post-processed by a downstream skill (e.g. perimeter refined from surface, planes re-fit).
- **validated:** passed `validate_geometry`'s contract checks.
- **exportable:** GeoJSON can be emitted; requires validated.
- **reportable:** customer PDF / totals can be emitted; requires exportable AND no blockers.
- **rejected:** any blocker raised — job ends in `failed`, no customer report.

Today the pipeline only distinguishes `pending` / `completed` / `failed` / `needs_review` at the run level. The five-state lifecycle is **CONTRACT REQUIRED**.

---

## 14. Required invariants

Hard invariants enforced at the `validate_geometry` gate:

1. Every roof plane has a valid, closed, CCW, non-self-intersecting polygon of ≥ 0.5 m².
2. Every plane's `|n_z| ≥ 0.5` (no vertical planes).
3. Every segment's `connected_plane_ids` resolve to planes in the same job.
4. Every segment length ≥ 0.5 m.
5. `area.total_slope_m2 ≥ area.total_flat_m2`.
6. `area.waste_factor_applied == false`.
7. `pitch.predominant_pitch ∈ [1, 18]` rise-over-12.
8. Every raster artifact carries `{cell_size_m, transform, crs, nodata, bounds}`.
9. Every geometry artifact carries `coordinate_frame` and `units`.
10. No report export uses an artifact whose lifecycle state is not `exportable`.
11. No customer PDF is produced from a job with any `severity == "blocker"`.

Invariants 1–7 and 10–11 are **CONTRACT REQUIRED — NOT YET IMPLEMENTED**. Invariants 8–9 require the Phase 2 artifact envelope.

---

## 15. Open implementation gaps

1. Add the shared object envelope (§2) to every skill response and every `writeSkillArtifact` call.
2. Persist `plan_area_m2`, `slope_area_m2`, and `azimuth_deg` on the plane object (§6).
3. Persist `segment_id` and `confidence` on segments (§7).
4. Preserve polygon holes through `fit_roof_planes._facet_polygon`.
5. Compute and persist `display_pitch` and per-pitch confidence (§8).
6. Add `exclusions`, `confidence`, `validation_status` to the area object (§9).
7. Itemise the 10 quality components instead of returning a single score (§10).
8. Stamp the GeoJSON FeatureCollection with CRS + metadata (§11).
9. Replace `validate_geometry.ts`'s single Error throw with the structured validation-error list (§12).
10. Implement the five-state geometry lifecycle (§13) in `mskill_runs` / a new `mskill_geometry_state` column.
11. Enforce all 11 invariants from §14 in `validate_geometry.ts`.

These are tracked here only — no code changes in Phase 1.
