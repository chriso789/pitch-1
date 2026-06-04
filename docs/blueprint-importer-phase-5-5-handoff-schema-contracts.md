# Blueprint Importer v2 — Phase 5.5: CRM Handoff Schema + Contracts

**Status:** Schema + contracts shipped. No runtime wiring, no preview implementation, no live CRM estimate writes, no UI changes. Companion to Phase 5 docs.

Pre-Phase-5.5 reads (re-verified):

- `docs/blueprint-importer-phase-5-crm-handoff-contract.md`
- `docs/blueprint-crm-estimate-integration-inventory.md`
- `docs/blueprint-crm-handoff-review-gates.md`
- `docs/blueprint-importer-phase-4-draft-generation.md`
- `docs/blueprint-importer-phase-3-runtime-detection.md`
- `docs/blueprint-estimate-mapping-contract.md`
- `docs/blueprint-mvp-phase-plan.md`
- Existing CRM/estimate routes: `generate-estimate-from-measurement`, `update-estimate-line-items`, `excel-style-estimate-calculator`, `generate-proposal`
- Existing `enhanced_estimates`, `estimates`, `estimate_line_items`, `proposal_tier_items`, `materials`, `labor_rates` schemas
- Existing tenant/RLS pattern via `public.get_user_tenant_id()` (used by all Phase 1 blueprint tables)

---

## 1. Scope

Allowed (this phase):

- DB migration adding three staging/provenance tables.
- Shared TypeScript contracts (`crm-handoff.ts`).
- Shared Python contracts (`crm_handoff.py`).
- JSON schemas + contract examples.
- Doc updates (this file + Phase plan line).

Explicit non-goals:

- No runtime handoff implementation, no preview route, no Push-to-Estimate.
- No live `estimates` / `enhanced_estimates` / `estimate_line_items` writes.
- No proposal / work-order / purchase-order / production-task writes.
- No final pricing implementation, no catalog wiring implementation.
- No UI changes, no document-worker route changes, no worker changes.
- No new standalone edge functions.
- Phase 6 NOT started.

---

## 2. Canonical CRM estimate header target — decision

**Selected: `public.enhanced_estimates`.**

### Evidence

| Source | Reads / writes | Notes |
|---|---|---|
| `supabase/functions/update-estimate-line-items/index.ts` | `enhanced_estimates` (rows 98, 250) | Active engine-standard recalculator. |
| `supabase/functions/excel-style-estimate-calculator/index.ts` | `enhanced_estimates` (row 192) | Server-side calc surface. |
| `public.enhanced_estimates` schema | Tier-aware (good/better/best), `calculation_metadata` jsonb, `measurement_report_id`, `signature_envelope_id`, `material_cost_locked_at`, `pricing_tier` | Carries the surface area a blueprint handoff needs. |
| `public.estimates` schema | Legacy — no tier, no `measurement_report_id`, sparse calculation metadata | Still has writers, but not the tier-aware/measurement-aware path. |

### Rejected alternative

`public.estimates`. Rejected because it lacks tier, measurement linkage, and the active engine-standard recalculator now lives on `enhanced_estimates`. Targeting `estimates` from a blueprint handoff would either bypass the active flow or require an adapter on top of a legacy header.

### Why not "adapter required"

The two recent estimate edge functions (`update-estimate-line-items`, `excel-style-estimate-calculator`) both target `enhanced_estimates` exclusively. There is no evidence of a current dual-target adapter in the active flow. Phase 5.5 commits to `enhanced_estimates` and locks it with a CHECK constraint on `canonical_estimate_target_table`. If a future phase needs to support `estimates` as well, that requires a contract amendment + migration loosening the CHECK — not a runtime guess.

### Migration impact

- New tables only. `enhanced_estimates`, `estimates`, `estimate_line_items` are NOT altered.
- A bridge table (`blueprint_estimate_line_provenance`) is preferred over adding `blueprint_*` columns to `estimate_line_items` (see §4).

