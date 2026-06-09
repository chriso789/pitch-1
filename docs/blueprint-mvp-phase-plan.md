# Blueprint Importer v2 — MVP Phase Plan

**Status:** Phase 0 contract doc. No DB, no code, no endpoint behavior changes.
**Scope:** Locks the phase sequence, the MVP cut, explicit non-goals, acceptance criteria, and current implementation gaps. Companion to `blueprint-trade-catalog.md` and `blueprint-estimate-mapping-contract.md`.

> **Progress (as of Phase 7.5):**
> - Phase 0 (contract docs): **complete**
> - Phase 1 (schema draft + shared TS/Python contracts + JSON schemas + examples): **complete** — see `docs/blueprint-importer-phase-1-schema-contracts.md`
> - Phase 2 (schema promotion + DB verification): **complete** — see `docs/blueprint-importer-phase-2-db-verification.md`
> - Phase 3 (runtime detection: classify → parse → measurement objects → PlanPaths → review flags → acceptance UI): **complete** — see `docs/blueprint-importer-phase-3-runtime-detection.md`. Material/labor population, template binding, and CRM estimate handoff remain intentionally unwired.
> - Phase 4 (material/labor draft generation + template binding): **shipped — see [phase-4 doc](./blueprint-importer-phase-4-draft-generation.md). Draft-only; no final pricing, no CRM handoff.**
> - Phase 5 (CRM estimate handoff contract + integration review docs): **shipped — docs only. See [phase-5 handoff contract](./blueprint-importer-phase-5-crm-handoff-contract.md), [CRM/estimate integration inventory](./blueprint-crm-estimate-integration-inventory.md), and [CRM handoff review gates](./blueprint-crm-handoff-review-gates.md).**
> - Phase 5.5 (CRM handoff schema + contracts): **shipped — see [phase-5.5 doc](./blueprint-importer-phase-5-5-handoff-schema-contracts.md). Canonical target chosen: `enhanced_estimates`. Three staging/provenance tables created (no live writes). Shared TS + Python contracts + JSON schemas + 8 examples. `estimate_line_items` NOT altered (bridge table preferred). Runtime unwired; Phase 6 (preview implementation) blocked behind review.**
> - Phase 6 (CRM handoff preview implementation, preview-only): **shipped — see [phase-6 doc](./blueprint-importer-phase-6-handoff-preview.md). Three `document-worker` routes added (`/handoff-preview`, `/handoff-preview/get`, `/handoff-preview/review`). Writes only to `blueprint_estimate_handoff_batches` + `blueprint_estimate_line_candidates`. `blueprint_estimate_line_provenance` not written. Push to Estimate, final pricing, catalog mapping, and custom-line approval intentionally disabled in UI and at the route boundary. 17/17 tests passing.**
> - Phase 7 (live handoff approval contract): **shipped — docs only. See [phase-7 doc](./blueprint-importer-phase-7-live-handoff-approval-contract.md), [status mapping](./blueprint-live-handoff-status-mapping.md), [existing-line resolution policy](./blueprint-existing-line-resolution-policy.md), [provenance bridge live-write contract](./blueprint-provenance-bridge-live-write-contract.md), and [catalog resolver requirements](./blueprint-catalog-resolver-requirements.md).**
> - Phase 7.5 (schema hardening + resolver/pricing/approval contracts): **shipped — see [phase-7.5 doc](./blueprint-importer-phase-7-5-schema-hardening-and-resolver-contracts.md), [resolver contract](./blueprint-catalog-labor-resolver-contract.md), [pricing contract](./blueprint-live-handoff-pricing-contract.md), [approval-object contract](./blueprint-handoff-approval-object-contract.md), [schema diff](./blueprint-handoff-schema-diff-verification.md). DB: `enhanced_estimates.status` CHECK (draft/sent/signed), `blueprint_estimate_handoff_batches` extended with nullable approval columns. Shared TS+Python contracts add ApprovalObject, CatalogResolverOutput, pricing-safety helpers; `source_draft_hash` now required in deterministic batch key. No runtime route, worker, UI, or live estimate writes.**
> - Phase 7.6 (deterministic catalog/labor resolver + pricing preflight): **STOP-AND-REPORT — see [phase-7.6 discovery report](./blueprint-importer-phase-7-6-discovery-report.md). Catalog/labor model is ambiguous per the Phase 7.6 prompt's required first step: `product_catalog` has no `item_key`/`sku`/`trade_id`; `labor_rates` has no `trade_id`/`labor_key`/unit; `material_item_match_rules` is `company_id`-scoped and invoice-side; `product_catalog`, `labor_rates`, `supplier_catalog_items`, `abc_catalog_items` all have 0 rows in production. Shipping a resolver today would resolve 0 candidates. Recommendation: replace with Phase 7.6a (blueprint↔catalog binding schema + resolver contract v2). No runtime code, no migration, no UI written. Phase 8 readiness: **blocked**.**
> - Phase 7.6a (blueprint↔catalog binding schema + resolver contract v2): **shipped — schema + contracts only. See [phase-7.6a doc](./blueprint-importer-phase-7-6a-catalog-binding-schema.md), [resolver v2 contract](./blueprint-catalog-labor-resolver-v2-contract.md), [tenant/company reconciliation](./blueprint-tenant-company-catalog-reconciliation.md), [pricing contract addendum](./blueprint-live-handoff-pricing-contract.md). DB: `blueprint_catalog_bindings` + `blueprint_catalog_binding_events` with tenant-scoped RLS, deterministic-key uniqueness, `windows_doors` CHECK, audit trigger. Shared TS+Python contracts add `BlueprintCatalogBinding`, `BlueprintResolverV2Result`, validators, deterministic-key helper. JSON schemas + 12 examples. No runtime resolver, no pricing preflight, no UI, no document-worker, no edge function, no catalog/labor mutation. Phase 8 readiness: **still blocked**.**
> - Phase 7.6b (deterministic binding resolver runtime): **shipped — runtime only, no live writes. See [phase-7.6b doc](./blueprint-importer-phase-7-6b-binding-resolver-runtime.md). Adds `POST /blueprint-importer/v2/resolve-bindings` + `POST /blueprint-importer/v2/resolve-bindings/get` inside the existing document-worker route family. Pure resolver module `phase7_6b-resolver.ts` matches `blueprint_estimate_line_candidates` against active `blueprint_catalog_bindings`; emits granular runtime status (`resolved`/`unresolved`/`ambiguous`/`inactive_binding`/`inactive_target`/`unit_mismatch`/`tenant_scope_mismatch`/`missing_labor_rate`/`blocked`) into `metadata.resolver_v2_result`, maps to DB-safe `catalog_resolution_status`, and writes resolver-owned `blueprint_review_flags` idempotently. Preserves `source_measurement_ids`/`plan_path_ids`/`source_document_ids`/`deterministic_handoff_key`/quantity/unit/formula_inputs. `handoff_allowed` stays `false`; `pricing_status` capped at `cost_unresolved`. No mutation of `product_catalog`, `labor_rates`, `supplier_catalog_items`, `abc_catalog_items`, `material_item_match_rules`. No `estimate_line_items`/`enhanced_estimates`/`proposal_tier_items` writes. No fuzzy/AI/first-row-wins matching. No standalone edge functions. UI adds *Resolve catalog bindings* button + resolver summary + resolver v2 column to `BlueprintImporterV2`; Push to Estimate / pricing preflight / final pricing / custom-line approval remain disabled. 32/32 phase-7.6b tests passing; 146/146 blueprint-importer suite. Phase 8 readiness: **still blocked** (pricing preflight is Phase 7.6c).**
> - Phase 7.6c (pricing preflight + target validation, preview-only): **shipped — preview-only, no live writes. See [phase-7.6c doc](./blueprint-importer-phase-7-6c-pricing-preflight.md). Adds `POST /blueprint-importer/v2/pricing-preflight` + `/pricing-preflight/get` inside the existing document-worker family. Pure module `phase7_6c-preflight.ts` validates resolved binding targets in `product_catalog`/`supplier_catalog_items`/`abc_catalog_items`/`labor_rates` (tenant safety, active status, unit compatibility) and evaluates cost readiness with cost priority `binding.unit_cost > target.base_unit_cost` (catalog source only). Quantity-only mode is unconditionally blocked (`QUANTITY_ONLY_LIVE_LINES_UNSAFE`). Zero unit_cost/labor rate is blocked (`ZERO_DEFAULT_PRICING_UNSAFE`). Granular blockers: `MATERIAL_UNIT_COST_MISSING`/`_ZERO_UNSAFE`/`_PRICING_RULE_MISSING`, `CATALOG_RESOLVED_COST_MISSING`/`_TARGET_MISSING`/`_INACTIVE`/`_TENANT_MISMATCH`, `LABOR_RATE_*`, `LABOR_PRODUCTION_RATE_REQUIRED`, `UNIT_CONVERSION_REQUIRED`, `MATERIAL_ITEM_MATCH_RULES_OUT_OF_SCOPE`, plus always-on `FINAL_PRICING_NOT_ENABLED_PHASE_7_6C`/`LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6C`. Writes preview-only `extended_cost = quantity * unit_cost` (and `quantity / production_rate_per_hour * base_rate_per_hour` for labor) into `metadata.pricing_preflight` and `metadata.preview_cost_summary`. Preserves `source_measurement_ids`/`plan_path_ids`/`source_document_ids`/`deterministic_handoff_key`/quantity/unit/formula_inputs/resolver_v2_result. `handoff_allowed` stays `false`. Owned flags scoped by `metadata.source='pricing_preflight_v2'` for idempotent rerun. No mutation of `product_catalog`/`labor_rates`/`supplier_catalog_items`/`abc_catalog_items`/`material_item_match_rules`. No `estimate_line_items`/`enhanced_estimates`/`proposal_tier_items` writes. No proposal/work-order/PO/production/invoice writes. No tax/discount/margin/markup inference. No standalone edge functions. UI adds *Run pricing preflight* button + preview-only readiness panel (ready/blocked counts, preview-cost total badge, blocker chips) to `BlueprintImporterV2`; Push to Estimate / Final pricing / custom-line approval remain disabled. 31/31 phase-7.6c tests passing; 177/177 blueprint-importer suite. Phase 8 readiness: **still blocked** — next is Phase 7.7 (final live-handoff readiness contract).**
> - Phase 7.7 (final live-handoff readiness contract): **shipped — docs only. See [phase-7.7 doc](./blueprint-importer-phase-7-7-live-handoff-readiness.md), [readiness matrix](./blueprint-live-handoff-readiness-matrix.md), [supplier catalog tenant-scope contract](./blueprint-supplier-catalog-tenant-scope-contract.md), [ABC pricing source contract](./blueprint-abc-pricing-source-contract.md), [estimate line write mapping contract](./blueprint-estimate-line-write-mapping-contract.md). Closes Phase 7.6c deviations by contract: supplier_catalog_items tenant-scoping must join through `supplier_catalogs.tenant_id`; ABC pricing must come from a trusted webhook price row or user-confirmed binding-level cost. Locks Phase 8 live-write preconditions, output contract, provenance bridge rule, existing-line policy, approval object requirements, and pricing/write mapping. No code, no DB, no endpoint/worker/UI change. No live writes. No `estimate_line_items`/`enhanced_estimates`/`proposal_tier_items`/provenance bridge writes. No catalog/labor mutation. **Phase 8 readiness decision: C — Phase 7.8 required** to verify supplier tenant-join, ABC price source, cost-only tier aggregation behavior, and existing-line scenarios in code/test before Phase 8 implementation begins.**
> - Phase 7.8 (live-handoff hardening + verification tests): **shipped — pure helpers + tests + docs only. See [phase-7.8 doc](./blueprint-importer-phase-7-8-live-handoff-hardening.md). Adds six pure modules under `supabase/functions/_shared/blueprint-importer/`: `phase7_8-supplier-validation.ts` (supplier_catalog tenant-join validator), `phase7_8-abc-validation.ts` (ABC webhook-price-row + binding fallback validator), `phase7_8-existing-line-policy.ts` (deterministic-key + user-edit + tenant/target collision policy), `phase7_8-write-mapping.ts` (estimate_line_items payload mapper with no zero-default, no margin/tax/discount inference), `phase7_8-provenance-bridge.ts` (transaction harness with rollback-only behavior — both inserts atomic), `phase7_8-tier-side-effects.ts` (locked verdict `unsafe_without_phase_7_9_contract` based on DB inspection: 0 triggers on estimate_line_items/enhanced_estimates/proposal_tier_items), and `phase7_8-readiness-evaluator.ts` (centralised Phase 7.7 gate aggregator). 45 phase-7.8 tests passing; 222/222 blueprint-importer suite. **Hard schema finding:** `supplier_catalogs` has no `tenant_id` column today — every supplier_catalog target hard-blocks with `SUPPLIER_CATALOG_TENANT_JOIN_REQUIRED` until Phase 7.9 migration. No DB migration, no new routes, no worker/UI changes, no standalone edge functions, no catalog/labor mutation, no persistent `estimate_line_items`/`enhanced_estimates`/`proposal_tier_items`/`blueprint_estimate_line_provenance` rows, no Push to Estimate. **Phase 8 readiness decision: Phase 7.9 required** — (a) supplier_catalogs tenant attribution migration, (b) ABC tenant-scoped webhook price-row store wired to preflight, (c) enhanced_estimates / proposal-tier recompute contract + draft/non-final line convention.**
> - **Trade Quote Workbench Completion Phase**: **shipped — see [workbench completion doc](./blueprint-importer-trade-quote-workbench-completion.md). Bridges uploaded blueprints/reports to the Blueprint Importer v2 workbench. Adds three additive routes to the existing `document-worker` family: `POST /blueprint-importer/v2/import-from-plan-document` (idempotent session creation from `plan_documents.id`, falls back to a `blueprint_set` manual-mode session when no MVP parser matches or PDF has no selectable text), `POST /blueprint-importer/v2/measurements/upsert-manual` (manual measurement entry with mandatory `blueprint_plan_paths` provenance and `metadata.measurement_source='user_manual'`), and `POST /blueprint-importer/v2/workbench/by-document` (lookup the active session for a plan document). UI: `BlueprintDocumentDetail` gets an *Open Trade Quote Workbench* action; `BlueprintImporterV2` is rebranded as the workbench and shows a permanent *Push to Estimate is disabled* notice. No new standalone edge function, no DB migration, no writes to `estimate_line_items`/`enhanced_estimates`/proposal/work-order/PO/invoice/production tables, no catalog/labor mutation, no worker-geometry-stub output stored as real measurements. Phase 8 readiness unchanged (Phase 7.9 still required).**


