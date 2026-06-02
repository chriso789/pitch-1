
# ABC Setup Gating + Phase 3 Pricing Architecture

Multi-day migration. Splits into two independent shippable slices: **(A) ABC setup gate + locked states** must land first because Phase 3 pricing flows depend on having `(shipToNumber, branchNumber)` resolved per tenant. **(B) Phase 3 schema + run/history rewrite** lands after (A) is green.

No ABC side-by-side grid. One supplier drawer at a time. Neutral basis cost stays separate from supplier fulfillment cost.

---

## Slice A — ABC Setup Gate (ships first)

### A1. Setup wizard contract (post-OAuth)

After `abc-oauth-callback` succeeds, the tenant is **not** considered "connected for pricing" until both `selected_ship_to_number` and `selected_branch_number` are persisted on `abc_connections`.

Flow:

```text
OAuth callback OK
   │
   ▼
Call ABC Search Accounts (accountType="ship-to", embed=branches)
   │
   ▼
Filter: only accounts where branches[].length > 0
   │
   ▼
UI: "Select Ship-To account" (radio list)
   │
   ▼
UI: "Select Branch" (radio list from that ship-to's branches[])
   │
   ▼
Persist on abc_connections:
   selected_ship_to_number, selected_branch_number,
   selected_ship_to_snapshot (jsonb), selected_branch_snapshot (jsonb),
   setup_completed_at
```

Until `setup_completed_at IS NOT NULL`, every pricing/catalog UI surface shows the gate, not "pending".

### A2. DB changes

Migration adds to `abc_connections`:

- `selected_ship_to_number text`
- `selected_branch_number text`
- `selected_ship_to_snapshot jsonb`
- `selected_branch_snapshot jsonb`
- `setup_completed_at timestamptz`

`NOTIFY pgrst, 'reload schema';` at end. No new tables in this slice.

### A3. Edge function: `abc-api/setup`

New routes inside the existing `abc-api` grouped function (no new function folder):

- `GET /setup/accounts` → calls ABC Search Accounts with `accountType=ship-to`, `embed=branches`; returns only accounts with non-empty `branches[]`.
- `POST /setup/select` → body `{ ship_to_number, branch_number }`; verifies branch belongs to the selected ship-to's `branches[]` from a fresh API call (no client-trust); writes the four columns + `setup_completed_at = now()`; audit log.

Tenant resolution via `_shared/tenant.ts`. No `tenant_id` from request body.

### A4. Setup UI

New `AbcSetupWizard` component, surfaced from the existing ABC settings page and as a blocking dialog from any pricing surface when `setup_completed_at` is null.

- Step 1 — Ship-To list (cards with name, address, branch count).
- Step 2 — Branch list for chosen ship-to (cards with branch_number, city/state).
- Confirm → POST `/setup/select` → invalidate `useAbcConnectionStatus` query.

### A5. Locked-state contract for the pricing panel

Replace any silent "pending" rendering with explicit locked reasons. New shared component `AbcPricingLockedCell` driven by a typed reason:

```ts
type AbcLockReason =
  | { kind: 'missing_ship_to' }
  | { kind: 'missing_branch' }
  | { kind: 'missing_item_number' }
  | { kind: 'missing_uom' };
```

Copy:

| Reason | Message |
|---|---|
| missing_ship_to | "ABC pricing locked: select Ship-To account." |
| missing_branch | "ABC pricing locked: select Branch." |
| missing_item_number | "ABC pricing locked: item has not been mapped to ABC Product API result." |
| missing_uom | "ABC pricing locked: valid UOM required from Product API." |

`AbcPriceCell` evaluates these gates **before** issuing a price call:

```text
if !shipToNumber           → missing_ship_to
else if !branchNumber      → missing_branch
else if !mapping.itemNumber→ missing_item_number
else if !mapping.uom       → missing_uom
else                       → call price (then priced | zero | error states from supplierPricing.ts)
```

