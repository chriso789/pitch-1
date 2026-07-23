# ABC Supply — Production Readiness Audit

Read-only audit against the 20-section ABC Production Readiness checklist. All findings cite `file:line` evidence. No code was modified.

## Verdict Summary

| # | Section | Verdict |
|---|---|---|
| 1 | Authentication (OAuth/PKCE/refresh/scopes) | PARTIAL |
| 2 | Tenant Isolation | **FAIL** |
| 3 | Account Workflow (Ship-To → Branch) | PARTIAL |
| 4 | Product Catalog (Search Items / familyItems) | **FAIL** |
| 5 | Color Handling (family/child SKUs) | **FAIL** |
| 6 | UOM Handling | **FAIL** |
| 7 | Branch Availability | PARTIAL |
| 8 | Pricing payload + parser | PASS |
| 9 | Estimate Architecture (basis vs live) | **FAIL** |
| 10 | Mapping Gate (approved-mapping) | PARTIAL |
| 11 | Order Builder (deterministic, no body.order) | PARTIAL |
| 12 | Order API (place / status / templates / history) | PARTIAL |
| 13 | Webhooks (dedup + authoritative refresh) | PARTIAL |
| 14 | Purchase Confirmation / procurement ledger | **FAIL** |
| 15 | Notifications (Accepted/Submitted/Delivered/Invoiced) | **FAIL** |
| 16 | Error Handling (WAF/429/retry) | PARTIAL |
| 17 | ABC Terms of Use compliance | PASS |
| 18 | UI States (no generic "Pending") | PARTIAL |
| 19 | Database Schema & RLS | PARTIAL |
| 20 | Overall Production Readiness | **NOT READY** |

Total: 2 PASS · 9 PARTIAL · 7 FAIL.

---

## 1. Authentication — PARTIAL

- ✅ Auth Code + PKCE with per-tenant verifier (`abc-api-proxy/handler.ts:593-630`; `abc-oauth-callback/index.ts:253-259`; canonical `_shared/abc/pkce.ts:18-25` — not yet imported by handlers, duplicated locally at `handler.ts:121-132`).
- ✅ `offline_access` requested; refresh flow at `handler.ts:182-248`, guarded 60s expiry (`:250-296`).
- ✅ Per-tenant encrypted tokens (`abc_integrations` unique on `(tenant_id, environment)`; `pgp_sym_encrypt/decrypt` SECURITY DEFINER RPCs).
- ✅ Sandbox/production fully separated (`env.ts:19-44`; distinct client id secrets).
- ❌ **Scope strategy not separated.** No `client_credentials` grant anywhere (`grep grant_type` returns only `refresh_token`, `authorization_code`). All scopes (`location.read product.read account.read pricing.read order.* notification.* offline_access`) are bundled into a single user-token grant (`env.ts:43-44`). `abc_integrations.token_strategy` supports `'client_credentials'` but is never set/used.
- Fix: separate client_credentials cache for `location.read`/`product.read`/`notification.*`; restrict PKCE user-token to account/pricing/order scopes.

## 2. Tenant Isolation — **FAIL (critical)**

- ❌ **`tenant_id` trusted from request body**, no ownership check. `abc-api-proxy/handler.ts:469-483`:
  `let tenant_id = body.tenant_id; if (!tenant_id && userId) { /* derive */ }`
  The proxy uses the **service-role** client (`handler.ts:453-456`) which bypasses RLS. Any authenticated user can substitute another tenant's UUID in the body and read/write that tenant's ABC connections, ship-tos, orders, and pricing.
- Frontend always sends `tenant_id` explicitly (`src/components/orders/AbcCatalogBrowser.tsx:251,301,357,401`, `useAbcCatalog.ts`).
- `public.user_can_access_tenant(tenant_id)` already exists (migration `20260514221711...sql:296`) but is not called from the edge function.
- Master override is implicit only; no audited override path (no `master` check in `abc-api-proxy`).
- ✅ Row-level RLS policies exist on `abc_connections`, `abc_accounts`, `abc_branches`, `abc_orders`, `abc_price_cache`, `abc_material_sku_mappings` — but they are bypassed by the service-role path above.
- Fix (blocking): derive `tenant_id` from JWT; if body-supplied `tenant_id` is accepted for multi-company switching, require `user_can_access_tenant()` check and 403 on mismatch; log master overrides to `abc_credential_audit`.

## 3. Account Workflow — PARTIAL