---

## 1. Phase 3 MVP scope

The Phase 3 MVP supports four `mvp_supported` trades and one `measurement_object_only` trade:

| `trade_id` | Status | Source documents at MVP |
|---|---|---|
| `roofing` | `mvp_supported` | Roofr roof report, EagleView roof report, in-house `roof_measurements` row |
| `exterior_walls_siding` | `mvp_supported` | EagleView wall report |
| `paint_coatings` | `mvp_supported` (derived from siding) | — (consumes `exterior_walls_siding` outputs) |
| `gutters_fascia_trim` | `mvp_supported` | EagleView wall report, EagleView/Roofr roof report (eaves/rakes) |
| `windows_doors` | `measurement_object_only` | EagleView wall report |

The MVP user flow is:

```
Upload report(s)
   → Classify documents
   → Detect trades (with confidence)
   → User accepts trades (mvp_supported only)
   → Extract measurements (typed objects with provenance)
   → Select template (tenant assembly template)
   → Populate material list (deterministic generator)
   → Generate labor pricing (deterministic generator)
   → Review flags resolved
   → Push to CRM estimate
```

No step in this flow may silently default a critical input. Every default emits a review flag (see estimate-mapping contract §6).

---

## 2. Explicit non-goals (Phase 3)

The following are **out of scope** for the Phase 3 MVP and must not be implemented until their dedicated phase is approved:

- Drywall auto-populate
- Framing auto-populate
- Insulation, flooring, concrete auto-populate
- Electrical, plumbing, HVAC auto-populate (any MEP trade)
- Blueprint sheet-index navigation
- Scaled measurement extraction from blueprint drawings
- Wall-type schedule parsing
- Finish-level schedule parsing
- Structural schedule parsing (headers, beams, trusses, connectors)
- MEP sheet parsing (panel schedules, fixture schedules, equipment schedules)
- Automatic product-to-catalog matching by free-text description
- OCR fallback for scanned-only blueprint sets (review queue only)
- Spec-book section parsing beyond CSI division detection
- Multi-building / multi-structure project decomposition

A request to add any of the above to Phase 3 must be rejected and routed into the appropriate future phase below.

---

## 3. Phase sequence (locked)

| Phase | Title | Deliverables | Gate to next |
|---|---|---|---|
| **0** | Contract docs | `blueprint-trade-catalog.md`, `blueprint-estimate-mapping-contract.md`, `blueprint-mvp-phase-plan.md` | User approval. No code. |
| **1** | DB schema + shared contracts | Tables: `importer_projects`, `importer_documents`, `detected_trades`, `trade_measurements`, `trade_specifications`, `assembly_templates`, `material_rules`, `labor_rules`, `accepted_trades`, `generated_material_lists`, `generated_labor_lists`, `plan_paths`, `review_flags`. RLS + tenant scoping + explicit GRANTs. Shared TS types in `_shared/importer/`. | Migration applied, types generated. No worker code yet. |
| **2** | Document classifier + trade detector | Routes added to existing `document-worker`: `/importer/classify`, `/importer/detect-trades`. Reuses shipped Roofr/EagleView parsers. No new edge function (architecture guard). | Classifier + detector pass fixture tests for Roofr roof, EagleView roof, EagleView wall. |
| **3** | Measurement + specification extractors (MVP trades only) | `roofing` extractor, `exterior_walls_siding` extractor, `windows_doors` extractor. Typed `TradeMeasurement` + `TradeSpecification` rows with PlanPath source steps. | All MVP-trade extractors green on fixture set. |
| **4** | Assembly templates + deterministic generators | Material rule evaluator, labor rule evaluator, complexity multiplier engine, review-flag emitter. Tenant template CRUD. Pure deterministic — no AI in math. | Determinism invariant test passes (re-run = byte identical). |
| **5** | PlanPath persistence + review-flag UI contract | Every generated line item has a non-empty PlanPath. Review flags block actions per estimate-mapping contract §6. | Provenance invariant test passes. |
| **6** | UI: 3-step wizard | Upload → Trade selection (confidence + status) → Per-trade takeoff review → Populate Materials → Generate Labor → Resolve flags. | UX QA on Fonsica + EagleView wall fixtures. |
| **7** | CRM estimate handoff | Write into existing `estimates` + `estimate_line_items`; add `source_plan_path` JSON column; freeze AcceptedTrade on push. Honor existing engine standards (commission, selling_price, line_total recalc). | Round-trip test: importer → estimate → re-open estimate → PlanPath intact. |
| **8** | Regression tests | Snapshot tests on Fonsica Roofr report, EagleView wall report, and one full blueprint set (classification only — no drywall/framing extraction). | All snapshots green; phase 3 MVP shipped. |

