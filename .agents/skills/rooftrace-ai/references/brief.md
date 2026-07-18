# RoofTrace AI — PITCH CRM implementation brief

## Outcome

Add **RoofTrace AI** to the existing PITCH CRM Measure Lab. A user starts from a job address, uploads an aerial image, roof report, or roof-plan PDF (or selects a licensed imagery/GIS source), receives an AI-assisted roof trace, edits it on a canvas, confirms every facet and pitch, and saves a **measurement-ready draft**. It must not create or overwrite a live CRM estimate automatically.

This is perimeter-first by design. Do not bring back the old global-mask calculation. The outer eave perimeter is detected and scored before any facet, ridge, hip, valley, or area calculation is trusted.

## Placement and permissions

- Add `RoofTrace AI` beside the existing `AI Measurement` action in Job → Measure Lab.
- Allow roles `owner`, `admin`, `estimator`, and `project_manager` to create/edit traces. Sales users may view approved reports only.
- The action opens a full-screen workbench for the selected job, never a modal.
- Save work continuously as a draft. Only the explicit **Approve measurement** action creates a locked revision.
- Existing jobs/measurements remain untouched. This feature extends the existing measurement flow and preserves its fields.

## Workflow

1. **Source** — show property address and geocode confidence. Accept: aerial JPG/PNG/WebP, drone image, measurement-report image, roof-plan PDF, or a provider-backed licensed image/GIS layer. Store source provenance, capture date, license/provider, resolution, and north orientation.
2. **Calibrate** — use report scale, known dimension, GIS footprint scale, or user-drawn reference line. Never silently assume pixel-to-feet scale. If calibration confidence is below 0.85, require manual confirmation.
3. **Outer perimeter** — AI proposes the outer eave boundary only. Display it in cyan. The user can add/move/delete nodes. Require a closed, non-self-intersecting polygon.
4. **Topology** — only after perimeter acceptance, AI proposes facets and feature lines: ridges, hips, valleys, eaves, rakes, walls, drains, skylights/penetrations. Each item gets confidence and source evidence.
5. **Pitch** — infer only when a reliable source exists (plan annotation, LiDAR/DSM, or a verified user value). Otherwise mark `needs_pitch_review`; never invent pitch from a flat aerial image.
6. **Review** — show area, waste-ready area, perimeter, eaves/rakes/ridges/hips/valleys, count of facets, pitch distribution, missing-region warnings, and confidence by component.
7. **Approve** — write a versioned, immutable approved revision and create/update only `measurement_drafts`. A later user action may apply that draft to an estimate.

## Hard gates

- Block “approve” when no valid outer perimeter, scale confidence < 0.85, a facet lies outside perimeter, topology has intersecting lines, or unresolved critical warnings exist.
- Flag, but do not block: low-confidence penetrations, missing pitch on individual facets, or an imagery source older than 36 months.
- `perimeter_status`: `pending | proposed | needs_review | accepted | rejected`.
- `result_state`: `queued | acquiring | calibrating | tracing_perimeter | tracing_topology | needs_review | ready | failed`.
- A trace marked `needs_review` must never populate material/labor quantities.

## Data model (Supabase migration)

```sql
create table if not exists roof_trace_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null references jobs(id) on delete cascade,
  measurement_id uuid references roof_measurements(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','processing','needs_review','approved','archived')),
  source_type text not null check (source_type in ('upload','licensed_imagery','county_gis','drone','report','plan_pdf')),
  source_url text,
  source_metadata jsonb not null default '{}'::jsonb,
  calibration jsonb not null default '{}'::jsonb,
  perimeter_status text not null default 'pending',
  perimeter_confidence numeric,
  topology_confidence numeric,
  pitch_confidence numeric,
  active_revision integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists roof_trace_revisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references roof_trace_sessions(id) on delete cascade,
  revision integer not null,
  state text not null check (state in ('draft','approved','superseded')),
  geometry jsonb not null,
  measurements jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  ai_evidence jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique(session_id, revision)
);

create table if not exists roof_trace_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references roof_trace_sessions(id) on delete cascade,
  type text not null check (type in ('acquire','calibrate','perimeter','topology','pitch','report')),
  status text not null default 'queued' check (status in ('queued','running','complete','failed')),
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists measurement_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null references jobs(id) on delete cascade,
  trace_revision_id uuid not null references roof_trace_revisions(id),
  status text not null default 'ready' check (status in ('ready','applied','superseded')),
  totals jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists roof_trace_sessions_job_idx on roof_trace_sessions(job_id, updated_at desc);
create index if not exists roof_trace_jobs_session_idx on roof_trace_jobs(session_id, created_at desc);
alter table roof_trace_sessions enable row level security;
alter table roof_trace_revisions enable row level security;
alter table roof_trace_jobs enable row level security;
alter table measurement_drafts enable row level security;
-- Apply the CRM's existing tenant-membership RLS pattern to all four tables.
```

### Geometry contract

Store WGS84 GeoJSON when geo-referenced and image-pixel coordinates otherwise. Every geometry object must declare `coordinate_space`, `image_width`, `image_height`, `units`, and calibration data.

```json
{
  "coordinate_space": "image_px",
  "units": "ft",
  "outer_perimeter": { "type": "Polygon", "coordinates": [[[x,y], [x,y], [x,y], [x,y], [x,y]]] },
  "facets": [{ "id": "F1", "polygon": {"type":"Polygon","coordinates":[]}, "pitch": "6/12", "pitch_source": "user", "confidence": 0.94 }],
  "edges": [{ "id":"E1", "kind":"eave", "coordinates":[[x,y],[x,y]], "confidence":0.97 }],
  "features": [{ "kind":"penetration", "geometry": {"type":"Point","coordinates":[x,y]}, "confidence":0.72 }]
}
```