- ✅ `accountType` filter used on account search (`supplier-api/abc-proxy-handler.ts:881,2260`).
- ✅ Ship-To → branch UI sequencing enforced (`AbcSetupWizard.tsx:52-63,132`; pricing locked until `setup_completed_at`, `useAbcSetup.ts:81-85`).
- ✅ Ship-Tos with no branches filtered out (`AbcSetupWizard.tsx:53-56`, server dedup `abc-proxy-handler.ts:975-983`).
- ⚠ `accountType` value sent lowercased `"ship-to"` — verify vs ABC's exact enum casing (`Ship-To`).
- ❌ **`ABC_SANDBOX_DEMO_FALLBACK`** (`abc-proxy-handler.ts:438`, substituted at `:1374-1377`, `:1595-1598`) can inject a Ship-To/branch pair whenever the body omits them, bypassing the selection gate at the API layer for pricing/order actions.
- Fix: strictly gate the fallback behind `env === "sandbox" && body.sandboxDemo === true` at every call site.

## 4. Product Catalog — **FAIL**

- ❌ **`familyItems: true` never sent** on Search Items. `buildSearchProductsPayload` (`_shared/abc/catalogService.ts:119-160`) only emits `filters` + `pagination`. Repo-wide grep: `familyItems` appears only in the response parser (`productNormalizer.ts:276-279,373-376`), never assigned on a request body.
- ❌ `familyColorResolver.ts` (which embeds branches/variations/color families correctly) explicitly notes "Additive only — no handler currently imports this module" and is unused by both handlers.
- ✅ Exact `itemNumber` lookup and description-contains search implemented (`catalogService.ts:124-141,186-215`).
- Fix: add `familyItems: true` to the search payload; wire `resolveAbcFamilies`/`rankFamilyCandidates` into the `search_products` response path.

## 5. Color Handling — **FAIL**

- ✅ Good building blocks exist: `familyColorResolver.ts:8-11,248-320` enforces per-child `itemNumber`, no inheritance from parents, parent orderable only if independently qualified. `productNormalizer.ts:12` enforces the same shape invariant.
- ❌ Both `familyColorResolver.ts` and `mappingResolver.ts` are dead code — not imported by any handler. No server-side guard blocks resolving an order line to a family/parent SKU instead of the exact color child.
- ✅ UI does the right thing for its scope (`FindAbcMatchDialog.tsx:2-8` renders each color variant as its own row).
- Fix: wire `mappingResolver.resolveAbcMapping` (and by extension `familyColorResolver`) into pricing/order handlers; refuse order build unless `state === "approved" && canOrder === true`.

## 6. UOM Handling — **FAIL**

- ✅ `orderService.buildAbcOrderPayload` requires non-empty UOM (`orderService.ts:200-201`, error `line_uom_missing`).
- ✅ `uomValidator.ts` correctly forbids inventing `EA`.
- ❌ `uomValidator.ts` not imported by either handler.
- ❌ Live `EA` fallbacks that violate the rule:
  - `src/components/orders/AbcCatalogControls.tsx:230` — `unitOfMeasure: uom || 'EA'`
  - `supabase/functions/supplier-api/abc-proxy-handler.ts:1198` — persists fabricated `EA` into `supplier_price_history`
  - `src/components/orders/AbcCatalogBrowser.tsx:68,97` — `readItemUom` picks first UOM when none flagged default
  - `abc-proxy-handler.ts:446-451` — hardcoded `validUoms: ["EA"]` for sandbox item `02OCTDUMP`
- Fix: replace fallbacks with locked states (`ABC_LOCK_MESSAGES.missing_uom`, `src/lib/templates/supplierPricing.ts:43,60`); auto-select UOM only when `isDefault` or exactly one sellable UOM exists; wire `uomValidator.ts` into handlers.

## 7. Branch Availability — PARTIAL

- ✅ `branchVerifier.ts:135-228` implements full Ship-To → authorized branches → selected branch → item-level branch chain, no inheritance.
- ✅ `useAbcCatalog.ts:88-136` scopes branches to selected Ship-To via `abc_account_branches`.
- ✅ Pricing/order require both `shipToNumber` and `branchNumber` (`pricingService.ts:141-142`, `orderService.ts:164-165`).
- ❌ `branchVerifier.ts` unused; no server-side check that a specific item's `branches[]` contains the selected branch before pricing/ordering.
- ❌ Sandbox fallback risk (see Section 3).
- Fix: invoke `verifyBranchEligibility` per line at pricing and order time; lock sandbox fallback.

## 8. Pricing (payload + parser) — PASS

