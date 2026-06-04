Pre-Integration Audit: Existing AI Measurement vs New Skill Pipeline

Do not connect the AI Measurement button yet.  
Do not replace start-ai-measurement yet.  
Do not add another competing measurement path yet.  
Do not remove legacy code.

Goal:  
Audit the existing AI measurement pipeline and map what it already pulls, produces, stores, and displays so the new measurement skills pipeline strengthens it instead of conflicting with it.

Known existing repo areas to inspect:

- src/components/measurements/PullMeasurementsButton.tsx
- src/hooks/useMeasurementJob.ts
- src/components/measurements/UnifiedMeasurementPanel.tsx
- src/components/measurements/MeasurementWorkflow.tsx
- src/components/measurements/MeasurementReportDialog.tsx
- src/components/measurements/MeasurementVisualQAOverlay.tsx
- supabase/functions/start-ai-measurement/index.legacy.ts
- supabase/functions/measure-roof/index.ts
- supabase/functions/measure/index.ts
- supabase/functions/analyze-roof-aerial/index.ts
- supabase/functions/render-measurement-pdf/index.ts
- supabase/functions/_shared/dsm-derived-bounds-runtime.ts
- supabase/functions/_shared/dsm-diagnostic-propagation.ts
- supabase/functions/_shared/perimeter-refinement.ts
- supabase/functions/_shared/ridge-clustering.ts
- supabase/functions/_shared/ridge-cluster-region-split.ts
- docs/ai_measurement_architecture_[status.md](http://status.md)
- docs/[measurement-route-audit.md](http://measurement-route-audit.md)
- docs/[measurement-runtime-audit.md](http://measurement-runtime-audit.md)
- .agents/skills/ai-measurement-regression-harness/[SKILL.md](http://SKILL.md)
- .agents/skills/roof-measurement-vision-qa/[SKILL.md](http://SKILL.md)

Create a report:  
docs/[measurement-integration-audit.md](http://measurement-integration-audit.md)

The report must answer:

1. Current UI triggers  
List every button/component/hook that starts or displays a measurement:

- component path
- hook path
- function invoked
- payload sent
- downstream route/function

2. Current edge functions/routes  
For each measurement-related function:

- function name
- path
- current purpose
- input schema
- output schema
- tables written
- storage buckets written
- whether it is active, legacy, duplicate, or unknown

3. Current data sources pulled  
For each existing source, identify whether the current system pulls:

- aerial image
- satellite image
- DSM
- DEM
- DTM
- roof mask
- roof bounds
- provider imagery
- Mapbox/Google data
- AI vision output
- manual polygon
- stored report artifact

For each source show:

- API/provider name if identifiable
- env var required
- source URL or route
- where stored
- what it is used for
- whether it can be reused by the new skill pipeline

4. Current measurement artifacts produced  
List all existing artifacts:

- roof outline
- roof polygon
- DSM bounds
- roof mask
- facets
- ridges
- hips
- valleys
- eaves/rakes
- pitch
- roof area
- overlay image
- visual QA result
- PDF report

For each artifact:

- produced by which function
- stored in which table/bucket
- confidence/QA fields
- known failure modes
- whether it should become an input to the new skill pipeline or be replaced

5. Current database tables  
List all measurement-related tables:

- roof_measurements
- any measurement_jobs tables
- any report/artifact tables
- any AI usage/diagnostics tables
- any DSM/geometry tables

For each:

- schema summary
- writer functions
- reader components
- downstream dependency
- should keep / bridge / migrate / deprecate

6. Conflict map  
Identify conflicts between legacy and new system:

- duplicate job creation
- duplicate status tracking
- duplicate report generation
- duplicate roof polygon storage
- duplicate DSM/roof surface artifacts
- duplicate provider calls
- risk of stale artifacts
- risk of wrong request_hash
- risk of writing incomplete data into roof_measurements

7. Reuse map  
Identify what existing code should be reused:

- DSM-derived bounds logic
- perimeter refinement
- ridge clustering
- visual QA overlays
- regression harness
- PDF renderer
- report dialog
- old roof_measurements compatibility
- any useful measurement tables/artifacts

8. Integration recommendation  
Provide a specific safe integration plan:

- what stays legacy
- what becomes a shim
- what becomes the new orchestrator
- what data source functions are reused
- what artifacts are bridged
- what code is deprecated later
- what tests must pass before switching the AI Measurement button

Do not modify code in this audit step except adding the report.

Success criteria:

- A full [measurement-integration-audit.md](http://measurement-integration-audit.md) exists.
- It clearly shows what the existing system already pulls.
- It identifies all conflicts before the button is rewired.
- It identifies reusable code so the new skill pipeline strengthens the existing measurement system instead of leaving duplicate code behind.  
  
  
  
Goal

Make the existing "AI Measurement" button (PullMeasurementsButton → useMeasurementJob) the user-facing trigger for the new `measurement_requests` / `mskill_runs` / internal worker pipeline, while keeping `roof_measurements` as the final compatibility surface — written only after `validate_geometry` + `export_geojson` + `export_report` succeed.

## Architecture

```text
PullMeasurementsButton (UI)
  └─ useMeasurementJob.startJob()
       └─ POST /functions/v1/start-measurement-pipeline   ← NEW orchestrator
            ├─ create mskill_requests row
            ├─ create/attach mskill_jobs row
            ├─ run control-plane skills (mskill/runner)
            │     geocode → parcel → footprint → roof_edge_candidates
            │     → lidar_coverage → elevation_assets
            │     → acquire_dem_dtm → acquire_roof_surface_asset
            ├─ dispatch compute-plane skills to internal worker
            │     clip_point_cloud → (later) dsm/dtm/chm/planes/edges/pitch/area
            ├─ validate_geometry → export_geojson → export_report
            └─ bridgeSkillReportToRoofMeasurements  ← only on full success

start-ai-measurement (legacy)
  └─ thin shim → calls start-measurement-pipeline, stamps
       legacy_entrypoint=start-ai-measurement, routed_to=measurement_skills_pipeline
```

## Hard rules enforced

- No `roof_measurements` row written unless validate_geometry + export_geojson + export_report all `completed` with real artifacts.
- Worker offline → control-plane skills still run; compute-plane skills marked `blocked`; pipeline marked `paused`, NOT `failed`.
- Stub / `needs_implementation` worker responses cannot satisfy a step.
- Every provider response stamped with measurement_request_id, request_hash, measurement_job_id, provider_key, source_url, timestamp, metadata.
- Missing required source (e.g. no Google key, DEM-only property) → hard block at that step, no fake downstream.
- Wrong request_hash on worker callback → 409, artifact rejected (already enforced).

## Changes

### Backend

1. **New edge function** `supabase/functions/start-measurement-pipeline/index.ts`
  - Auth: `requireAuth` + `requireTenant` (tenant resolved from JWT, never body).
  - Input: `{ address, job_id?, contact_id?, lead_id?, source, mode, allow_paid_fallback? }`.
  - Creates `mskill_requests` + `mskill_jobs`, then drives the skill list via `mskill/runner.runMeasurementSkill`.
  - Returns `{ measurement_request_id, measurement_job_id, pipeline_status[] }`.
  - On full success calls `bridgeSkillReportToRoofMeasurements`.
2. `**supabase/functions/_shared/mskill/pipeline.ts**` (new)
  - Defines canonical ordered skill list (control / compute / report).
  - `runPipeline(ctx)` iterates skills, respects dependencies, surfaces per-skill status (`pending|running|blocked|completed|failed|needs_implementation`), and stops promotion when a required upstream is missing.
  - Worker health checked once at compute boundary; if offline, all compute+report skills emitted as `blocked` with reason `worker_offline`, pipeline result = `paused`.
3. `**supabase/functions/_shared/mskill/bridge.ts**`
  - Add `assertReadyForRoofMeasurementsBridge(runs)` guard — refuses to write `roof_measurements` unless validate_geometry, export_geojson, export_report are all `completed` with required artifacts.
4. **Legacy `supabase/functions/start-ai-measurement/index.ts**`
  - At top of handler: build pipeline input from current body and `fetch` the new `start-measurement-pipeline` with the user's JWT forwarded.
  - Stamp response with `legacy_entrypoint`, `routed_to`.
  - Keep legacy code reachable behind `?legacy=1` query flag for debugging only (not used by UI).

### Frontend

5. `**src/hooks/useMeasurementJob.ts**`
  - Replace the `supabase.functions.invoke('start-ai-measurement', …)` call with `invoke('start-measurement-pipeline', …)`.
  - Persist `measurement_request_id` and start subscribing to `mskill_runs` for that request (real-time).
6. **New `src/components/measurements/MeasurementPipelineStatus.tsx**`
  - Lists the 25 skills with status pill, dependency reason, artifact link.
  - Source: `mskill_runs` filtered by `measurement_request_id`.
  - Renders banner: "Internal processing worker offline — measurement paused before roof geometry extraction." when worker_offline reason present.
7. `**src/components/measurements/PullMeasurementsButton.tsx` / `UnifiedMeasurementPanel.tsx**`
  - Mount `MeasurementPipelineStatus` while a run is active.

### Tests

8. Edge-function tests covering test cases A–F (worker offline, only clip implemented, DEM-only, missing Google key, wrong request_hash, future full success).

## Out of scope (this step)

- Implementing remaining compute skills (generate_dsm and beyond) — they stay `needs_implementation` and intentionally block bridge.
- Removing legacy geometry_first_v2 code paths inside `start-ai-measurement` (kept behind `?legacy=1`).