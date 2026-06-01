# ABC Integration Hardening — 3 Phases

Shipping in order so each phase is verifiable before moving on.

---

## Phase 1 — Order Submission Fixes (ships first)

**Goal:** Next ABC order accepted cleanly by the branch.

**Backend — `supabase/functions/abc-api-proxy/handler.ts`** (order builder, ~line 832–1100):
1. **Jobsite contact (DC)** — append a contact to `shipTo.contacts[]` with:
   - `functionCode: "DC"`
   - `name`, `email`, `phones: [{ number, type: "WORK" }]`
   - Source these from request body (`jobsiteContact: { name, phone, email }`), which the dialog will populate from the project's primary contact.
2. **Correct UOM per line** — require `uom` per item in the request payload. Reject (HTTP 400 `missing_item_uom`) if any line lacks one. No silent default. UOM comes from the Product API response stored alongside the item.
3. **Echo price from Price Items endpoint** — require `unit_price` per line. If absent, call `/price/v2/items` server-side with `(shipToNumber, branchNumber, itemNumber, uom)` and use the returned price. Persist the resolved price into the order payload so the branch sees the same number we showed the user.
4. **`itemDescription`** — already pulled from Product API; ensure it's included on every line submitted to ABC.

**Frontend — `src/components/orders/PushToSupplierDialog.tsx`:**
- For ABC orders, attach `jobsiteContact` (name/phone/email) from the project contact to the submit payload.
- Per-line UOM must come from the catalog item (Product API), not a free-text field. If unknown, block submit with an inline error.
- Show the resolved unit price (from `/price`) in the row before submit; allow override but default to the API value.

**Verification:** Test a submission against ABC sandbox via `supabase--curl_edge_functions` and confirm the order JSON contains `shipTo.contacts[{functionCode:"DC"}]`, every line has valid `uom`, `unitPrice`, and `itemDescription`.

---

## Phase 2 — Integration Setup UI (Ship-To + Branch picker)

**Goal:** After OAuth, user picks one Ship-To + one Branch; persisted as their default.

**Backend:**
- New table column on `abc_connections`: `default_ship_to_number` (already has `default_branch_code`).
- `abc-api /accounts` already returns `accounts[].branches[]`. Frontend will hide accounts where `branches.length === 0` per spec.
- New route `POST /accounts/default` on `abc-api`: body `{ ship_to_number, branch_number }`, validates the pair exists under this tenant's connection, then upserts `abc_connections.default_ship_to_number` and `default_branch_code`.

**Frontend — `src/components/settings/ABCConnectionSettings.tsx`:**
- After connection, render two dependent dropdowns:
  - **Ship-To** — `useAbcAccounts()` filtered to `branches.length > 0`. Label: `${name} — ${ship_to_number}`.
  - **Branch** — populated from selected ship-to's `branches[]`. Label: `${branch_number} — ${name}, ${city}, ${state}`.
- Save button calls `/accounts/default`; on success, show "Default set" badge.
- Existing branches table shrinks to a read-only summary under the picker.

**Verification:** Connect, pick a Ship-To with branches, save, reload page — selection persists. Ship-Tos with empty `branches[]` do not appear.

---

## Phase 3 — Branch-Aware Catalog & Pricing

**Goal:** Catalog/price views only show items truly available at the user's selected branch; $0 prices are gated by an availability re-check.

**Backend — `supabase/functions/abc-api/index.ts` + proxy:**
1. **`/catalog/search`** — accept `branch_number` query param (default = tenant's `default_branch_code`). Proxy to ABC Product API with `embed=branches`. Server-side filter: keep only items whose `branches[]` includes the requested branch_number. Return real `items[]` (not the current stub) including `item_number`, `description`, `family_id`, `color_name`, `uoms[]` (full UOM list from response).
2. **`/price`** — when `unit_price === 0`, re-call ABC Product API for that item with `embed=branches`; if branch is not listed, return `price_pending: true, reason: "not_available_at_branch"` instead of `$0.00`. Otherwise return the $0 with `confirmed_zero: true`.
3. New route `/catalog/item/:itemNumber` — returns full item including UOM list and branch availability, used by the order dialog to lock UOM to a valid value.

**Frontend:**
- `AbcCatalogBrowser` — surface the active branch in the header ("Filtered to branch 1234 — Houston Heights"). Show "Not available at your branch" if API returns `pending: branch_unavailable`.
- `PushToSupplierDialog` (ABC path) — UOM field is now a `<Select>` whose options come from the catalog item's `uoms[]`. Selecting an item auto-picks the default UOM. Block submit if UOM is empty.
- Price column shows `Pending — not at branch` when `not_available_at_branch`.

**Verification:** Search "shingle" in catalog browser → all results listed as available at the selected branch. Submit an order with an item that returns $0 → see availability gate trigger.

---

## Technical Notes

- All three phases preserve tenant isolation (`requireTenant` on every abc-api route; service-role queries in proxy filter by `tenant_id`).
- No DB migrations needed for Phase 1. Phase 2 adds one column. Phase 3 adds none.
- Each phase is independently shippable; I'll pause after Phase 1 and Phase 2 for you to verify against the live ABC sandbox before continuing.
