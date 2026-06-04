# Blueprint Importer v2 — Phase 7.6 Discovery Report (STOP-AND-REPORT)

**Status:** Phase 7.6 paused at the contract-mandated checkpoint.
**Action requested:** review and decide whether to (a) approve a Phase 7.6a schema-bridge migration, (b) re-scope Phase 7.6 to a no-op safety pass, or (c) defer Phase 7.6 entirely until catalog/labor data exists.
**No runtime code, no migrations, no UI changes were written in this phase.**

The Phase 7.6 prompt was explicit:

> "If the catalog/labor/pricing model is ambiguous after inspection, **stop and report before writing runtime code**."

It is ambiguous. The repo schema cannot support a deterministic
blueprint-candidate → catalog/labor-rate resolver without first introducing a
binding/mapping layer. Catalog and labor tables are also empty in production,
so any resolver shipped today would resolve zero candidates and add only
blocker churn.

---

## 1. What the prompt requires the resolver to do

Per `blueprint-catalog-labor-resolver-contract.md` and the Phase 7.6 prompt,
the material resolver must deterministically match a candidate carrying:

- `tenant_id`
- `trade_id` (e.g. `roofing`, `exterior_walls_siding`)
- `item_key`   (e.g. `shingles_architectural_30yr`)
- `template_binding_id`
- `formula_inputs`

…to exactly one of:

- `product_catalog`
- `supplier_catalog_items`
- `abc_catalog_items`
- (via) `material_item_match_rules`

The labor resolver must deterministically match a labor candidate carrying
`trade_id` + `item_key` (+ optional complexity) to exactly one
`labor_rates.id`.

Match must be:

- Tenant-scoped
- Deterministic (no AI, no free-text fuzzy)
- By explicit key (rule, SKU, normalized item key) — **not** by free-text name
  unless unique AND tenant-scoped

---

## 2. What the repo schema actually supports

### 2.1 `product_catalog` (tenant catalog)

Columns:

```
id, tenant_id, category, tier, brand, model, description,
warranty_years, price_per_square, metadata jsonb,
is_active, created_at, updated_at
```

Observations:

- **No `item_key` column.**
- **No `sku` / `manufacturer_sku` / `abc_item_number` column.**
- **No `trade_id` column.** `category` is free text (no enum, no FK to
  `accepted_trades.trade_id`).
- Pricing is `price_per_square` only — no unit/UOM, no markup, no labor split.
- `metadata jsonb` is the only place a deterministic key could live, but no
  schema constraint guarantees it carries `item_key` or `trade_id`.

Conclusion: **there is no deterministic, contract-defined key on
`product_catalog` that a blueprint candidate can match against.** A resolver
would have to invent a key convention and then hope existing rows happen to
follow it. They don't — see §3.

### 2.2 `labor_rates`

Columns:

```
id, tenant_id, job_type, skill_level, base_rate_per_hour,
location_zone, seasonal_adjustment, complexity_multiplier,
effective_date, expires_date, is_active, created_at, updated_at
```

Observations:

- **No `trade_id`.** `job_type` is free text.
- **No `labor_key` / `labor_code`.**
- **No unit** (per hour only — Phase 4 labor templates may emit per-square,
  per-LF, or flat units).
- Effective/expires date range exists, which a resolver must honor, but no
  contract-level mapping from a Phase 4 labor `item_key` to a `(job_type,
  skill_level)` pair is defined anywhere in the repo.

Conclusion: **no deterministic key links a Phase 4 labor candidate to a
`labor_rates` row.**

### 2.3 `material_item_match_rules`

Columns:

```
id, company_id, supplier_id, supplier_sku, manufacturer_sku,
normalized_invoice_description, price_list_item_id,
match_priority, confidence, created_by, created_at, updated_at
```

Observations:

- Scope column is **`company_id`, not `tenant_id`.** Multi-tenancy contract
  for the blueprint importer is `tenant_id`. Mixing the two without an
  explicit reconciliation rule is itself a tenant-isolation risk
  (see Tenant Isolation Auditor §5).
