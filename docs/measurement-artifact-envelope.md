# Measurement Artifact Envelope Contract

**Status:** Phase 2 contract layer. No live endpoint, DB, validator, or report code is wrapped in this envelope yet. This document defines the canonical shape; later phases will adopt it.

## 1. Purpose

Every stage of the measurement pipeline (worker skills, control plane executors, exports, reports) eventually emits artifacts that downstream systems (DB persistence, `validate_geometry`, `export_geojson`, `export_report`, regression harness, customer-facing report renderer) must consume. Without a single envelope shape, each consumer reinvents field names, coordinate metadata, lineage tracking, and validation gating — which is exactly how the current pipeline drifted.

This envelope is the single contract for any measurement artifact persisted, transmitted, or rendered.

## 2. Relationship to coordinate contract

Defined in `docs/measurement-coordinate-contract.md`. The envelope's `coordinate_frame` block MUST conform to the five canonical frames (`source`, `project_metric`, `raster_grid`, `export_geojson`, `report_display`) and the tolerance rules declared there. Any frame_id used in an envelope must appear in the coordinate contract.

## 3. Relationship to geometry object contract

Defined in `docs/measurement-geometry-objects.md`. The envelope's `geometry` and `data` blocks reuse the geometry object schemas (points, surfaces, perimeters, planes, segments, pitch, area). The envelope wraps those objects with lifecycle, lineage, quality, and validation metadata.

## 4. Envelope lifecycle

```
created → partial → complete → validation_pending → validated → exportable → reportable
                                                       ↓
                                                   rejected / failed
```

- `created`: envelope skeleton allocated, payload not yet populated.
- `partial`: some payload present, more skills must contribute.
- `complete`: payload finalized by producing skill; validator has not yet run.
- `validation_pending`: queued for `validate_geometry`.
- `validated`: passed validator; eligible for export.
- `rejected`: validator returned blocking issues; not exportable.
- `exportable`: GeoJSON export gate passed.
- `reportable`: report gate passed (quality + validation + display).
- `failed`: pipeline error; see `errors`.

## 5. Top-level schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema_version` | string (semver) | yes | Envelope schema semver, e.g. `"1.0.0"`. |
| `envelope_version` | int | yes | Monotonic instance version (re-emit increments). |
| `artifact_id` | string (uuid) | yes | Globally unique. |
| `job_id` | string (uuid) | yes | `measurement_job_id`. |
| `parent_artifact_ids` | string[] | yes | Direct inputs (may be empty for ingest). |
| `artifact_type` | enum | yes | See §7. |
| `stage` | enum | yes | See §8. |
| `source_skill` | string | yes | Skill name (e.g. `generate_dsm`). |
| `producer` | object | yes | `{ kind: "worker"\|"control_plane"\|"external", name, version }`. |
| `status` | enum | yes | See §9. |
| `created_at` | string (ISO 8601 UTC) | yes | |
| `coordinate_frame` | object | yes | See §10. |
| `units` | object | yes | See §11. |
| `geometry` | object | yes | See §12. |
| `data` | object | yes | Artifact-type-specific. See §13. |
| `quality` | object | yes | See §14. |
| `validation` | object | yes | See §15. |
| `lineage` | object | yes | See §16. |
| `warnings` | issue[] | yes | May be empty. See §19. |
| `errors` | issue[] | yes | May be empty. See §19. |
| `storage` | object | no | Present when payload is externalized. See §17. |
| `display` | object | no | Present when artifact is rendered. See §18. |

## 6. Field-by-field definitions

- `schema_version`: pins the contract version; consumers reject unknown majors.
- `envelope_version`: bumps on republish (e.g. re-validation, refinement). Append-only event log uses (`artifact_id`, `envelope_version`).
- `artifact_id`: stable identity; `parent_artifact_ids` always reference prior `artifact_id`s.
- `job_id`: tenant scoping and lineage roll-up.
- `source_skill`: the skill that produced this envelope version.
- `producer.kind`: distinguishes worker compute from control-plane assembly from external imports (e.g. EagleView).
- `status`: see lifecycle.
- `created_at`: emission time, UTC.

## 7. Artifact type enum

`source_surface_data`, `dsm`, `dtm`, `chm`, `roof_points`, `roof_mask`, `roof_perimeter`, `roof_planes`, `ridge_segments`, `hip_segments`, `valley_segments`, `eave_segments`, `rake_segments`, `pitch_measurements`, `roof_area_measurements`, `geometry_quality_score`, `geojson_export`, `report_export`.

## 8. Stage enum

