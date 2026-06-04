# Blueprint Importer v2 — CRM / Estimate Integration Inventory (Phase 5)

**Status:** Docs only. No code, no DB, no endpoint, no worker, no UI changes.
**Purpose:** Catalog the exact existing CRM/estimate/proposal/catalog/labor surfaces in this repo so that the Phase 5 handoff contract can reference real targets (or honestly mark "not found"). Authored alongside `blueprint-importer-phase-5-crm-handoff-contract.md` and `blueprint-crm-handoff-review-gates.md`.

> This document MUST NOT propose new tables or new routes. Any gap is recorded as **not found** with an impact note for Phase 5.5 / Phase 6 / Phase 7.

---

## 1. Source side (already shipped — Phase 1–4)

| Object | Kind | Owned by |
|---|---|---|
| `blueprint_import_sessions` | table | Phase 1 |
| `blueprint_source_documents` | table | Phase 1 |
| `blueprint_detected_trades` | table | Phase 1 |
| `blueprint_accepted_trades` | table | Phase 1 |
| `blueprint_measurement_objects` | table | Phase 1 |
| `blueprint_plan_paths` | table | Phase 1 |
| `blueprint_review_flags` | table | Phase 1 |
| `blueprint_template_bindings` | table | Phase 4 |
| `blueprint_material_draft_lines` | table | Phase 4 |
| `blueprint_labor_draft_lines` | table | Phase 4 |
| `/blueprint-importer/v2/*` routes on `document-worker` | edge route group | Phases 3–4 |
| Shared contracts: `supabase/functions/_shared/blueprint-importer/*.ts` | TS types | Phases 1–4 |
| Python contracts: `worker/app/blueprint_contracts/*.py` | Pydantic models | Phases 1–4 |

All source-side rows are tenant-scoped (`tenant_id`), carry `plan_path_ids` + `source_measurement_ids`, and are subject to RLS per Phase 1.

---

## 2. Target side (existing CRM / estimate surface)

### 2.1 Estimate header tables — **two parallel models found**

This repo carries **two estimate header tables**. Phase 5 must pick one canonical target and document this explicitly before any handoff implementation begins.

#### `public.estimates` (legacy / current write target for most flows)

Columns observed:

```
id, tenant_id, pipeline_entry_id, template_id, estimate_number, status,
parameters (jsonb), line_items (jsonb), material_cost, labor_cost,
overhead_percent, overhead_amount, target_margin_percent, selling_price,
actual_profit, actual_margin_percent, valid_until, sent_at, approved_at,
created_by, created_at, updated_at, project_id, measurement_id, location_id
```

- Has both a normalized line item child table (`estimate_line_items`) and a denormalized `line_items` jsonb column. Both are populated by various existing flows.
- `status` is a Postgres `USER-DEFINED` enum.
- No column named `source_plan_path`, no column for blueprint provenance.

#### `public.enhanced_estimates` (richer model, tier-aware, used by Roofr-style proposals)

Columns observed (selection):

```
id, tenant_id, estimate_number, pipeline_entry_id, project_id, template_id,
customer_name, customer_address, property_details (jsonb),
roof_area_sq_ft, roof_pitch, complexity_level, season, location_zone,
material_cost, material_markup_percent, material_total,
labor_hours, labor_rate_per_hour, labor_cost, labor_markup_percent, labor_total,
overhead_percent, overhead_amount,
sales_rep_id, sales_rep_commission_percent, sales_rep_commission_amount,
subtotal, target_profit_percent, target_profit_amount,
actual_profit_amount, actual_profit_percent,
selling_price, price_per_sq_ft, permit_costs,
waste_factor_percent, contingency_percent,
line_items (jsonb), status, approval_required, approved_by, approved_at,
sent_to_customer_at, customer_viewed_at, expires_at, notes, internal_notes,
calculation_metadata (jsonb), created_by, created_at, updated_at,
selected_tier, good_tier_total, better_tier_total, best_tier_total,
tier_line_items (jsonb), tracking_enabled, view_count, last_viewed_at,
share_token, cover_photo_url, scope_of_work_html, warranty_tier_details,
financing_options, measurement_report_id, signature_envelope_id, signed_at,
accepted_tier, fixed_selling_price, is_fixed_price,
rep_commission_percent, rep_commission_amount, materials_total, pdf_url,
short_description, first_viewed_at, tier_selected_at, follow_up_enabled,
material_cost_manual, labor_cost_manual, manual_override_notes,
material_cost_locked_at, material_cost_locked_by,
labor_cost_locked_at, labor_cost_locked_by,
display_name, sales_tax_rate, sales_tax_amount, total_with_tax,
pricing_tier, signature_anchor (jsonb)
```

- No `source_plan_path` column, no blueprint provenance column.
- `calculation_metadata` jsonb is the only safe place to land provenance without a schema migration; this is recorded as a Phase 6/7 gap, not a Phase 5 decision.

