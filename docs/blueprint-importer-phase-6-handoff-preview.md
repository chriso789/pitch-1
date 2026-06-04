# Blueprint Importer v2 — Phase 6: CRM Handoff Preview (Implementation)

**Status:** Phase 6 shipped. Preview-only. **NO live CRM estimate writes. NO `enhanced_estimates` / `estimate_line_items` / `proposal_tier_items` mutation. Push to Estimate intentionally disabled.**

Companion docs (re-read before this phase):

- `docs/blueprint-importer-phase-5-5-handoff-schema-contracts.md`
- `docs/blueprint-importer-phase-5-crm-handoff-contract.md`
- `docs/blueprint-crm-estimate-integration-inventory.md`
- `docs/blueprint-crm-handoff-review-gates.md`
- `docs/blueprint-importer-phase-4-draft-generation.md`
- `docs/blueprint-importer-phase-3-runtime-detection.md`
- `docs/blueprint-estimate-mapping-contract.md`
- `docs/blueprint-mvp-phase-plan.md`
- `supabase/functions/_shared/blueprint-importer/crm-handoff.ts`
- `worker/app/blueprint_contracts/crm_handoff.py`

---

## 1. Scope

Phase 6 answers one question only: **"What would be pushed to the CRM estimate, and what blocks it?"** It does not push anything.

In scope:

- Pure preview-builder module `_shared/blueprint-importer/phase6-preview.ts`.
- Three new `document-worker` routes under the existing `blueprint-importer/v2` route family.
- UI panel inside `src/pages/BlueprintImporterV2.tsx`.
- Preview-only writes to `blueprint_estimate_handoff_batches` and `blueprint_estimate_line_candidates`.
- Phase 6 unit tests (`tests/blueprint-importer/phase6.test.ts`).

Explicit non-goals (still blocked):

- Push to Estimate.
- Any write to `enhanced_estimates` / `estimate_line_items` / `proposal_tier_items`.
- Any write to proposal / work-order / purchase-order / production-task tables.
- Final pricing, margin, tax, discount, markup.
- Catalog wiring / resolver implementation.
- Catalog item or labor-rate mutation.
- Custom non-catalog line approval implementation.
- `blueprint_estimate_line_provenance` writes (Phase 7 only).
- DB migrations.
- New standalone edge functions.
- Worker / Python changes.
- Geometry / OCR / drywall / framing / MEP.

---

## 2. Canonical target

`canonical_estimate_target_table = 'enhanced_estimates'` is enforced by the Phase 5.5 DB CHECK and reaffirmed in the preview-batch insert path. Legacy `public.estimates` is **rejected**.

---

## 3. Routes added

All three routes are inside the existing `document-worker` grouped function (architecture guard — no new standalone functions).

| Route | Purpose |
|---|---|
| `POST /blueprint-importer/v2/handoff-preview` | Create/refresh a preview batch + candidates. Idempotent on `(tenant_id, deterministic_batch_key)`. |
| `POST /blueprint-importer/v2/handoff-preview/get` | Fetch a batch + its candidates + target estimate context (read-only). Accepts either `handoff_batch_id` or `import_session_id`. |
| `POST /blueprint-importer/v2/handoff-preview/review` | Preview-only candidate review (`pending` / `reviewed` / `excluded`). Rejects `approved` — Phase 7 owns the live-handoff approval gate. |

Auth mode: **authenticated tenant route** (`requireAuth` + `requireTenant`).

---

## 4. Tables written by Phase 6

| Table | Writes |
|---|---|
| `blueprint_estimate_handoff_batches` | INSERT / supersede non-terminal prior batches for the same session; UPDATE batch status after candidates are built. |
| `blueprint_estimate_line_candidates` | UPSERT on `(tenant_id, deterministic_handoff_key)`. |

## 5. Tables intentionally **not** written

- `enhanced_estimates`
- `estimate_line_items`
- `proposal_tier_items`
- `proposals` and all proposal-related tables
- `work_orders` / `purchase_orders` / production task tables
- `invoices`
- `blueprint_estimate_line_provenance` — Phase 7 only

`blueprint_estimate_line_provenance` write status: **NO** — the Phase 5.5 contract states "Phase 7 will populate" and the bridge row is the proof-of-live-write. Writing it in Phase 6 would lie about live status.

---

## 6. Candidate generation strategy

Source rows (all `.neq('status', 'superseded')`):

- `blueprint_material_draft_lines`
- `blueprint_labor_draft_lines`

Each surviving draft becomes one row in `blueprint_estimate_line_candidates`. The Phase 5/5.5 contract is enforced per draft:

- `source_measurement_ids` and `plan_path_ids` must be non-empty → drafts that fail this are **skipped** (not persisted; surfaced in `skipped` summary) because the DB constraint forbids insertion.
- `windows_doors` candidates are **skipped** (DB CHECK + contract).
- `future_supported` trades are skipped.
- Catalog `unresolved` candidates are persisted with `handoff_allowed = false` and blocker `CATALOG_UNRESOLVED_LIVE_HANDOFF` — they remain visible in preview but cannot be live-handed-off.
- `paint_coatings` without a wall/siding source produces `PAINT_WITHOUT_SIDING_SOURCE`.
- Missing quantity / unit produces `MISSING_QUANTITY` / `MISSING_UNIT`.

