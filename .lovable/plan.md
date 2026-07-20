# ABC Supply Integration Hardening

Large multi-phase backend + frontend hardening for the ABC Supply integration. Contractor material orders will only reach ABC when the exact color-specific child SKU is verified at the selected branch, priced through Price Items, and shipped in a compliant Place Orders payload. QXO, supplier comparison UI, and estimate-template duplication are explicitly out of scope.

## Phase 0 — Trace live contract
- Confirm the active browser route (`/functions/v1/supplier-api/abc/proxy`) and every legacy alias (`abc-api-proxy`, `submit_order`, `place_order`, `submit_test_order`).
- Map data path: contractor material order → canonical line → approved ABC mapping → Product API verify → Price Items → order payload → `abc_orders` persistence.
- Enumerate every place an ABC SKU / UOM / description / color / qty / price / Ship-To / branch can currently be guessed. Document in `docs/abc-integration-trace.md`.

## Phase 1 — Normalized ABC catalog model
- New shared type `NormalizedAbcCatalogItem` + parser in `supabase/functions/_shared/abc/catalog-normalize.ts`.
- Preserves itemNumber, itemDescription, color.name/code, familyItems, uoms[], branches[], status, dimensional lengths. No `[object Object]`. No UOM collapse.
- Fixtures + tests: simple, family parent, family children, multi-UOM, embedded branches, dimensional, inactive.

## Phase 2 — Product search returns color-specific items
- Server action `search_products` uses `POST /product/v1/search/items?familyItems=true` with `embed:["branches","variations"]` and pagination.
- Response normalized server-side. Each color child is its own selectable result. Child needs exact branch verification unless embedded availability is authoritative.

## Phase 3 — Exact child SKU branch verification
- New action `verify_catalog_item({environment, itemNumber, branchNumber})`.
- Returns `{verified, item, failures[]}` with codes: `item_not_found | item_inactive | unavailable_at_branch | no_valid_uoms | dimensional_length_required | abc_waf_blocked | abc_upstream_error`.
- Color-family child is not order-ready until this passes.

## Phase 4 — Supplier mapping model
- Extend `template_item_supplier_mappings` with ABC fields (supplier_item_number/description, family, color, valid_uoms, selected_uom, branch_number, ship_to_number, verification/approval timestamps, mapping_status, match_confidence, raw payload, stale_at).
- Statuses: `unmapped | suggested | needs_review | approved | rejected | stale | unavailable_at_branch`.
- Tenant-scoped RLS + indexes. Branch/Ship-To/itemNumber/UOM/color change invalidates or reverifies.

## Phase 5 — Remove unsafe auto-mapping
- Rewrite `template-supplier-pricing` matcher: ranked candidates using manufacturer + family + type + color + UOM + tokens. No fuzzy auto-approve. Color-bearing items always require review unless prior approved exact canonical mapping.

## Phase 6 — Material order → ABC mapping resolver
- Keep contractor lines supplier-neutral. Resolver requires approved mapping, exact child SKU branch verification, valid Product API UOM, explicit approved UOM conversion.
- `item_name` / `srs_item_code` / unverified typed SKUs can never become ABC itemNumber. Unmapped lines block submission with repair action.

## Phase 7 — Pricing hardening
- `price_items`: reject `abc_product_uom_required`, require approved mapping + itemNumber + Product API UOM + Ship-To + branch + qty + fresh verification.
- Match response by line id then itemNumber. Line ok only when line-level status successful, numeric price present, identity matches.
- Persist per-line: id, itemNumber, description, requested/returned UOM, unit/extended price, status, availability, branch, ship-to, raw, checked_at, mapping id.
- $0 → verify availability, mark `zero_price_available_contact_branch | unavailable_at_branch | zero_price_unresolved`, block order.
- Continue writing `abc_api_audit`, `supplier_pricing_runs`, `supplier_price_history`. Never mutate signed estimate cost.