> **Decision required before Phase 6:** which header table is the canonical handoff target? Phase 5 deliberately does **not** make this decision — see the handoff contract §2.

### 2.2 Estimate line item table

`public.estimate_line_items`

Columns:

```
id, tenant_id, estimate_id, line_number,
item_category, item_name, description,
quantity, unit_type, unit_cost, extended_cost,
markup_percent, markup_amount, total_price,
material_id, labor_rate_id, notes,
is_optional, sort_order, created_at, updated_at,
srs_item_code, vendor_id,
abc_item_number, abc_color, abc_uom, abc_price,
abc_price_timestamp, abc_branch, abc_ship_to,
abc_availability, abc_price_status
```

- Has `material_id` FK and `labor_rate_id` FK — the existing catalog wiring contract.
- Has supplier-specific columns (`srs_item_code`, `abc_*`) but **no blueprint provenance column** (`source_plan_path`, `blueprint_draft_line_id`, etc.).

### 2.3 Proposal / tier surface

| Table | Notes |
|---|---|
| `public.proposal_tier_items` | tier, item_type, category, name, description, quantity, unit, unit_cost, markup_percent, final_price, is_optional, is_included, sort_order, metadata. Belongs to an estimate via `estimate_id`. |
| `public.proposal_tracking` | view/open analytics. |
| `public.proposal_financing` | financing offer rows. |
| `public.proposal_follow_ups` | follow-up scheduling. |
| `public.proposal_notification_preferences` | per-tenant proposal notification config. |

Phase 5 contract: **proposal writes are out of scope.** Listed for completeness only.

### 2.4 Catalog / material / labor sources

| Table | Role |
|---|---|
| `public.materials` | tenant catalog: id, code, name, category_id, uom, coverage_per_unit, base_cost, default_markup_pct, is_taxable, tags, attributes, supplier_sku, active. Linked from `estimate_line_items.material_id`. |
| `public.products` | tenant product master with approval/HVHZ fields. |
| `public.product_catalog` | tier/brand/model + warranty + price_per_square (good/better/best fodder). |
| `public.material_categories` | category taxonomy. |
| `public.material_costs` | historical cost rows. |
| `public.labor_rates` | id, tenant_id, job_type, skill_level, base_rate_per_hour, location_zone, seasonal_adjustment, complexity_multiplier, effective_date, expires_date, is_active. Linked from `estimate_line_items.labor_rate_id`. |
| `public.supplier_price_lists` / `public.supplier_price_list_items` | imported supplier price lists. |
| `public.supplier_catalogs` / `public.supplier_catalog_items` | per-supplier catalogs. |
| `public.abc_catalog_items` / `public.abc_material_sku_mappings` | ABC Supply catalog wiring. |

Phase 4 deliberately writes `catalog_resolution_status = 'unresolved'` on every draft line. The mapping target for resolution would be `materials.id` (and `materials.supplier_sku` / `abc_item_number` / `srs_item_code` for supplier flavors). Phase 5 does not perform this resolution.

### 2.5 Existing estimate write/calc surfaces (edge functions)

| Function | Phase-5 relevance |
|---|---|
| `generate-estimate-from-measurement` | Writes `estimates` / `estimate_line_items` from `roof_measurements`. Closest analog to a future blueprint handoff. |
| `update-estimate-line-items` | Mutates `estimate_line_items` with engine-standards recalculation. |
| `excel-style-estimate-calculator` | Server-side calc surface. |
| `dynamic-pricing-calculator` | Pricing calc surface. |
| `estimate-scope-narrative` | Generates `scope_of_work_html`. |
| `generate-estimate-pdf` | PDF export. |
| `generate-proposal` | Proposal flow — out of scope for Phase 5. |

Phase 5 inventory only — **do not modify any of the above.**

### 2.6 Status lifecycle (existing)

`estimates.status` is a `USER-DEFINED` enum (not enumerated in this inventory because Phase 5 must not change it). Externally observable transitions referenced in the codebase include: draft → ready → sent → viewed → tier_selected → signed → approved / declined / expired / superseded. The handoff contract §7 references these only abstractly.

### 2.7 Tenant / RLS pattern (existing)

- All tables above are scoped by `tenant_id`.
- Frontend reads use `useEffectiveTenantId()` with explicit `.eq('tenant_id', effectiveTenantId)` filters (per core memory rule).
- Writes are gated by RLS policies tied to `user_company_access` membership, plus `tenant_id` columns auto-populated by the documented automated-tenant-scoping triggers.

### 2.8 Other supporting tables

