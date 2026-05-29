
# Section-Aware Measurement Import — Phase 1 Plan

Scope: **Foundation + template rules + mapping engine. No override UI.** Goal is to prove deterministic flat-vs-sloped routing end-to-end while keeping every existing template and the current `generate-estimate-from-measurement` aggregate path working unchanged.

Hard policy (locked from your answer):
- Class-scoped items (`applies_to.surface_classes` set) **never silently fall back** to global totals. When the import lacks a per-class measurement, the item becomes an `unresolved` assignment with reason code, not a guessed line.
- Legacy items with `measurement_scope = "global"` continue to read `global.*` and `roof.*` and stay working.
- `class.flat.area_sqft` etc. resolve to a sentinel `unavailable` (not `0`) when no evidence exists. The formula evaluator surfaces a structured `missing_class_measurement` conflict instead of evaluating to zero.
- Manual JSON split is supported now (no UI): an admin can POST a `manual_measurement_split` payload and the mapper materializes synthetic reviewed segments.

## What already exists (verified)

- `roof_measurements` already has `total_area_flat_sqft`, `predominant_pitch`, `pitch_degrees`, `facet_count`, linear totals (eave/rake/hip/valley/ridge/wall flashing). No per-segment table yet.
- `estimate_calc_template_items` has `qty_formula`, `measurement_type`, `coverage_per_unit` but **no `applies_to` / surface-class rule**.
- `estimate_calc_template_groups` has `group_type` but no section-rule table.
- `generate-estimate-from-measurement` reads aggregate totals only and emits a flat list.
- `roof-report-ingest` parses provider PDFs but does not currently persist a `pitched_area_sqft` / `flat_area_sqft` split into a typed segment row — confirmed via repo search (`rg pitched_area_sqft` → no hits in TS). The split exists only inside the AI extraction schema and is dropped on the way to `roof_measurements`.

## Architecture (Phase 1)

```text
roof-report-ingest / ai-measurement / manual import
        │
        ▼
  measurement_imports          one row per import batch (provider, source, raw payload, quality)
        │
        ├──► measurement_segments    surface segments (flat/low_slope/sloped/other), area, pitch, class, confidence, source
        └──► measurement_features    linear/count features (ridge/valley/eave/rake/drain/boot) optionally linked to a segment
        │
        ▼
  classifier (deterministic)   pitch + provider flags → surface_class + confidence + reason
        │
        ▼
  context builder              { global.*, class.flat.*, class.sloped.*, class.low_slope.*, class.other.*, section.*  with unavailable sentinels }
        │
        ▼
  mapping engine               section rules → item rules → formula eval → assignments | unresolved | conflicts
        │
        ▼
  estimate_measurement_assignments   audit row per item (segment_ids, formula_evaluated, confidence, status, reason_code)
```

## Database changes (one migration)

New tables (all `tenant_id`-scoped, RLS via `has_tenant_access(tenant_id)`, GRANTs to `authenticated` + `service_role`, none to `anon`):

| Table | Purpose | Key columns |
|---|---|---|
| `measurement_imports` | one import batch | `tenant_id`, `roof_measurement_id`, `job_id`, `provider`, `source_doc_id`, `import_status`, `quality_score`, `raw_payload jsonb` |
| `measurement_segments` | surface planes | `measurement_import_id`, `provider_segment_key`, `name`, `geometry_geojson jsonb`, `area_sqft`, `pitch_rise_over_12`, `pitch_scope` (`segment`\|`global`\|`none`), `surface_class` (`flat`\|`low_slope`\|`sloped`\|`other`\|`unknown`), `classification_confidence`, `classification_reason`, `is_synthetic_split`, `reviewed bool` |
| `measurement_features` | linear/count | `measurement_import_id`, `feature_type` (`ridge`/`hip`/`valley`/`eave`/`rake`/`drip_edge`/`step_flashing`/`wall_flashing`/`parapet`/`drain`/`pipe_boot`/`vent`/`skylight`/`chimney`), `length_ft`, `count_value`, `primary_segment_id`, `confidence` |
| `template_section_rules` | per-group applicability | `group_id` (FK `estimate_calc_template_groups`), `surface_classes text[]`, `feature_types text[]`, `min_pitch numeric`, `max_pitch numeric`, `allow_unknown bool`, `priority int` |
| `template_item_rules` | per-item applicability | `item_id` (FK `estimate_calc_template_items`), `surface_classes text[]`, `feature_types text[]`, `measurement_scope text` (`global`\|`class`\|`section`), `allow_global_fallback bool`, `exclusive_group text` |
| `estimate_measurement_assignments` | mapping result audit | `estimate_id`, `template_group_id`, `template_item_id`, `segment_ids uuid[]`, `feature_ids uuid[]`, `quantity numeric`, `unit text`, `formula_evaluated text`, `confidence numeric`, `status text` (`assigned`\|`unresolved`\|`conflict`\|`manual`), `reason_code text`, `matched_by jsonb` |

