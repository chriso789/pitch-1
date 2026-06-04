# Blueprint Importer v2 — Phase 5: CRM Estimate Handoff Contract

**Status:** Docs only. No code, no DB migration, no endpoint change, no worker change, no UI change, no new shared TS/Python contracts, no new edge functions. **No CRM estimate writes, no live estimate line writes, no proposal/work-order/PO/production-task writes.** Phase 5 defines the contract by which Phase 4 draft rows may later become CRM estimate candidates and, eventually, live estimate lines — without leaking unresolved catalog, pricing, or provenance issues into customer-facing estimates.

Companion documents:

- `blueprint-crm-estimate-integration-inventory.md` — what exists today.
- `blueprint-crm-handoff-review-gates.md` — the blocker/warning gate matrices referenced from this contract.

Pre-Phase-5 reads (verified — see Final Verification Report at the bottom):

- `docs/blueprint-trade-catalog.md`
- `docs/blueprint-estimate-mapping-contract.md`
- `docs/blueprint-mvp-phase-plan.md`
- `docs/blueprint-importer-phase-1-schema-contracts.md`
- `docs/blueprint-importer-phase-2-db-verification.md`
- `docs/blueprint-importer-phase-3-runtime-detection.md`
- `docs/blueprint-importer-phase-4-draft-generation.md`
- Phase 3 + Phase 4 `document-worker` blueprint-importer routes
- Phase 4 tests (`tests/blueprint-importer/phase4.test.ts`)
- Existing CRM/estimate/proposal/catalog/labor surfaces (per inventory doc)

---

## 1. Scope

In scope (this doc):

- Source-side ↔ target-side boundary contract.
- Handoff lifecycle states (documented, not implemented).
- Estimate-line-candidate object contract (documented, not implemented).
- Pricing boundary contract.
- Catalog-resolution handoff modes.
- Review-gate references (matrices live in `blueprint-crm-handoff-review-gates.md`).
- User approval contract (future UI; documented only).
- Idempotency and supersession contract.
- Provenance / audit contract.
- Recommended Phase 6 (preview) and Phase 7 (live write) plans.
- Tenant / RLS considerations.

Explicit non-goals:

- CRM estimate handoff implementation.
- "Push to Estimate" implementation.
- Live `estimates` / `estimate_line_items` writes.
- Proposal, work-order, purchase-order, production-task writes.
- Final pricing implementation.
- Catalog wiring implementation.
- Material / labor generation changes.
- New DB tables, columns, or migrations.
- New endpoints or route changes.
- New standalone edge functions.
- Any UI change.
- Starting Phase 6 work.

---

## 2. Source ↔ target boundary

### 2.1 Source side (Phase 1–4 deliverables — already shipped)

```
blueprint_import_sessions
  └── blueprint_source_documents
  └── blueprint_detected_trades
        └── blueprint_accepted_trades
              └── blueprint_template_bindings
                    ├── blueprint_material_draft_lines
                    └── blueprint_labor_draft_lines
  └── blueprint_measurement_objects
  └── blueprint_plan_paths
  └── blueprint_review_flags
```

Every source-side row is tenant-scoped, immutable in shape, and carries `plan_path_ids` + `source_measurement_ids` per Phases 1–4.

### 2.2 Target side (existing CRM / estimate surfaces)

Per `blueprint-crm-estimate-integration-inventory.md`:

- Two candidate header tables: `public.estimates` and `public.enhanced_estimates`.
- Normalized line table: `public.estimate_line_items`.
- Catalog wiring: `public.materials.id` (+ supplier SKU columns), `public.labor_rates.id`.
- Tier / proposal layer: `public.proposal_tier_items` (out of scope).

### 2.3 Boundary rule

> Phase 4 source-side rows are **draft inputs**. Target-side rows in `estimates` / `enhanced_estimates` / `estimate_line_items` are **live CRM artifacts**. The handoff is a one-way, **explicitly-user-approved**, **idempotent**, **fully-provenanced** transition from the former to the latter. There is no implicit handoff, no background handoff, no auto-handoff on draft generation, and no handoff at all during Phase 5.

If at Phase 6/7 the chosen header target lacks the columns required for provenance / idempotency / supersession, Phase 6/7 is **blocked** until a minimal schema migration (column or linking table — see §10.4) is approved.

---

## 3. Handoff lifecycle (documented only)