| Table | Notes |
|---|---|
| `public.estimate_bindings` | Joins `estimate_id ↔ template_id`. Could be analogous to `blueprint_template_bindings` but is **not** a blueprint provenance link. |
| `public.estimate_templates` | Tenant estimate templates (roof_type, template_data). |
| `public.estimate_measurements` / `public.estimate_measurement_assignments` | Existing measurement-to-estimate linkage. Closest existing analog for "draft-line-to-estimate-line" linkage. |
| `public.estimate_calculation_templates` + `*_groups` + `*_items` | Tenant calc template structure. |
| `public.estimate_commissions` | Commission rows. |
| `public.estimate_versions` | Versioning rows. |
| `public.tenant_estimate_settings` | sales_tax_enabled, sales_tax_rate, fine_print_content, default_terms. |
| `public.change_order_line_items` | Out of scope for Phase 5; reference only. |

---

## 3. Missing pieces (impact for Phase 6/7)

| Gap | Where it bites |
|---|---|
| No `source_plan_path` (or equivalent) column on `estimate_line_items`. | Live handoff cannot persist PlanPath provenance natively. Either (a) migrate a new column, (b) add a linking table `blueprint_draft_line_to_estimate_line_id`, or (c) bury provenance inside the `notes`/jsonb fields (rejected — not queryable). |
| No `source_import_session_id` on `estimates`. | Cannot enforce "one estimate per import session" idempotency at the header level without a new column or linking table. |
| No deterministic-handoff-key column on `estimate_line_items`. | Cannot enforce idempotent per-line writes without a new column or linking table. |
| Two header tables (`estimates` vs `enhanced_estimates`). | Phase 5 deliberately does not pick. Phase 5.5 or Phase 6 must pick one. |
| No formal "draft estimate" / "candidate estimate" surface. | Phase 6 preview cannot reuse `estimates` rows without polluting status pipelines. A new staging surface (`blueprint_estimate_candidates`) is recommended in Phase 6/7. |
| No catalog-resolution endpoint that maps a draft material line to `materials.id`. | Phase 6/7 must add a resolver; Phase 5 only documents the rules. |
| `labor_rates` is keyed by `job_type` + `skill_level` + `location_zone` — Phase 4 labor drafts do not yet carry `skill_level`/`location_zone`. | Phase 6/7 must require the user to confirm those before any labor rate can be looked up. |
| No audit table dedicated to importer→estimate transitions. | Either reuse generic audit (`_shared/audit.ts`) with `event_type='blueprint_handoff_*'`, or add `blueprint_handoff_events` in Phase 6/7. |
| Existing `estimates` flow assumes a single header per `pipeline_entry_id` in most paths. | Phase 6/7 must define behavior when an import session targets a pipeline entry that already has an active estimate (block, version, supersede, or create new). |

---

## 4. Ambiguity / explicit "not found"

| Question | Answer for Phase 5 |
|---|---|
| Canonical estimate header table? | **not decided** — two candidates exist; Phase 5 declines to pick. |
| Canonical proposal write target for blueprint flows? | **not in scope** — proposal writes are excluded from Phase 5/6/7. |
| Existing "draft" or "candidate" estimate status before `draft`? | **not found**. Phase 6/7 must introduce a staging surface. |
| Catalog auto-mapping for free-text material descriptions? | **not found** beyond supplier SKU lookups (ABC/SRS/etc.). Phase 6/7 must keep `catalog_resolution_status='unresolved'` as a hard blocker unless a user-approved custom-line mode is enabled. |
| Existing labor rate auto-selection rules from a free-text trade description? | **not found** beyond `labor_rates.job_type` join. Phase 6/7 must require explicit `job_type` / `skill_level` / `location_zone` confirmation. |
| Existing idempotency keys on `estimate_line_items`? | **not found**. The `(estimate_id, line_number)` pair is unique but is not a deterministic key derivable from blueprint inputs. |

---

## 5. Is live handoff safe to implement later?

Conditionally **yes**, provided that before Phase 7 ships:

1. The canonical header target (`estimates` vs `enhanced_estimates`) is picked and documented.
2. A provenance surface is added (`source_plan_path` column on `estimate_line_items`, or a `blueprint_draft_line_to_estimate_line` linking table).
3. A deterministic handoff key column (or linking table) is added so repeated handoffs don't duplicate rows.
4. A user-approval gate is wired (see handoff contract §8).
5. Catalog-resolution rules are honored (see handoff contract §6).
6. Audit events are written for every handoff transition (see handoff contract §10).

Until those six items land, **no Phase 6 preview row may be promoted to a live `estimates` / `estimate_line_items` write**, even behind a feature flag.

---

## 6. What this inventory does **not** authorize

- Any schema migration.
- Any code change in `generate-estimate-from-measurement`, `update-estimate-line-items`, or any other existing estimate function.
- Any change to `estimates`, `enhanced_estimates`, `estimate_line_items`, `proposal_tier_items`, `materials`, `labor_rates`, `product_catalog`, or `tenant_estimate_settings`.
- Any new edge function.
- Any UI change in estimate/proposal screens.

Phase 5 is finished when these three docs (`-phase-5-crm-handoff-contract.md`, `-crm-estimate-integration-inventory.md`, `-crm-handoff-review-gates.md`) plus the Phase-5-line update in `blueprint-mvp-phase-plan.md` exist and are approved.
