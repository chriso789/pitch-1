# Blueprint Importer v2 — Phase 1: Schema + Contracts

**Status:** Phase 1 deliverable. Schema file + shared TS/Python contracts + JSON
schemas + examples + docs. **No runtime behavior is wired. No migration applied.**

## Scope

Phase 1 establishes durable persistence and shared object contracts that future
phases (detection, acceptance, draft material/labor generation, CRM handoff) will
build on. It explicitly does **not**:

- Apply the migration to any live DB
- Run extraction or scraping
- Wire any endpoint
- Change `document-worker` execution behavior
- Change geometry worker behavior
- Add standalone edge functions
- Populate `blueprint_material_draft_lines` or `blueprint_labor_draft_lines`
- Touch CRM estimate / opportunity rows
- Add UI

## Files created

### Migration (file only — DO NOT APPLY in this phase)

- `supabase/migrations/20260604043421_2f153e21-f518-452d-bfab-e429bc0d7e47.sql`

Tables created by that migration:

| Table | Purpose |
|---|---|
| `blueprint_import_sessions` | One upload/import run, scoped to a CRM context. |
| `blueprint_source_documents` | Files within an import session (roof_report, wall_report, blueprint_set, spec_book, addendum, unknown). |
| `blueprint_detected_trades` | Trades found by the importer prior to user acceptance. |
| `blueprint_accepted_trades` | Trades the user accepted. DB-level guards: `windows_doors` blocked; `future_supported` trades blocked unless `review_state = manual_only`. |
| `blueprint_plan_paths` | Provenance chain for every measurement / future draft line. |
| `blueprint_measurement_objects` | Canonical extracted measurements (roof + wall). |
| `blueprint_review_flags` | Blocking + non-blocking review items. |
| `blueprint_template_bindings` | Future estimate-template wiring; not generating estimates yet. |
| `blueprint_material_draft_lines` | **Schema only — not populated.** |
| `blueprint_labor_draft_lines` | **Schema only — not populated.** |

All tables are tenant-scoped, RLS-enabled with `public.get_user_tenant_id()`, and
carry `GRANT` statements to `authenticated` and `service_role`. The migration
ends with `NOTIFY pgrst, 'reload schema';`.

### Shared TS contracts

`supabase/functions/_shared/blueprint-importer/`
- `trade-catalog.ts` — `TradeId`, `TradeSupportStatus`, support-status maps, trade lists, `isMvpSupportedTrade`, `isMeasurementObjectOnlyTrade`, `isFutureSupportedTrade`, `assertCanAcceptTradeForMvp`.
- `measurement-objects.ts` — `BlueprintMeasurementObject`, canonical key lists for roofing and walls/siding.
- `plan-path.ts` — `BlueprintPlanPath`, `validatePlanPathPresent`, `requiresPlanPath`.
- `review-flags.ts` — `BlueprintReviewFlag`, `createReviewFlag`, blocking-code set.
- `estimate-mapping.ts` — `BlueprintImportSession`, `BlueprintSourceDocument`, `BlueprintDetectedTrade`, `BlueprintAcceptedTrade`, `BlueprintTemplateBinding`, `BlueprintMaterialDraftLine`, `BlueprintLaborDraftLine` + enum unions.
- `index.ts` — barrel re-export.

All helpers are deterministic and side-effect-free. They do not call the DB or
any API. They do not run extraction or generate estimates.

### Shared Python contracts

`worker/app/blueprint_contracts/`
- `__init__.py`
- `trade_catalog.py`
- `estimate_mapping.py`
- `measurement_objects.py`
- `plan_path.py`
- `review_flags.py`

These mirror the TS contracts. They are **not** registered in
`worker/app/skills_registry.py` and **not** imported by `worker/app/main.py`.
They cannot be invoked as worker routes.

### JSON schemas

`docs/schemas/blueprint-importer/`
- `blueprint-import-session.schema.json`
- `blueprint-source-document.schema.json`
- `blueprint-detected-trade.schema.json`
- `blueprint-accepted-trade.schema.json` (forbids `windows_doors`)
- `blueprint-measurement-object.schema.json`
- `blueprint-plan-path.schema.json` (requires at least one anchor)
- `blueprint-review-flag.schema.json`
- `blueprint-template-binding.schema.json`
- `blueprint-material-draft-line.schema.json` (requires non-empty `plan_path_ids`)
- `blueprint-labor-draft-line.schema.json` (requires non-empty `plan_path_ids`)

### Examples

`docs/examples/blueprint-importer/` — contract examples (not live extraction):
- `README.md`
- `roofing-detected-trade.example.json`
- `roofing-measurement-objects.example.json`
- `roofing-plan-path.example.json`
- `wall-siding-detected-trade.example.json`
- `wall-siding-measurement-objects.example.json`
- `paint-derived-trade-blocked-without-siding.example.json`
- `windows-doors-measurement-object-only.example.json`
- `future-drywall-blocked.example.json`
- `material-draft-line-roofing.example.json`
- `labor-draft-line-roofing.example.json`

## Relationship to Phase 0 docs

This phase preserves and operationalizes the rules locked in:

- `docs/blueprint-trade-catalog.md` (4-state support enum, MVP / measurement-only / future / unsupported lists)
- `docs/blueprint-estimate-mapping-contract.md` (PlanPath required on every line; no AI in math; deterministic re-runs)
- `docs/blueprint-mvp-phase-plan.md` (phase boundaries)

DB CHECK constraints + TS/Python helpers enforce:
1. Support-status enum
2. MVP / measurement-only / future trade lists
3. `windows_doors` cannot be a top-level accepted trade
4. `paint_coatings` cannot stand alone — requires `exterior_walls_siding` in the same session
5. `future_supported` trades may only be accepted with `review_state = manual_only`
6. Every PlanPath must carry at least one anchor
7. Material + labor draft lines must reference at least one PlanPath (schema-level)

## Relationship to future material/labor population

Tables I and J (`blueprint_material_draft_lines`, `blueprint_labor_draft_lines`)
are intentionally created empty. Phase 3+ will write to them via deterministic
formula rules, with non-empty `source_measurement_ids` and `plan_path_ids`. UI
exposure of these draft lines is deferred.

## What remains intentionally unwired

- No edge functions read or write these tables.
- No worker routes reference the Python contracts.
- No frontend reads from these tables.
- No estimate / opportunity / project row references these tables yet.
- `document-worker` runtime behavior is unchanged.

## Stop conditions

Lovable stops after Phase 1 and waits for review before any Phase 2 work
(detection, parsing into these tables, or UI surfacing).

## Verification checklist

- [x] Phase 0 docs exist and were re-read before authoring.
- [x] Migration file created under `supabase/migrations/`.
- [x] Migration NOT applied.
- [x] Every new public-schema table has `GRANT`s before `ENABLE RLS`.
- [x] All new tables have tenant-scoped RLS policies.
- [x] `NOTIFY pgrst, 'reload schema';` at end of migration.
- [x] TS contracts created under `supabase/functions/_shared/blueprint-importer/`.
- [x] Python contracts created under `worker/app/blueprint_contracts/`.
- [x] Python contracts NOT registered in `skills_registry.py`.
- [x] Python contracts NOT imported by `worker/app/main.py`.
- [x] JSON schemas created under `docs/schemas/blueprint-importer/`.
- [x] Examples created under `docs/examples/blueprint-importer/` and marked as contract examples.
- [x] Enum parity: support-status / document-type / provider / severity / review-state / binding-status / draft-line status match across docs, TS, Python, and JSON schemas.
- [x] No new standalone edge functions.
- [x] No endpoint behavior changes.
- [x] No worker behavior changes.
