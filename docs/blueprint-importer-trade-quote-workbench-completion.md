# Blueprint Importer v2 — Trade Quote Workbench Completion Phase

Status: shipped (workbench wiring only — no live CRM handoff)

## Scope

This phase delivers the practical user workflow:

1. Open an uploaded blueprint or report → land in a Blueprint Import Session.
2. See detected quote-able trades with support status, confidence, and source pages.
3. Accept the trades you want to quote (contract-gated).
4. Store measurements under accepted trades, each with a PlanPath for provenance.
5. Enter manual measurements for blueprint sheets where deterministic takeoff isn't available.
6. Apply measurements to templates → review required/missing inputs.
7. Populate material drafts and generate labor drafts where inputs are complete.

The workbench is read-then-write only against the `blueprint_*` tables. Nothing in
this phase mutates CRM/estimate/proposal/PO/invoice tables.

## Non-goals (explicit)

- No writes to `estimate_line_items`, `enhanced_estimates`, `proposal_tier_items`,
  proposal, work-order, purchase-order, project cost invoice, or production tables.
- No catalog / labor table mutation. No final pricing. No live CRM handoff route.
- No standalone edge functions — all routes live in `document-worker`.
- No stub geometry skill output is consumed as real measurement data.
- No automatic blueprint-sheet takeoff for drywall / framing / MEP / insulation /
  flooring / concrete (those trades remain manual-only or future-supported).

## Supported document types

| Document                              | Behavior                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Roofr roof report (PDF, text)         | Classified, parsed, measurements + PlanPaths persisted, trades detected.                   |
| EagleView roof report (PDF, text)     | Same as above.                                                                             |
| EagleView wall report (PDF, text)     | Same as above; emits siding/paint/gutters detection and windows/doors measurement object.  |
| Generic blueprint PDF (selectable)    | Session created as `blueprint_set`; user accepts trades in `manual_measurement_required`.  |
| Image-only / OCR-only PDF             | Session created as `blueprint_set`; manual measurement required; no auto-extraction.       |

## Supported trades

- MVP quote trades (`mvp_supported`): `roofing`, `exterior_walls_siding`, `paint_coatings`,
  `gutters_fascia_trim`.
- `paint_coatings` requires a wall source (EagleView wall report or accepted
  `exterior_walls_siding`); enforced by `evaluateTradeAcceptance`.
- `windows_doors` is `measurement_object_only` and cannot be accepted standalone.
- Future trades (`drywall`, `framing`, `insulation`, `flooring`, `concrete`,
  `electrical`, `plumbing`, `hvac`) remain locked or manual-only.

## Workflow

```text
plan_documents row
   │  (POST /blueprint-importer/v2/import-from-plan-document)
   ▼
blueprint_import_sessions   (idempotent on tenant_id + plan_document_id)
   │
   ├── blueprint_source_documents
   │
   ├── blueprint_detected_trades
   │
   ├── blueprint_accepted_trades             (POST /accept-trade)
   │       │
   │       ├── blueprint_measurement_objects (auto OR user_manual; PlanPath required)
   │       │       └── blueprint_plan_paths
   │       │
   │       ├── blueprint_template_bindings   (POST /bind-template)
   │       │
   │       ├── blueprint_material_draft_lines (POST /generate-material-drafts)
   │       └── blueprint_labor_draft_lines    (POST /generate-labor-drafts)
   │
   └── blueprint_review_flags  (blockers + warnings, including the disabled-Push-to-Estimate notice)
```

## New routes (`document-worker`)

- `POST /blueprint-importer/v2/import-from-plan-document` — Body: `{ plan_document_id }`.
  Tenant-scoped. Returns the existing non-superseded session for that plan document if
  present (idempotent). Otherwise loads the PDF from the `blueprints` bucket, classifies,
  parses with the Roofr / EagleView roof / EagleView wall parser that wins by confidence,
  and persists session + source document + plan paths + measurements + detected trades.
  Falls back to a manual `blueprint_set` session when there is no selectable text or no
  MVP parser matches.

- `POST /blueprint-importer/v2/measurements/upsert-manual` — Body:
  `{ session_id, trade_id, measurement_key, measurement_group, quantity, unit,
     page_number?, section_label?, source_text_excerpt?, note?, source_document_id?,
     measurement_id? }`. Inserts a `blueprint_plan_paths` row (`path_type='user_entry'`)
  and either inserts or updates a `blueprint_measurement_objects` row stamped with
  `metadata.measurement_source='user_manual'` and `metadata.created_by`.

- `POST /blueprint-importer/v2/workbench/by-document` — Body: `{ plan_document_id }`.
  Returns `{ session_id, status }` for the active session on a plan document, or
  `{ session_id: null }` when none exists.

## Existing routes reused (unchanged)