In pipeline order: `ingest`, `generate_dsm`, `generate_dtm`, `generate_chm`, `isolate_roof_points`, `refine_roof_perimeter`, `fit_roof_planes`, `detect_ridges`, `detect_hips`, `detect_valleys`, `detect_eaves`, `detect_rakes`, `calculate_pitch`, `calculate_roof_area`, `geometry_quality_score`, `validate_geometry`, `export_geojson`, `export_report`.

## 9. Status enum

`created`, `partial`, `complete`, `validation_pending`, `validated`, `rejected`, `exportable`, `reportable`, `failed`.

## 10. Coordinate frame block

```jsonc
{
  "frame_id": "project_metric_utm17n",
  "frame_type": "project_metric",          // source | project_metric | raster_grid | export_geojson | report_display
  "crs": "EPSG:32617",
  "origin": [635120.0, 3324510.0],          // optional, frame-dependent
  "axis_orientation": "ENU",                // ENU | image | other
  "units": "m",
  "has_z": true,
  "z_convention": "ellipsoidal_m",          // ellipsoidal_m | orthometric_m | relative_m | none
  "transform_to_source": null,
  "transform_to_local": null,
  "transform_to_raster": null,
  "transform_to_export": null,
  "precision": { "xy_m": 0.05, "z_m": 0.10 },
  "status": "complete"                      // complete | partial | unknown
}
```

`status="unknown"` is the honest answer when upstream metadata is missing; downstream validation MUST refuse to promote such artifacts past `validation_pending`.

## 11. Units block

```jsonc
{
  "horizontal_distance": "m",
  "vertical_distance": "m",
  "area": "m^2",
  "slope": "deg",
  "pitch": "rise_per_12",
  "angle": "deg",
  "raster_resolution": "m_per_px",
  "confidence": "ratio_0_1",
  "quality_score": "ratio_0_1"
}
```

## 12. Geometry block

Supports inline OR by-reference geometry.

```jsonc
{
  "geometry_type": "raster" | "point_cloud" | "polygon" | "multipolygon" | "linestring" | "multilinestring" | "plane_set" | "export_document" | "none",
  "coordinate_frame": "project_metric_utm17n",
  "dimensions": { "width_px": 2048, "height_px": 2048 },   // raster only
  "bbox": [xmin, ymin, xmax, ymax],
  "value": null,                                            // inline GeoJSON / array / null
  "storage_ref": "artifact_id_or_uri",                      // when not inline
  "precision": { "xy_m": 0.05 },
  "no_data_policy": { "sentinel": -9999, "mask_band": null }
}
```

## 13. Data block by artifact type

- **DSM / DTM / CHM**: `{ raster_uri, width_px, height_px, resolution_m_per_px, bounds, no_data, band_stats, source_point_density_per_m2 }`.
- **roof_points**: `{ point_count, classifications, source_indices_uri, confidence_stats, density_per_m2 }`.
- **roof_mask**: `{ raster_uri, polygon_simplified, coverage_ratio }`.
- **roof_perimeter**: `{ exterior_ring, holes, simplification_tolerance_m, source: "surface"|"footprint"|"jurisdiction"|"math_offset" }`.
- **roof_planes**: `{ planes: [{ plane_id, normal:[a,b,c,d], boundary, rmse_m, inlier_count, slope_deg }] }`.
- **ridge/hip/valley/eave/rake segments**: `{ segments: [{ segment_id, connected_plane_ids, geometry, classification_evidence, length_m }] }`.
- **pitch_measurements**: `{ predominant_pitch, predominant_slope_deg, per_plane_pitch:[{ plane_id, pitch_rise_per_12, slope_deg, inlier_count }] }`.
- **roof_area_measurements**: `{ total_roof_area_m2, total_roof_area_sqft, total_flat_footprint_m2, roofing_squares, per_facet:[...] }`.
- **geometry_quality_score**: `{ overall_score, pass, components, weights, needs_review_reason }`.
- **geojson_export**: `{ document_uri, feature_counts_by_type }`.
- **report_export**: `{ document_uri, mime_type, pages, included_artifact_ids }`.

Type-specific schemas are formalized incrementally; the envelope itself does not block on additions because each type lives under `data`.

## 14. Quality block

```jsonc
{
  "overall_score": 0.0,                 // 0..1
  "confidence": 0.0,
  "component_scores": {},
  "completeness": 0.0,
  "coordinate_integrity": 0.0,
  "geometry_validity": 0.0,
  "plane_fit_quality": 0.0,
  "segment_consistency": 0.0,
  "warnings_count": 0,
  "blockers_count": 0
}
```

## 15. Validation block