Each candidate carries:

- `source_measurement_ids`, `plan_path_ids`, `source_document_ids` (derived from PlanPath `source_document_id`).
- `formula_key`, `formula_inputs`.
- `catalog_resolution_status`, `pricing_status`, `cost_status`.
- `handoff_allowed`, `handoff_blockers`, `blocking_review_flag_ids`, `warning_review_flag_ids`.
- `deterministic_handoff_key` via `createDeterministicHandoffKey()`.
- `provenance_summary` via `summarizeCandidateProvenance()`.
- `metadata.live_handoff_not_enabled_phase_6 = true`, `metadata.custom_line_mode_not_enabled_phase_6 = true`, `metadata.warning_codes`.
- `status` in `preview` / `user_review_required` / `blocked`.

---

## 7. Blocker / warning evaluation

Built on top of Phase 5.5 `validateCandidateCatalogGate` plus a mapping of existing `blueprint_review_flags.flag_code` to Phase 5/5.5 `HandoffBlockerCode` / `HandoffWarningCode`. Per-candidate flag resolution looks at flags scoped to:

- `material_draft_line` / `labor_draft_line` (by draft id)
- `template_binding` (by binding id)
- `accepted_trade` (by accepted id)

Warnings (e.g. `WALL_IMAGE_OBSTRUCTION`, `ROOF_PENETRATION_FIELD_VERIFY`, `WALL_SOFFIT_ASSUMPTION`) propagate to the candidate but do not block.

---

## 8. Pricing / catalog handling

- `pricing_mode` defaults to `quantity_only`. No final pricing math anywhere.
- `catalog_mode` defaults to `preview_only`. `user_approved_custom_lines` is explicitly rejected at the route boundary in Phase 6 (`phase_6_custom_line_disabled`).
- `custom_line_mode` is forced to `disabled` regardless of body.
- Labor candidates always get `pricing_status = labor_rate_missing`, `cost_status = unavailable` — labor rate resolution is deferred.
- Matched catalog material candidates get `cost_status = available_from_catalog`, `pricing_status = catalog_resolved_cost_missing` (or `ready_for_pricing_review` when explicitly requested) — but Phase 6 never reads or asserts an actual cost value.

---

## 9. `enhanced_estimates` target validation

If `canonical_estimate_target_id` is supplied:

- Read-only `SELECT id,tenant_id,status` against `enhanced_estimates`.
- Tenant mismatch → 403 `target_estimate_tenant_mismatch`.
- Not found → 404 `target_estimate_missing`.
- Otherwise the estimate metadata is echoed back via `/handoff-preview/get` as `target_estimate`.

No write, no update to `calculation_metadata`, no tier change.

---

## 10. Idempotency

Deterministic batch key (Phase 5.5 contract):

```
sha256(tenant_id : import_session_id : target_context_type : target_context_id :
       canonical_estimate_target_table : canonical_estimate_target_id :
       pricing_mode : catalog_mode : custom_line_mode : source_draft_hash)
```

- Same inputs → same batch key → `INSERT … ON CONFLICT` semantics via prior-row lookup.
- Different inputs → prior non-terminal batches for the session are marked `superseded`.
- Candidates upserted on `(tenant_id, deterministic_handoff_key)` per the 5.5 unique constraint.
- User review state (`user_review_status`) is preserved across re-runs unless the candidate is superseded.

---

## 11. UI

`src/pages/BlueprintImporterV2.tsx` gains a `Phase6Panel`:

- Target `enhanced_estimates` ID input (read-only validation only).
- Draft-mode select (`material` / `labor` / `both`).
- Trade-include chips (empty = all accepted MVP trades).
- `Create handoff preview` button.
- Disabled buttons (always show tooltip explaining why):
  - `Push to Estimate` — "Push to Estimate is disabled until Phase 7 live handoff is approved."
  - `Final pricing`, `Catalog mapping`, `Approve custom line` — all disabled in Phase 6.
- Preview batch card: status badge, deterministic key, target estimate context.
- Candidate table: trade/item, type, qty/unit, catalog status, pricing status, handoff allowed, blockers + warnings, per-line review select (`pending` / `reviewed` / `excluded`).

---

## 12. No-live-write guarantees

Verified in code review:

- Routes never touch `enhanced_estimates`, `estimate_line_items`, `proposal_tier_items`, `proposals`, work-order / PO / production / invoice tables.
- Routes never touch `blueprint_estimate_line_provenance`.
- Service-role queries always include `.eq('tenant_id', tenantId)` (per the tenant-isolation rule).
- `tenant_id` resolved from JWT via `requireTenant` — never from the body.

---

## 13. Test coverage

`tests/blueprint-importer/phase6.test.ts` — 17 deterministic tests:

