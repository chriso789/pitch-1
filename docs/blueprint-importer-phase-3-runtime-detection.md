# Blueprint Importer v2 — Phase 3: Runtime Detection

**Status:** Phase 3 deliverable. Deterministic report parsing → trade detection →
measurement extraction → PlanPath provenance → review flags → user acceptance UI.

**Hard stops (NOT shipped in Phase 3):**

- Material list population
- Labor pricing
- CRM estimate handoff / line items
- Drywall / framing / MEP runtime support
- Full blueprint sheet intelligence (scale, sheet coordinates)
- AI anywhere in the math path
- New standalone edge functions

## Scope

Phase 3 turns uploaded **Roofr** and **EagleView** (roof + wall) reports into
persisted blueprint importer sessions with:

- source documents (`blueprint_source_documents`)
- detected MVP trades (`blueprint_detected_trades`)
- normalized measurement objects (`blueprint_measurement_objects`)
- PlanPath provenance (`blueprint_plan_paths`)
- review flags (`blueprint_review_flags`)
- accepted trade rows on explicit user acceptance (`blueprint_accepted_trades`)

The material/labor draft tables (`blueprint_material_draft_lines`,
`blueprint_labor_draft_lines`) are intentionally **never written to** in Phase 3.

## Architecture

```
PDF bytes
   │
   ▼
extractPdfText  ──── existing _shared/parsers/pdf-text.ts
   │
   ▼
classifyBlueprintDocument  → eagleview_roof_report | roofr_roof_report | eagleview_wall_report | unknown
   │
   ▼
deterministic parser (chooses winner by confidence):
   • parseEagleViewRoofReport   (existing)
   • parseRoofrRoofReport       (existing)
   • parseEagleViewWallReport   (NEW — supabase/functions/_shared/blueprint-importer/parsers/eagleview-wall.ts)
   │
   ▼
deterministicSessionHash  → supersedes prior session with same hash
   │
   ▼
INSERT blueprint_import_sessions
INSERT blueprint_source_documents
INSERT blueprint_plan_paths   ← one PlanPath per measurement
INSERT blueprint_measurement_objects (with plan_path_id)
INSERT blueprint_detected_trades
INSERT blueprint_review_flags (report warnings + Phase 4 disabled notices)
UPDATE blueprint_import_sessions.status = 'trades_detected'
```

## Files changed

### New shared contracts (TS, side-effect-free)

- `supabase/functions/_shared/blueprint-importer/document-classifier.ts`
- `supabase/functions/_shared/blueprint-importer/parsers/eagleview-wall.ts`
- `supabase/functions/_shared/blueprint-importer/trade-detection.ts`
- `supabase/functions/_shared/blueprint-importer/measurement-mapper.ts`
- `supabase/functions/_shared/blueprint-importer/acceptance-gates.ts`
- `supabase/functions/_shared/blueprint-importer/session-hash.ts`
- `supabase/functions/_shared/blueprint-importer/review-flag-codes.ts`
- `supabase/functions/_shared/blueprint-importer/index.ts` (extended barrel)

### Runtime routes added inside existing `document-worker`

- `POST /blueprint-importer/v2/ingest` — classify + parse + persist + detect trades + emit flags
- `POST /blueprint-importer/v2/session` — return full session summary for UI
- `POST /blueprint-importer/v2/accept-trade` — runtime acceptance gates

**No new edge function folders were created.** Frontend calls hit
`document-worker` via the existing `edgeApi(...)` helper.

### Python parser twins (NOT registered; contracts only)

- `worker/app/blueprint_contracts/document_classifier.py`
- `worker/app/blueprint_contracts/acceptance_gates.py`

### Frontend

- `src/integrations/blueprintImporterV2Api.ts` — typed wrappers for the 3 routes
- `src/pages/BlueprintImporterV2.tsx` — review/accept UI
- `src/routes/protectedRoutes.tsx` — added `/blueprint-importer-v2[/:sessionId]`

### Tests

- `tests/blueprint-importer/phase3.test.ts` — Vitest coverage: classifier,
  wall parser, mapper (incl. PlanPath presence + derived field), trade detection,
  acceptance gates (all 7 gate cases), deterministic hash stability.