```text
draft_generated                       (Phase 4 — already shipped)
   │
   ▼
handoff_preview_requested             (Phase 6 future)
   │
   ▼
handoff_preview_created               (Phase 6 future — produces candidates, no live writes)
   │
   ▼
user_review_required                  (Phase 6 future — gates per blueprint-crm-handoff-review-gates.md)
   │
   ▼
user_approved_for_estimate            (Phase 6/7 boundary — explicit user action)
   │
   ▼
live_estimate_write_requested         (Phase 7 future)
   │
   ▼
live_estimate_written                 (Phase 7 future — terminal-success)
   │
   ├──► superseded                    (a newer generation re-runs the contract)
   ├──► failed                        (gates failed at write-time; audit + back to user_review_required)
   └──► cancelled                     (user abandoned)
```

Lifecycle invariants:

1. No state may be skipped.
2. `live_estimate_write_requested` is reachable **only** from `user_approved_for_estimate`.
3. `superseded`, `failed`, `cancelled` are non-destructive: they mark the candidate, never delete the live estimate line. Supersession of a live estimate line requires an additional explicit user approval (see §9.4).
4. Each transition writes one audit event (see §10).

---

## 4. Estimate line candidate contract

The future "estimate line candidate" object (Phase 6) is the **handoff envelope** between Phase 4 draft rows and Phase 7 live writes. It is a runtime object (or persisted staging row — Phase 6/7 decides). Phase 5 fixes its shape.

### 4.1 Required fields

| Field | Type | Source |
|---|---|---|
| `source_import_session_id` | uuid | `blueprint_import_sessions.id` |
| `source_accepted_trade_id` | uuid | `blueprint_accepted_trades.id` |
| `source_template_binding_id` | uuid | `blueprint_template_bindings.id` |
| `source_draft_line_id` | uuid | `blueprint_material_draft_lines.id` or `blueprint_labor_draft_lines.id` |
| `source_draft_line_type` | enum: `material` \| `labor` | from which Phase 4 table the row came |
| `trade_id` | string | from accepted trade |
| `item_key` | string | template item key (e.g. `shingles_3tab_bundle`, `labor_install_shingles_sq`) |
| `item_name` | string | human-readable |
| `description` | string \| null | template-rendered |
| `quantity` | numeric | Phase 4 generated quantity |
| `unit` | string | Phase 4 generated unit |
| `source_measurement_ids` | uuid[] (≥1) | from draft line |
| `plan_path_ids` | uuid[] (≥1) | from draft line |
| `formula_key` | string | Phase 4 formula identifier |
| `formula_inputs` | jsonb | Phase 4 input snapshot (waste %, coverage, etc.) |
| `source_document_ids` | uuid[] | from PlanPath roots |
| `catalog_resolution_status` | enum (§6) | initial: `unresolved` (Phase 4 default) |
| `catalog_item_id` | uuid \| null | `materials.id` or `labor_rates.id` when resolved |
| `pricing_status` | enum (§5.2) | initial: `quantity_only` |
| `cost_status` | enum: `not_attempted` \| `unavailable` \| `available_from_catalog` \| `available_from_user_override` | initial: `not_attempted` |
| `user_review_status` | enum: `pending` \| `reviewed` \| `approved` \| `excluded` | initial: `pending` |
| `blocking_review_flag_ids` | uuid[] | references `blueprint_review_flags.id` |
| `warning_review_flag_ids` | uuid[] | references `blueprint_review_flags.id` |
| `handoff_allowed` | boolean | derived from blockers (§7); `true` only when all blockers are empty/resolved |
| `handoff_blockers` | string[] | machine codes from gate matrix |
| `deterministic_handoff_key` | string | per §9.1 |
| `provenance_summary` | jsonb | short, human-readable provenance snapshot for audit/UI |

### 4.2 Hard rules

1. Every candidate **must** have ≥1 `source_measurement_id`.
2. Every candidate **must** have ≥1 `plan_path_id`.
3. Every candidate **must** map back to exactly one Phase 4 draft row.
4. No candidate may be treated as approved unless the user explicitly approves it.
5. No candidate may be converted into a live estimate line while any blocking review flag remains unresolved.
6. No candidate may hide unresolved catalog status (`catalog_resolution_status` must surface in any preview UI).
7. `handoff_allowed = true` is necessary but not sufficient — Phase 7 must additionally verify `user_review_status = 'approved'` at write time.