A phase may not begin until the previous phase is explicitly approved. No consolidation across phases.

---

## 4. Future phases (post-MVP)

| Phase | Title | Scope summary |
|---|---|---|
| **F1** | Blueprint sheet intelligence foundation | Sheet-index extractor, discipline classifier (A/S/M/E/P/FP/R/C), drawing-title parser, scale detection, missing-sheet detection. Pure intelligence layer — no trade auto-populate. |
| **F2** | Drywall auto-populate | Wall-type schedule parsing, finish-level schedule parsing, opening-deduction logic, reflected-ceiling-plan area extraction. Drywall promoted to `mvp_supported`. |
| **F3** | Framing auto-populate | Structural sheet parsing, wall-type-driven framing takeoff, header/beam/post schedules, truss/rafter schedules, connector schedules. Framing promoted to `mvp_supported`. |
| **F4** | Envelope completion | Insulation auto-populate (by assembly), flooring auto-populate (by room area + finish schedule). |
| **F5** | Concrete + sitework | Foundation-plan parsing, slab-area extraction, footing schedules. |
| **F6** | MEP | E/P/M sheet parsing, schedule extraction, discipline-specific symbol recognition. Electrical, plumbing, HVAC promoted to `mvp_supported`. |
| **F7** | Spec-book deep parsing | CSI division + section text extraction driving spec-derived material substitutions and review flags. |
| **F8** | Multi-structure projects | Per-building decomposition, per-structure accepted trades, consolidated estimate roll-up. |