## Phase 8 — One safe production order builder
- Single server-side builder. Hard-disable browser-trusted `body.order` bypass and legacy paths that accept `item_name`/`srs_item_code`/unapproved `abc_item_code`/guessed UOM/optional DC contact.
- Reload trusted records server-side. Preflight rejects lines with unapproved mapping, stale verification, invalid UOM, missing description, color mismatch, unavailable branch, missing/failing Price Items echo, zero/unresolved price, mismatched pricing identity, missing DC contact, missing Ship-To/branch, invalid address.
- Payload: idempotent requestId, PO, branch, Ship-To, deliveryService, typeCode, delivery date, currency, address, DC contact (functionCode=DC + name/email/phone). Lines echo exact SKU + description + Product API UOM + Price Items unit price. Place Orders body is an array.

## Phase 9 — Color UX
- `AbcCatalogControls` + `PushToSupplierDialog` show canonical name, requested mfr/family/color, selected ABC itemNumber + exact description + color, UOM dropdown, branch verification badge, mapping status, price status, last checks.
- Buttons: Find ABC Match, Select Exact Color, Verify at Branch, Approve Mapping, Change Mapping, Refresh Price. No comparison grid.

## Phase 10 — Account/Ship-To/branch rules
- Ship-Tos from ABC account sync; empty-branch accounts not selectable; branch must belong to selected Ship-To; connection-wide branch cannot override account relationship; production users cannot free-type Ship-To/branch outside admin repair flow; Ship-To change revalidates.
- Remove O'Brien sandbox defaults from prod paths. Demo defaults gated by `environment=sandbox && sandboxDemo && tenant authorized`.

## Phase 11 — Dimensional products
- Expose valid lengths, require selection, carry into pricing + order line per ABC contract. Tests for missing/valid length.

## Phase 12 — Security + tenant isolation
- Server-resolved tenant only. Reject `body.tenant_id`. Service-role writes always filter by resolved tenant. Cross-tenant reads blocked across connections/accounts/branches/mappings/pricing/orders/audit. No token/secret/Auth header logging. CORS not widened.

## Phase 13 — Tests
- Catalog, mapping, pricing, order, sandbox tests as specified in the brief.

## Phase 14 — Delivery report
- `docs/abc-hardening-delivery.md` with files changed, migrations, live route map, before/after contracts (catalog, pricing, order), tests + results, ABC doc ambiguities, WAF-blocked items, and a production-readiness matrix (OAuth / Ship-To+branch sync / catalog / color mapping / UOM validation / branch availability / Price Items / zero-price / preflight / Place Orders / tracking / tenant isolation).

## Stop conditions
- Do not declare production-ready without proven exact color SKU + UOM + branch availability + Price Items echo.
- No fabricated evidence when ABC WAF blocks calls.
- Do not proceed to QXO.
- Legacy unsafe order submission is replaced by a safe adapter or hard-disabled — not preserved.

## Technical notes
- All ABC HTTP work stays in `supabase/functions/supplier-api/abc-proxy-handler.ts` + `_shared/abc/*`. Frontend touches limited to `PushToSupplierDialog.tsx`, `AbcCatalogControls.tsx`, `useAbcCatalog.ts`.
- Migrations: mapping columns + statuses + indexes + RLS; new pricing history columns if needed; no changes to signed estimates.
- Existing `abc_api_audit`, `supplier_pricing_runs`, `supplier_price_history`, `abc_orders`, `abc_order_lines` reused.
- Idempotency via existing `supplier_idempotency_keys` (order requestId).

Given the size, I will land this in reviewable chunks in this order: Phase 0 trace doc → Phase 1 normalizer + tests → Phase 4 migration → Phases 2/3 catalog+verify → Phase 5/6 mapping resolver → Phase 7 pricing → Phase 8 order builder → Phase 9 UX → Phase 10/11 rules + dimensional → Phase 12 security sweep → Phase 13 tests → Phase 14 delivery doc. Each chunk is independently reviewable and does not break the current flow until the safe path replaces it.
