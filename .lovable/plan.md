## Phase 3 — Blueprint Importer Runtime Detection

**Scope lock:** deterministic parsing + trade detection + measurement extraction + PlanPath provenance + review flags + user acceptance UI. No materials, no labor, no CRM handoff, no new edge functions, no AI in math.

### Pre-flight verification
Re-read Phase 0–2 contracts and the applied migration. If anything is stale/contradictory, stop and report before writing code.
- `docs/blueprint-trade-catalog.md`
- `docs/blueprint-estimate-mapping-contract.md`
- `docs/blueprint-mvp-phase-plan.md`
- `docs/blueprint-importer-phase-1-schema-contracts.md`
- `docs/blueprint-importer-phase-2-db-verification.md`
- `supabase/functions/_shared/blueprint-importer/index.ts`
- `worker/app/blueprint_contracts/__init__.py`
- The applied `supabase/migrations/2026...blueprint-importer-v2-phase1.sql`

### Implementation (deterministic, no AI)

**A. Shared parser contracts** (`supabase/functions/_shared/blueprint-importer/`)
- `document-classifier.ts` — signal-based classifier → `roofr_roof_report | eagleview_roof_report | eagleview_wall_report | unknown`. Generic blueprint sets stored only as source docs with `future_trade_requires_sheet_intelligence` flag.
- `units.ts` — deterministic `ft-in → decimal ft`, `sq ft`, pitch `n/12` normalization. Preserve raw + normalized + unit.
- `parsers/roofr-roof.ts`, `parsers/eagleview-roof.ts`, `parsers/eagleview-wall.ts` — label-anchored regex extractors emitting `{ key, raw, normalized, unit, confidence, plan_path }` per field. Report-summary totals preferred over diagram-rounded labels. No invention of missing fields.
- `trade-detection.ts` — deterministic rules: roof report ⇒ `roofing` + `gutters_fascia_trim` when fascia/eave evidence; wall report ⇒ `exterior_walls_siding`, `paint_coatings` (derived), `gutters_fascia_trim`, `windows_doors` (measurement-only).
- `acceptance-gates.ts` — runtime enforcement of Phase 2 helper-only gaps: blocks `windows_doors` top-level, blocks `paint_coatings` without sibling `exterior_walls_siding`, blocks `future_supported` auto-acceptance, requires non-empty PlanPath before ready.
- `review-flag-codes.ts` — canonical set of Phase 3 flag codes.
- `session-hash.ts` — deterministic content hash; rerun supersedes per Phase 0 contract.

**B. Python parser twins** (`worker/app/blueprint_contracts/parsers/`) — mirror logic, side-effect-free. NOT registered in `skills_registry.py` or `main.py`.

**C. Runtime wiring (existing infra only)**
- Extend the existing `document-worker` grouped function with parse handlers that consume an uploaded report, run classifier → parser → writes to the 8 Phase-3 tables (`blueprint_import_sessions`, `blueprint_source_documents`, `blueprint_detected_trades`, `blueprint_plan_paths`, `blueprint_measurement_objects`, `blueprint_review_flags`, and on accept `blueprint_accepted_trades`). No writes to `blueprint_material_draft_lines` or `blueprint_labor_draft_lines`.
- Add an `acceptTrade` handler in the same function enforcing `acceptance-gates`.
- No standalone edge functions. No changes to geometry worker / measurement worker / roof export-report flows.

**D. UI** (`src/pages/BlueprintImporterV2.tsx` + `src/components/blueprint-importer/`)
- Import session summary card (source docs, detected provider/type, status, blocking flags).
- Detected trade cards with support badge, confidence, source doc, measurement preview, PlanPath chips, blocking flags.
- Accept button enabled only when allowed-MVP AND no blocking flags AND (paint ⇒ siding present).
- Disabled states for `windows_doors` (measurement-only), `future_supported` (locked), unsupported.
- Gated next-action buttons: "Populate Material List", "Generate Labor Pricing", "Push to Estimate" all disabled with tooltip "Not enabled until Phase 4." No draft-line tables surfaced.
- Wire into `src/integrations/blueprintApi.ts` via existing `edgeApi("document-worker", ...)` pattern.

**E. Tests** (`tests/blueprint-importer/`)
- Roofr roof parser: provider/type detection, area/facets/pitch/eaves/rakes/valleys/hips/ridges/waste, PlanPaths created, roofing detected.
- EagleView roof parser: same surface incl. penetrations + pitch table.
- EagleView wall parser: total area, with-W&D area, W&D area/count/perimeter, top/bottom walls, inside/outside corners, fascia, waste; review flags for field-verification / image obstruction / soffit assumption; detects siding, paint, gutters, windows-doors.
- Acceptance gates: roofing/siding/gutters acceptable; windows_doors blocked top-level; paint blocked without siding; future trades blocked; accept does NOT write material/labor lines.
- Determinism: same input ⇒ same normalized values + hash; rerun supersedes without duplicates.
- RLS smoke (if pattern supported in repo): tenant-scoped read/write.

**F. Docs**
- New: `docs/blueprint-importer-phase-3-runtime-detection.md` (scope, files, parser architecture, supported types, measurement keys, PlanPath strategy, review flag strategy, acceptance workflow, disabled future actions, unwired surfaces, gaps, tests, verification checklist).
- Update only the Phase 3 status row in `docs/blueprint-mvp-phase-plan.md`.

### Hard stops (will not implement)
Material population · labor pricing · estimate/CRM handoff · drywall/framing/MEP · blueprint sheet intelligence (scale, sheet coords) · standalone edge functions · AI in math path · geometry/measurement worker changes · changes to roof export/report gating · Phase 4.

### Final verification report
Will produce the full yes/no checklist from your prompt (Phase 0–2 re-read, runtime added, parser types, tables written/not-written, endpoints/workers/UI deltas, all gate confirmations, tests added/passing, deviations, next phase recommendation).

### Notes / risks
- The grouped `document-worker` function is the only runtime surface that will gain new routes. I will document each added route.
- Real Roofr/EagleView PDF→text extraction lives in existing document-worker upstream; parsers consume already-extracted text. If text extraction for these report types is missing in the worker today, I will add a thin deterministic text-extraction step inside the same function (no new edge function), and document it.
- "Same parse ⇒ same hash" relies on stable text extraction; if upstream OCR is non-deterministic, hash will key on normalized parser output instead, and that decision will be documented.