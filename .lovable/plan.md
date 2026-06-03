
# PITCH Measure — Internal Skill Pipeline Build

A self-contained measurement pipeline that runs in parallel to the existing `start-ai-measurement` system. It only writes back into `roof_measurements` once a full, validated report exists. Heavy compute skills dispatch to an external internal worker; they never fake completion.

## Architecture

```text
Frontend (/skills registry, /jobs pipeline panel, Bridge status card)
        │
        ▼
measurement-api (grouped edge function)        measurement-worker (grouped)
  /skills/run                                    /worker/callback (internal-secret)
  /skills/list                                   /worker/dispatch  (internal-secret)
  /skills/pipeline?jobId
  /skills/run-status?runId
  /skills/retry
  /jobs/create
  /jobs/get
  /jobs/bridge
        │
        ▼
Postgres: 17 new tables + roof_measurements (read-only target of bridge)
        │
        ▼
External Internal Worker Service (separate, not built here)
  POST /skills/clip-point-cloud … /skills/calculate-roof-area
```

Routing rule per architecture guard: **no new standalone functions.** All routes live inside `measurement-api` and `measurement-worker`. Frontend uses `edgeApi("measurement-api", "/route", payload)`.

## Phase 1 — Schema (one migration)

Tables (all `tenant_id`, RLS enabled, GRANTed, indexed on `measurement_request_id` + `request_hash`):

- `measurement_requests` — entry point (address, place_id, lat/lon, county, request_hash, status)
- `measurement_jobs` — execution shell tied to a request
- `measurement_skills` — registry (skill_key, category, execution_target, dependencies, inputs, outputs, version)
- `skill_runs` — every execution attempt (status, input_payload, output_payload, error)
- `skill_artifacts` — every produced artifact (type, storage_path/source_url, hash-stamped)
- `provider_sources`, `provider_coverage`, `provider_sync_logs`
- `parcels`, `building_footprints`, `roof_edge_candidates`
- `lidar_windows`, `lidar_assets`, `elevation_provider_assets`
- `roof_surface_assets`, `roof_surface_processing_jobs`, `roof_point_jobs`
- `roof_plane_candidates`, `roof_segments`, `roof_geometry_status`
- `report_artifacts`, `processing_workers`
- `measurement_pipeline_bridges` — links validated skill output → roof_measurements row

Skill seed data (24 rows) inserted in the migration.

## Phase 2 — Grouped edge functions

### `measurement-api`
Authenticated tenant routes:
- `POST /jobs/create` → creates `measurement_requests` + `measurement_jobs`, kicks off `geocode_address`
- `GET  /jobs/get?jobId`
- `GET  /skills/pipeline?jobId` — full skill order + per-skill status + last error + artifact links + "cannot complete from stub" flag
- `POST /skills/run` { jobId, skillKey } → `runMeasurementSkill`
- `GET  /skills/run-status?runId`
- `POST /skills/retry` { runId }
- `GET  /skills/list` — full registry
- `POST /jobs/bridge` { jobId } → `bridgeSkillReportToRoofMeasurements`

### `measurement-worker`
Service-role / `INTERNAL_WORKER_SECRET` routes:
- `POST /worker/dispatch` — sent by `runMeasurementSkill` for compute-plane skills; calls `WORKER_BASE_URL` + `/skills/<key>` with payload, marks `skill_runs.status = queued`
- `POST /worker/callback` — external worker reports completion; writes `skill_runs.output_payload`, persists artifacts via `writeSkillArtifact`, recomputes `roof_geometry_status`, unblocks downstream

Shared module `_shared/measurement-skills/`:
- `registry.ts` — 24 skill definitions, dependencies, gates
- `runner.ts` — `runMeasurementSkill`, `validateSkillDependencies`, `validateRequestContract`, `blockDownstreamSkills`, `updateGeometryReadiness`
- `artifacts.ts` — `writeSkillArtifact` (stamps request_hash, refuses stale)
- `executors/` — one file per control-plane skill (real execution: geocode, parcel, footprint, edge candidates, lidar discovery, elevation assets, dem/dtm, roof surface asset)
- `bridge.ts` — `bridgeSkillReportToRoofMeasurements` (only runs when validate_geometry + export_report completed with real artifacts)

## Phase 3 — Frontend