- `pricingService.ts:58-64,186-209` — `requestId` deterministic, `shipToNumber`/`branchNumber`/`purpose` present, line-level `itemNumber`/`quantity`/`uom`/`id`, canonical validation at `:137-176`.
- Parser (`pricingResponseParser.ts`): non-2xx feeds `{}` → all lines `missing` and run `failed` (`pricingService.ts:291-300`); per-line status classification (`:340-364`); item identity check → `item_mismatch` (`:440-448`); UOM check → `uom_mismatch` (`:450-461`); explicit `priceIsZero` never `usableForOrder` (`:466`); `negative_unit_price`/`line_status_rejected` handling (`:470-472,494-496`); missing lines → `status: "missing"` (`:432-435`). 40+ fixture tests.

## 9. Estimate Architecture — **FAIL**

- ❌ **Customer/tenant-facing multi-supplier price comparison exists**: `src/components/templates/TemplateLivePricingPanel.tsx:46,210-289` renders one column per supplier (`SUPPLIERS = ["srs","abc","qxo"]`) with unit price/SKU/color/branch side-by-side. Backed by `supabase/functions/template-supplier-pricing/index.ts:92-99,156-291,293-429`. Mounted in `CalcTemplateEditor.tsx`, route `/templates/calc-editor/:templateId`.
- ❌ `template_basis_unit_cost` is a dead column — present in `types.ts:27665,27689,27713`; no code reads/writes it.
- ❌ `procurement_cost_ledger` and `benchmark_update_suggestions` have zero producers/consumers (only `types.ts` references).
- Fix: gate/remove the multi-supplier comparison surface; wire `template_basis_unit_cost` as the estimate-calc source; implement the producer/consumer for `benchmark_update_suggestions`.

## 10. Mapping Gate — PARTIAL

- ✅ Rigorous gate in `src/lib/abc/mappingState.ts`: approved-only (`:104-107`), review flag (`:109-111`), exact color (`:113-115`), exact UOM in `valid_uoms` (`:117-123`), branch verified (`:125-131`), `canPrice` allow-list (`:86`). Consumed by `SupplierVerifyPricingPage.tsx:268-274`.
- ❌ **Bypassed by** `template-supplier-pricing/index.ts:317-357`, which resolves ABC SKUs via fuzzy name match (`>= 0.5` score) and immediately prices without approval/color/UOM/branch gates, then writes `abc_sku` back to `estimate_calc_template_items` (`:359-369`) — silently promoting an unapproved guess.
- Fix: route the template pricing path through `mappingResolver`/`mappingState`; never auto-persist SKU from a fuzzy match.

## 11. Order Builder — PARTIAL

- ✅ Deterministic shared builders (`orderService.ts:227-381`; `orderProduction.ts:262-440`) that reload trusted fields from DB (`:181-256,316-376`).
- ✅ Production `place_order`/`submit_order` **rejects pre-shaped `body.order`** (`abc-api-proxy/handler.ts:1913-1920`; `supplier-api/abc-proxy-handler.ts:1964-1971`).
- ✅ DC contact hardcoded (`orderService.ts:264-273`).
- ✅ Idempotency: `payloadHash`+`idempotencyKey` computed and enforced (`orderService.ts:355-371`; `handler.ts:1957-1976`).
- ❌ **Unsafe `body.order` fallback remains in `submit_test_order`** on both handlers: `abc-api-proxy/handler.ts:1673,1684`; `supplier-api/abc-proxy-handler.ts:1776,1786`. No env/role gating.
- Fix: gate behind `environment === "sandbox"` + allowlist, or delete.

## 12. Order API — PARTIAL

- ✅ `POST /order/v2/orders` (`handler.ts:1904-1905,1955-1956`).
- ✅ `GET /orders/{orderNumber}` and `?confirmationNumber=` (`handler.ts:1341-1346`).
- ✅ Confirmation/order/transaction numbers persisted (`handler.ts:1756-1830`), but `transactionID` lives only inside `raw_payload` JSON — no first-class column.
- ❌ **No Order Templates endpoint** — no `order_template`/`get_template` action anywhere.
- ❌ **Order History is a raw DB read** (`SupplierOrderHistory.tsx:29-58`), no ABC-authoritative refresh action.
- Fix: add `order_templates` and `order_history` (list) actions; add `abc_orders.transaction_id` column.

## 13. Webhooks — PARTIAL