---

## 5. Pricing boundary contract

### 5.1 Hard rules

- Phase 5 does **not** calculate price.
- Phase 5 does **not** calculate final labor totals.
- Phase 6 (preview) may carry **quantity-only** lines.
- Phase 6 may carry **cost** fields only when an existing catalog/labor rule provides them (i.e., `materials.base_cost` or `labor_rates.base_rate_per_hour` for a resolved `catalog_item_id`).
- Phase 6/7 may **not** invent unit cost, labor rate, margin, markup, tax, or discounts.
- If catalog item is unresolved, the line is blocked from automatic live handoff unless the contract explicitly allows user-approved custom lines (§6 mode B).
- `labor_rates.base_rate_per_hour` is `null` (unresolved) unless a trusted labor rule / catalog source resolves it; complexity multipliers from Phase 4 templates do **not** become price multipliers until a future "pricing contract" is approved.
- The existing engine standard (recalculate `line_total` on qty/cost change; never overwrite `selling_price` with margin calc — per core memory) is honored by **not touching** those fields at all in Phase 5/6.

### 5.2 Pricing status enum

| Value | Meaning |
|---|---|
| `quantity_only` | Quantity + unit set; cost not attempted. Phase 6 default. |
| `cost_unresolved` | Cost lookup attempted, no source available. |
| `catalog_resolved_cost_missing` | Catalog item resolved but `base_cost` is null/zero. |
| `catalog_resolved_cost_available` | Catalog item resolved with valid `base_cost`. |
| `labor_rate_missing` | Labor candidate missing required `job_type` / `skill_level` / `location_zone` to look up `labor_rates`. |
| `ready_for_pricing_review` | All inputs present; awaiting user pricing review. |
| `ready_for_live_handoff` | All gates green, user approved, ready for Phase 7 write. |
| `blocked` | At least one pricing or review blocker is active. |

### 5.3 Out-of-scope pricing concerns

Margin/markup defaults, tax rules, financing terms, commission application, and tier (good/better/best) construction are all governed by the existing estimate engine and `tenant_estimate_settings`. Phase 5 does not touch them.

---

## 6. Catalog-resolution handoff modes

Phase 4 writes `catalog_resolution_status = 'unresolved'` on every draft. Phase 5 fixes the future-allowed modes; Phase 6/7 chooses which to enable.

### Mode A — `catalog_resolved_only`

- Only resolved catalog items may become live estimate lines.
- Unresolved items remain blocked from live handoff.
- Safest mode. Recommended as Phase 7 default once a resolver lands.

### Mode B — `user_approved_custom_lines`

- User may approve a non-catalog custom line.
- Custom lines **must** preserve source draft id, PlanPath, source measurement ids, formula key, and warning flags.
- Custom lines **must** be visibly marked custom / non-catalog in any UI and in the `notes` / metadata of any written `estimate_line_items` row.
- Custom lines **may not** silently invent unit cost — the user must enter it explicitly, or the line stays at `quantity_only`.

### Mode C — `preview_only`

- Candidate appears in a preview but cannot be pushed live.
- All unresolved candidates fall into this mode by default.

### Recommended Phase 6 default

> **`preview_only`** for all unresolved candidates until a catalog-mapping contract is approved. Mode A and Mode B unlock only behind explicit Phase 7 approval.

---

## 7. Review gate contract

Full matrices live in `blueprint-crm-handoff-review-gates.md`. This contract references them; it does not duplicate the matrices.

Required **blockers** (Phase 7 must refuse live handoff while any are active):

- Unresolved blocking review flags.
- Missing PlanPath.
- Missing `source_measurement_ids`.
- Missing `accepted_trade_id`.
- `windows_doors` as standalone trade (measurement-object-only — per Phase 0 catalog).
- `future_supported` trade.
- `unsupported` trade.
- `paint_coatings` without an `exterior_walls_siding` source.
- Catalog item unresolved (unless custom-line mode is explicitly approved — §6 mode B).
- Missing required user/template assumptions (waste %, coverage, etc.).
- Missing quantity.
- Missing unit.
- Pricing required but unavailable.
- Final pricing not approved.
- CRM target estimate not selected.
- Tenant mismatch between source session and target estimate.
- Stale / superseded import session.
- Draft rows superseded by a newer Phase 4 generation.
- Deterministic handoff key collision (§9.2).
- Existing estimate locked/approved/sent (if the CRM has such statuses — see inventory §2.6).

