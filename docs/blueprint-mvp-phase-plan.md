# Blueprint Importer v2 — MVP Phase Plan

**Status:** Phase 0 contract doc. No DB, no code, no endpoint behavior changes.
**Scope:** Locks the phase sequence, the MVP cut, explicit non-goals, acceptance criteria, and current implementation gaps. Companion to `blueprint-trade-catalog.md` and `blueprint-estimate-mapping-contract.md`.

> **Progress (as of Phase 2):**
> - Phase 0 (contract docs): **complete**
> - Phase 1 (schema draft + shared TS/Python contracts + JSON schemas + examples): **complete** — see `docs/blueprint-importer-phase-1-schema-contracts.md`
> - Phase 2 (schema promotion + DB verification): **complete** — see `docs/blueprint-importer-phase-2-db-verification.md`
> - Phase 3 (detection / parsing / acceptance / draft generation / UI): **not started — awaiting approval**

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