`/blueprint-importer/v2/ingest`, `/session`, `/accept-trade`, `/bind-template`,
`/generate-material-drafts`, `/generate-labor-drafts`, `/draft-lines`,
`/resolve-bindings`, `/pricing-preflight`.

## Database

No schema migration in this phase. Manual-measurement provenance is captured in
`blueprint_measurement_objects.metadata.measurement_source` and
`blueprint_plan_paths.path_type='user_entry'`, both already supported by existing
columns. If a future phase needs the field as a hard column it should be added with
an additive migration (`IF NOT EXISTS`) and a `NOTIFY pgrst, 'reload schema'`.

Tables written by the workbench:

- `blueprint_import_sessions`
- `blueprint_source_documents`
- `blueprint_detected_trades`
- `blueprint_accepted_trades`
- `blueprint_measurement_objects`
- `blueprint_plan_paths`
- `blueprint_review_flags`
- `blueprint_template_bindings`
- `blueprint_material_draft_lines`
- `blueprint_labor_draft_lines`

Tables intentionally NOT written:

- `estimate_line_items`, `enhanced_estimates`
- `proposal_tier_items`, all proposal tables
- `work_orders`, `purchase_orders`, `purchase_order_items`
- `project_cost_invoices`, `project_cost_invoice_line_items`
- `production_*`

## UI

- `src/pages/BlueprintDocumentDetail.tsx` now has an **Open Trade Quote Workbench**
  action. It calls `findWorkbenchSessionByPlanDocument` first; if no session exists it
  calls `importBlueprintFromPlanDocument` and then routes to
  `/blueprint-importer-v2/:sessionId`. Manual-mode sessions surface a toast so the user
  knows deterministic takeoff isn't available.
- `src/pages/BlueprintImporterV2.tsx` is rebranded as the **Trade Quote Workbench** and
  shows a permanent **Push to Estimate is disabled** notice at the top.
- The existing trade cards, accept-trade flow, template binding panel, draft-line
  preview, blocking-flag alert, and handoff-preview review surfaces remain in place
  (they were already wired and are tenant-scoped).

## Manual measurement mode

Allowed for the MVP quote trades (`roofing`, `exterior_walls_siding`, `paint_coatings`,
`gutters_fascia_trim`) and visible-but-manual-only for the future trades. Every manual
measurement gets a `blueprint_plan_paths` row with `path_type='user_entry'` and the
measurement row is stamped `metadata.measurement_source='user_manual'`. Manual entries
remain visibly marked as manual in the UI and downstream template draft generators.

## Geometry worker safety

Worker geometry skills currently shipping as real (per `worker/app/skills_registry.py`)
include the segment detectors, plane fitter, DSM/DTM/CHM, pitch and area calculators,
and the geometry-quality score. `validate_geometry` and `export_report` are still
stubs and MUST NOT be consumed as real measurement data. The workbench does not call
worker geometry at all — measurements come from deterministic Roofr / EagleView text
parsers or from manual user entry. Any future wiring of worker geometry into the
workbench must respect the `geometry_worker_stub_not_allowed` blocker.

## Disabled future actions

- "Push to Estimate" — disabled. Notice rendered in the workbench header.
- "Final pricing" — disabled. Pricing preflight remains a preview-only review surface.
- "Catalog binding mutation" — read/preview only; no catalog rows are written.

## Verification checklist

- [x] Required docs re-read (blueprint trade catalog, phase 3 runtime detection,
      phase 4 draft generation, phase 7-6c preflight, phase 7-8 live handoff hardening,
      MVP phase plan).
- [x] Existing `document-worker` blueprint-importer/v2 routes inspected; new routes
      added are additive only.
- [x] Workbench can be opened from an uploaded blueprint via the new
      `import-from-plan-document` + `workbench/by-document` routes.
- [x] Manual measurement entry route ships with PlanPath provenance and source stamp.
- [x] No new standalone edge function.
- [x] No writes to estimate / proposal / work-order / PO / invoice / production tables.
- [x] No new DB migration required for this phase.
- [x] Push-to-Estimate notice rendered prominently in the workbench.

## Remaining gaps / next phase candidates

1. Full blueprint-sheet takeoff (auto measurement from architectural drawings).
2. Catalog / labor resolver hardening (`phase 7-6b`, `7-6c`) → enable live pricing.
3. Live CRM estimate handoff hardening (`phase 7-8`) → enable Push to Estimate.
4. Worker geometry skills `validate_geometry` and `export_report` need real
   implementations before any geometry-derived measurements can be consumed.
5. Drywall / framing / MEP / insulation / flooring / concrete auto-measurement
   requires sheet-intelligence work that is out of scope here.

Recommended next phase: live handoff hardening (3) once catalog / pricing (2) lands,
because that is what unblocks the user-visible "send this to the CRM estimate"
button. Full blueprint takeoff (1) is a longer-horizon effort.
