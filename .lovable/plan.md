## Full Plan — Side-by-Side Supplier Pricing for Template Items (Steps 1–5)

Multi-day migration. Delivered in 5 reviewable phases. Each phase is shippable on its own and gated on the previous one.

### Phase 1 — Data model (DB)

Two new tables, both tenant-scoped, both with RLS + GRANTs.

**`template_item_supplier_mappings`** — the persisted, auditable "this template item = this SKU at this supplier" decision.
- `id`, `tenant_id`, `template_item_id` (fk), `supplier` (`abc` | `srs` | `qxo`), `supplier_item_code`, `supplier_description`, `uom`, `color_name` (nullable), `confidence` (0–1), `match_source` (`auto` | `manual` | `imported`), `review_state` (`unreviewed` | `approved` | `rejected` | `needs_attention`), `reviewed_by`, `reviewed_at`, `created_by`, timestamps.
- Unique on `(tenant_id, template_item_id, supplier)`.

**`supplier_price_observations`** — every live price fetch, append-only, so we can show "last seen $X on date Y" and trend.
- `id`, `tenant_id`, `mapping_id` (fk), `supplier`, `supplier_item_code`, `ship_to_number`, `branch_number`, `purpose` (`estimating` | `quoting` | `ordering`), `uom`, `unit_price` (nullable), `currency`, `price_pending` (bool), `reason` (nullable), `observed_at`.
- Index on `(tenant_id, mapping_id, observed_at desc)`.

Both tables: `ENABLE ROW LEVEL SECURITY`; policies scope by `tenant_id` via `get_user_tenant_id()`; `GRANT` to `authenticated` + `service_role` (no `anon`); `NOTIFY pgrst, 'reload schema'`.

### Phase 2 — Typed states everywhere

Replace string-bag fields with a single discriminated union in `src/lib/templates/supplierPricing.ts`:

```ts
type SupplierPriceState =
  | { kind: 'unmapped' }
  | { kind: 'pending'; reason?: string }
  | { kind: 'priced'; unitPrice: number; uom: string; currency: string; observedAt: string }
  | { kind: 'zero'; reason: 'contract_zero' | 'no_contract' | 'unknown' }
  | { kind: 'error'; reason: string };
```

- `TemplateLivePricingPanel`, `InlineSupplierMatch`, `AbcPriceCell` all consume `SupplierPriceState` instead of raw `unit_price: number | null`.
- Helper `toSupplierPriceState(row)` centralizes the mapping from edge-function row → state.
- No component is allowed to render `$0.00` for a `zero` state — it renders a labeled badge ("Zero on contract — verify" or "No contract price").

### Phase 3 — Edge function: `template-supplier-pricing` hardening

- Reads mappings from `template_item_supplier_mappings` instead of inferring on every call.
- Writes every supplier response row into `supplier_price_observations` (one row per item per supplier per call). Service-role write with explicit `.eq('tenant_id', resolvedTenantId)`.
- Returns the unioned `{ template_item_id, supplier, state: SupplierPriceState }` shape — never bare numbers.
- Auth-gated (`requireAuth` + `requireTenant`), tenant resolved from JWT only, never body.
- SRS/QXO branches stay stubbed if their backends aren't ready, but return `{ kind: 'pending', reason: 'supplier_integration_pending' }` instead of `0`.

### Phase 4 — UI

1. **Mount `TemplateLivePricingPanel`** inside `TemplateDetailsPanel` (below Vendor Quotes). Side-by-side columns: ABC / SRS / QXO. No "cheapest / savings / best price" copy anywhere — ABC contract-policy safe.
2. **Persisted Ship-To / Branch picker** at the top of the panel, stored on the tenant's user prefs row (not on the template, not in localStorage).
3. **Mapping review UI** — per row, an icon menu: Approve, Reject, Change SKU (opens `AbcCatalogSearchPopover` / `SrsSearchInline`), Mark needs attention. Each action writes `review_state` + `reviewed_by` + `reviewed_at`.
4. **Zero-price fix in `AbcPriceCell`** — renders the new badge variants from the typed state. Never silently shows `$0.00`.
5. **Inline supplier match on estimate rows** (`InlineSupplierMatch.tsx`) switches to the same typed state + same mapping table, so estimate-time matches and template-time matches share one source of truth.

### Phase 5 — Tests + cleanup

- Unit: `toSupplierPriceState` for every supplier-response shape (priced / zero / pending / error / missing).
- Unit: `catalogMatching.scoreSrsProductMatch` and the auto-match threshold (already used in estimates).
- Edge-function test (Deno): `template-supplier-pricing` writes one `supplier_price_observations` row per item per supplier per call and rejects body-supplied `tenant_id`.
- Component: `AbcPriceCell` renders the right badge for each `SupplierPriceState.kind` (no `$0.00` regression).
- Decision recorded in `docs/`: whether `template-supplier-pricing` stays on the legacy `abc-api-proxy` path or moves to the routed `abc-api` v2 surface — kept on proxy for now (v2 catalog/price/orders are still stubbed).

### Rollout order

1. Phase 1 migration (DB) — review + apply.
2. Phase 2 typed states + Phase 4.4 `AbcPriceCell` fix shipped together (frontend-only, no schema dependency once Phase 1 is in).
3. Phase 3 edge-function rewrite.
4. Phase 4.1–4.3 UI (panel mount, ship-to picker, review UI).
5. Phase 4.5 inline-estimate-row unification.
6. Phase 5 tests.

### Out of scope

- Finishing the `abc-api` v2 routed surface for catalog/price/orders.
- SRS / QXO real-pricing backends (still pending status).
- Any "cheapest supplier" UX — explicitly excluded for ABC contract compliance.

### Approval gate

Reply "go" to start with the **Phase 1 migration** (DB only — no code yet). I'll surface it via the migration tool so you can review the SQL before it runs.