Promotion of any future-phase trade to `mvp_supported` requires amendments to `blueprint-trade-catalog.md` (§3, §4) and `blueprint-estimate-mapping-contract.md` (§8), plus regression coverage.

---

## 5. Acceptance criteria (Phase 3 MVP)

The MVP is considered shipped when **all** of the following hold:

1. Upload of a Roofr roof report + EagleView wall report on the same project yields detected trades for `roofing`, `exterior_walls_siding`, `paint_coatings`, `gutters_fascia_trim`, and a `windows_doors` measurement object — each with non-empty source provenance.
2. User can accept each `mvp_supported` trade and see its required-input checklist with green/red status.
3. Selecting a tenant `active` assembly template + clicking "Populate Material List" produces a deterministic, fully-provenanced material list with no silent defaults.
4. Clicking "Generate Labor Pricing" produces a deterministic labor list with complexity multipliers applied per template, again with full PlanPath.
5. All review flags from `blueprint-trade-catalog.md` §3 surface correctly on missing inputs and block the appropriate actions per `blueprint-estimate-mapping-contract.md` §6.
6. Pushing to CRM creates real rows in `estimates` + `estimate_line_items`, preserves `source_plan_path`, freezes the AcceptedTrade, and round-trips intact.
7. Determinism invariant: re-running the generator with identical inputs produces byte-identical output.
8. Provenance invariant: every generated line item has a non-empty PlanPath that includes at least one `source_document` step and one `rule_evaluated` step.
9. No `future_supported` trade can be auto-populated through any UI path.
10. All work routes through existing `document-worker` and `*-api` grouped functions — no new standalone edge functions (architecture guard).

