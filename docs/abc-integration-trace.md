# ABC Supply Integration — Phase 0 Live Contract Trace

Snapshot of the ABC Supply integration as it actually runs today, before the hardening PR touches anything. This is the reference baseline for Phases 1–14.

## 1. Live routing reality

The PR brief lists `POST /functions/v1/supplier-api/abc/proxy` as the primary active backend. That is **only partly true today**:

| Route | File | Frontend callers | Status |
|---|---|---|---|
| `supplier-api/abc/proxy` | `supabase/functions/supplier-api/abc-proxy-handler.ts` (2303 lines) | `src/pages/AbcValidateDebug.tsx` **only** | Newer handler, wired to the debug page. Not yet the production path. |
| `abc-api-proxy` | `supabase/functions/abc-api-proxy/handler.ts` (1849 lines) | **All** production surfaces (see below) | Legacy but live — this is the real production handler right now. |
| `abc-api` | `supabase/functions/abc-api/index.ts` (333 lines) | none directly, referenced by connection helpers | Auxiliary. |
| `abc-oauth-callback` | `supabase/functions/abc-oauth-callback/index.ts` | OAuth redirect target | Live. |
| `abc-save-account` | `supabase/functions/abc-save-account/*` | `ConnectSupplierDialog.tsx`, `SupplierIntegrationsPanel.tsx` | Live. |

Production frontends still invoking **`abc-api-proxy`** (not the newer `supplier-api/abc/proxy`):

- `src/components/estimates/TemplateSectionSelector.tsx` — `search_products`
- `src/components/estimates/InlineSupplierMatch.tsx` — `price_items`
- `src/components/orders/PushToSupplierDialog.tsx` — `submit_order`
- `src/components/orders/AbcCatalogControls.tsx` — `search_products`, `price_items`
- `src/components/orders/AbcCatalogBrowser.tsx` — `search_products`, `price_items`, others
- `src/components/settings/ABCConnectionSettings.tsx` — `search_products`, `price_items`, other diagnostics
- `src/components/settings/AbcTenantConnectCard.tsx`
- `src/components/settings/AbcDiagnosticsPanel.tsx`
- `src/components/settings/SupplierIntegrationsPanel.tsx`
- `src/components/settings/abc/AbcWebhookPanel.tsx`
- `src/components/settings/ConnectSupplierDialog.tsx`
- `src/features/settings/components/Settings.tsx`
- `supabase/functions/template-supplier-pricing/index.ts` — server-to-server `search_products`, `price_items`
- `supabase/functions/srs-price-refresh-scheduler/index.ts` — server-to-server `price_items` (misnamed scheduler; also refreshes ABC)

**Implication for this PR:** the hardening work has to land in **both** handlers or the legacy path must be converted into a shim over the new one. The plan's "primary active backend" is aspirational, not current. I'll route all new logic through `_shared/abc/*` modules imported by both handlers so we can flip callers safely.

## 2. Actions exposed by the current proxies

Both proxies accept an `action` string on the request body. Observed actions:

- `search_products`
- `get_item`
- `price_items`
- `price_items_record_history` (only in `supplier-api/abc-proxy-handler.ts`)
- `get_order_status`
- `submit_test_order`
- `validate_payload_only`
- `place_order` / `submit_order` (aliases; both handlers)
- Various read-only diagnostics: list accounts / list ship-to / list branches / oauth status / webhook management

Legacy aliases that **still resolve to real orders** and must be tightened:

- `submit_order` → `place_order` (`abc-api-proxy/handler.ts:1586`, `supplier-api/abc-proxy-handler.ts:1715`)
- `submit_test_order` (`abc-api-proxy/handler.ts:1108`, `supplier-api/abc-proxy-handler.ts:1351`) — sandbox-only in production but shares the same code path.

## 3. Data path today (contractor material order → ABC)

1. **Contractor material line** originates from an estimate/template line (`estimate_line_items` / `template_items`).
2. **Order draft** written to `abc_orders` + `abc_order_lines` when the user opens `PushToSupplierDialog`. `abc_order_lines.item_number` is populated from **whatever the estimate line currently holds** — this is the primary integrity gap. Sources include:
   - `abc_item_code` on `template_items` (may or may not have been reviewed)
   - `srs_item_code` (wrong supplier)
   - `item_name` (free text)
   - manually typed input
3. **Push to supplier**: `PushToSupplierDialog.tsx:705, 780` invokes `abc-api-proxy` with `action: 'submit_order'` and the persisted order id. The proxy re-reads the order rows and builds the ABC payload from `abc_order_lines` — the SKU written in step 2 is trusted as-is.
4. **Pricing**: `abc-api-proxy` `price_items` currently defaults UOM to `"EA"` when the request omits it (`handler.ts:1013`) — one of the exact anti-patterns the PR calls out.
5. **Persistence**: successful and failed responses land in `abc_api_audit`, `supplier_pricing_runs`, `supplier_price_history`, `abc_orders.raw_payload`.