## Supported document types (parser tier = deterministic)

| Document | Parser | Detected trades |
|---|---|---|
| Roofr roof report | `parseRoofrRoofReport` | roofing, gutters_fascia_trim |
| EagleView roof report | `parseEagleViewRoofReport` | roofing, gutters_fascia_trim |
| EagleView wall report | `parseEagleViewWallReport` (NEW) | exterior_walls_siding, paint_coatings (derived), gutters_fascia_trim, windows_doors (measurement-only) |
| Blueprint set / spec book | classified only — NOT parsed for measurements; review flag surfaces "future" status |
| Unknown | rejected with HTTP 422 |

## Measurement keys extracted

### Roof
`total_roof_area_sqft`, `pitched_roof_area_sqft`, `flat_roof_area_sqft`,
`roof_facets_count`, `predominant_pitch`, `pitch_area_by_pitch`, `eaves_lf`,
`rakes_lf`, `eaves_plus_rakes_lf` (DERIVED, PlanPath references inputs),
`valleys_lf`, `hips_lf`, `ridges_lf`, `hips_plus_ridges_lf`, `flashing_lf`,
`step_flashing_lf`, `parapet_lf`, `penetrations_count`, `waste_table`.

### Wall / siding / paint / gutters / windows-doors
`wall_area_sqft`, `wall_area_with_windows_doors_sqft`, `wall_facets_count`,
`top_of_walls_lf`, `bottom_of_walls_lf`, `inside_corners_lf`, `outside_corners_lf`,
`inside_corners_gt_90_lf`, `outside_corners_gt_90_lf`, `fascia_eaves_rake_lf`
(scoped to `gutters_fascia_trim`), `window_door_area_sqft`, `window_door_count`,
`window_door_perimeter_lf` (scoped to `windows_doors`), `wall_area_by_direction`,
`wall_area_by_elevation`, `window_door_*_by_elevation`, `wall_waste_table`.

## PlanPath strategy

Every persisted measurement carries a non-null `plan_path_id` referencing a row
in `blueprint_plan_paths` with `path_type = report_page`. PlanPaths capture
`file_name`, `document_type`, `provider`, and a `section_label` like
`"Report Summary → Measurements"`. No fake sheet coordinates are produced;
blueprint sheet provenance is Phase 4+ work. Derived aggregates (e.g.
`eaves_plus_rakes_lf`) carry their own PlanPath flagged as derived via
`section_label = "DERIVED: ..."`.

## Review flag strategy

Phase 3 enforces what Phase 2 left as helper-only:

| Flag code | Blocking? | Trigger |
|---|---|---|
| `windows_doors_selected_as_trade` | yes | accept attempt on windows_doors |
| `paint_without_wall_source` | yes | accept paint without wall_report or accepted siding |
| `future_trade_requires_sheet_intelligence` | yes | accept future trade without `manual_only` |
| `unsupported_trade_for_mvp` | yes | accept unknown trade |
| `missing_plan_path` | yes | accept trade with measurements missing plan_path_id |
| `wall_image_obstruction_warning` | warn | wall report text contains image obstruction notice |
| `report_field_verification_required` | warn | "verify in the field" / yellow-shaded |
| `wall_soffit_assumption_warning` | warn | soffit assumption text in wall report |
| `roof_penetration_field_verification_required` | info | roof report has 0 penetrations counted |
| `material_population_not_enabled_phase_3` | info (always emitted) | ingest |
| `labor_pricing_not_enabled_phase_3` | info (always emitted) | ingest |

Failed acceptance attempts also persist a blocker-severity flag tied to the
detected trade so the UI shows why the action was rejected.

## User acceptance workflow

The UI's "Accept trade" button is enabled **only** when:

1. trade is `mvp_supported`, AND
2. no unresolved blocking flags on the session, AND
3. every measurement for that trade has a `plan_path_id`, AND
4. for `paint_coatings`: a `wall_report` source exists in the session OR
   `exterior_walls_siding` is already accepted.

Disabled states with tooltips:

