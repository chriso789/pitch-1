# Measurement Route Audit

`route_audit_version: measurement-route-audit-v1`

## Purpose

Every row written to `roof_measurements`, `ai_measurement_jobs`, and
`measurement_jobs` is now stamped with provenance so we can tell exactly which
edge function (and which solver entrypoint) produced it. This eliminates the
"phase 3 not implemented" mystery, which was caused by a stale row created by a
non-canonical legacy route.

## Canonical route

| Field                          | Value                                          |
|--------------------------------|------------------------------------------------|
| `created_by_function`          | `start-ai-measurement`                         |
| `solver_entrypoint`            | `start-ai-measurement.geometry_first_v2`       |
| `report_renderer_version`      | `render-measurement-pdf-v1` (after PDF render) |
| `canonical_measurement_route`  | `true`                                         |
| `route_audit_version`          | `measurement-route-audit-v1`                   |

`geometry_report_json.route_provenance` mirrors these values, plus a
`phase3_status` block:

```json
{
  "phase3a5_perimeter_refinement": { "version": "v1", "executed": true },
  "phase3c_topology": { "version": "v1", "executed": true },
  "phase3d_post_topology": { "version": "v1", "executed": true },
  "phase3e_constraint_repair": { "version": "v1", "executed": false, "skipped_reason": "autonomous_score_above_threshold" }
}
```

## Legacy / non-canonical routes

These functions still exist for back-compat but are explicitly marked
non-canonical. UI surfaces a `MISSING — stale or non-canonical route` warning.

| Function              | `created_by_function` | `solver_entrypoint`               |
|-----------------------|-----------------------|-----------------------------------|
| `measure`             | `measure`             | `legacy.measure`                  |
| `analyze-roof-aerial` | `analyze-roof-aerial` | `legacy.analyze-roof-aerial`      |
| `RoofMeasurementTool` | (manual UI path)      | `legacy.manual.RoofMeasurementTool` |

All inserts/updates from these functions are spread with
`LEGACY_*_PROVENANCE` so `canonical_measurement_route` is `false`.

## How to diagnose a "stale" report

1. Open the measurement in `MeasurementReportDialog`.
2. Check the Provenance card:
   - `Created By Function` — should be `start-ai-measurement`.
   - `Canonical Route` — should be `true`.
   - Phase 3A.5 / 3C / 3D / 3E — each should show `v1 / executed` or an
     explicit `skipped: <reason>`.
3. If any field is missing or `non-canonical`, **re-run the measurement**
   through the canonical route (the lead's "Pull AI Measurement" button); do
   not trust the existing row.
4. To confirm at the API level:

   ```sh
   curl -sS "$SUPABASE_URL/functions/v1/debug-measurement-runtime?jobId=<id>" \
     -H "Authorization: Bearer $TOKEN" | jq '.canonical_route, .phase3_versions'
   ```

## Deprecation plan

`measure` and `analyze-roof-aerial` will be deleted once the lead/project
detail pages no longer reference them. Until then they are read-only fallbacks
for legacy data; they cannot produce a customer-ready report because
`canonical_measurement_route=false` blocks the publish gate.