Required **warnings** (must surface in preview UI but do not block):

- Field verification required (vendor-flagged or Phase 3 review flag).
- Wall image obstruction warning.
- Wall soffit assumption warning.
- Roof penetration field verification required.
- Catalog unresolved but preview allowed (Mode C).
- Quantity generated from assumption.
- Quantity generated from report waste table (vs. measured area).
- Quantity generated from formula rather than report-provided suggestion.

---

## 8. User approval contract

The future Push-to-Estimate UI (Phase 6/7) must require, in order:

1. Choose target estimate / opportunity / job (one of the existing `pipeline_entry_id` / `project_id` paths).
2. Select accepted trades to include.
3. Choose material draft lines to include / exclude.
4. Choose labor draft lines to include / exclude.
5. Resolve or explicitly acknowledge warnings.
6. Resolve blocking flags (or change selection to drop the affected lines).
7. Select catalog items per line — or explicitly approve custom-line mode (§6 mode B).
8. Confirm quantity basis (assumption vs. report-provided vs. formula).
9. Confirm pricing mode (`quantity_only` vs. `ready_for_pricing_review`).
10. Confirm that line items are draft-to-estimate candidates (not pre-priced final lines).
11. Final **"Push to Estimate"** approval — single explicit action; writes audit event `blueprint_handoff_user_approved`.

Phase 5 does **not** implement any of this UI. It documents the contract only.

---

## 9. Idempotency and supersession contract

### 9.1 Deterministic handoff key

```
sha256(
  tenant_id
  || ':' || import_session_id
  || ':' || accepted_trade_id
  || ':' || template_binding_id
  || ':' || draft_line_id
  || ':' || draft_line_type             // 'material' | 'labor'
  || ':' || formula_key
  || ':' || canonical_decimal(quantity)
  || ':' || unit
  || ':' || sorted_uuid_hash(source_measurement_ids)
  || ':' || sorted_uuid_hash(plan_path_ids)
  || ':' || template_version
  || ':' || canonical_json_hash(user_assumptions)
)
```

`canonical_decimal` normalizes trailing zeros and unit precision; `canonical_json_hash` sorts keys and strips whitespace. Both helpers are deferred to Phase 6/7 implementation; Phase 5 only fixes the input set.

### 9.2 Rules

1. Repeated preview generation **must not** duplicate candidates: same deterministic key ⇒ same candidate row (upsert by key).
2. Repeated live handoff **must not** duplicate estimate lines: same deterministic key ⇒ either update-in-place, skip, or version, per Phase 7 contract.
3. If draft rows are superseded by a newer Phase 4 generation, prior candidates derived from the old draft rows must transition to `superseded` (lifecycle §3). They are not deleted.
4. If a live estimate line already exists for a given deterministic handoff key, the future implementation must choose one of: **update**, **skip**, or **version** — per the approved contract. Default Phase 7 behavior is **skip with audit event**; **update** and **version** require explicit user approval per write.
5. **No destructive overwrite without explicit user approval.** Specifically, no automatic delete of a previously-written `estimate_line_items` row.

### 9.3 Supersession of source rows

When Phase 4 re-generates draft rows (e.g. waste % changed), the new rows carry a new generation id. Phase 6 candidates derived from the old generation must be marked `superseded` and recomputed from the new generation, preserving audit history of both.

### 9.4 Supersession of live estimate lines

If a previously-written live `estimate_line_items` row needs to be replaced because of a regenerated draft, Phase 7 must:

1. Surface the diff in the preview UI.
2. Require explicit user re-approval ("Replace existing line X with new candidate Y").
3. Mark the prior line as `superseded` via metadata (or via a versioning column if Phase 6/7 adds one); never silently delete.

---

## 10. Provenance / audit contract

### 10.1 Per-line provenance (must be preserved on every live `estimate_line_items` row generated from the importer)

- `import_session_id`
- `source_document_ids`
- `source_measurement_ids`
- `plan_path_ids`
- `draft_line_id`
- `accepted_trade_id`
- `template_binding_id`
- `formula_key`
- `formula_inputs`
- generated `quantity`
- generated `unit`
- source / provider (e.g. `blueprint_importer_v2`)
- user who approved handoff (`approved_by_user_id`)
- timestamp of approval
- deterministic handoff key