### Phase 6 impact

Phase 6 may now build preview generation that writes to `blueprint_estimate_handoff_batches` and `blueprint_estimate_line_candidates` only. No live writes.

---

## 3. Schema created (Phase 5.5)

Migration: `supabase/migrations/<timestamp>_blueprint-phase-5-5-handoff-schema.sql` (applied).

| Table | Purpose | Inserted by runtime? |
|---|---|---|
| `public.blueprint_estimate_handoff_batches` | One staged handoff attempt per import session. | **No (Phase 5.5).** Phase 6 will populate. |
| `public.blueprint_estimate_line_candidates` | Preview rows derived from Phase 4 draft material/labor lines. | **No.** Phase 6 will populate. |
| `public.blueprint_estimate_line_provenance` | Bridge from staged candidates to future live estimate line items. `live_estimate_line_item_id` stays null until Phase 7. | **No.** Phase 7 will populate. |

### DB-level invariants enforced

- Tenant scoping: every row carries `tenant_id`; RLS via `public.get_user_tenant_id()`.
- `windows_doors` cannot be a standalone candidate trade (`CHECK trade_id <> 'windows_doors'`).
- Candidates require `plan_path_ids` and `source_measurement_ids` non-empty.
- `(tenant_id, deterministic_batch_key)` unique on batches.
- `(tenant_id, deterministic_handoff_key)` unique on candidates AND on provenance bridge.
- `canonical_estimate_target_table` is constrained to `enhanced_estimates` only.
- Status / pricing-mode / catalog-mode / custom-line-mode / pricing-status / cost-status / user-review-status / draft-line-type are CHECK-constrained.
- Indexes on tenant, session, batch, candidate, status, deterministic keys, target context, and live line for Phase 7 lookup.

### `estimate_line_items` NOT altered

Decision: **bridge table chosen over additive columns.**

Reasons:

1. `estimate_line_items` is shared by every existing estimate-writing path; adding nullable `blueprint_*` columns introduces a surface that legacy writers must intentionally ignore.
2. A bridge table preserves full provenance (formula key, formula inputs, draft-line type, measurement ids, plan paths, source documents) without polluting `estimate_line_items`.
3. Idempotency is enforceable on the bridge via `(tenant_id, deterministic_handoff_key)` unique — no risk of partial migrations of the live line-item table.
4. If a future phase decides additive columns are also needed for query-by-line ergonomics, that can layer on top of the bridge without rework.

---

## 4. Provenance strategy

Per live line that Phase 7 eventually writes, the bridge row carries:

- `import_session_id`, `accepted_trade_id`, `template_binding_id`
- `source_draft_line_id` + `source_draft_line_type`
- `source_measurement_ids`, `plan_path_ids`, `source_document_ids`
- `formula_key`, `formula_inputs`
- `approved_by`, `approved_at` (user approval at handoff)
- `live_written_by`, `live_written_at`, `live_estimate_line_item_id` (Phase 7 only)

Live `estimate_line_items` rows produced by a blueprint handoff are joinable to provenance via:

```sql
SELECT eli.*, prov.*
FROM enhanced_estimates ee
JOIN estimate_line_items eli ON eli.estimate_id = ee.id
JOIN blueprint_estimate_line_provenance prov
  ON prov.live_estimate_line_item_id = eli.id
 AND prov.tenant_id = eli.tenant_id;
```

---

## 5. Idempotency strategy

Per the Phase 5 contract §9.1, the deterministic handoff key inputs are fixed:

```
sha256(
  tenant_id : import_session_id : accepted_trade_id : template_binding_id :
  draft_line_id : draft_line_type : formula_key :
  canonical_decimal(quantity) : unit :
  sorted_uuid_hash(source_measurement_ids) :
  sorted_uuid_hash(plan_path_ids) :
  template_version : canonical_json_hash(user_assumptions)
)
```

Phase 5.5 implementations:

- TS: `createDeterministicHandoffKey()` / `createDeterministicBatchKey()` in `supabase/functions/_shared/blueprint-importer/crm-handoff.ts`. SHA-256 via `crypto.subtle`.
- Python: `create_deterministic_handoff_key()` / `create_deterministic_batch_key()` in `worker/app/blueprint_contracts/crm_handoff.py`. SHA-256 via `hashlib`.
- DB: `UNIQUE(tenant_id, deterministic_handoff_key)` on candidates AND provenance bridge.

Phase 6 must upsert by `(tenant_id, deterministic_handoff_key)` — never plain insert. Phase 7 must respect the same key when writing the live line and the bridge row.

---

## 6. Catalog gate strategy

Defaults shipped:

- `catalog_mode = 'preview_only'` on every new batch.
- `custom_line_mode = 'disabled'`.
- Candidates default `catalog_resolution_status = 'unresolved'`, `handoff_allowed = false`.

`validateCandidateCatalogGate()` returns `CATALOG_UNRESOLVED_LIVE_HANDOFF` for `preview_only` and `catalog_resolved_only` modes unless the candidate is `matched` / `manual_override`. `user_approved_custom_lines` mode additionally requires per-candidate user approval (`CUSTOM_LINE_WITHOUT_USER_APPROVAL` otherwise).

---

## 7. Pricing boundary retained from Phase 5

Unchanged. Phase 5.5 does NOT calculate price. The DB and contracts allow `pricing_status = 'quantity_only'` as the default. No unit cost, labor rate, margin, markup, tax, or discount is invented anywhere in Phase 5.5.

---

## 8. RLS / security notes

- All three tables have RLS enabled with `FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (...)`.
- `GRANT SELECT, INSERT, UPDATE, DELETE` to `authenticated`; `GRANT ALL` to `service_role`. Anon NOT granted — matches Phase 1 pattern.
- Service-role writers (Phase 6/7) MUST add explicit `.eq('tenant_id', resolvedTenantId)` per the tenant-isolation rule. RLS is the second line of defense, not the first.
- `tenant_id` MUST be resolved from JWT + membership, never from request body.
- Updated_at triggers wired via `public.update_updated_at_column`.

---

## 9. Files created (Phase 5.5)

### Migration

- `supabase/migrations/<ts>_blueprint-phase-5-5-handoff-schema.sql` (applied)

### Shared TypeScript

- `supabase/functions/_shared/blueprint-importer/crm-handoff.ts`
- Barrel updated: `supabase/functions/_shared/blueprint-importer/index.ts`

### Shared Python

- `worker/app/blueprint_contracts/crm_handoff.py`
- Twin registered in `worker/app/blueprint_contracts/__init__.py` (NOT in `skills_registry.py`; NOT in `worker/app/main.py`)

### JSON schemas

- `docs/schemas/blueprint-importer/blueprint-estimate-handoff-batch.schema.json`
- `docs/schemas/blueprint-importer/blueprint-estimate-line-candidate.schema.json`
- `docs/schemas/blueprint-importer/blueprint-estimate-line-provenance.schema.json`

### Examples

- `docs/examples/blueprint-importer/crm-handoff/README.md`
- `docs/examples/blueprint-importer/crm-handoff/handoff-batch-preview-only.example.json`
- `docs/examples/blueprint-importer/crm-handoff/roofing-material-line-candidate.example.json`
- `docs/examples/blueprint-importer/crm-handoff/roofing-labor-line-candidate.example.json`
- `docs/examples/blueprint-importer/crm-handoff/siding-material-line-candidate.example.json`
- `docs/examples/blueprint-importer/crm-handoff/paint-blocked-candidate.example.json`
- `docs/examples/blueprint-importer/crm-handoff/unresolved-catalog-blocked-candidate.example.json`
- `docs/examples/blueprint-importer/crm-handoff/estimate-line-provenance-bridge.example.json`
- `docs/examples/blueprint-importer/crm-handoff/duplicate-handoff-key-block.example.json`

