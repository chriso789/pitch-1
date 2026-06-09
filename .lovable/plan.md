
# Blueprint Importer v2 — Trade Quote Workbench Completion

## Scope (this phase only)

Deliver the end-to-end **workbench** flow:

1. Open a blueprint/report PDF → land in a Blueprint Import Session.
2. See **Detected Trades** with support status, confidence, source pages.
3. Accept the trades you want to quote (with contract rules).
4. See/store **Measurements** under accepted trades, each with a **PlanPath**.
5. Enter **Manual Measurements** for trades where deterministic takeoff isn't available.
6. **Apply to Template** → required inputs view → save **template binding**.
7. **Populate Material Draft / Generate Labor Draft** → review draft lines (no pricing, no CRM write).
8. Review flags + blockers visible throughout.

## Hard non-goals

- No writes to `estimate_line_items`, `enhanced_estimates`, `proposal_tier_items`, proposal/work-order/PO/invoice/production tables.
- No catalog/labor table mutation, no pricing, no live handoff route.
- No standalone edge functions — extend `document-worker` route family only.
- No stub geometry skill output stored as real measurements; no AI in math path.
- No automatic blueprint-sheet takeoff for drywall/framing/MEP/etc.

## Required reading (verified first, no code before this)

- `docs/blueprint-trade-catalog.md`
- `docs/blueprint-estimate-mapping-contract.md`
- `docs/blueprint-mvp-phase-plan.md`
- `docs/blueprint-importer-phase-3-runtime-detection.md`
- `docs/blueprint-importer-phase-4-draft-generation.md`
- `docs/blueprint-importer-phase-7-6c-pricing-preflight.md`
- `docs/blueprint-importer-phase-7-8-live-handoff-hardening.md`
- `supabase/functions/document-worker/index.ts` (blueprint v2 route family)
- Existing blueprint upload routes (`upload-blueprint-document`, `parse-blueprint-document`, `classify-blueprint-pages`)
- `plan_documents` + all `blueprint_*` tables
- `src/pages/BlueprintImporterV2.tsx`, `BlueprintDocumentDetail.tsx`, `BlueprintReviewPage.tsx`
- `src/integrations/blueprintImporterV2Api.ts`, `blueprintApi.ts`
- `worker/app/skills_registry.py` + skill files to mark real vs stub

If any required flow is missing/contradictory/unsafe → stop and report before coding.

## Workflow

```text
plan_documents row
   │
   ▼
blueprint_import_sessions  ◄── idempotent on (tenant_id, plan_document_id)
   │
   ├── blueprint_source_documents  (1+; report or blueprint_set)
   │
   ├── blueprint_detected_trades   (auto from extractor + classifier)
   │
   ├── blueprint_accepted_trades   (user choice; contract-gated)
   │       │
   │       ├── blueprint_measurement_objects   (auto OR user_manual; PlanPath required)
   │       │       └── blueprint_plan_paths
   │       │
   │       ├── blueprint_template_bindings     (template_id + required/missing inputs)
   │       │
   │       ├── blueprint_material_draft_lines  (only when inputs complete & user clicks)
   │       └── blueprint_labor_draft_lines     (only when inputs complete & user clicks)
   │
   └── blueprint_review_flags      (blockers + warnings)
```

## DB changes (additive only, if needed)

Verify first whether existing columns can carry:
- `blueprint_measurement_objects.measurement_source` ∈ {`report_extraction`, `derived`, `user_manual`, `placeholder`}
- `blueprint_measurement_objects.created_by`
- `blueprint_template_bindings.binding_status` already exists — confirm enum covers `pending|ready|blocked|rejected|superseded`.
- `blueprint_material_draft_lines.source_measurement_ids uuid[]`, `plan_path_ids uuid[]`
- `blueprint_labor_draft_lines.source_measurement_ids uuid[]`, `plan_path_ids uuid[]`
- Idempotency keys: `(import_session_id, accepted_trade_id, template_id, line_key)` unique on draft lines.

Any missing columns → one additive migration with `IF NOT EXISTS`, RLS unchanged (tenant_id already enforced), `NOTIFY pgrst, 'reload schema';`. **No new tables unless contract demands it.** No changes to estimate/proposal tables.

## Routes (extend `document-worker` blueprint-importer/v2 family)

