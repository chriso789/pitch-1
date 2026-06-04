# Blueprint Importer v2 — Phase 4: Draft Generation

**Status:** Phase 4 deliverable. Deterministic template binding + material/labor
draft quantity generation for the four MVP-supported trades. **No final
pricing. No CRM estimate handoff. No live estimate lines. No proposals.**

## Hard stops (NOT shipped in Phase 4)

- Final material pricing
- Final labor pricing or totals
- CRM estimate handoff
- Live `estimates` / `estimate_line_items` writes
- Proposal, work-order, purchase-order, or production-task writes
- Drywall / framing / MEP / insulation / flooring / concrete
- OCR / image-only PDF parsing
- Full blueprint sheet intelligence (sheet coordinates, scale)
- AI in the math path
- New standalone edge functions
- Pricing / labor-rate inference from historical data

## Scope

Phase 4 turns each `blueprint_accepted_trades` row for an MVP trade into:

- one `blueprint_template_bindings` row (in-code MVP template, missing-input list)
- N `blueprint_material_draft_lines` (status `ready` or `blocked`, never invented)
- N `blueprint_labor_draft_lines` (quantity only — `base_rate` stays NULL)
- review flags explaining every missing assumption, missing measurement,
  unresolved catalog, and Phase 4 gate (`final_pricing_not_enabled_phase_4`,
  `crm_handoff_not_enabled_phase_4`).

Re-running generation supersedes prior bindings + drafts for the same
`accepted_trade_id` — DB rows are never duplicated by repeated clicks.

## Architecture

```
accepted_trade (Phase 3)
   │
   ▼
generateTemplateBindingOnly  →  blueprint_template_bindings
   │
   ▼
generateDraftsForAcceptedTrade (pure)
   ├─ rewriteMeasurementInputsForTrade  (gross/net basis, gutter LF source)
   ├─ resolveRuleAssumptionValues       (coverage + waste from template/user)
   ├─ evaluateFormula                   (deterministic; no AI; no eval)
   └─ emits DraftMaterialOut / DraftLaborOut + DraftFlagOut
        │
        ▼
document-worker route persists:
   - blueprint_template_bindings  (supersede prior)
   - blueprint_material_draft_lines  (supersede prior; insert new)
   - blueprint_labor_draft_lines     (supersede prior; insert new)
   - blueprint_review_flags          (assumption + formula + Phase 4 info)
```

## Supported trades

| Trade | Material drafts | Labor drafts | Notes |
|---|---|---|---|
| roofing | yes | yes (quantity only) | uses `pitched_roof_area_sqft` when present |
| exterior_walls_siding | yes | yes | gross/net basis is explicit assumption |
| paint_coatings | yes | yes | requires wall report or accepted siding |
| gutters_fascia_trim | yes | yes | downspouts blocked without spacing assumption |
| windows_doors | no | no | measurement-object-only |
| drywall / framing / MEP / etc. | no | no | future-supported |

## Template strategy

In-code MVP template registry: `supabase/functions/_shared/blueprint-importer/phase4-templates.ts`.

- `selected_template_id` in `blueprint_accepted_trades` and
  `template_id` in `blueprint_template_bindings` remain **nullable**.
- Each binding persists `template_version` = the internal MVP template key
  (e.g. `mvp.roofing.asphalt_shingle_v1`).
- No tenant catalog seeding happens — that requires an approved schema.
  Material rows persist with `catalog_resolution_status = 'unresolved'` and an
  informational `catalog_item_unresolved` flag per line.

## Assumption model

Per trade, the template declares `required_assumptions` and
`optional_assumptions`. Resolution order: `user_assumption` →
`template_default` → unresolved.

- `waste_percent` is **required** on every MVP trade and has **no template
  default** — Phase 4 contract forbids silent defaults. Missing yields a
  `waste_percent_required` + `template_required_assumption_missing` flag.
- Roofing: `shingle_coverage_sqft_per_bundle`, `underlayment_coverage_sqft_per_roll`,
  `starter_coverage_lf_per_bundle`, `hip_ridge_coverage_lf_per_bundle`,
  `valley_metal_lf_per_unit`, `drip_edge_lf_per_unit` (defaults provided).
- Walls/siding: `wall_area_basis (gross|net)`, `siding_coverage_sqft_per_unit` (no default),
  `wrb_coverage_sqft_per_roll`.
- Paint: `paintable_area_basis`, `finish_coats_count`, `finish_coverage_sqft_per_gallon`,
  `primer_enabled`. Skips primer rules when `primer_enabled = 0`.
- Gutters: `gutter_lf_source` (default `eaves_lf`), `downspout_spacing_lf`
  (unresolved by default — the downspout placeholder rule blocks until set).

## Formula engine

Pure module `phase4-formulas.ts`. Exclusively supports:

