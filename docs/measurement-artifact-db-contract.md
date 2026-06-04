# Measurement Artifact Envelope — DB Persistence Contract (Phase 3)

Phase 3 introduces DB-native persistence for the canonical
`MeasurementArtifactEnvelope` defined in
`docs/measurement-artifact-envelope.md` and
`docs/schemas/measurement-artifact-envelope.schema.json`.

This phase is **persistence-only**. It does not modify worker endpoint
behavior, validate_geometry, export_geojson, or export_report, and it does
not wrap any live skill output in an envelope.

---

## 1. Chosen design

Additive extension of the existing `public.mskill_artifacts` table plus a
new `public.mskill_artifact_issues` table.

We deliberately **did not** create a parallel `mskill_artifact_envelopes`
table. Reasons:

- Existing readers (`runner.ts`, dashboards, executor stubs) already query
  `mskill_artifacts` by `(mskill_job_id, artifact_type, request_hash)`.
  Splitting envelopes into a sibling table would either fork those queries
  or require a view shim, both of which add drift surface.
- Every new envelope column is **nullable**, so legacy `writeSkillArtifact`
  calls continue to insert minimal rows unchanged.
- The full canonical envelope is persisted as a single `JSONB` column
  (`envelope`) so downstream consumers can rehydrate
  `MeasurementArtifactEnvelope` byte-for-byte. The flattened columns are
  search/index helpers, not the source of truth.

---

## 2. `mskill_artifacts` — added columns

All columns are nullable / defaulted unless noted.

| Column | Type | Purpose |
| --- | --- | --- |
| `artifact_id` | `UUID` | `envelope.artifact_id`. Unique when present. |
| `schema_version` | `TEXT` | `envelope.schema_version` (e.g. `"1.0.0"`). |
| `envelope_version` | `INTEGER` | `envelope.envelope_version`. |
| `parent_artifact_ids` | `UUID[]` (default `{}`) | `envelope.parent_artifact_ids`. |
| `stage` | `TEXT` | `envelope.stage`. |
| `source_skill` | `TEXT` | `envelope.source_skill`. |
| `producer_kind` | `TEXT` | `envelope.producer.kind` (`worker` / `control_plane` / `external`). |
| `producer` | `JSONB` | Full `envelope.producer`. |
| `status` | `TEXT` | `envelope.status`. CHECK-constrained to the 9 enum values. |
| `coordinate_frame` | `JSONB` | `envelope.coordinate_frame`. |
| `units` | `JSONB` | `envelope.units`. |
| `geometry` | `JSONB` | `envelope.geometry`. |
| `data` | `JSONB` | `envelope.data`. |
| `quality` | `JSONB` | `envelope.quality`. |
| `validation` | `JSONB` | `envelope.validation` (full block). |
| `lineage` | `JSONB` | `envelope.lineage`. |
| `display` | `JSONB` | `envelope.display`. |
| `storage_block` | `JSONB` | `envelope.storage` (does not replace legacy `storage_path` / `source_url`). |
| `validation_status` | `TEXT` | Mirror of `envelope.validation.validation_status`. CHECK: pending/passed/failed/skipped. |
| `validation_confidence` | `NUMERIC` | Mirror of `envelope.validation.confidence` when present. |
| `export_allowed` | `BOOLEAN` (default `false`) | Derived from `status ∈ {exportable, reportable}`. |
| `report_allowed` | `BOOLEAN` (default `false`) | Derived from `status = reportable`. |
| `envelope` | `JSONB` | Full canonical envelope, source of truth. |
| `updated_at` | `TIMESTAMPTZ` | Touched by `mskill_touch_updated_at()` trigger. |

### Constraints

- `mskill_artifacts_status_chk` — status ∈ envelope status enum.
- `mskill_artifacts_validation_status_chk` — validation_status ∈ enum.
- `mskill_artifacts_producer_kind_chk` — producer_kind ∈ enum.

### Indexes

- `uq_mskill_artifacts_artifact_id` — partial UNIQUE on `artifact_id IS NOT NULL`.
- `idx_mskill_artifacts_stage`, `_status`, `_validation`, `_source_skill`.
- `idx_mskill_artifacts_export_allowed` / `_report_allowed` — partial on `true`.
- `idx_mskill_artifacts_parents` — GIN on `parent_artifact_ids`.
- `idx_mskill_artifacts_envelope_gin` — GIN on `envelope` for JSON path queries.

### Trigger

- `trg_mskill_artifacts_touch` — `BEFORE UPDATE` → `mskill_touch_updated_at()`.

---

## 3. `mskill_artifact_issues` — new table

Stores canonical `MeasurementArtifactIssue` objects (warnings, errors,
blockers) separated from the envelope row so they can be queried by
severity / code / blocking without rescanning JSONB.

