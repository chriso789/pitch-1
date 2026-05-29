
# ABC Supply: Customer-Grade Connect, Catalog Search & Live Pricing

Aligns Pitch's ABC integration with ABC's published Third-Party Aggregator (TPA) model: **server token for platform data, user token (OAuth + PKCE) for everything customer-specific**. Removes manual pre-auth branch/account entry, replaces the generic supplier order modal with ABC-native concepts (Job Account / Ship-To / Branch / Delivery), and adds catalog search, color-aware SKU mapping, and contextual live pricing.

Non-regression: keeps SRS workflow intact; preserves existing `pitch-crm-architecture-guard` rules (routes go through `abc-api` / `abc-worker` / `abc-webhook`, not new standalone functions); honors tenant isolation per `tenant-isolation-auditor` (every credential, ship-to, branch, mapping, pricing call scoped by `tenant_id` + `user_id`).

---

## 1. Two-layer integration model

**Platform layer (server token, shared across tenants)**
- Catalog ingest + delta refresh (`Get All Items`, `sinceLastModifiedDateTime`).
- Branch/location reference data.
- Webhook subscriptions.
- Filter inactive items before exposing to tenants.

**Tenant layer (user token, per connected user)**
- OAuth Auth Code + PKCE via ABC Okta.
- `offline_access` for refresh token.
- Ship-to / job account / branch discovery.
- Pricing, availability, order submission, order history, invoice history.

Strict rule: **no customer-specific call ever uses the server token.**

---

## 2. Customer-facing connect flow (replaces current form)

Today's UI asks for branch + ship-to + environment before auth. That's wrong for normal tenants.

New flow:
1. **Card**: "Connect ABC Supply" → single primary button "Sign in with ABC Supply".
2. Redirect to ABC Okta `/authorize` (PKCE, `offline_access` scope). Environment (sandbox vs prod) is resolved server-side from tenant/developer-mode context — never shown to normal users.
3. Callback → `abc-api /oauth/callback` exchanges code for tokens, stores per-user encrypted credential row scoped by `tenant_id` + `user_id`.
4. Immediately call `Search Accounts` → cache discovered `shipTos[]` with `branches[]` and `homeBranch`.
5. Post-connect confirmation:
   - Single ship-to + single home branch → auto-assign, show summary only.
   - Multiple → compact picker for default Job Account + primary Branch.
6. Connected state shows: account label, default branch, "Disconnect", "Last order", "Order history". Nothing else.

Developer-only surface (gated by `useSupplierDeveloperMode().showAdvanced`) keeps env selector, raw OAuth URLs, webhook tools, WAF/diagnostics — unchanged from current behavior, just hidden from normal tenants.

---

## 3. Data model changes

New / updated tables (all tenant-scoped, RLS + GRANTs per project rules):

- `abc_user_connections` — per `(tenant_id, user_id)` OAuth tokens, refresh token, expiry, scopes.
- `abc_ship_to_accounts` — discovered ship-tos per connection: `ship_to_number`, address, contacts, `is_default`.
- `abc_account_branches` — branches per ship-to: `branch_number`, name, `is_home_branch`.
- `abc_catalog_items` — platform-wide indexed catalog (item number, description, family_id, family_name, color name/code, UOMs, dimensions, is_active, last_modified). Full-text index on description + item_number.
- `abc_item_family_members` — sibling SKUs per family for color/variant lookup.
- `abc_material_sku_mappings` — replaces single-SKU-on-material. Maps `(tenant_id, material_id, color)` → ABC `item_number`. This is the color-aware mapping the current schema lacks.
- `abc_price_cache` — short-TTL cache keyed by `(ship_to_number, branch_number, item_number, uom, purpose)` to dedupe pricing calls within a session.

Existing `estimate_line_items.srs_item_code` pattern is generalized: line items get an optional `abc_item_number` + `abc_color` + `abc_uom` so the orderable identity is the specific colored SKU, not the family.

---

## 4. Edge function routes (no new standalone functions)

All added to existing grouped functions per architecture guard:

**`abc-api`** (authenticated tenant routes, `requireAuth` + `requireTenant`)
- `POST /oauth/start` — returns Okta authorize URL + PKCE challenge.
- `GET  /oauth/callback` — token exchange, ship-to discovery, persist.
- `POST /oauth/disconnect`
- `GET  /accounts` — list cached ship-tos/branches for current user.
- `POST /accounts/default` — set default ship-to + branch.
- `GET  /catalog/search?q=&branch=&color=` — proxies `Search Items`, merges with `abc_catalog_items` index.
- `GET  /catalog/family/:itemNumber` — returns family siblings for color picker.
- `POST /availability` — body: `{ branch_number, items: [{item_number, qty, length?}] }` → `Search Item Availability`.
- `POST /price` — body: `{ ship_to_number, branch_number, purpose, lines: [...] }` → `Price Items`. Always passes explicit `uom`. Handles `$0.00 = price pending` as warning, not error.
- `POST /orders/submit` — Place Order with `branchNumber` + `shipTo.number` + optional `shipTo.address` override.
- `GET  /orders` / `GET /orders/:id`
- `GET  /invoices`