```jsonc
{
  "validation_status": "pending" | "passed" | "failed" | "skipped",
  "validated_at": null,
  "validator_version": null,
  "errors": [],
  "warnings": [],
  "blockers": [],
  "export_allowed": false,
  "report_allowed": false
}
```

`validate_geometry.ts` is NOT hardened in this phase; this block defines the shape future enforcement will write into.

## 16. Lineage block

```jsonc
{
  "input_artifact_ids": [],
  "source_files": [],
  "source_job_id": null,
  "parameters": {},
  "skill_version": "0.0.0",
  "code_version": "git-sha",
  "runtime": { "language": "python"|"typescript", "version": "" },
  "created_by": "worker"|"control_plane"|"external",
  "dependencies": []
}
```

## 17. Storage block

```jsonc
{
  "storage_type": "supabase_storage" | "s3" | "inline" | "external",
  "uri": "supabase://bucket/path",
  "bucket": "measurement-artifacts",
  "path": "{job_id}/{stage}/{artifact_id}.json",
  "mime_type": "application/json",
  "checksum": { "algo": "sha256", "value": "" },
  "byte_size": 0,
  "compression": "none" | "gzip" | "zstd",
  "encoding": "utf-8" | "binary"
}
```

## 18. Display / reporting block

```jsonc
{
  "display_units": { "area": "sqft", "pitch": "x_per_12", "length": "ft" },
  "rounding_rules": { "area_sqft": 0, "pitch": 1, "length_ft": 1 },
  "labels": {},
  "report_visibility": "customer" | "internal" | "debug" | "hidden",
  "map_visibility": "always" | "on_zoom" | "hidden"
}
```

## 19. Warning / error object

```jsonc
{
  "severity": "info" | "warning" | "error" | "blocker",
  "code": "PERIMETER_OPEN_RING",
  "message": "Exterior ring is not closed",
  "object_type": "roof_perimeter",
  "object_id": "perimeter_3",
  "source_skill": "refine_roof_perimeter_from_surface",
  "blocking": true,
  "suggested_fix": "Re-run perimeter refinement with relaxed tolerance",
  "metadata": {}
}
```

## 20. JSON schema location

`docs/schemas/measurement-artifact-envelope.schema.json`.

## 21. TypeScript contract location

`supabase/functions/_shared/mskill/artifact-envelope.ts`. Placed in the existing shared mskill folder used by `registry.ts`, `runner.ts`, and the executors — this is the canonical shared contract directory in the repo. Re-export from `_shared/mskill` if a barrel is later introduced.

## 22. Python contract location

`worker/app/artifacts/envelope.py`. New `worker/app/artifacts/` package created to keep contract helpers out of `worker/app/skills/`, which is reserved for routed skill modules.

## 23. Example artifact list

Under `docs/examples/artifacts/`:

- `dsm.json`
- `dtm.json`
- `chm.json`
- `roof_points.json`
- `roof_perimeter.json`
- `roof_planes.json`
- `ridge_segments.json`
- `hip_segments.json`
- `valley_segments.json`
- `eave_segments.json`
- `rake_segments.json`
- `pitch_measurements.json`
- `roof_area_measurements.json`
- `geometry_quality_score.json`
- `geojson_export.json`
- `report_export.json`

These are contract examples, not captured outputs from live endpoints.

## 24. Current implementation status

- **Existing live endpoints DO NOT emit this envelope.** Worker skills today return `SkillResponse` with bespoke `output_payload` shapes (verified: `worker/app/skills/calculate_pitch.py`, `calculate_roof_area.py`, `generate_chm.py`, `geometry_quality_score.py`, etc.). Control-plane executors (`_shared/mskill/executors/*.ts`) likewise return ad-hoc payloads.
- This phase delivers ONLY: doc, JSON schema, TS helper, Python helper, examples.
- `validate_geometry.ts` has not been hardened against the envelope.
- `export_geojson.ts` and `export_report.ts` have not been wrapped in the envelope.
- No DB schema changes were made.

## 25. Open implementation gaps

1. Worker skills must be updated to wrap `output_payload` in the envelope and attach it to each `Artifact`. (Phase 4+.)
2. Control-plane runner must persist envelopes through a dedicated table. (Phase 3 DB.)
3. `validate_geometry` must consume envelopes, write the `validation` block, and gate `exportable`/`reportable`. (Phase 5.)
4. `export_geojson` and `export_report` must refuse non-`validated` envelopes. (Phase 5/6.)
5. Coordinate-frame status `unknown` must become a hard block at validation. (Phase 5.)
6. Type-specific `data` schemas need formal sub-schemas in `docs/schemas/` once Phase 4 freezes worker payloads.
7. Regression harness must replay envelopes against golden fixtures. (Phase 6.)