---

## 10. What remains intentionally unwired

- No edge function reads or writes these three tables.
- No worker route references the Python contracts.
- No frontend reads from these tables.
- No `estimates` / `enhanced_estimates` / `estimate_line_items` / proposal rows reference these tables yet.
- `assertCandidateCanLiveWrite()` exists in TS but is NOT called by any runtime.

---

## 11. What Phase 6 may do

- Build preview-generation route inside `document-worker` (`/blueprint-importer/v2/handoff-preview` and friends).
- Compute deterministic keys via the shipped helpers.
- Upsert into `blueprint_estimate_handoff_batches` and `blueprint_estimate_line_candidates`.
- Run review-gate validators; set `handoff_allowed`, `handoff_blockers`, `status`.
- Surface preview UI (separate Phase 6 UI sub-task).
- MUST NOT write to `estimates` / `enhanced_estimates` / `estimate_line_items` / `proposal_tier_items`.

## 12. What Phase 7 may do (only after Phase 6 ships and is reviewed)

- Implement live write into `enhanced_estimates` + `estimate_line_items` via a server-side route, with per-line user approval.
- Insert one `blueprint_estimate_line_provenance` row per written line.
- Maintain `(tenant_id, deterministic_handoff_key)` uniqueness across runs.
- Honor existing engine standards: recalc `line_total` on qty/cost change; never overwrite `selling_price` with margin calc.

---

## 13. Implementation gaps surfaced (for Phase 6/7)

- Catalog resolver from free-text item name → `materials.id` does NOT exist. Phase 6/7 must require explicit user mapping until a resolver lands.
- Labor rate resolver from trade + draft labor key → `labor_rates.id` does NOT exist. Phase 6/7 must require `job_type` + `skill_level` + `location_zone` to be user-confirmed.
- No "draft" status exists upstream of `enhanced_estimates.status='draft'`. Phase 6 staging surface is the staging layer; Phase 7 promotes to a live `draft` estimate header.
- No audit table dedicated to importer→estimate transitions. Phase 6/7 must use `_shared/audit.ts` with `event_type='blueprint_handoff_*'`, OR a follow-up Phase 5.6 may add a dedicated `blueprint_handoff_events` table.

---

## 14. Stop conditions

Phase 5.5 stops here. Phase 6 must NOT start until this is reviewed.

If during Phase 6 implementation any of the following occur, stop and request approval:

- A request would write to `estimates` / `enhanced_estimates` / `estimate_line_items` / proposal rows.
- A request would skip the deterministic key.
- A request would skip RLS / tenant filter.
- A request would invent unit cost / labor rate / margin / markup / tax.
- A request would allow `windows_doors` as a standalone candidate.
- A request would promote `future_supported` trades into a candidate.

---

## 15. Verification checklist

- [x] Phase 5 docs re-read.
- [x] Existing estimate model re-inspected; canonical target selected: `enhanced_estimates`.
- [x] Migration created and applied.
- [x] Three new tables created, RLS enabled, tenant-scoped policies, GRANTs to authenticated + service_role.
- [x] `estimate_line_items` NOT altered.
- [x] Shared TS contracts created and barrel-exported.
- [x] Shared Python contracts created and registered in `blueprint_contracts/__init__.py` (NOT in skills_registry / main).
- [x] Three JSON schemas created with min-length on uuid arrays + windows_doors forbidden on candidate `trade_id`.
- [x] Eight example files created and marked as contract-only.
- [x] Enum parity verified across DB CHECK / TS / Python / JSON schema.
- [x] No edge function runtime, worker, or UI changes.
- [x] `NOTIFY pgrst, 'reload schema';` emitted at end of migration.
- [x] No live CRM estimate writes.

---

## 16. Recommended next phase

**Phase 6 — Handoff preview implementation only.** Must remain server-side preview (no live estimate writes). UI sub-task may follow Phase 6 backend approval.