- `src/pages/MeasurementSkills.tsx` — `/skills` registry page (list, category, target, deps, inputs, outputs, last run/error, version)
- `src/pages/MeasurementJobPipeline.tsx` — `/measurement-jobs/:jobId` pipeline panel:
  - Ordered skill list with status badges (blocked/pending/queued/running/completed/failed)
  - "Missing dependency: X" for blocked
  - Artifact links for completed
  - "Cannot complete from stub" badge when no real artifact exists
  - Bridge status card: not written / written / failed / blocked, target `roof_measurements` id, confidence
- `src/hooks/useMeasurementSkills.ts` + `useMeasurementJob.ts` (Tanstack Query + Realtime on `skill_runs`)
- Route added to `adminRoutes.tsx` (master/admin only)

## Phase 4 — Bridge

`bridgeSkillReportToRoofMeasurements`:
1. Verify `request_hash`.
2. Verify `validate_geometry` and `export_report` skill_runs are `completed`.
3. Verify required artifacts exist (facets, roof edge, ridges, hips, valleys, eaves, rakes, pitch, area, report JSON, GeoJSON).
4. Build compatibility payload matching existing `roof_measurements` columns.
5. Insert (or update) `roof_measurements` with `source_pipeline = 'skill_runs'`, `measurement_request_id`, `request_hash`, `confidence_score`, `validation_status`.
6. Write `measurement_pipeline_bridges` row.
7. Goes through `normalizeResultStateForWrite()` and respects schema-drift strip-and-retry.

Refuses to bridge: demo geometry, footprint-derived outline only, LiDAR coverage only, DEM/DTM only, roof-edge candidate only, stub/deferred results, unvalidated geometry.

## Phase 5 — Worker integration

Two-step plumbing because the worker lives outside Lovable:
- `WORKER_BASE_URL` + `INTERNAL_WORKER_SECRET` secrets (request from user only when first compute skill is invoked).
- If `WORKER_BASE_URL` not set: dispatch marks `skill_runs.status = 'requires_internal_worker'` with `blocking_reason`. Downstream is blocked. UI shows "Worker offline — cannot complete from stub".
- Callback endpoint `POST measurement-worker/worker/callback` accepts results, validates `request_hash`, writes artifacts.

## Hard guarantees

- No stub data flips a skill to `completed`.
- No new standalone edge function folders — all routes inside `measurement-api` / `measurement-worker`.
- All writes resolve `tenant_id` from JWT, never from body.
- `roof_measurements` is untouched until full validated bridge runs.
- Failed/blocked dependency cascades via `blockDownstreamSkills`.
- All artifacts stamped with `request_hash`; stale rejected.

## Technical notes

- One migration file with all 17 tables + 24-row skill seed + RLS + GRANTs + indexes + `NOTIFY pgrst, 'reload schema';`.
- `measurement-api` uses existing `_shared/router.ts`, `auth.ts`, `tenant.ts`, `errors.ts`, `audit.ts`, `env.ts`.
- Geocode skill uses existing Google Maps key (already in secrets). Parcel/footprint discovery uses provider_sources rows seeded with USGS/county placeholders — real provider wiring is iterative.
- `runMeasurementSkill` is the single chokepoint that creates `skill_runs` rows; control-plane executors are pure functions returning `{ output_payload, artifacts[] }`; compute-plane skills return `{ dispatched: true }` after worker call.

## Out of scope this build

- Real provider integrations beyond Google geocode (parcels/footprints will use stubbed `requires_provider_wiring` until you add provider creds).
- The external worker service itself.
- Pricing, PITCH CRM integration beyond the bridge.

## Delivery order

1. Migration (schema + seed + RLS + grants).
2. `measurement-api` grouped function + shared registry/runner/artifacts.
3. `measurement-worker` grouped function + dispatch/callback.
4. Control-plane executors (geocode → roof_surface_asset, validate, export_geojson, export_report).
5. Bridge function + `measurement_pipeline_bridges` writes.
6. `/skills` + `/jobs/:id` UI pages and hooks, routed under admin.
7. Smoke test: create a job for a real address, walk through skills 1–4 end-to-end, confirm 5–8 produce real metadata, confirm worker skills correctly stick at `requires_internal_worker` instead of faking completion.
