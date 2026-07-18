## Goal
Make the **Run Measurement Test** button in the AI Measurement admin tab drive the new **RoofTrace AI** perimeter-first workflow instead of (or in addition to) the legacy `start-ai-measurement` + `vision-trace-roof` path.

## Scope
Only the Developer Testing Area on `/admin/companies` → AI Measurement tab. No changes to production Measure Lab or customer report pipeline yet.

## 1. Database (one migration)
Create the four RoofTrace AI tables per skill schema, tenant-scoped RLS + GRANTs:

- `roof_trace_sessions` — session per address/job, holds source + calibration + current perimeter_status + result_state
- `roof_trace_revisions` — immutable versioned geometry payloads (`draft|approved|superseded`), unique(session_id, revision)
- `roof_trace_jobs` — async worker jobs (`acquire|calibrate|perimeter|topology|pitch|report`)
- `measurement_drafts` — approved output (`ready|applied|superseded`); never touches estimates

Enums: `perimeter_status`, `result_state` as defined in skill.

## 2. Edge function (grouped, per architecture guard)
Add routes to existing `measurement-api` (or create if not present following the `*-api` grouping rule) — **not** a new standalone function:

- `POST /roof-trace/sessions` — create session from `{ address, lat, lng, job_id? }`
- `POST /roof-trace/sessions/:id/run` — enqueue `roof_trace_jobs` for `{ stages: ['acquire','calibrate','perimeter'] }`
- `GET  /roof-trace/sessions/:id` — session + latest revision + open jobs
- `POST /roof-trace/sessions/:id/approve` — validate gates (closed non-self-intersecting perimeter, scale conf ≥ 0.85), write approved revision, upsert `measurement_drafts`

Worker execution stays inside the existing measurement worker function; add a `roof-trace` route that:
1. Fetches Google tile centered on confirmed lat/lng at auto-picked zoom (Solar bbox → zoom 19–21)
2. Calls Gemini via Lovable AI Gateway with perimeter-only prompt (reuse `vision-trace-roof` prompt but constrained to outer eave polygon)
3. Computes `perimeter_gate_metrics` (closure, self-intersect, coverage vs Solar bbox)
4. Writes revision as `draft` with `perimeter_status='proposed'`

## 3. Frontend
Replace/augment `MeasurementTestPanel.tsx`:

- Keep address autocomplete + Run button
- On Run: call `POST /roof-trace/sessions` then `.../run`
- Poll `roof_trace_jobs` via existing polling helper until perimeter job completes
- Render the returned outer perimeter + tile in a new `RoofTraceWorkbenchPreview` component (read-only view of the workbench canvas — cyan proposed, orange needs review, green accepted)
- Show `perimeter_gate_metrics` inline (closure ✓/✗, coverage %, self-intersect ✓/✗)
- **Approve perimeter** button → calls `.../approve`, then shows `measurement_drafts` row id

Legacy `start-ai-measurement` test path stays available under a "Legacy pipeline" collapsible so we can still compare.

## 4. Out of scope (this PR)
- Full workbench editing UI (drawing tools, layer toggles, right-panel props) — preview only for now
- Topology / pitch / report stages
- Measure Lab entry point in Job page

## Technical notes
- All tables get `tenant_id uuid not null` + RLS `USING (tenant_id = get_current_tenant_id())`
- GRANTs: `authenticated` = full CRUD, `service_role` = ALL, no anon
- Frontend uses `edgeApi("measurement-api", "/roof-trace/...", payload)` per architecture guard
- No changes to `roof_measurements` or `ai_measurement_jobs` — RoofTrace AI is fully additive

## Acceptance
- Clicking Run creates a `roof_trace_sessions` row and a `perimeter` job
- Within ~30s the panel renders an AI-proposed cyan perimeter over the Google tile
- Approve button writes a `roof_trace_revisions` row (revision=1, state=approved) and a `measurement_drafts` row
- No `estimates`, `estimate_line_items`, or `roof_measurements` rows are touched