| Formula key | Use |
|---|---|
| `area_with_waste` | `(area * (1+waste)) / coverage`; shingles, underlayment, WRB, primer, finish |
| `linear_feet_with_waste` | sum of LF inputs, `* (1+waste) / coverage`; starter, ridge cap, drip edge |
| `count_with_waste` | `count * (1+waste)` |
| `coverage_division_round_up` | `quantity / coverage`, ceil; corner trims, downspouts |
| `squares_from_sqft` | `(area * (1+waste)) / 100`; waste-adjusted SQ totals |
| `report_waste_table_lookup` | pulls user-picked row from report's waste table |
| `sum_measurements` | sum of LF inputs |
| `pass_through_quantity` | identity copy of one quantity input |

No `eval`. No AI. Unknown keys return `{ ok: false, reason: "unknown_formula_key" }`.

Rounding rules per rule: `ceil` (default), `round`, `floor`, `none`.

## Waste handling

- If the user provides `waste_percent` in user_assumptions, it is used.
- Otherwise the template's default applies — but Phase 4 templates set
  `waste_percent` default to `null`, so missing waste **always** produces a
  blocking review flag.
- The Roofr / EagleView `waste_table` is preserved on the measurement objects
  and may be surfaced in the UI for the user to pick from (the `report_waste_table_lookup`
  formula is available but the MVP rules use the explicit `waste_percent`
  assumption path).

## PlanPath propagation

Every emitted `DraftMaterialOut` / `DraftLaborOut` row collects the
`plan_path_id` of every measurement that fed its formula. Multi-input rules
(starter, ridge cap, drip edge) carry multiple PlanPath ids. A draft row with
zero source measurements is automatically downgraded to `status='blocked'`
with `formula_input_missing` flag and never reaches `ready`.

## Review flag behavior

Phase 4 codes (new) added to `review-flag-codes.ts`:

- `template_required_assumption_missing` — blocking
- `formula_input_missing` — blocking
- `catalog_item_unresolved` — info (catalog wiring deferred)
- `product_selection_required` — blocking (reserved)
- `waste_percent_required` — blocking
- `material_population_blocked_by_review` — blocking (reserved aggregate)
- `labor_generation_blocked_by_review` — blocking (reserved aggregate)
- `final_pricing_not_enabled_phase_4` — info (always emitted once per session)
- `crm_handoff_not_enabled_phase_4` — info (always emitted once per session)

`PHASE4_BLOCKING_FLAG_CODES` exposes the blocking set for downstream gating.

## Draft persistence

- `blueprint_template_bindings` — supersedes prior bindings for the same
  `accepted_trade_id` on every run; one active binding per accepted trade.
- `blueprint_material_draft_lines` / `blueprint_labor_draft_lines` — supersede
  prior non-superseded rows for the same `accepted_trade_id` per draft mode
  (materials / labor), then insert the new run. Re-running is idempotent in
  the sense that the UI shows one current set; superseded rows remain for audit.
- Every draft line records: `accepted_trade_id`, `template_binding_id`,
  `material_rule_id` / `labor_rule_id`, `item_key` / `labor_key`,
  `quantity`, `unit`, `rounding_rule` (materials), `waste_percent` (materials),
  non-empty `source_measurement_ids` + `plan_path_ids` for ready rows,
  `formula_key`, `formula_inputs` (including `computed_quantity`,
  `computed_rounded_quantity`, `effective_waste_percent`, `missing_measurements`,
  `missing_assumptions`), `catalog_resolution_status='unresolved'`,
  `catalog_item_id=null`, `status` in `draft|ready|blocked|superseded`.

## UI behavior

`src/pages/BlueprintImporterV2.tsx` now contains a `Phase4Panel` for each
accepted MVP trade:

- Template binding panel showing required assumptions with inline inputs
  and `source` (`user_assumption` / `template_default` / `unresolved`).
- `Bind / refresh template` button.
- `Populate Material Draft` button — disabled while blocking flags exist.
- `Generate Labor Draft` button — disabled while blocking flags exist.
- `Push to Estimate` — disabled with tooltip
  "CRM estimate handoff is not enabled in Phase 4."
- Material + labor draft tables with item, quantity, unit, status badge,
  and PlanPath count per row.
- Future-supported trades remain visible only in the Phase 3 detected
  panel as locked.

## Routes (document-worker only)

- `POST /blueprint-importer/v2/bind-template`
- `POST /blueprint-importer/v2/generate-material-drafts`
- `POST /blueprint-importer/v2/generate-labor-drafts`
- `POST /blueprint-importer/v2/draft-lines`

No new standalone edge functions. No existing route behavior changed. No
geometry-worker / measurement-worker / CRM estimate routes were touched.

## Intentionally unwired in Phase 4

- Final unit cost / price on draft material lines (no catalog wiring).
- Labor `base_rate`, `complexity_multiplier`, line totals.
- Push to CRM `estimates` or `estimate_line_items`.
- Tenant `assembly_templates` / `material_rules` / `labor_rules` DB tables.
- OCR fallback for image-only PDFs.
- Roofr-style report material-calc cross-comparison surfaces (data available
  on `blueprint_measurement_objects.normalized_value`; UI not built).

