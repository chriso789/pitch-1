---
name: rooftrace-ai
description: Implementation contract for the RoofTrace AI feature in PITCH CRM's Measure Lab — perimeter-first roof tracing workbench with calibration, topology, pitch, revision immutability, and measurement_drafts (never auto-writing estimates). Load when working on RoofTrace AI, roof_trace_sessions/revisions/jobs tables, measurement_drafts, the tracing workbench UI, or Measure Lab perimeter-first gates.
---

# RoofTrace AI — PITCH CRM Implementation

## Outcome
Full-screen workbench in Job → Measure Lab where a user supplies an aerial image / roof report / plan PDF / licensed imagery, gets an AI-assisted trace, edits it, and saves a **measurement-ready draft**. Never auto-creates or overwrites a CRM estimate.

**Perimeter-first**: outer eave perimeter detected and scored BEFORE any facet/ridge/hip/valley/area is trusted. Do not resurrect the old global-mask calculation.

## Placement & Permissions
- Action sits beside existing `AI Measurement` in Job → Measure Lab.
- Roles that can create/edit: `owner`, `admin`, `estimator`, `project_manager`. Sales sees approved reports only.
- Full-screen workbench, never modal. Continuous draft save. Only explicit **Approve measurement** creates a locked revision.

## Workflow (7 stages)
1. **Source** — address + geocode confidence; accept aerial JPG/PNG/WebP, drone, report image, roof-plan PDF, or licensed imagery/GIS. Store provenance, capture date, license/provider, resolution, north orientation.
2. **Calibrate** — report scale, known dimension, GIS footprint scale, or user reference line. If confidence < 0.85 require manual confirmation. Never silently assume px/ft.
3. **Outer perimeter** — AI proposes outer eave only (cyan). Closed, non-self-intersecting required.
4. **Topology** — only after perimeter accepted: facets, ridges, hips, valleys, eaves, rakes, walls, drains, penetrations. Each has confidence + evidence.
5. **Pitch** — only from plan annotation, LiDAR/DSM, or verified user value. Otherwise `needs_pitch_review`. Never invent pitch from flat aerial.
6. **Review** — area, waste-ready area, perimeter, edge lengths by class, facet count, pitch distribution, missing-region warnings, component confidence.
7. **Approve** — versioned immutable revision; creates/updates only `measurement_drafts`.

## Hard Gates
Block approve when: no valid outer perimeter, scale confidence < 0.85, facet outside perimeter, intersecting topology lines, unresolved critical warnings.

Flag (don't block): low-confidence penetrations, missing per-facet pitch, imagery > 36 months old.

Enums:
- `perimeter_status`: `pending | proposed | needs_review | accepted | rejected`
- `result_state`: `queued | acquiring | calibrating | tracing_perimeter | tracing_topology | needs_review | ready | failed`

A `needs_review` trace MUST NOT populate material/labor quantities.

## Data Model
Tables: `roof_trace_sessions`, `roof_trace_revisions`, `roof_trace_jobs`, `measurement_drafts`. All tenant-scoped RLS. See `references/schema.sql`.

Key constraints:
- `roof_trace_revisions`: unique(session_id, revision); states `draft | approved | superseded`.
- `roof_trace_jobs.type`: `acquire | calibrate | perimeter | topology | pitch | report`.
- `measurement_drafts.status`: `ready | applied | superseded`.

## Geometry Contract
GeoJSON in WGS84 when geo-referenced, image-pixel otherwise. Every geometry object declares `coordinate_space`, `image_width`, `image_height`, `units`, calibration. Structure: `outer_perimeter` (Polygon), `facets[]` (polygon+pitch+pitch_source+confidence), `edges[]` (kind: eave/rake/ridge/hip/valley/wall/flashing), `features[]` (penetrations, etc.).

## AI Worker Contract
All image/PDF analysis runs in existing `pitch-worker-api` — **not** in browser, **not** in Supabase DB function.

`POST /v1/roof-trace/sessions/:sessionId/run` with `{ stages, source, property, existing_context }`.

Worker sequence:
1. Validate source; fail early on blurry/oblique.
2. Scale from strongest evidence: plan/report → verified GIS footprint → user reference. Preserve evidence + confidence.
3. Segment only inside target building footprint. Never full-image mask.
4. Outer eave polygon + `perimeter_gate_metrics` (coverage vs footprint, image-edge contact, closure, self-intersection, simplification error, missed-region estimate).
5. Stop topology unless perimeter gate passes.
6. Facets/lines reconciled inside accepted perimeter. No line outside outer boundary.
7. Pitch only from supported evidence; else `unknown`.
8. Plan area, slope area (where pitch known), linear lengths by class, confidence, stable warning codes.

Return `200` structured only; `422` unusable source; `409` revision conflict. Browser polls `roof_trace_jobs` or uses realtime — never long-waits.

## Workbench UX
- **Left**: source selector, layer toggles, confidence legend, warnings, revision history.
- **Center**: zoomable canvas — pan, undo/redo, snapping, draw/edit/select, north arrow, scale bar, original/proposed/approved toggle.
- **Right**: selected object props, numeric measurements, facet table, pitch editor, QA gate status.
- Colors: **cyan** proposed perimeter, **green** accepted, **orange** needs review, **red** invalid, **gray** hidden.
- All machine-proposed objects labeled **AI proposed** until accepted/modified.
- Tools: Trace perimeter, Add facet, Draw ridge/hip/valley/eave/rake, Mark wall, Add penetration, Set known dimension.
- Keys: `V` select, `P` perimeter, `F` facet, `L` line, `Delete`, `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, `Space` pan.

## Measurement Calculations
- Plan area: calibrated polygon area.
- Slope factor: `sqrt(1 + (rise/run)^2)` (6/12 = 1.1180).
- Facet slope area: plan area × slope factor **only when pitch known**.
- Total roof area: sum of approved facet slope areas. Keep `unknown_pitch_plan_area_sqft` subtotal — never fabricate.
- Linear totals: per edge class independently (eave, rake, ridge, hip, valley, wall/flashing).
- Waste is an estimate-template concern — do not bake into raw measurement.

## Measure Lab Compatibility
On approve, update existing `roof_measurements` with approved data only: `true_outer_roof_perimeter_px`, `true_outer_roof_perimeter_geo`, `eave_edges`, `rake_edges`, `roof_corners`, `missed_roof_regions`, `perimeter_confidence`, `perimeter_source`, `perimeter_hints`, `perimeter_gate_metrics`, `perimeter_status`, `result_state = 'ready'`.

**Forbidden**: `roof_mask_area_sqft`, `perimeter_to_mask_ratio`, prior global-mask hard-failure as approval authority. Persist target-footprint isolation metrics instead.

## Acceptance Tests
1. Upload → session → trace/approve perimeter → edit facet → set 6/12 pitch → save approved revision works end-to-end.
2. Self-intersecting perimeter cannot approve.
3. Low-calibration trace flagged; cannot populate measurement draft.
4. Line outside accepted perimeter → visible QA error.
5. Low-confidence AI result editable; cannot silently change estimate.
6. Approved revision creates exactly one `measurement_draft`; no estimate/estimate_lines/supplier/material/labor row touched.
7. RLS blocks cross-tenant on all four new tables.
8. Revision 2 leaves revision 1 immutable; audit records author.

## References
- Full schema SQL: `references/schema.sql`
- Original brief: `references/brief.md`
