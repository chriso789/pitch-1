# Blueprint Importer v2 — Phase 7.6b — Deterministic Binding Resolver (Runtime)

Status: **shipped — runtime only, no live writes.**
Resolver version: `v2.0-runtime-phase-7.6b`.

## Scope

Phase 7.6b adds a deterministic runtime resolver that matches every
`blueprint_estimate_line_candidates` row against active rows in
`blueprint_catalog_bindings` (created in Phase 7.6a). Resolver output is
persisted on the candidate row (`catalog_resolution_status`, `handoff_blockers`,
`metadata.resolver_v2_result`) and surfaced via `blueprint_review_flags`.

Push to Estimate, pricing preflight, custom-line approval, and any live writes
into CRM estimate tables remain **disabled**.

## Non-goals (explicit)

- No pricing preflight, no margin/markup/tax/discount math, no labor totals.
- No writes to `estimate_line_items`, `enhanced_estimates`,
  `proposal_tier_items`, proposal/work-order/purchase-order/production/invoice
  tables.
- No mutation of `product_catalog`, `labor_rates`, `supplier_catalog_items`,
  `abc_catalog_items`, `material_item_match_rules` (re-asserted from 7.6a).
- No catalog seeding, no labor-rate seeding.
- No fuzzy / AI / first-row-wins matching — bindings only.
- No standalone edge functions, no worker changes, no document-classifier
  changes.

## Architecture

```
+-----------------------------+        +--------------------------------+
| blueprint_estimate_line_    |        | blueprint_catalog_bindings     |
| candidates  (read+update)   | <----- | (read only, tenant-scoped)     |
+-----------------------------+        +--------------------------------+
              |                                       ^
              | resolver_v2 metadata, handoff_blockers|
              v                                       |
+-----------------------------+        +--------------------------------+
| blueprint_review_flags      |        | blueprint_estimate_handoff_    |
| (insert/delete resolver_v2  |        | batches (read; status update   |
| -owned only; tenant scoped) |        | to preview_created / user_     |
+-----------------------------+        | review_required only)          |
                                       +--------------------------------+
```

Pure logic lives in
`supabase/functions/_shared/blueprint-importer/phase7_6b-resolver.ts` and is
exercised by `tests/blueprint-importer/phase7_6b.test.ts`. The route handlers
in `supabase/functions/document-worker/index.ts` glue the pure module to the
DB, enforce tenant isolation, and replace resolver-owned review flags
idempotently.

## Routes (document-worker, blueprint-importer v2 family)

| Method | Path                                                 | Purpose                                     |
| ------ | ---------------------------------------------------- | ------------------------------------------- |
| POST   | `/blueprint-importer/v2/resolve-bindings`            | Run resolver on a batch (all or subset)     |
| POST   | `/blueprint-importer/v2/resolve-bindings/get`        | Read prior resolver output for a batch      |

Both routes are **authenticated tenant routes** (`requireAuth + requireTenant`)
inside the existing document-worker grouped function. No new edge function
folder is created.

### POST /resolve-bindings — request body

```json
{
  "handoff_batch_id": "uuid",
  "candidate_ids": ["uuid", "..."],
  "resolver_mode": "blueprint_catalog_bindings_only",
  "dry_run": false,
  "contract_version": "blueprint-importer-v2"
}
```

Only `handoff_batch_id` is required. `candidate_ids` is optional (defaults to
all candidates in the batch). `resolver_mode` is enforced to
`blueprint_catalog_bindings_only`. `dry_run=true` performs all match work but
writes nothing.

### POST /resolve-bindings — response shape

```json
{
  "ok": true,
  "data": {
    "handoff_batch_id": "uuid",
    "resolver_mode": "blueprint_catalog_bindings_only",
    "resolver_version": "v2.0-runtime-phase-7.6b",
    "contract_version": "blueprint-importer-v2",
    "dry_run": false,
    "total_candidates": 23,
    "summary": {
      "total": 23, "resolved": 7, "ambiguous": 1, "missing": 14, "blocked": 1,
      "by_status": { ... },
      "blocker_counts": { "BLUEPRINT_CATALOG_BINDING_MISSING": 14, ... },
      "warning_counts": { "PRICING_PREFLIGHT_NOT_ENABLED_PHASE_7_6B": 23, ... },
      "handoff_still_blocked": true,
      "push_to_estimate_enabled": false,
      "push_to_estimate_disabled_reason": "..."
    },
    "results": [ /* BlueprintResolverV2RuntimeResult[] */ ],
    "push_to_estimate_enabled": false,
    "push_to_estimate_disabled_reason": "Push to Estimate remains disabled...",
    "pricing_preflight_enabled": false,
    "pricing_preflight_disabled_reason": "Pricing preflight is not enabled..."
  }
}
```

## Tables read