- `POST /blueprint-importer/v2/import-from-plan-document` — idempotent session+source-doc create from a `plan_documents.id`.
- `POST /blueprint-importer/v2/detect-trades` — runs extractor over source docs, writes `blueprint_detected_trades` + `blueprint_measurement_objects` + `blueprint_plan_paths` + flags. Idempotent per `import_session_id`.
- `POST /blueprint-importer/v2/accept-trades` — body: `[{trade_id, measurement_mode, template_id?, assumptions?}]`. Enforces contract gates (no `windows_doors` standalone; `paint_coatings` requires wall source).
- `POST /blueprint-importer/v2/measurements/upsert-manual` — manual measurement entry with required PlanPath.
- `POST /blueprint-importer/v2/apply-template` — writes/updates `blueprint_template_bindings`; recomputes required/missing inputs.
- `POST /blueprint-importer/v2/draft/material` — generates `blueprint_material_draft_lines` only if binding is `ready`.
- `POST /blueprint-importer/v2/draft/labor` — same for labor.
- `GET /blueprint-importer/v2/workbench/:sessionId` and `…/by-document/:planDocumentId` — returns hydrated workbench payload.

All routes: validate tenant via `_shared/auth` + `_shared/tenant`, RLS-safe queries, idempotent, structured error envelope, no live-estimate writes.

## Extractors (deterministic only)

Inside worker, expand `worker/app/blueprint_contracts/` with three extractors:

- `roofr_roof_report_extractor.py`
- `eagleview_roof_report_extractor.py`
- `eagleview_wall_report_extractor.py`

Each takes the already-parsed report payload (existing parser output) and emits typed measurement objects + PlanPaths against the keys listed in the request. No OCR fallback; no inference.

For generic blueprint sets: classifier emits detected trades only, all measurements as `measurement_source='placeholder'`, `status='manual_measurement_required'`. No quantities.

## Geometry safety

Audit `worker/app/skills_registry.py` and skills. Any skill currently returning stubbed/fake geometry is marked in a small `STUB_SKILLS` set and the workbench refuses to consume their output as real measurements (flag: `geometry_worker_stub_not_allowed`). Document real vs stub in workbench doc.

## UI

`src/pages/BlueprintImporterV2.tsx` becomes the workbench shell. Add components under `src/components/blueprint/workbench/`:

- `WorkbenchHeader` — doc name/type/provider/session status/address/flag summary.
- `DetectedTradesPanel` — trade cards with status badges (`Accept` / `Locked` / `Manual measurement required`).
- `AcceptedTradePanel` — per accepted trade:
  - measurements list with PlanPath links,
  - missing inputs,
  - template selector,
  - assumptions form,
  - `Apply Template`, `Populate Material Draft`, `Generate Labor Draft`.
- `DraftLinesPreview` — material + labor draft tables with source/PlanPath columns.
- `ManualMeasurementForm` — modal for `measurements/upsert-manual`.
- `FutureActionsDisabledBar` — fixed disabled message: *“Push to Estimate is disabled until live CRM handoff is approved. This workbench stores trade selections, measurements, and template draft outputs only.”*

`BlueprintDocumentDetail.tsx` gets a prominent **Open Trade Quote Workbench** action that calls `import-from-plan-document` then routes to the workbench.

## Tests

Vitest (frontend/api integration) + Python tests (extractors). Coverage list matches the request: session idempotency, trade-detection rules per report type, contract gates, measurement persistence with PlanPath, manual measurement, template binding required/missing, draft line idempotency + provenance, workbench GET shape, safety asserts (no `estimate_line_items` writes, no stub geometry stored).

## Docs

- New: `docs/blueprint-importer-trade-quote-workbench-completion.md` (full scope/non-goals/routes/UI/tests/gaps/checklist).
- Touch only the workbench status line in `docs/blueprint-mvp-phase-plan.md`.

## Verification report

End-of-phase report covering every bullet in the request (docs re-read, routes, UI, DB tables written/not-written, tests, deviations, remaining blockers, recommended next phase).

## Sequencing

1. **Audit pass** — read all required docs + existing routes/tables/UI/skills; produce gap notes.
2. **Schema check + (if needed) one additive migration**.
3. **Extractors** for Roofr/EagleView roof/EagleView wall + generic blueprint placeholder path.
4. **Routes** in `document-worker` blueprint-importer/v2 namespace.
5. **API client** updates in `blueprintImporterV2Api.ts`.
6. **UI workbench** components + page wiring.
7. **Tests**.
8. **Docs + verification report**.

Stop after this phase. Wait for review before any live handoff or full sheet takeoff.