| Column | Type | Notes |
| --- | --- | --- |
| `tenant_id` | `UUID NOT NULL` | RLS scope. |
| `mskill_request_id` | `UUID` | FK → `mskill_requests`. |
| `mskill_job_id` | `UUID NOT NULL` | FK → `mskill_jobs`. |
| `mskill_run_id` | `UUID` | FK → `mskill_runs`. |
| `artifact_id` | `UUID` | Envelope `artifact_id` (logical). |
| `mskill_artifact_id` | `UUID` | FK → `mskill_artifacts.id` (physical row). |
| `severity` | `TEXT NOT NULL` | CHECK: info/warning/error/blocker. |
| `code` | `TEXT NOT NULL` | Machine token. |
| `message` | `TEXT NOT NULL` | Human message. |
| `object_type` / `object_id` | `TEXT` | Target object reference (e.g. facet, edge). |
| `source_skill` | `TEXT` | Originating skill key. |
| `blocking` | `BOOLEAN NOT NULL DEFAULT false` | Mirrors envelope `blocking`. Defaults to `true` when severity = `blocker` (set by writer). |
| `suggested_fix` | `TEXT` | Optional. |
| `metadata` | `JSONB NOT NULL DEFAULT '{}'` | Structured context. |

### Indexes

`mskill_job_id`, `mskill_artifact_id`, `artifact_id`, `severity`, `code`,
`source_skill`, and partial index on `blocking = true`.

### RLS

`mskill_artifact_issues_tenant_all` (FOR ALL TO authenticated) scoped via
`public.user_company_access`. Matches existing `mskill_artifacts` policy
style. `service_role` retains full access.

---

## 4. `artifact_id` ↔ DB primary key

- `mskill_artifacts.id` (UUID) remains the **physical** primary key.
- `mskill_artifacts.artifact_id` (UUID) is the **logical** envelope id and
  is unique when present.
- `mskill_artifact_issues` carries both:
  - `mskill_artifact_id` (FK to the physical row) — preferred join.
  - `artifact_id` (logical) — for cross-row diagnostics and exports.

This split lets multiple physical revisions of the same logical artifact
coexist (re-runs, partials), while issues remain linked to the exact row
they were emitted against.

---

## 5. Parent artifact lineage

`parent_artifact_ids UUID[]` stores the lineage chain from
`envelope.lineage.parent_artifacts`. Use the GIN index for queries like
"all artifacts produced from this DSM":

```sql
SELECT id, artifact_type, status
FROM public.mskill_artifacts
WHERE parent_artifact_ids @> ARRAY['<dsm artifact_id>']::uuid[];
```

---

## 6. Validation / export / report queries

Three searchable booleans/strings are mirrored from the envelope:

- `validation_status` — `pending` / `passed` / `failed` / `skipped`.
- `export_allowed` — `status ∈ {exportable, reportable}`.
- `report_allowed` — `status = reportable`.

Example: "jobs that have a reportable roof_planes artifact":

```sql
SELECT mskill_job_id
FROM public.mskill_artifacts
WHERE artifact_type = 'roof_planes'
  AND report_allowed = true
  AND validation_status = 'passed';
```

**Note:** Setting `report_allowed = true` requires the producer to write
`status = 'reportable'` into the envelope. The DB does not infer this on
its own, and the existing `validate_geometry.ts` executor still reports
`confidence_source: "artifact_presence_only"` — true geometric validation
remains unimplemented.

---

## 7. What remains unimplemented

- **Live endpoints do not emit the envelope.** Worker skills still return
  bespoke `SkillResponse.output_payload` shapes and use
  `writeSkillArtifact`, not `writeMeasurementArtifactEnvelope`.
- **No backfill migration** from legacy `metadata` JSONB into envelope
  columns. Existing rows keep envelope columns NULL until rewritten.
- **`validate_geometry.ts` is not hardened.** It still gates on artifact
  presence, not envelope `validation.validation_status`.
- **`export_geojson.ts` / `export_report.ts` are not hardened.** They do
  not yet read `export_allowed` / `report_allowed`.
- **No regression tests.** Reserved for the Phase 6 contract.
- **No view / RPC surface.** All access is via direct table queries; a
  thin read-side helper can be added when adoption begins.

---

## 8. Writer contract (TypeScript)

`supabase/functions/_shared/mskill/artifacts.ts`

- `writeSkillArtifact(svc, ctx, artifact)` — **unchanged**. Legacy path.
- `writeMeasurementArtifactEnvelope(svc, ctx, envelope)` — new.
  - Refuses missing `request_hash` / `tenant_id` / `mskill_job_id` /
    `mskill_run_id` / `mskill_request_id`.
  - Runs `validateMeasurementArtifactEnvelope` and refuses structurally
    invalid envelopes.
  - Persists every envelope block into its column AND the full envelope
    JSONB.
  - Inserts every warning/error into `mskill_artifact_issues`.
  - Does **not** silently mutate the envelope. Does **not** mark
    validation passed. Does **not** infer status.
  - Returns `{ mskill_artifact_id, artifact_id, issue_ids }`.

See `docs/examples/sql/measurement-artifact-envelope-insert.sql` for the
SQL shape the writer produces.