- ✅ `register_webhook` action + secret stored (`supplier-api/abc-proxy-handler.ts:2071,2148`).
- ✅ `ORDER_UPDATE` and `ORDER_INVOICED` handled (`supplier-webhook/index.ts:143-146,279-315`).
- ⚠ Dedup relies on DB `23505`/duplicate-key catch (`index.ts:224-233`) rather than an explicit `provider_event_id` uniqueness check in code.
- ❌ **Money fields trusted from webhook body**: `sub_total`, `tax_amount`, `total_amount` are taken from `inv?.subTotal/…` and upserted to `abc_invoices` (`index.ts:294-310`) without an authoritative re-fetch. `order_status` set from `pickAbcStatus(payload)` without a GET refresh (`:279-284`).
- ❌ No retry/backoff on downstream side-effect failures (invoice upsert failure just `console.warn`, `:312-314`).
- Fix: on `ORDER_INVOICED`/`ORDER_UPDATE`, re-fetch the authoritative order/invoice and persist re-fetched totals; add a retry queue for failed side-effects.

## 14. Purchase Confirmation — **FAIL**

- ❌ No confirmed-vs-quoted comparison; substitution handling absent (grep for `substitut` in invoice/`_shared/abc` returns zero).
- ❌ **`procurement_cost_ledger` never inserted** — only referenced from generated `types.ts`.
- ❌ **`benchmark_update_suggestions` never populated** — no trigger/producer/consumer.
- Fix: implement purchase-confirmation handler that captures confirmed price/qty/substitutions from ABC invoice response, computes variance vs quote, inserts into `procurement_cost_ledger`, and enqueues `benchmark_update_suggestions` above threshold.

## 15. Notifications — **FAIL**

- ❌ No shared ABC notifications module; grep for `Order Accepted|Submitted|Delivered|invoice_created|Invoice Created` returns zero.
- ❌ `supplier-webhook/index.ts` updates DB rows but never invokes any messaging function or inserts into a notifications table after `ORDER_UPDATE`/`ORDER_INVOICED`.
- ❌ `supplier-worker/index.ts:16-23` is 100% stubbed (`501 not_migrated` for every route).
- Fix: implement dispatch (Accepted, Submitted, Delivered, Invoiced) fired by the webhook path with persisted notification rows.

## 16. Error Handling — PARTIAL

- ✅ WAF detection (`waf.ts:8-28`), stable `499` sentinel (`http.ts:50-58`), mapped to `abc_waf_blocked` with interpretation (`errors.ts:23,48-49`).
- ✅ `429` mapped to `abc_429_rate_limited` (`errors.ts:29`).
- ❌ **No retry-with-backoff for ABC.** `callAbc` (`http.ts:21-59`) is a single `fetch`; no retry loop for 429/5xx/network.
- ✅ Zero-price rejection at order time (`orderService.ts:206-208`) and parse time (`pricingResponseParser.ts:46,502-503`).
- ✅ Comprehensive unavailable/rejected/malformed line classification (`pricingResponseParser.ts:46-52,338-539,664-681`).
- ⚠ Ship-To mismatch code path (`orderPayloadBuilder.ts:196 LINE_SHIP_TO_MISMATCH`) appears **dead** — handlers import `orderService.ts`/`orderProduction.ts` instead, which lack the equivalent per-line branch/ship-to mismatch check.
- Fix: add exponential-backoff+jitter (2–3 attempts) around `callAbc` for 429/5xx/network; do not retry WAF immediately. Reconcile `orderPayloadBuilder.ts` (remove or port checks into `orderService.ts`).

## 17. ABC Terms of Use — PASS (with caution)

- ✅ No customer-facing ABC-vs-SRS-vs-QXO comparison inside ABC-specific components (only an internal comment reference).
- ✅ No CSV/market-intel export function.
- ⚠ `AbcCatalogBrowser.tsx:472-481` "Dump entire branch catalog" bulk-pulls full-catalog pricing outside an order context. Confirm role gating (master/admin only) to stay clearly on the compliant side of ABC's ToU permitted-use language.
- ✅ No token pooling (see §1).
- ✅ Prices fetched only after ABC is the selected supplier context.

*Note*: Section 9's `TemplateLivePricingPanel` (multi-supplier comparison) is a **separate** ToU risk — it renders ABC pricing alongside SRS/QXO in the same tenant-facing table. That is called out under Section 9 as a `FAIL` and should be considered a ToU issue as well.

## 18. UI States — PARTIAL

- ✅ Real distinct states in `mappingState.ts:41-55,65-80` (`needs_abc_match`, `needs_color_selection`, `needs_uom_selection`, `needs_branch_verification`, `needs_review`, `ready_to_price`, `priced`, `price_unavailable`, `unavailable_at_branch`, `waf_blocked`, `error`); zero-price properly separated from success (`:136-159`).
- ❌ Generic "Pending" still shipped in `TemplateLivePricingPanel.tsx:70-75` (`row.status === "pending"` → literal `"Pending"`), sourced from `template-supplier-pricing/index.ts:170,275,414` emitting `status: "pending"` for real, distinguishable failure conditions (branch not configured, price missing, etc.).
- Fix: replace `"pending"` emissions with specific states from `AbcRowState`/`statesForPricingResult`; drop the "Pending" label from the badge.