### 10.2 Existing target columns cannot hold all of this

Per `blueprint-crm-estimate-integration-inventory.md` §3, `estimate_line_items` has no provenance column. Phase 6/7 must choose one of:

- **(a)** new jsonb column `estimate_line_items.source_plan_path` (smallest surface, queryable via gin).
- **(b)** new linking table `blueprint_draft_line_to_estimate_line(estimate_line_item_id, draft_line_id, draft_line_type, deterministic_handoff_key, …)` with FKs and unique constraint on the key.
- **(c)** hybrid: jsonb summary + linking table for queryability.

Phase 5 documents these as **future options**. It does **not** create the migration.

### 10.3 Audit events

Every lifecycle transition (§3) writes an audit event via `_shared/audit.ts` (per existing audit convention). Suggested event_types (Phase 6/7 finalizes):

- `blueprint_handoff_preview_requested`
- `blueprint_handoff_preview_created`
- `blueprint_handoff_user_approved`
- `blueprint_handoff_live_write_requested`
- `blueprint_handoff_live_write_succeeded`
- `blueprint_handoff_live_write_failed`
- `blueprint_handoff_superseded`
- `blueprint_handoff_cancelled`

Each event payload must include `tenant_id`, `import_session_id`, `user_id`, `deterministic_handoff_key` (per-line events), and the relevant `estimate_id` once known.

### 10.4 Required future migration (NOT in Phase 5)

For Phase 7 to ship safely, at minimum:

- Add `source_plan_path jsonb` (or equivalent linking table) to `estimate_line_items`.
- Add `source_import_session_id uuid` to chosen header table.
- Add unique constraint or partial unique index on `(estimate_id, deterministic_handoff_key)` to enforce idempotency.

Phase 5 explicitly does **not** author this migration.

---

## 11. Tenant / RLS considerations

- All candidate rows and audit events must be tenant-scoped via `tenant_id` matching the source `blueprint_import_sessions.tenant_id`.
- Phase 7 write must verify `target_estimate.tenant_id === source_session.tenant_id` before any write; mismatch ⇒ hard blocker (§7).
- Per core memory, all queries in any future UI must use `useEffectiveTenantId()` with explicit `.eq('tenant_id', effectiveTenantId)`.
- Per the tenant-security-enforcer skill: never trust `tenant_id` from the request body; resolve via JWT → membership → existing `_shared/tenant.ts`.
- Service role must never be used in any browser path; if a future edge route uses service role, it must manually filter every query by `tenant_id` and write an audit event.

---

## 12. Recommended next-phase plan

### Phase 6 — handoff preview implementation only

- Build the candidate-generation pipeline (Phase 4 drafts ⇒ candidate objects, §4).
- Persist candidates either in-memory or in a new `blueprint_estimate_candidates` table (Phase 6 decides).
- Build the preview UI (selection, gate display, warning/blocker display).
- **No live `estimates` / `estimate_line_items` writes.**
- Pricing may remain `quantity_only` unless existing pricing rules are read-only-safe to surface.

### Phase 7 — live CRM estimate write behind explicit user approval

- Idempotent write logic keyed by `deterministic_handoff_key`.
- Audit / provenance persistence (per §10).
- Catalog / custom-line decision enforced (per §6).
- Tests for tenant safety, duplicate prevention, supersession, and rollback on failure.
- Schema migration per §10.4 lands here (or in Phase 6.5).

### Phase 5.5 (recommended only if Phase 5 inventory revealed blockers)

Per `blueprint-crm-estimate-integration-inventory.md` §3 + §4, the inventory **did** reveal blockers (two header tables, no provenance columns, no idempotency keys). A small **Phase 5.5 schema/contracts phase** is recommended before Phase 6:

- Decide canonical header target (`estimates` vs `enhanced_estimates`).
- Approve linking-table vs jsonb-column for provenance.
- Approve `blueprint_estimate_candidates` staging table (or in-memory candidates).
- No code change beyond the schema + RLS + GRANT migration.

---

## 13. Stop conditions

Phase 5 must stop and escalate if any of the following occur during review:

- A request asks for any code or migration change inside Phase 5.
- A request asks Phase 5 to pick the canonical estimate header target without inventory approval.
- A request asks Phase 5 to allow auto-handoff without user approval.
- A request asks Phase 5 to allow custom lines without preserving provenance + warning flags.
- A request asks Phase 5 to drop the deterministic handoff key or the audit trail.