## 4. Places where SKU / UOM / description / color / qty / price / Ship-To / branch can be guessed today

| Field | Guess site | Fix owner |
|---|---|---|
| ABC `itemNumber` | `abc_order_lines.item_number` populated from `template_items.abc_item_code` / `srs_item_code` / `item_name` at draft time; never re-verified against Product API. | Phases 4–6, 8 |
| ABC `itemDescription` | Copied from canonical item description, never overwritten by Product API response. | Phases 1, 8 |
| Color | Family-parent items get selected without descending to the color-specific child SKU. `search_products` filter uses `itemDescription contains` and does not force `familyItems=true`. | Phases 1, 2 |
| Valid UOMs | Not parsed from Product API. Frontend selectors show canonical UOM only. `price_items` server default `EA` (`abc-api-proxy/handler.ts:1013`). | Phases 1, 7 |
| Quantity | Free numeric input; no UOM-conversion audit trail. | Phase 6 |
| Unit price | Order builder can accept prices from stale `supplier_price_history` or manual overrides in `PushToSupplierDialog`. | Phase 7, 8 |
| Ship-To / branch | `ABCConnectionSettings.tsx` and sandbox console allow free-typed Ship-To/branch. Sandbox demo defaults (O'Brien) leak into the ordering path when `sandboxDemo` is unset in production checks. | Phases 8, 10 |
| Branch availability | No `verify_catalog_item` action exists; family items assumed available at whatever branch the connection is on. | Phase 3 |
| Dimensional length | Not modeled anywhere. | Phase 11 |

## 5. Existing supabase objects the PR will build on

- Tables: `abc_orders`, `abc_order_lines`, `abc_api_audit`, `abc_price_cache`, `abc_price_requests`, `abc_material_sku_mappings`, `abc_item_family_members`, `abc_items`, `abc_item_availability`, `abc_ship_to_accounts`, `abc_account_branches`, `abc_branches`, `abc_connections`, `abc_tokens`, `abc_oauth_states`, `abc_oauth_callback_logs`, `abc_credential_audit`, `abc_webhooks`, `abc_webhook_events`, `abc_user_connections`, `abc_catalog_items`, `abc_integrations`, `abc_invoices`, `abc_invoice_lines`, `abc_order_job_links`.
- Cross-supplier: `template_item_supplier_mappings`, `supplier_pricing_runs`, `supplier_price_history`, `supplier_price_observations`, `supplier_idempotency_keys`, `supplier_verified_invoice.ts` helper.

`template_item_supplier_mappings` (Phase 4) already exists and is the correct place to extend rather than build a new mapping table. The current schema does not yet carry ABC-specific fields (`color_name`, `color_code`, `valid_uoms`, `branch_number`, `ship_to_number`, `branch_verified_at`, `mapping_status`, `stale_at`, etc.).

## 6. Known unsafe legacy behavior to remove or gate (source-anchored)

- `abc-api-proxy/handler.ts:1013` — hard-coded `EA` UOM default in `price_items`.
- `abc-api-proxy/handler.ts:1586` / `supplier-api/abc-proxy-handler.ts:1715` — `place_order`/`submit_order` accept the persisted order rows without re-verifying SKU against Product API, without checking mapping approval, and without a fresh Price Items echo.
- `template-supplier-pricing/index.ts:334` — writes suggested ABC SKUs against template items with confidence as low as 0.5 without human review.
- `PushToSupplierDialog.tsx` — allows manual SKU/qty overrides that flow straight into the order without re-verification.
- `IntegrationSandboxConsole.tsx:90` — O'Brien-specific demo Ship-To / branch / item is baked in and not gated behind an explicit tenant allow-list plus `environment === 'sandbox'`.

## 7. Tenant isolation status (baseline)

- `abc_*` tables carry `tenant_id`; RLS policies exist per the supabase-tables catalog.
- Both proxies resolve tenant server-side from JWT (`_shared/auth-tenant.ts`) — no `body.tenant_id` trust in current code paths, but the audit needs to reconfirm this for every action added in Phases 2/3/7/8.
- CORS in both handlers uses shared `_shared/cors.ts`; no widening required by this PR.

## 8. WAF caveat

ABC's sandbox WAF frequently rejects Price Items and Place Orders calls issued from non-allow-listed IPs, which means end-to-end proof of exact-SKU echo has to happen from an allow-listed environment. The Phase 14 delivery report must call out any check that could not be proven live because of this and must not fabricate passing evidence.

---

**Next chunk:** Phase 1 — introduce `supabase/functions/_shared/abc/catalog-normalize.ts` and fixture-driven tests, imported by the new legacy-shim path so both handlers converge on one normalized shape.