## Implementation gaps / honest deviations

- **In-code templates.** Per Phase 4 contract: "Prefer deterministic in-code
  MVP template definitions if no template table is ready." Template rows in
  `blueprint_template_bindings` carry `template_id = NULL` and the internal
  key in `template_version`.
- **Roofr waste_table not auto-picked.** The waste table is preserved on
  measurements but the generator uses the explicit `waste_percent`
  assumption. UI surfacing of the picker is deferred.
- **Catalog resolution not wired.** Every material draft persists with
  `catalog_resolution_status = 'unresolved'` plus an info `catalog_item_unresolved`
  flag. Wiring to a tenant material catalog is a Phase 5+ concern (CRM handoff
  contract).
- **Penetrations.** Roofing penetration material allowance + labor count run
  only when the report supplied `penetrations_count`; otherwise the line is
  emitted as `blocked` with `formula_input_missing`.
- **`material_population_blocked_by_review` / `labor_generation_blocked_by_review`**
  flag codes are reserved aggregates; per-rule blocking is already emitted via
  the specific `formula_input_missing` / `template_required_assumption_missing`
  codes. UI uses the granular flags.

## Test coverage

`tests/blueprint-importer/phase4.test.ts` — 22 deterministic tests:

- Formula engine: 7 cases (each formula family + missing-input fail-closed +
  unknown-key fail-closed).
- Templates: presence on MVP trades; absence on measurement-only / future
  trades; `waste_percent` required with no default on every MVP trade.
- Generator gates: windows_doors blocked, future trades blocked, paint
  standalone blocked, missing waste_percent emits blocking flag.
- Roofing: ready material drafts with correct quantities + multi-source
  provenance; labor drafts with non-empty provenance; every ready line has
  source_measurement_ids and plan_path_ids.
- Walls/siding: gross vs net basis switch affects siding panel quantity.
- Paint: finish gallons scale by coats; primer rules skipped when disabled.
- Gutters: downspout placeholder blocked without spacing assumption.
- Determinism: identical inputs → identical outputs (byte-equal quantities).
- Binding-only path: emits binding without drafts and flags missing
  required assumptions.

Combined with Phase 3's 18 tests, the full importer suite is 40 passing.

## Verification checklist

- [x] Phase 0 docs re-read (trade-catalog, estimate-mapping-contract, mvp-phase-plan)
- [x] Phase 1 schema contracts re-read; schema already present, no migration needed
- [x] Phase 2 DB verification doc re-read
- [x] Phase 3 runtime doc re-read
- [x] Template binding added — yes (`bind-template` route + in-code registry)
- [x] Material draft generation added — yes (`generate-material-drafts`)
- [x] Labor draft generation added — yes (`generate-labor-drafts`)
- [x] Supported trades: roofing, exterior_walls_siding, paint_coatings, gutters_fascia_trim
- [x] DB tables written by Phase 4: `blueprint_template_bindings`,
      `blueprint_material_draft_lines`, `blueprint_labor_draft_lines`,
      `blueprint_review_flags` (Phase 4 codes); also touches
      `blueprint_accepted_trades.user_assumptions`
- [x] DB tables intentionally NOT written: `estimates`, `estimate_line_items`,
      proposals, work orders, purchase orders, production tasks
- [x] Endpoint behavior changed: `document-worker` gained 4 new routes
      under `/blueprint-importer/v2/*`. No existing route behavior changed.
- [x] Worker behavior changed: no — Python twins are still contracts only
- [x] New standalone edge functions: no
- [x] UI changed: yes — `src/pages/BlueprintImporterV2.tsx` gains Phase4Panel;
      `src/integrations/blueprintImporterV2Api.ts` adds 4 helpers
- [x] Final pricing added: no
- [x] CRM estimate handoff added: no
- [x] Live estimate lines created: no
- [x] Windows/doors blocked as standalone: yes (generator hard gate + Phase 1
      DB CHECK still in force)
- [x] Paint standalone blocked: yes (generator hard gate)
- [x] Future trades blocked: yes (generator hard gate + DB CHECK)
- [x] Every ready draft line has `source_measurement_ids`: yes (test enforces)
- [x] Every ready draft line has `plan_path_ids`: yes (test enforces)
- [x] Missing assumptions create review flags: yes
- [x] Idempotency verified: re-runs supersede prior rows (one active set
      per accepted_trade per draft mode)
- [x] Tests added: 22 in `tests/blueprint-importer/phase4.test.ts`
- [x] Tests passing: 22/22 Phase 4 + 18/18 Phase 3 = 40/40

## Recommended next phase

Phase 5 — CRM estimate handoff **contract + review only**. Do not ship live
estimate writes until the contract is signed off, the tenant catalog wiring
strategy is approved, and the `selling_price` / commission interaction with
the existing estimate engine is re-verified against the engine-standards memory.