**`abc-worker`** (service-role / `INTERNAL_WORKER_SECRET`)
- `POST /catalog/full-sync` — initial `Get All Items`.
- `POST /catalog/delta-sync` — incremental using `sinceLastModifiedDateTime`; filters inactive.
- Token refresh cron for `abc_user_connections` nearing expiry.

**`abc-webhook`** (public, signature-verified, tenant resolved from payload)
- Order status updates → unified inbox / project timeline.

All routes declare auth mode explicitly per tenant-security-enforcer. Server resolves `tenant_id` from JWT; client-supplied `tenant_id` is ignored.

---

## 5. Catalog search + color-aware SKU mapping UX

Material line in estimate / order:
- Inline search box → calls `/catalog/search`, debounced.
- Result row: `Item Description · Color chip · ABC SKU · UOM · Branch availability badge`.
- If the Pitch material line has a color, pre-filter family members by that color name/code (text match, not images — image URLs unreliable per ABC docs).
- On select, silently call `/availability` for the chosen branch; if unavailable, show alternate siblings.
- Persist mapping in `abc_material_sku_mappings` so the next estimate auto-suggests the same SKU.

Materials table columns (when ABC selected): `Item · Color · ABC SKU · UOM · Qty · Live Price · Availability`. Replaces today's plain SKU text cell.

---

## 6. Live pricing

- Triggered after ship-to + branch are set on the order context.
- `purpose=estimating` in estimate views, `purpose=ordering` in Push-to-Supplier modal.
- UOM sent explicitly per line — never let ABC default to stocking UOM (SQ vs BD shingle trap).
- `$0.00` response → render line with amber "Price pending at branch" badge, still submittable.
- Refresh button per line + bulk refresh for the order; results cached via `abc_price_cache` for the session.

`useLivePricing` hook gets a new `provider: 'abc'` branch that calls `abc-api/price` instead of the generic `material-pricing-api`.

---

## 7. Order modal refactor (`PushToSupplierDialog` when vendor=ABC)

Today: generic "branch code" + "ship-to address" text fields.

New (ABC variant):
- **Job Account (Ship-To)** — dropdown from discovered ship-tos, defaulted.
- **Branch** — dropdown from branches associated with that ship-to, home branch defaulted.
- **Delivery address** — separate section, prefilled from ship-to but editable; sent as `shipTo.address` override only when changed.
- Line table uses the new ABC columns above.
- Submit hits `abc-api /orders/submit`.

If the tenant has exactly one ship-to and one branch, both selectors collapse to a read-only summary line.

---

## 8. Normal-tenant vs developer UX separation

- `ProjectMaterialsTab` already conditionally renders `AbcDiagnosticsPanel`. Keep it, but ensure it's gated by `useSupplierDeveloperMode().canSeeRawDiagnostics`.
- Remove env labels, OAuth URLs, scopes, webhook register/list, WAF notes from the normal supplier card. Move them under a "Developer" subsection only visible when `showAdvanced` is true.
- Same separation principle applied to SRS and QXO cards (UI-only pass for consistency — no backend changes for SRS/QXO in this plan).

---

## 9. Out of scope for this plan

- SRS/QXO backend rewrites (only UI consistency pass).
- Image-based color picker (text-first per ABC doc reliability).
- Invoice reconciliation UI beyond list view.
- Multi-user ABC token sharing within a tenant (each user authenticates their own).

---

## 10. Rollout order

1. DB migrations (tables + RLS + GRANTs + indexes).
2. `abc-api` OAuth + accounts routes; replace connect UI.
3. `abc-worker` catalog full + delta sync; populate index.
4. Catalog search route + UI search/match in estimate line items.
5. Availability + family/color picker.
6. Live pricing route + hook + UI badges.
7. Order modal refactor (ABC variant) + `/orders/submit`.
8. Order history + status webhook wiring.
9. Hide developer surface from normal tenants; verify with `useSupplierDeveloperMode`.

Each step ships behind a per-tenant feature flag (`abc_v2_enabled`) so the legacy form stays available until the new flow is verified end-to-end against ABC sandbox.

---

## Technical notes

- PKCE: `code_verifier` stored server-side in a short-TTL row keyed by `state`; never round-tripped to the browser.
- Token storage: AES-encrypted at rest, decrypted only inside `abc-api`/`abc-worker`. Never returned to frontend.
- Pricing cache TTL: 15 min for `estimating`, 60 s for `ordering`.
- `abc_catalog_items` search: Postgres `tsvector` on `item_description || ' ' || item_number || ' ' || color_name`, GIN index.
- Audit log entries for: connect, disconnect, default ship-to/branch change, order submit, token refresh failure.
- All ABC API errors mapped to safe user-facing messages; raw responses only surfaced in developer diagnostics panel.