Constraints:
- `surface_class` check constraint on the 5 enum values above.
- `status` check constraint on the 4 values above.
- `template_item_rules.measurement_scope` check on the 3 values.
- Indexes on `tenant_id`, `(measurement_import_id, surface_class)`, `(estimate_id, status)`.

Compatibility:
- Items with **no** `template_item_rules` row default to `measurement_scope='global'`, `allow_global_fallback=true` — every existing template behaves exactly as today.
- `generate-estimate-from-measurement` stays in place as the v1 generator; v2 mapper is opt-in per template via a new boolean `estimate_calculation_templates.use_section_mapping`.

Migration ends with `NOTIFY pgrst, 'reload schema';`.

## Edge function work

Group everything under existing **`measurement-api`** (no new function folders, per the architecture guard):

- `POST /measurement-imports/normalize` — takes a `roof_measurement_id` (or raw ingest payload), creates `measurement_imports` + `measurement_segments` + `measurement_features`. For records that only have aggregate `total_area_adjusted_sqft` it creates **one** `unknown`-class segment marked `pitch_scope='global'`. For records with `total_area_flat_sqft > 0` and a non-zero residual it creates two segments: one `flat` (explicit) and one `sloped` candidate marked `is_split_residual=true`, with classification reason and lower confidence.
- `POST /measurement-imports/{id}/classify` — runs the deterministic classifier (rules in your message: `<2/12 flat`, `2–4 low_slope`, `≥4 sloped`, provider explicit-flat beats pitch). Idempotent.
- `POST /measurement-imports/{id}/manual-split` — accepts `{ flat: { area_sqft }, sloped: { area_sqft }, low_slope?: { area_sqft } }`, creates synthetic `reviewed=true` segments, archives prior auto-classified rows for that import.
- `POST /estimate-templates/{id}/map-measurements` — runs the matcher: section rules → item rules → scoped context → formula eval → write `estimate_measurement_assignments` rows. Returns `{ assignments, unresolved, conflicts }`. Does **not** mutate `estimate_line_items` yet — that wiring is gated behind a small follow-up so we can compare against today's generator first.

All routes: `requireAuth` + `requireTenant` middleware; tenant resolved server-side; `company_id` from JWT membership, never the body.

## Shared TypeScript

New `supabase/functions/_shared/measurement-mapping/`:
- `classifier.ts` — `classifySurface(seg) -> { surface_class, confidence, reason }`.
- `context.ts` — `buildScopedContext(import, segments, features)` returns the namespaced object with the `Unavailable` sentinel, not `0`, when a class has no segments.
- `formula.ts` — thin wrapper around the existing formula evaluator that recognizes `class.*` / `section.*` paths and emits `missing_class_measurement` structured errors instead of `NaN`/`0`.
- `mapper.ts` — `mapMeasurementsToTemplate(importId, templateId, policy)`.
- `types.ts` — `SurfaceClass`, `MeasurementSegment`, `Assignment`, `Conflict`, `ReasonCode` unions.

Mirror the types in `src/lib/measurement-mapping/types.ts` for the frontend (read-only consumers).

## Frontend (read-only this phase)