- This table is **invoice-side**: the input keys are `supplier_sku`,
  `manufacturer_sku`, `normalized_invoice_description` — none of which a
  Phase 4 blueprint candidate carries. Blueprint candidates carry
  `(trade_id, item_key, formula_inputs)`.
- `price_list_item_id` points at a `price_list_item`, not at
  `product_catalog.id`. The bridge from blueprint candidate → price list →
  product catalog is undefined.

Conclusion: **this table cannot be used as the blueprint resolver's
match-rule source without redefining its scope and adding new columns.**

### 2.4 `supplier_catalog_items`, `abc_catalog_items`

- `supplier_catalog_items` is empty in production (see §3).
- `abc_catalog_items` is tenant-agnostic (global ABC catalog keyed by
  `item_number`); blueprint candidates have no `abc_item_number`. A bridge
  would still be required.

---

## 3. Production data state (read-only verification)

| table | row count |
|---|---|
| `product_catalog` | **0** |
| `labor_rates` | **0** |
| `supplier_catalog_items` | **0** |
| `abc_catalog_items` | **0** |
| `material_item_match_rules` | 90 (all invoice-side, `company_id`-scoped) |

Even if a deterministic resolver were implemented today, **it would resolve
0 material candidates and 0 labor candidates** for every tenant. The only
runtime effect would be:

- Every candidate flips to `catalog_resolution_status='unresolved'`.
- Every candidate gains `CATALOG_UNRESOLVED_LIVE_HANDOFF`.
- Every labor candidate gains `LABOR_RATE_MISSING`.
- `handoff_allowed` stays `false` for every candidate (which it already is).

That is not a Phase 8 readiness signal. It is noise.

---

## 4. The missing piece: a blueprint↔catalog binding layer

The Phase 4 generator already emits candidates keyed by
`(trade_id, item_key, template_binding_id)`. To turn these into deterministic
matches, we need a contract-level binding layer the resolver can read. Two
viable shapes:

### Option A — Extend existing tables with bind keys (additive, smallest diff)

```sql
ALTER TABLE product_catalog
  ADD COLUMN IF NOT EXISTS trade_id text,
  ADD COLUMN IF NOT EXISTS item_key text,
  ADD COLUMN IF NOT EXISTS unit text;
CREATE UNIQUE INDEX IF NOT EXISTS product_catalog_tenant_item_key_unique
  ON product_catalog (tenant_id, trade_id, item_key)
  WHERE item_key IS NOT NULL AND is_active = true;

ALTER TABLE labor_rates
  ADD COLUMN IF NOT EXISTS trade_id text,
  ADD COLUMN IF NOT EXISTS labor_key text,
  ADD COLUMN IF NOT EXISTS unit text;
CREATE UNIQUE INDEX IF NOT EXISTS labor_rates_tenant_labor_key_unique
  ON labor_rates (tenant_id, trade_id, labor_key)
  WHERE labor_key IS NOT NULL AND is_active = true;
```

Pros: minimal surface, lets a future tenant populate keys without a new
table. Cons: edits two long-lived tenant tables, requires backfill policy
for every tenant that already has catalog rows (none today, so the backfill
cost is currently zero).

### Option B — New `blueprint_catalog_binding` table (zero touch of existing tables)

```sql
CREATE TABLE public.blueprint_catalog_binding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  trade_id text NOT NULL,
  item_key text NOT NULL,
  candidate_type text NOT NULL CHECK (candidate_type IN ('material','labor')),
  matched_table text NOT NULL
    CHECK (matched_table IN ('product_catalog','supplier_catalog_items','abc_catalog_items','labor_rates')),
  matched_item_id uuid,          -- product_catalog / supplier_catalog_items / labor_rates id
  matched_abc_item_number text,  -- abc_catalog_items (no uuid id)
  unit text,
  is_active boolean NOT NULL DEFAULT true,
  binding_version text NOT NULL DEFAULT 'v1',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, trade_id, item_key, candidate_type, binding_version)
);
GRANT SELECT ON public.blueprint_catalog_binding TO authenticated;
GRANT ALL    ON public.blueprint_catalog_binding TO service_role;
ALTER TABLE public.blueprint_catalog_binding ENABLE ROW LEVEL SECURITY;
-- + tenant-scoped policies
```