- Canonical target enforcement.
- Batch key determinism.
- Material draft → candidate with provenance + deterministic key.
- Catalog unresolved blocks handoff while keeping preview visible.
- Catalog matched + `catalog_resolved_only` mode → `handoff_allowed = true`.
- Windows/doors skipped.
- Future-supported trade skipped.
- Missing plan paths / measurements → skipped.
- Superseded drafts ignored.
- Paint without wall source blocked.
- Blocking flag propagates from `material_draft_line`.
- Warning flag propagates without blocking; `warning_codes` recorded in metadata.
- Labor draft → labor candidate with `labor_rate_missing` pricing.
- Idempotent deterministic handoff key.
- `allowed_accepted_trade_ids` filters.
- Empty preview → `preview_created`.
- `user_review_status` always defaults to `pending`.

---

## 14. Implementation gaps / honest deviations

- `source_draft_hash` is not yet supplied to the batch-key builder; preview re-runs after Phase 4 regeneration will still get a fresh key because candidate-level deterministic keys change. Surfacing a session-wide source-draft hash is deferred.
- `TARGET_ESTIMATE_LOCKED` is currently checked only as a passive read of the target's `status` — the existing `estimates.status` enum semantics for "locked / approved / sent / signed" are not enumerated in Phase 6 (per non-goal: do not modify CRM enums). Phase 7 must add the explicit gate before any live write.
- `EXISTING_LINE_AT_KEY_NEEDS_DECISION` is not evaluated in Phase 6 because no live `estimate_line_items` row can yet carry the deterministic key — Phase 7 must add the column or linking table referenced in the Phase 5 inventory.
- Bulk-review flag aggregates (`MATERIAL_POPULATION_BLOCKED_BY_REVIEW` / `LABOR_GENERATION_BLOCKED_BY_REVIEW`) are not separately translated; the individual blocker codes already explain the failure.

---

## 15. Stop conditions

Phase 6 stops here. Phase 7 must NOT start until this is reviewed.

If during any follow-up work the following occur, stop and request approval:

- A request would write to `enhanced_estimates` / `estimate_line_items` / `proposal_tier_items`.
- A request would write to `blueprint_estimate_line_provenance` (Phase 7-only).
- A request would enable `Push to Estimate`.
- A request would invent unit cost, labor rate, margin, markup, tax, or discount.
- A request would allow `user_approved_custom_lines` without a Phase 7 contract addition.
- A request would skip the deterministic key.

---

## 16. Verification checklist

- [x] Phase 5.5 docs re-read.
- [x] Canonical target used: `enhanced_estimates`.
- [x] Handoff preview implemented: yes.
- [x] Routes added: `POST /blueprint-importer/v2/handoff-preview`, `…/get`, `…/review`.
- [x] Tables written by Phase 6: `blueprint_estimate_handoff_batches`, `blueprint_estimate_line_candidates`.
- [x] Tables intentionally not written: `enhanced_estimates`, `estimate_line_items`, `proposal_tier_items`, proposal tables, work-order tables, purchase-order tables, production-task tables, `blueprint_estimate_line_provenance`.
- [x] `blueprint_estimate_line_provenance` written: no — Phase 7 only.
- [x] Live CRM estimate writes: no.
- [x] Final pricing added: no.
- [x] Catalog wiring added: no.
- [x] Custom-line approval added: no.
- [x] Push to Estimate enabled: no — UI disabled with explicit tooltip; route does not exist.
- [x] UI changed: `src/pages/BlueprintImporterV2.tsx` (Phase6Panel + CandidateTable); `src/integrations/blueprintImporterV2Api.ts` (helpers).
- [x] Worker behavior changed: no.
- [x] New standalone edge functions: no.
- [x] Candidate `source_measurement_ids` enforced: yes (DB CHECK + builder gate).
- [x] Candidate `plan_path_ids` enforced: yes (DB CHECK + builder gate).
- [x] Windows/doors blocked as standalone candidate: yes.
- [x] Future trades blocked: yes.
- [x] Catalog unresolved blocks live handoff: yes (`handoff_allowed = false`).
- [x] Pricing unresolved visible: yes (`pricing_status` surfaced per candidate).
- [x] Idempotency verified: deterministic batch + handoff keys; upsert by unique key.
- [x] Tests added: 17 in `tests/blueprint-importer/phase6.test.ts`.
- [x] Tests passing: 17/17.

---

## 17. Recommended next phase

**Phase 7 — CRM live handoff contract + approval (not implementation).** A Phase 7 contract doc must precede any live `enhanced_estimates` / `estimate_line_items` write, and must define:

- The `TARGET_ESTIMATE_LOCKED` enum mapping.
- The `EXISTING_LINE_AT_KEY_NEEDS_DECISION` resolution policy (skip / update / version).
- The provenance bridge write rule (`blueprint_estimate_line_provenance`).
- The user-approval gate (`user_review_status = 'approved'` → batch `live_write_requested`).
- The catalog-resolver requirement (no live write while `catalog_resolution_status` is `unresolved`).
