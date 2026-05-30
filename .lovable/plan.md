
# Supplier Onboarding Overhaul — Phased Plan

This spec is a full product surface rewrite across 4 suppliers + a new unified hub + project ordering + live pricing. It's too large for one pass without splitting; the prior message thread already established the order: unify connection state → hide dev surfaces → OAuth → pricing rows. ABC tenant card is done. The remaining work is split into 5 phases below.

## Phase A — SRS & QXO tenant connect cards (next, this turn)

Mirror what was done for ABC. Hide every developer surface behind `useSupplierDeveloperMode().canSeeRawDiagnostics`.

- Create `src/components/settings/SrsTenantConnectCard.tsx`
  - Minimal onboarding modal: Customer Code + Integration Key (required), optional invoice trio
  - Calls existing `srs-api` validate/sync route; on success shows: Customer Code, Branch Count, Ship-To Count, Last Sync, View Orders, Disconnect
- Create `src/components/settings/QxoTenantConnectCard.tsx`
  - Minimal account-link modal: Customer Number, Account Number, optional API Key
  - Same connected-state surface
- Gate `SRSConnectionSettings.tsx` and `QXOConnectionSettings.tsx`: normal tenants see only the new card; dev/O'Brien sees the legacy panel underneath.
- Add a `useSrsConnectionStatus` and `useQxoConnectionStatus` hook pair next to `useAbcConnectionStatus` so all three cards share the same state shape.

## Phase B — Unified Suppliers hub route

- New page `src/pages/SuppliersHub.tsx` at `/settings/integrations/suppliers`
- Renders ABC / SRS / QXO / QuickBooks / Billtrust (coming soon) cards in a grid
- Uses the tenant connect cards from Phase A + the existing ABC card
- Add row in `IntegrationsSettings` tab list pointing here (or replace Suppliers section in Settings.tsx)

## Phase C — Supplier Orders page

- Route `/settings/integrations/suppliers/orders`
- Read-only table unioning `abc_orders`, `srs_orders`, `qxo_orders`, scoped by `useEffectiveTenantId()`
- Columns: Supplier, Project, PO, Order #, Confirmation #, Status, Submitted, Last Updated, Total, Inspect
- "Inspect" opens existing diagnostics dialogs (dev-only details still gated)

## Phase D — QuickBooks OAuth-only card

- Remove Realm ID / Company ID / Client ID / Client Secret inputs from `QuickBooksSettings.tsx` for normal tenants
- Replace with a single "Connect QuickBooks" button → existing Intuit OAuth start route → callback persists tokens
- Connected state surface: Company Name, Last Sync, Sync Status, Disconnect
- Keep dev-mode legacy panel under the same `canSeeRawDiagnostics` gate

## Phase E — PushToSupplierDialog: row-level live pricing

- Per-line item: SKU search (`searchAbcCatalog`), color variant select, availability check, then `getAbcPrice({purpose:'ordering', branch, ship_to, items})`
- Persist `abc_item_number`, `abc_color`, `abc_uom`, `abc_price`, `abc_price_timestamp` on the estimate line
- Branch + Ship-To dropdowns sourced from `useAbcAccounts()` — no manual numeric entry
- Mirror flow for SRS/QXO once their catalog routes exist; until then show "Pricing not available for <supplier>" instead of $0.00
- Per the prior agreement: this phase only starts after Phases A–D land and connection state is proven stable

## Technical notes

- All new cards consume `useSupplierDeveloperMode()` and share the existing `useAbcConnectionStatus` shape.
- No backend / edge-function changes in Phases A–C; everything routes through existing `abc-api`, `srs-api`, `qxo-api`.
- Phase D requires confirming the existing `quickbooks-oauth-start` / `-callback` functions are wired (will verify before editing UI).
- Phase E is the only phase that touches estimate-line-item persistence; will require a migration to add the `abc_*` columns if they don't exist.

## Out of scope for this plan

- Tenant allowlist rollout for the measurement-mapping work (separate track, still NO-GO per prior memory).
- Any production write against `alxelfrbjzkmtnsulcei` from the measurement-mapping scripts.

## Proposed execution

Approve Phase A now; I'll implement it this turn (2 new cards + 2 hooks + 2 settings-page edits). Phases B–E follow in subsequent turns so each lands reviewable.