## 19. Database Schema & RLS — PARTIAL

Live schema check via service-role DB query. All expected tables exist. All have `rowsecurity = true`.

| Table | tenant_id | RLS | Policies |
|---|---|---|---|
| abc_connections | ✅ | ✅ | 4 |
| abc_accounts | ✅ | ✅ | 2 |
| abc_ship_to_accounts | ✅ | ✅ | 2 |
| abc_branches | ✅ | ✅ | 2 |
| abc_account_branches | ✅ | ✅ | 2 |
| abc_catalog_items | ❌ | ✅ | 1 |
| abc_items | ✅ | ✅ | 2 |
| abc_item_family_members | ❌ | ✅ | 1 |
| abc_item_availability | ✅ | ✅ | 2 |
| abc_material_sku_mappings | ✅ | ✅ | 2 |
| material_supplier_skus | ✅ | ✅ | 2 |
| abc_price_cache | ✅ | ✅ | 2 |
| abc_price_requests | ✅ | ✅ | 2 |
| supplier_price_history | ✅ | ✅ | 2 |
| abc_orders | ✅ | ✅ | 2 |
| abc_order_lines | ✅ | ✅ | 2 |
| abc_order_job_links | ✅ | ✅ | 2 |
| abc_webhook_events | ✅ | ✅ | 4 |
| abc_webhooks | ✅ | ✅ | 2 |
| abc_oauth_callback_logs | ✅ | ✅ | 2 |
| abc_credential_audit | ✅ | ✅ | 2 |
| abc_api_audit | ✅ | ✅ | 1 |
| abc_tokens | ✅ | ✅ | **0 (service-role only — intentional)** |
| procurement_cost_ledger | ✅ | ✅ | 2 |
| benchmark_update_suggestions | ✅ | ✅ | 2 |
| materials | ✅ | ✅ | 2 |

Findings:
- ❌ `abc_catalog_items` and `abc_item_family_members` lack `tenant_id` and only carry a single policy — verify these are intended global catalog tables (read-only for all tenants). If any tenant-specific rows land here they cannot be RLS-scoped.
- ✅ `abc_tokens` intentionally has no policies (service-role only), matching its design comment.
- ✅ Token storage encrypted via bytea: `abc_tokens.access_token_enc bytea`, `refresh_token_enc bytea`. However `abc_connections` still exposes **plaintext** `access_token text`, `refresh_token text`, and `webhook_secret text` columns alongside the encrypted `client_secret_encrypted`. Confirm these plaintext columns are unused/nulled in production, or migrate to encrypted-only.
- ✅ `abc_api_audit` has only 1 policy — verify read/insert coverage.

## 20. Overall Production Readiness — **NOT READY**

Blockers before promoting the ABC integration to production:

1. **Section 2 (Tenant Isolation).** Fix `abc-api-proxy/handler.ts:469-483` to derive `tenant_id` from JWT or require `user_can_access_tenant()`; this is a cross-tenant data-access vulnerability.
2. **Section 4 (`familyItems: true`).** Without this the ABC catalog is incomplete — colors/branches don't come back.
3. **Section 5 (family-parent SKU guard).** Wire `mappingResolver` + `familyColorResolver` so orders cannot ship against a parent SKU.
4. **Section 6 (EA fallbacks).** Remove `?? "EA"` / `|| 'EA'` — they will produce wrong-UOM orders.
5. **Section 9 (multi-supplier comparison in `TemplateLivePricingPanel`).** ToU + business-rule violation.
6. **Section 11 (`body.order` in `submit_test_order`).** Reachable, unsafe.
7. **Section 13 (webhook money fields).** Re-fetch authoritative totals; add retry.
8. **Section 14 (`procurement_cost_ledger` + benchmarks).** Unimplemented business logic.
9. **Section 15 (notifications).** No user-facing signal on Accepted/Submitted/Delivered/Invoiced.
10. **Section 18 (`"pending"` masking).** Replace with real states.

Recommended once-through order: 2 → 4/5/6 (catalog+order safety) → 11 → 9/18 (UI) → 13/14/15 (post-order lifecycle) → 1 (scope separation) → 3/7 (sandbox fallback lockdown) → 12/16 (Order API + retry) → 19 (encrypted-only tokens on `abc_connections`).
