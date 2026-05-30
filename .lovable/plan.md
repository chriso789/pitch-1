# Plan: Supplier Connection Unification + ABC Row Pricing

## Priority 1 — Unify supplier connection state (hooks first)

**Goal:** One tenant-scoped source of truth per supplier. No public-portal session ever drives "connected" status. Connect button starts OAuth (ABC) not portal link.

### 1a. Shared hooks (single source of truth)
- `src/hooks/useSupplierDeveloperMode.ts` — returns `{ isDeveloper }` based on `useCurrentUser().is_developer` OR master role. Used to gate all dev surfaces.
- `src/hooks/useAbcConnectionStatus.ts` — already exists. Audit: confirm it's the only ABC status reader; export a `connect()` helper that invokes `abc-api-proxy` action `start_oauth` with tenant-scoped `state` and redirects.
- `src/hooks/useSrsConnectionStatus.ts` — already exists. Audit consistency with ABC shape (`state`, `isConnected`, `refresh`).
- `src/hooks/useQxoConnectionStatus.ts` — already exists. Same audit.

### 1b. Refactor every supplier surface to consume those hooks
ABC consumers that must switch to `useAbcConnectionStatus`:
- `src/components/settings/SupplierIntegrationsPanel.tsx` (card)
- `src/components/settings/ABCConnectionSettings.tsx`
- `src/components/settings/AbcTenantConnectCard.tsx` (if present)
- `src/components/settings/AbcDiagnosticsPanel.tsx`
- `src/components/orders/PushToSupplierDialog.tsx`

For each: remove any local `supabase.from('abc_connections').select(...)`, local `useEffect` status fetchers, or session-based heuristics. Render strictly off the hook.

### 1c. ABC Connect = OAuth, not portal
In `SupplierIntegrationsPanel.tsx`:
- Replace the ABC `Connect Account` `onClick` with `await startAbcOAuth(effectiveTenantId)` which calls edge function `abc-api-proxy` `{ action: 'start_oauth', tenant_id }` and `window.location.href = data.authorize_url`.
- "Open ABC Supply portal" link: render only when `isConnected === true`, styled as secondary link, never as Connect.
- SRS/QXO: same shape — Connect calls a tenant-scoped credential modal/OAuth (existing). Portal link only after connect.

### 1d. Disconnected vs connected UI per card
- Disconnected: show single primary `Connect <Supplier> Account`.
- Connected: hide Connect; show `Disconnect`, `Refresh`, `View Orders`, and optional secondary `Open Supplier Portal`.

## Priority 2 — Finish ABC row-level SKU / color / availability / pricing in `PushToSupplierDialog`

Files:
- `src/components/orders/PushToSupplierDialog.tsx`
- `src/components/orders/AbcCatalogControls.tsx` (already exists — extend)
- `src/lib/abc/abcApi.ts` (wrappers exist)
- `src/lib/abc/useAbcConnection.ts` (catalog hooks exist)

Add per-row when supplier === ABC:
1. **Catalog search cell** — `AbcCatalogControls` shows search → list of `{ item_number, description, color, uom }` scoped to selected branch (familyItems=true). Selecting a color writes the exact `abc_item_number`/`abc_color`/`abc_uom` to the row.
2. **Availability cell** — calls `getAbcAvailability([{ item_number }])` on item/branch change; renders `available | pending | unavailable | error`.
3. **Price cell (`AbcPriceCell` + `AbcPriceButton`)** — Button calls `getAbcPrice({ purpose: 'ordering', branch_number, ship_to_number, items: [{ item_number, uom }] })`. Render states:
   - priced → live unit + extended
   - `unit_price === 0 && !price_pending` → "$0.00 returned by ABC — price may be pending at branch"
   - `price_pending` → "Price pending"
   - unavailable / error → explicit messages
4. **Persist to `estimate_line_items`** on every change: `abc_item_number`, `abc_color`, `abc_uom`, `abc_price`, `abc_price_timestamp`, `abc_branch`, `abc_ship_to`, `abc_availability`, `abc_price_status`.
5. **Empty-row colSpan** bump to 6 when ABC selected.
6. **Submit gating:**
   - Disable until every ABC line has `abc_item_number`.
   - Zero/unavailable price → allow only with explicit confirm dialog.
   - Error → block unless developer override (`useSupplierDeveloperMode`).
7. **Submit payload:** include `abc_item_code`, selected `branch_number`, `ship_to_number`, color/uom (in dedicated fields or line comments).

## Priority 3 — Hide dev surfaces for normal tenants

Wrap each of these in `{ isDeveloper && ... }` from `useSupplierDeveloperMode`:
- `AbcDiagnosticsPanel` raw payload / callback log / WAF log sections
- Sandbox/staging environment labels in `SupplierIntegrationsPanel`, `ABCConnectionSettings`, `SRSConnectionSettings`, `QXOConnectionSettings`
- OAuth/token/callback URL displays
- Any "Enter credentials" manual paths surviving on ABC (should already be gone)

O'Brien tenant + master role: panels remain visible (developer mode true).

## Technical notes

- `abc-api-proxy` `start_oauth` action: confirm it exists in `supabase/functions/abc-api-proxy/index.ts`; if not, add it — generate Okta authorize URL with `state = { tenant_id, nonce }`, persist nonce to `abc_oauth_state` table, return `{ authorize_url }`.
- Tenant scoping invariant: every ABC supabase read passes `.eq('tenant_id', effectiveTenantId)`; every edge call relies on the function's `requireTenant` (server-side) — never trust client tenant.
- No DB migration needed if `estimate_line_items` already has the `abc_*` columns from the prior migration `20260530025254_*`. Verify and add only missing columns.

## Out of scope (deferred)
- QuickBooks OAuth onboarding (Phase C)
- Unified Supplier Order History (Phase D)
- Suppliers Hub route cleanup (Phase E)