Pros: leaves `product_catalog` / `labor_rates` untouched, keeps blueprint
concerns inside `blueprint_*` namespace, mirrors the Phase 5.5 pattern.
Cons: introduces a new table that tenants must populate before the resolver
can do anything useful.

**Either option is a real schema decision and needs explicit approval.**
Phase 7.6 was not approved to make that call.

---

## 5. Pricing preflight has the same blocker

Even setting the catalog problem aside, the pricing preflight specified by
Phase 7.6 needs at minimum:

- A trustworthy `unit_cost` per material candidate. Source today would have
  to be `product_catalog.price_per_square` — but per-square is not a valid
  cost basis for non-roofing items (LF gutters, EA accessories, BX nails),
  and Phase 4 candidates carry their own `unit`. No conversion table exists.
- A trustworthy `base_rate_per_hour` per labor candidate plus an hours
  estimate. Phase 4 labor candidates carry quantity + unit (often per-square
  or per-LF), not hours. No deterministic hours-conversion rule is defined.
- A markup/margin rule. None is contract-defined; Phase 7.5 explicitly
  forbids inferring markup/margin/tax/discount.

So pricing preflight at this point would, for every candidate:

- Mark `pricing_status='cost_unresolved'` (no `unit_cost` source).
- Mark `cost_status='unavailable'`.
- Emit `PRICING_REQUIRED_BUT_UNAVAILABLE` and
  `QUANTITY_ONLY_LIVE_LINES_UNSAFE` (already implied by Phase 7.5).
- Leave `handoff_allowed=false` (already the case).

Same outcome as §3: shipping it adds no Phase 8 readiness signal.

---

## 6. Tenant-isolation flags surfaced during inspection

These are not Phase 7.6 scope but must be tracked:

1. `material_item_match_rules.company_id` vs the blueprint importer's
   `tenant_id` contract — a future resolver wiring this table needs an
   explicit `company_id ↔ tenant_id` reconciliation policy.
2. `abc_catalog_items` is tenant-agnostic; any resolver that returns an
   ABC match must persist the originating tenant in the candidate row, not
   on the catalog row.
3. No `tenant_id` exists on `material_item_match_rules`. If we ever wire it
   to the blueprint resolver, RLS + tenant-scoped policy work is required
   (Tenant Isolation Auditor, Gates 1 + 2).

---

## 7. Recommendation

Reject the current Phase 7.6 scope as written. Replace with **Phase 7.6a:
blueprint↔catalog binding schema + resolver contract v2**, which:

1. Picks Option A or Option B from §4 (recommend Option B — additive, no
   touch of long-lived tenant tables, mirrors the Phase 5.5 pattern).
2. Adds the binding table with explicit `tenant_id`, `trade_id`, `item_key`,
   `unit`, `is_active`, `binding_version`, and tenant-scoped RLS/GRANTs.
3. Defines a pricing-source contract (per-unit cost, valid units per
   trade/item) backed by binding metadata.
4. Defines a labor-hours-conversion contract (units → hours) per
   `(trade_id, labor_key)`.
5. Reconciles `material_item_match_rules.company_id` vs `tenant_id` or
   declares it out of scope for the blueprint resolver.
6. **Still does not implement runtime resolution, pricing preflight, or any
   live-write path.**

Then Phase 7.6b can ship the deterministic resolver runtime against the new
binding table, with the guarantee that the schema actually supports
deterministic matching and pricing.

---

## 8. Verification checklist (this report)

- [x] Phase 7.5 docs re-read
- [x] Catalog/labor model re-inspected (information_schema + row counts)
- [x] Production catalog/labor data state recorded
- [x] No runtime code written
- [x] No DB migration written
- [x] No UI changes
- [x] No new edge functions
- [x] No catalog or labor mutation
- [x] Push to Estimate remains disabled
- [x] Phase 8 readiness: **blocked — Phase 7.6 cannot proceed as written**
- [x] Recommended next step documented (Phase 7.6a binding schema)