- `blueprint_estimate_handoff_batches` (tenant + batch lookup)
- `blueprint_estimate_line_candidates` (per-batch candidates)
- `blueprint_catalog_bindings` (tenant-scoped binding pool)
- `blueprint_review_flags` (to refresh blocking/warning id arrays)

## Tables written

- `blueprint_estimate_line_candidates` — resolver metadata + status fields
- `blueprint_review_flags` — resolver-owned blocker/warning rows
- `blueprint_estimate_handoff_batches` — `status` (preview_created /
  user_review_required) + `metadata.phase_7_6b_resolver_run_at` only

## Tables intentionally NOT written

- `enhanced_estimates`
- `estimate_line_items`
- `proposal_tier_items`
- `proposals`
- Work-order / purchase-order / production-task / invoice tables
- `product_catalog`
- `labor_rates`
- `supplier_catalog_items`
- `abc_catalog_items`
- `material_item_match_rules`
- `blueprint_catalog_binding_events` (no resolver-lifecycle events are written
  in 7.6b — that channel remains reserved for binding admin workflows)

## Matching hierarchy

For every candidate row:

1. Reject trade-level violations: `windows_doors`, measurement-object-only
   trades, and future-supported trades → `blocked` with
   `BLUEPRINT_CATALOG_BINDING_MISSING` (and `CATALOG_UNRESOLVED_LIVE_HANDOFF`
   for future-supported).
2. Defense-in-depth tenant filter — any binding with a foreign `tenant_id`
   collapses the candidate to `tenant_scope_mismatch` /
   `TENANT_COMPANY_SCOPE_UNRESOLVED`. The route handler already filters by
   `tenant_id` before calling the resolver.
3. Selector match: `tenant_id`, `trade_id`, `source_candidate_type`,
   `source_item_key`, plus `source_template_key` / `source_template_version`
   when both candidate and binding declare them, plus `source_formula_key`
   when the binding declares it.
4. Active validity: `validateBindingActiveForResolver` (status=active, no
   `unresolved` / `custom_line_disabled` targets, target id present where the
   binding kind requires it). Unit compatibility checked via
   `validateBindingUnitCompatibility` (matching units OR explicit
   `unit_conversion_rule`).
5. Count valid actives:
   - **0**: select the most-specific failure (custom_line_disabled → blocked,
     missing labor rate → `missing_labor_rate`, unit mismatch →
     `unit_mismatch`, otherwise inactive_binding / inactive_target /
     unresolved).
   - **1**: `resolved`. Warnings are layered on: `requires_user_confirmation`,
     `uses_unit_conversion`, ABC-target weak FK, unverified cost source, low
     confidence, near-expiry.
   - **>1**: `ambiguous` with `BLUEPRINT_CATALOG_BINDING_AMBIGUOUS`.

Forbidden behaviors (verified by tests):

- No `product_catalog` free-text lookup.
- No `labor_rates` free-text `job_type` lookup.
- No `material_item_match_rules` usage while the tenant/company reconciliation
  remains unresolved (see `blueprint-tenant-company-catalog-reconciliation.md`).
- No `abc_catalog_items` lookup outside an active binding's reference.
- No category-text fallback, fuzzy search, AI matching, or first-row-wins.

## Resolver statuses and blockers

Granular runtime statuses (see `BlueprintResolverV2Status` in
`catalog-bindings.ts`): `resolved`, `unresolved`, `ambiguous`,
`inactive_binding`, `inactive_target`, `unit_mismatch`,
`tenant_scope_mismatch`, `missing_labor_rate`, `blocked`.

Blockers emitted: `BLUEPRINT_CATALOG_BINDING_MISSING`,
`BLUEPRINT_CATALOG_BINDING_AMBIGUOUS`, `BLUEPRINT_CATALOG_BINDING_INACTIVE`,
`BLUEPRINT_CATALOG_TARGET_INACTIVE`, `BLUEPRINT_CATALOG_UNIT_MISMATCH`,
`BLUEPRINT_LABOR_RATE_MISSING`, `BLUEPRINT_LABOR_RATE_INACTIVE`,
`TENANT_COMPANY_SCOPE_UNRESOLVED`, `CATALOG_UNRESOLVED_LIVE_HANDOFF`,
`CUSTOM_LINE_MODE_NOT_APPROVED`.

Warnings emitted (a mix of v2 contract warnings + 7.6b runtime warnings):

- Contract: `BLUEPRINT_CATALOG_BINDING_NEEDS_REVIEW`,
  `BLUEPRINT_CATALOG_BINDING_LOW_CONFIDENCE`,
  `BLUEPRINT_CATALOG_BINDING_EFFECTIVE_DATE_NEAR_EXPIRY`,
  `BLUEPRINT_CATALOG_TARGET_UNIT_REQUIRES_CONVERSION`.