---

## 14. Verification checklist (Phase 5 reviewer)

- [ ] Phase 0 contract docs re-read?
- [ ] Phase 1 schema contracts re-read?
- [ ] Phase 2 DB verification doc re-read?
- [ ] Phase 3 runtime doc re-read?
- [ ] Phase 4 draft-generation doc re-read?
- [ ] CRM/estimate inventory written (`blueprint-crm-estimate-integration-inventory.md`)?
- [ ] Handoff contract written (this doc)?
- [ ] Review gates documented (`blueprint-crm-handoff-review-gates.md`)?
- [ ] Pricing boundary documented?
- [ ] Catalog-unresolved behavior documented?
- [ ] Idempotency / supersession documented?
- [ ] Provenance / audit contract documented?
- [ ] **Code unchanged?**
- [ ] **DB unchanged?**
- [ ] **Endpoint behavior unchanged?**
- [ ] **Worker behavior unchanged?**
- [ ] **UI unchanged?**
- [ ] **No new standalone edge functions?**
- [ ] **No CRM handoff implemented?**
- [ ] **No live estimate lines created?**

---

## Final verification report (Phase 5 author)

| Check | Status |
|---|---|
| Phase 0 docs re-read | yes (`blueprint-trade-catalog.md`, `blueprint-estimate-mapping-contract.md`, `blueprint-mvp-phase-plan.md`) |
| Phase 1 contracts re-read | yes (`blueprint-importer-phase-1-schema-contracts.md`) |
| Phase 2 DB verification doc re-read | yes (`blueprint-importer-phase-2-db-verification.md`) |
| Phase 3 runtime doc re-read | yes (`blueprint-importer-phase-3-runtime-detection.md`) |
| Phase 4 draft-generation doc re-read | yes (`blueprint-importer-phase-4-draft-generation.md`) |
| Existing CRM / estimate model inventoried | yes (see inventory doc) |
| Existing CRM target tables identified | `estimates`, `enhanced_estimates`, `estimate_line_items`, `proposal_tier_items`, `estimate_templates`, `estimate_bindings`, `tenant_estimate_settings`, `estimate_versions`, `estimate_commissions`, `estimate_measurements`, `estimate_measurement_assignments`, `estimate_calculation_templates*` |
| Existing CRM target routes identified | `generate-estimate-from-measurement`, `update-estimate-line-items`, `excel-style-estimate-calculator`, `dynamic-pricing-calculator`, `estimate-scope-narrative`, `generate-estimate-pdf`, `generate-proposal` |
| Existing catalog model identified | `materials`, `products`, `product_catalog`, `material_categories`, `material_costs`, `supplier_catalogs(+items)`, `supplier_price_lists(+items)`, `abc_catalog_items`, `abc_material_sku_mappings` |
| Existing labor pricing model identified | `labor_rates` (keyed by `job_type` + `skill_level` + `location_zone`) |
| Handoff contract written | yes (this doc) |
| Review gates documented | yes (`blueprint-crm-handoff-review-gates.md`) |
| Pricing boundary documented | yes (§5) |
| Catalog unresolved behavior documented | yes (§6) |
| Idempotency / supersession documented | yes (§9) |
| Provenance / audit contract documented | yes (§10) |
| Code changed | no |
| DB changed | no |
| Endpoint behavior changed | no |
| Worker behavior changed | no |
| UI changed | no |
| New standalone edge functions | no |
| CRM estimate handoff implemented | no |
| Live estimate lines created | no |
| Deviations | **Two existing estimate header tables (`estimates` vs `enhanced_estimates`) — Phase 5 deliberately did not pick a canonical target; Phase 5.5 is recommended to resolve this before Phase 6 begins. Existing `estimate_line_items` has no provenance / idempotency columns — Phase 5 documents three options (jsonb column, linking table, hybrid) without choosing.** |
| Recommended next phase | **Phase 5.5** (schema/contracts only — pick canonical header, approve provenance & idempotency surface, approve candidate staging surface), then **Phase 6** (handoff preview implementation only). Phase 7 (live CRM estimate write) remains blocked until Phase 5.5 + Phase 6 ship. |

Stop after Phase 5 docs. Wait for review before Phase 6.