---

## 6. Implementation gaps (today)

The following gaps exist between the current repo and the Phase 1 starting line. They are listed for the Phase 1 author, not for Phase 0 resolution.

- **No `importer_*` tables.** Existing tables (`documents`, `document_extractions`, `plan_documents`, `plan_parse_jobs`) cover ingestion but not the trade/measurement/template/rule/PlanPath object model in the estimate-mapping contract.
- **No `_shared/importer/` directory.** Shared TS types and validation helpers must be created in Phase 1.
- **No `source_plan_path` column on `estimate_line_items`.** Phase 7 prerequisite — schema change scoped in Phase 1.
- **Existing parsers** (`_shared/parsers/eagleview-roof.ts`, `_shared/parsers/roofr-roof.ts`) emit a roof-report-shaped envelope but **not** typed `TradeMeasurement` objects with provenance. Phase 3 must adapt their output, not rewrite them.
- **EagleView wall-report parser** is not shipped. Phase 3 prerequisite (or Phase 2 if the work falls naturally there).
- **Tenant assembly-template UI** does not exist. Phase 4 must build minimal CRUD; a stopgap of seeded templates per tenant is acceptable for Phase 3 internal testing only.
- **No deterministic rule evaluator.** Phase 4 prerequisite — pure server-side, no AI.
- **Tenant material catalog** exists in some form for the existing estimate engine; Phase 4 must reuse it via `catalog_item_id` and never invent items.
- **Review-flag UI** does not exist. Phase 6 prerequisite.
- **Architecture guard:** any new backend work must route through `document-worker` (parsing/extraction) or a new `/importer` route group inside an existing `*-api` function. **Do not create new standalone edge functions.**

---

## 7. Stop conditions

Implementation MUST stop and request approval if any of the following occur:

- A request would add a `future_supported` trade to the MVP auto-populate path.
- A request would create a new standalone Supabase edge function instead of routing through an existing grouped function.
- A request would introduce AI into the material/labor math path.
- A request would skip provenance (PlanPath) on any generated line item.
- A request would silently default a critical input (waste factor, brand, finish level, wall height, gutter profile, paint coats) without emitting a review flag.
- A request would overwrite or delete a pushed AcceptedTrade or its PlanPath.

Each of these violates a contract above and cannot be resolved by the implementing phase alone.

---

## 8. Out of scope of this document

- DB column definitions (Phase 1).
- Endpoint signatures and request/response shapes (Phase 2).
- UI wireframes (Phase 6).
- Pricing strategy, margin policy, or tenant-specific labor rates.
- Vendor parser implementation details (already shipped or scoped in their own docs).