- `windows_doors` — "Measurement-object-only — cannot be a top-level trade in MVP"
- future trades — "Future-supported only — requires Phase 4 sheet intelligence"
- paint without siding — "Requires Exterior Walls / Siding source in this session"
- missing PlanPath — "Missing PlanPath provenance for one or more measurements"

## Gated future actions (visible but disabled)

The UI shows `Populate Material List`, `Generate Labor Pricing`, and
`Push to Estimate` buttons in a disabled state with tooltip
"Not enabled until Phase 4." No draft-line tables are surfaced in the UI.

## What remains intentionally unwired

- No writes to `blueprint_material_draft_lines` / `blueprint_labor_draft_lines`.
- No writes to `blueprint_template_bindings` (Phase 4).
- No edits to geometry worker / measurement worker / roof export-report flows.
- No new standalone edge functions.
- Python parser twins are **not** in `worker/app/skills_registry.py` and
  **not** imported by `worker/app/main.py`.

## Implementation gaps / honest deviations

- **OCR tier deferred.** Image-only PDFs return HTTP 422 `no_selectable_text`.
  No Tier-4 AI fallback — consistent with the existing `document-worker` policy.
- **Session-hash basis.** The hash is computed over normalized parser output
  (not raw PDF bytes) so re-runs produce stable hashes even if OCR text
  extraction is non-deterministic. Documented in `session-hash.ts`.
- **Wall-report by-elevation tables** rely on EagleView's repeating
  direction labels; if a customer's report uses a non-standard layout, the
  by-elevation tables will be `null` and only the summary totals will be
  persisted. Not a blocker for Phase 3 acceptance.
- **`storage_path` direct uploads** require the path's first folder to equal
  the caller's resolved `tenant_id`, matching the project storage RLS convention.
- **Phase 2 paint/windows_doors helper-only gaps** are now enforced at runtime
  by `acceptance-gates.ts` and re-asserted by the `bp_acc_*_chk` DB CHECK
  constraints added in Phase 1/2.

## Verification checklist

- [x] Phase 0 docs re-read (trade-catalog, estimate-mapping-contract, mvp-phase-plan)
- [x] Phase 1 contracts re-read (schema-contracts doc + shared TS/Python modules)
- [x] Phase 2 DB-verification doc re-read; applied migration inspected
- [x] Runtime parsing added inside existing `document-worker` only
- [x] Supported parsers: Roofr roof, EagleView roof, EagleView wall
- [x] DB tables written: `blueprint_import_sessions`, `blueprint_source_documents`,
      `blueprint_plan_paths`, `blueprint_measurement_objects`,
      `blueprint_detected_trades`, `blueprint_review_flags`, `blueprint_accepted_trades`
- [x] DB tables NOT written: `blueprint_material_draft_lines`,
      `blueprint_labor_draft_lines`, `blueprint_template_bindings`
- [x] Endpoint behavior changed: `document-worker` gained 3 new routes
      (`/blueprint-importer/v2/ingest`, `/session`, `/accept-trade`).
      No existing route behavior changed.
- [x] Worker behavior changed: none (Python twins are contracts only)
- [x] New standalone edge functions: none
- [x] UI changed: yes — new page `src/pages/BlueprintImporterV2.tsx`,
      new helper `src/integrations/blueprintImporterV2Api.ts`,
      new routes in `src/routes/protectedRoutes.tsx`.
- [x] Material population: none
- [x] Labor pricing: none
- [x] CRM estimate handoff: none
- [x] Windows/doors blocked as top-level trade: yes (UI + acceptance gate + DB check)
- [x] Paint standalone blocked: yes (UI + acceptance gate)
- [x] Future trades blocked from auto-acceptance: yes (UI + acceptance gate + DB check)
- [x] Every measurement has PlanPath: yes (mapper guarantees, gate enforces on accept)
- [x] Review flags for known report warnings: yes (image obstruction, field verification, soffit assumption)
- [x] Tests added: `tests/blueprint-importer/phase3.test.ts` (classifier, wall parser, mapper, trade detection, 7 acceptance-gate cases, deterministic hash)
- [x] Recommended next phase: Phase 4 — material/labor draft generation only after review

## Stop conditions

Lovable stops after Phase 3 and awaits review before any Phase 4 work
(material/labor draft generation, template binding population, or CRM handoff).