- Runtime (Phase 7.6b additive): `BINDING_REQUIRES_USER_CONFIRMATION`,
  `BINDING_TARGET_TABLE_NOT_STRONGLY_FK_ENFORCED`,
  `BINDING_USES_UNIT_CONVERSION`, `BINDING_TARGET_COST_UNVERIFIED`,
  `PRICING_PREFLIGHT_NOT_ENABLED_PHASE_7_6B`,
  `LIVE_HANDOFF_NOT_ENABLED_PHASE_7_6B`.

Rules enforced by the runtime:

- A `resolved` candidate still has `handoff_allowed = false`.
- `pricing_status` never moves to `ready_for_pricing_review` or
  `ready_for_live_handoff` in this phase. Resolved candidates land on
  `cost_unresolved`; unresolved candidates stay at `quantity_only`.
- Any blocker keeps `handoff_allowed = false`.
- `requires_user_confirmation = true` keeps the candidate at `status =
  user_review_required` even when no blockers fire.

## Candidate update behavior

The DB CHECK constraint on `catalog_resolution_status` only permits
(`unresolved`, `matched`, `ambiguous`, `missing`, `manual_override`).
The runtime maps the granular resolver status into those buckets via
`mapResolverStatusToDbCatalogStatus` and persists the granular value inside
`metadata.resolver_v2_result.status` (and `metadata.resolver_blocker_codes`).

Fields written per candidate:

- `catalog_resolution_status` — DB-safe bucket
- `catalog_item_id` — only set when matched target is a strong internal UUID
  (i.e. `product_catalog` or `supplier_catalog_item`). Never set for
  `abc_catalog_item` or `labor_rate` targets.
- `pricing_status` — `quantity_only` or `cost_unresolved` only
- `handoff_allowed` — always `false`
- `handoff_blockers` — array of resolver blocker codes
- `status` — preserves terminal values (`live_written`, `superseded`,
  `cancelled`, `failed`); otherwise `blocked` / `user_review_required` /
  `preview`
- `metadata.resolver_v2_result` — full runtime result
- `metadata.binding_summary` — human-readable target summary
- `metadata.resolver_version` — `v2.0-runtime-phase-7.6b`
- `metadata.resolver_warning_codes` / `metadata.resolver_blocker_codes`
- `metadata.pricing_preflight_not_enabled_phase_7_6b = true`
- `metadata.live_handoff_not_enabled_phase_7_6b = true`
- `blocking_review_flag_ids` / `warning_review_flag_ids` — recomputed as
  union of resolver-owned ids and prior non-resolver ids

Preserved verbatim (never rewritten):

- `source_measurement_ids`, `plan_path_ids`, `source_document_ids`,
  `deterministic_handoff_key`, `source_draft_line_id`, `source_draft_line_type`,
  `quantity`, `unit`, `formula_key`, `formula_inputs`, `provenance_summary`.

## Review flag idempotency

For every candidate, prior `blueprint_review_flags` rows tagged
`metadata.source = 'resolver_v2'` AND
`metadata.line_candidate_id = candidate.id` are deleted before the new specs
are inserted. Non-resolver flags (e.g. Phase 3 measurement warnings, Phase 4
formula-input gaps) are preserved.

`metadata` on every resolver flag includes: `source`, `resolver_version`,
`line_candidate_id`, `handoff_batch_id`, `deterministic_handoff_key`,
`matched_binding_id` — sufficient for downstream debugging and idempotent
re-runs.

## UI

`src/pages/BlueprintImporterV2.tsx`:

- New **Resolve catalog bindings** button beside *Create handoff preview*
  (disabled until a preview batch exists).
- New **Phase 7.6b resolver summary** chip row: resolved / ambiguous /
  missing / blocked counts, blocker counts, warning counts, and the canonical
  "Push to Estimate remains disabled..." reason string.
- New **Resolver v2** column in the candidate table showing the granular
  status, matched target kind, source→target unit, binding summary, plus
  user-confirmation and unit-conversion flags.
- Push to Estimate / Pricing preflight / Final pricing / Approve custom line
  remain disabled buttons with tooltip-explained reasons.

## Idempotency contract

A resolver run is uniquely determined by:

- `tenant_id`
- `handoff_batch_id`
- `line_candidate_id`
- `deterministic_handoff_key`
- `source_item_key`, `source_candidate_type`, `trade_id`, `source_unit`
- `source_template_key`, `source_template_version`, `source_formula_key`
- The matched binding's `deterministic_binding_key` and `updated_at`
- `resolver_version`

Re-running with unchanged inputs:

- produces byte-stable resolver output (tested),
- produces an identical set of review-flag specs (tested),
- replaces existing resolver-owned flags without duplicating them,
- does not mutate input candidate or input binding rows in memory (tested).