No new pages. Two minimal hooks under `src/lib/measurement-mapping/`:
- `useMeasurementImport(roofMeasurementId)` — fetches normalized segments + features (tenant-filtered).
- `useTemplateMappingPreview(templateId, importId)` — calls `/estimate-templates/{id}/map-measurements` in dry-run mode and returns `{ assignments, unresolved, conflicts }`.

Add a small **debug-only** read panel inside the existing measurement details view (gated behind `isDeveloperMode`) that lists segments with their class + confidence, and shows a dry-run mapping against the currently selected template. No edit controls — that is Phase 2.

## Policy details (locked)

Classifier thresholds (overridable per request, defaults locked):
- `pitch < 2/12` → `flat`
- `2/12 ≤ pitch < 4/12` → `low_slope`
- `pitch ≥ 4/12` → `sloped`
- explicit provider flat flag → `flat` (beats pitch)
- pitch unknown and no provider flag → `unknown` (never `flat`, never `sloped`)

Unresolved reason codes (enum):
- `global_only_import` — class-scoped item, import has no per-class split.
- `missing_class_measurement` — formula references `class.flat.*` but `class.flat` is unavailable.
- `unknown_pitch` — segment classification is `unknown` and item disallows unknown.
- `low_confidence` — below configurable threshold (default 0.7).
- `no_matching_segment` — feature item references a feature type not present.

Conflict resolution precedence (in code, no UI yet):
1. Manual lock on assignment (future-proofed; nothing locks rows yet in Phase 1)
2. Explicit `template_item_rules` match
3. Explicit `template_section_rules` match
4. Provider-explicit class
5. Pitch-derived class
6. Global fallback (only if item allows it)

## Testing

Deno tests in `supabase/functions/measurement-api/`:
- Classifier table tests for every threshold boundary, provider flag override, missing pitch.
- Context builder: `unavailable` sentinel on missing class, no silent zero, no class total > global total.
- Mapper:
  - Flat-only import → only flat sections populate.
  - Sloped-only import → only sloped sections populate, steep charge applies.
  - Mixed flat + sloped explicit → flat items consume flat area, shingles consume sloped area, no double counting.
  - Aggregate-only import → class-scoped items become `unresolved/global_only_import`, global items still resolve.
  - Manual split → synthetic reviewed segments win over prior auto rows.
  - Legacy template (no rule rows) → identical output to today's aggregate generator (regression).
  - Re-run is idempotent for unchanged inputs.

Frontend unit tests for the dry-run hook (mocked edge response).

## Migration / rollout

1. Ship the migration with `NOTIFY pgrst, 'reload schema';`.
2. Backfill `measurement_imports` + one `unknown`-class segment per existing `roof_measurements` row so the new schema isn't empty. Where `total_area_flat_sqft > 0`, backfill the split as `is_split_residual=true` with low confidence.
3. Deploy `measurement-api` routes.
4. Turn on the developer-only debug panel.
5. Keep `use_section_mapping=false` on every template by default — no customer-visible behavior change until Phase 2 flips a template over.

## Out of scope (Phase 2)

- Override UI: reassign / split / lock / explainability drawer.
- Writing mapper output into `estimate_line_items` (replacing the v1 generator).
- Incremental recompute on segment edits.
- Sub-segment geometry (per-facet polygons) — Phase 1 uses one segment per class unless the import already provides per-facet rows.
- Unit conversion beyond the existing canonical feet/sqft used today.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Repeating "fake fallback geometry" mistake from prior measurement work | Classifier refuses to invent class splits. Aggregate-only imports produce one `unknown` segment, not a fabricated flat/sloped breakdown. |
| Legacy templates regress | Default `measurement_scope='global'` + `allow_global_fallback=true` when no `template_item_rules` row exists; regression test asserts byte-identical output vs current generator on a known fixture. |
| Schema cache drift | Single migration ends with `NOTIFY pgrst, 'reload schema';`. Edge writes use strip-and-retry on optional columns and persist stripped fields under `raw_payload.schema_drift_stripped_columns`. |
| Tenant leakage on new tables | Every new table: RLS via `has_tenant_access(tenant_id)`, GRANT only to `authenticated` + `service_role`, mapper always filters `.eq('tenant_id', resolvedTenantId)`. |