No `kind: 'pending'` may render on the ABC cell unless an in-flight price request exists.

### A6. Catalog matching contract

`template-supplier-pricing` ABC branch (and the inline match in `TemplateSectionSelector`) must:

- Search ABC Product API by line-item keywords (existing seed logic — already extended).
- Request `embed=branches` on Product search.
- Persist on the mapping row: `item_number`, `item_description`, `valid_uoms` (array), `branches` (array of `branch_number`).
- Reject mapping if the **selected branch** is not in the product's `branches[]`. Mapping stays unmapped with reason `branch_not_stocked` so the UI shows missing_item_number with that subreason.

### A7. Pricing call shape

`fetchAbcPrice` is called only with `{ shipToNumber, branchNumber, itemNumber, uom, quantity }`. Any missing field is a programming bug (locked-cell gate should have caught it) and is logged.

Zero handling:

- If price === 0, re-query Product API for that `itemNumber` and check `branches[]` contains `branchNumber`.
- If yes → classify state as `zero_price_needs_availability_check` (new `SupplierPriceState` kind).
- If no → classify as `error` with reason `branch_not_stocked`.

### A8. Tests

- Unit: `AbcPricingLockedCell` renders correct copy for each lock reason.
- Unit: gate evaluator picks correct first failure when multiple are missing.
- Edge function: `/setup/select` rejects a branch that doesn't belong to the chosen ship-to (mocked API).
- Edge function: pricing route rejects requests when `setup_completed_at` is null.

---

## Slice B — Phase 3 Schema + Run/History Rewrite

Ships after A is green and a tenant can complete setup end-to-end.

### B1. New tables

**`template_item_supplier_mappings`** (rewrite of existing table — additive columns first, drop unused after backfill):

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid | RLS scope |
| `template_id` | uuid | |
| `template_item_id` | uuid | |
| `supplier` | text | enum 'abc' \| 'srs' \| 'qxo' |
| `supplier_item_number` | text | ABC `itemNumber` / SRS `productId` / QXO sku |
| `supplier_item_description` | text | |
| `valid_uoms` | text[] | from Product API |
| `branches` | text[] | from Product API embed=branches |
| `selected_uom` | text | |
| `mapping_state` | text | 'mapped' \| 'unmapped' \| 'needs_review' \| 'branch_not_stocked' |
| `mapping_source` | text | 'auto' \| 'manual' |
| `confidence` | numeric | 0..1 for auto matches |
| `last_verified_at` | timestamptz | |

GRANTs + RLS scoped to `tenant_id` via `get_user_tenant_id(auth.uid())`.

**`supplier_pricing_runs`** — one row per "go fetch prices for this template at this point in time" invocation:

| column | type |
|---|---|
| `id` | uuid pk |
| `tenant_id` | uuid |
| `template_id` | uuid |
| `supplier` | text |
| `triggered_by` | uuid (user_id, nullable for cron) |
| `ship_to_number` | text |
| `branch_number` | text |
| `started_at` | timestamptz |
| `completed_at` | timestamptz |
| `status` | text — 'running' \| 'ok' \| 'partial' \| 'failed' |
| `item_count` | int |
| `priced_count` | int |
| `zero_count` | int |
| `error_count` | int |
| `error_summary` | text |

**`template_supplier_price_history`** — append-only; one row per observed price per (mapping, run):

| column | type |
|---|---|
| `id` | uuid pk |
| `tenant_id` | uuid |
| `mapping_id` | uuid → mappings |
| `run_id` | uuid → runs |
| `supplier` | text |
| `supplier_item_number` | text |
| `uom` | text |
| `unit_price` | numeric (nullable when state ≠ priced) |
| `currency` | text default 'USD' |
| `state` | text — 'priced' \| 'zero' \| 'zero_price_needs_availability_check' \| 'error' |
| `reason` | text |
| `observed_at` | timestamptz default now() |

No updates to history rows. Latest-per-mapping view:

```sql
CREATE VIEW template_supplier_price_current AS
SELECT DISTINCT ON (mapping_id) *
FROM template_supplier_price_history
ORDER BY mapping_id, observed_at DESC;
```

All three with explicit `GRANT` to `authenticated`/`service_role` and tenant-scoped RLS.

### B2. Neutral basis vs supplier fulfillment cost

On `template_items`:

- `placeholder_unit_cost numeric` — designer-entered neutral basis (the number that drives the estimate's default cost).
- `estimate_basis_unit_cost numeric` — what the estimate engine actually uses (today = placeholder; later = chosen supplier observation if rep "locks in" a supplier).

Supplier observations from `template_supplier_price_history` never overwrite either column automatically. A rep chooses to apply a supplier price via the supplier drawer; the apply action writes to `estimate_basis_unit_cost` on the line, not on the template.

### B3. `template-supplier-pricing` rewrite

Per request:

1. Validate setup: load `abc_connections` for tenant, assert `setup_completed_at` and `selected_ship_to_number`/`selected_branch_number`.
2. Open a `supplier_pricing_runs` row (`status='running'`).
3. For each template item:
   - Resolve mapping from `template_item_supplier_mappings` (state must be `mapped`).
   - Skip with reason if `unmapped` / `needs_review` / `branch_not_stocked`.
   - Call supplier price with `(shipTo, branch, itemNumber, uom, qty)`.
   - Classify result into `SupplierPriceState`.
   - Insert one row in `template_supplier_price_history`.
4. Close the run with aggregate counts.

No writes to a "current prices" mutable table. UI reads from `template_supplier_price_current` view.

### B4. UI — single-drawer supplier view

`TemplateLivePricingPanel` becomes:

- Left column: template items with **neutral basis** column only.
- Per row: small chips per supplier (ABC / SRS / QXO) showing state badge from `describeSupplierPriceState`, not the price. (No grid of competing prices.)
- Click a supplier chip → opens **`SupplierPriceDrawer`** for that single supplier, showing item details, mapping, current observation, last N history points, "apply to estimate basis" button.

Removed: any three-column ABC/SRS/QXO comparison grid.

### B5. Tests

- Migration smoke: tables created, GRANTs present, RLS enabled.
- Edge: a run inserts the right number of history rows and the right `status`.
- UI: chip badges driven from `template_supplier_price_current`; drawer renders one supplier at a time.
- Contract: zero-price branch-not-stocked path produces `state='zero_price_needs_availability_check'`, never `'priced'`.

---

## Technical notes

- All new tables follow the project's `CREATE TABLE → GRANT → ENABLE RLS → POLICY` order with `NOTIFY pgrst, 'reload schema';`.
- Tenant resolution: `useEffectiveTenantId()` on the client, `_shared/tenant.ts` on edge functions. Never trust `tenant_id` from request body.
- `result_state`-style normalization is irrelevant here (that's the measurement system). Pricing states stay in `template_supplier_price_history.state` with the 4-value enum above.
- No new edge function folders — extend `abc-api` (setup routes) and existing `template-supplier-pricing` (rewrite handler, same path).
- `src/lib/templates/supplierPricing.ts` already has the typed `SupplierPriceState` union; extend it with `zero_price_needs_availability_check`.

---

## Order of execution

1. Slice A migration (`abc_connections` columns) — supabase--migration.
2. Slice A edge routes (`abc-api/setup/accounts`, `/setup/select`).
3. Slice A UI: `AbcSetupWizard`, `AbcPricingLockedCell`, gate wiring in `AbcPriceCell` / `TemplateLivePricingPanel`.
4. Smoke test: connect a tenant, complete wizard, see locked-state copy until items are mapped.
5. Slice B migration (mappings rewrite + runs + history + view + neutral basis columns).
6. Slice B edge function rewrite + UI drawer.
7. Backfill: copy existing `template_item_supplier_mappings` rows into new shape; legacy table dropped only after one release cycle of green observations.

Approve and I'll start with the Slice A migration.