## AI worker contract

Run all image/PDF analysis in the existing `pitch-worker-api`, not in the browser and not inside a Supabase database function.

`POST /v1/roof-trace/sessions/:sessionId/run`

```json
{
  "stages": ["calibrate", "perimeter", "topology", "pitch"],
  "source": { "url": "signed-url", "type": "upload" },
  "property": { "address": "...", "lat": 0, "lng": 0 },
  "existing_context": { "parcel": {}, "footprint": {}, "dsm": {}, "solar": {} }
}
```

Worker sequence:

1. Validate source quality; fail early for blurry/oblique/unusable imagery.
2. Obtain scale from the strongest available evidence: plan/report scale → verified GIS footprint → user reference. Preserve evidence and confidence.
3. Segment only candidate roof areas inside the target building footprint; never compare against the entire image mask.
4. Generate the outer eave polygon and record `perimeter_gate_metrics`: coverage versus footprint, image-edge contact, closure, self-intersection, simplification error, and missed-region estimate.
5. Stop topology inference unless the perimeter gate passes.
6. Infer facet boundaries and line classes, then reconcile them with the accepted perimeter. No line is allowed outside the outer boundary.
7. Infer pitch exclusively from supported evidence. Output `unknown` otherwise.
8. Calculate plan area, slope area (only where pitch is known), linear lengths, and confidence; return warning objects with stable codes.

Return `200` only with a structured result; use `422` for unusable sources and `409` for a revision conflict. The browser polls the `roof_trace_jobs` record or receives realtime updates—never waits on a long request.

## Workbench UX

- Left: source selector, layer toggles, confidence legend, warnings, revision history.
- Center: zoomable canvas with pan, undo/redo, snapping, draw/edit/select tools, north arrow, scale bar, and a toggle for original/proposed/approved geometry.
- Right: selected object properties, numeric measurements, facet table, pitch editor, and QA gate status.
- Use colors consistently: cyan proposed perimeter; green accepted geometry; orange needs review; red invalid geometry; gray hidden layer.
- All machine-proposed objects must visibly say **AI proposed** until the user accepts or modifies them.
- Include explicit tools: “Trace perimeter,” “Add facet,” “Draw ridge/hip/valley/eave/rake,” “Mark wall,” “Add penetration,” and “Set known dimension.”
- Keyboard: `V` select, `P` perimeter, `F` facet, `L` line, `Delete`, `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, `Space` pan.

## Measurement calculations

- Plan area: polygon area after calibration.
- Slope factor: `sqrt(1 + (rise/run)^2)`; e.g. 6/12 = 1.1180.
- Facet slope area: plan area × slope factor only when pitch is known.
- Total roof area: sum of approved facet slope areas. Keep an `unknown_pitch_plan_area_sqft` subtotal rather than fabricating it.
- Linear totals: calculate independently by edge class: eave, rake, ridge, hip, valley, wall/flashing.
- Waste is an estimate-template concern and must not be baked into the raw measurement.

## Existing Measure Lab compatibility

When a revision is approved, update the existing `roof_measurements` record only with approved data: `true_outer_roof_perimeter_px`, `true_outer_roof_perimeter_geo`, `eave_edges`, `rake_edges`, `roof_corners`, `missed_roof_regions`, `perimeter_confidence`, `perimeter_source`, `perimeter_hints`, `perimeter_gate_metrics`, `perimeter_status`, and `result_state = 'ready'`.

Do not use or resurrect `roof_mask_area_sqft`, `perimeter_to_mask_ratio`, or the prior global-mask hard-failure as an approval authority. Persist target-footprint isolation metrics instead.

## Acceptance tests

1. A user can upload a roof image, create a session, trace/approve a perimeter, edit a facet, set a 6/12 pitch, and save an approved revision.
2. A trace with a self-intersecting perimeter cannot be approved.
3. A low-calibration trace is clearly flagged and cannot populate a measurement draft.
4. A roof line drawn outside the accepted perimeter causes a visible QA error.
5. A low-confidence AI result is editable and cannot silently change a job estimate.
6. An approved revision creates exactly one `measurement_draft`; no `estimates`, `estimate_lines`, supplier order, material order, or labor record is created or modified.
7. RLS blocks cross-tenant reads/writes for every new table.
8. Revision 2 leaves revision 1 immutable and records who made the changes.

## Lovable build prompt

Paste this into Lovable after the SQL migration is applied:

> Build the PITCH CRM feature “RoofTrace AI” in the existing Job → Measure Lab. Implement the full-screen, editable roof-tracing workbench described in `RoofTrace_AI_Lovable_Implementation.md`. Use TypeScript, existing CRM UI primitives, Supabase realtime, and the existing auth/tenant RLS helpers. Do not generate a fake canvas or synthetic measurements: all mocked worker calls must be clearly labeled Demo Mode and return no approvable measurement. Integrate the existing `roof_measurements` fields only upon explicit approval. Create `measurement_drafts` but do not write to CRM estimates, order tables, supplier APIs, or labor pricing. Use a job queue/realtime state machine for worker results. Enforce the perimeter-first QA gate, calibration gate, topology validity gate, and revision immutability. Include unit tests for geometry validation/calculation and integration tests for the eight acceptance cases in the design brief.