If the matched binding row changes (target, status, unit, conversion rule,
labor_rate_id, requires_user_confirmation, effective dates), the next run
produces a different result and overwrites prior resolver metadata. If the
candidate's `deterministic_handoff_key` changes the resolver treats it as a
fresh candidate.

## Tests

`tests/blueprint-importer/phase7_6b.test.ts` — 32 passing tests covering:

- Resolver basics (material + labor, missing/ambiguous/inactive/unit-mismatch/
  unit-conversion/needs-confirmation/ABC/template-mismatch).
- Labor binding gaps (missing labor_rate_id, missing binding).
- Trade guards (windows_doors, future-supported).
- Tenant safety (cross-tenant defense in depth).
- Candidate update payload (resolved/missing/ambiguous mappings, no
  live-ready pricing, metadata preservation).
- Review flag specs (codes, severity, dedupe, related_entity_type per draft
  type, blocking flags only for true blockers).
- Idempotency (byte-stable output, stable flag specs, binding change ⇒ output
  change).
- No-mutation safety (input candidate + input bindings unchanged).
- DB mapping helpers.
- Batch summary aggregation.

Full suite: `bunx vitest run tests/blueprint-importer/` → **146/146 passing**
(Phase 3 + 4 + 6 + 7.5 + 7.6a + 7.6b).

## Implementation gaps / known limitations

- `BLUEPRINT_LABOR_RATE_INACTIVE` is declared in the blocker enum but is not
  yet emitted by the runtime — Phase 7.6b reads only the binding row, not the
  `labor_rates` target row, so an "inactive labor_rate target" cannot yet be
  detected. Will be addressed when 7.6c pricing preflight reads `labor_rates`
  active/cost fields.
- `BLUEPRINT_CATALOG_TARGET_INACTIVE` is emitted only when
  `validateBindingActiveForResolver` flags an "inactive target" shape (e.g.
  `target_kind = unresolved`). True inactive rows in `product_catalog` /
  `abc_catalog_items` are not yet read; same reason as above.
- `BLUEPRINT_CATALOG_BINDING_NEEDS_REVIEW` is reserved for the binding-admin
  workflow (status `needs_review`) and is not auto-emitted by the runtime.

These remain blocked-on-Phase-7.6c by design and are documented here to keep
the resolver contract honest.

## Phase 7.6c readiness decision

Phase 7.6b is internally complete: resolver output is trustworthy enough to
become the input for pricing preflight (7.6c) and live handoff (Phase 8). It
does **not** by itself prove pricing safety.

Recommended next phase: **Phase 7.6c — pricing preflight only**, gated by a
fresh review of:

- whether `product_catalog` rows referenced by active bindings carry verified
  unit costs;
- whether `labor_rates` referenced by active labor bindings carry verified
  per-unit rates;
- whether ABC item numbers have been resolved to live SRS/ABC pricing.

Push to Estimate, live `estimate_line_items` writes, and `enhanced_estimates`
mutations remain blocked until 7.6c is reviewed and approved.

## Verification checklist (Phase 7.6b)

- [x] Phase 7.6a docs re-read.
- [x] Binding schema re-inspected.
- [x] Deterministic binding resolver implemented (pure module + route gluing).
- [x] Resolver source: `blueprint_catalog_bindings` ONLY.
- [x] Routes added: `POST /blueprint-importer/v2/resolve-bindings`,
      `POST /blueprint-importer/v2/resolve-bindings/get`.
- [x] UI changed: `src/pages/BlueprintImporterV2.tsx` (button + summary +
      column).
- [x] No new migration created.
- [x] Tables read: see "Tables read".
- [x] Tables written: see "Tables written".
- [x] Tables NOT written: see "Tables intentionally NOT written".
- [x] Existing catalog/labor tables mutated: **no**.
- [x] Pricing preflight implemented: **no**.
- [x] Final pricing implemented: **no**.
- [x] Push to Estimate enabled: **no**.
- [x] Live estimate writes implemented: **no**.
- [x] AI / fuzzy / first-row-wins used: **no**.
- [x] Resolved candidates require active binding.
- [x] Ambiguous bindings block.
- [x] Missing bindings block.
- [x] Unit mismatch (no rule) blocks.
- [x] Missing labor rate blocks.
- [x] Candidate provenance fields preserved.
- [x] Idempotency verified by tests.
- [x] Worker behavior changed: **no** (resolver lives under existing
      blueprint-importer v2 route family inside document-worker).
- [x] New standalone edge functions: **no**.
- [x] Tests added: `tests/blueprint-importer/phase7_6b.test.ts` (32 tests).
- [x] Tests passing: yes (146/146 across all blueprint-importer suites).
- [x] Recommended next phase: Phase 7.6c (pricing preflight only).
