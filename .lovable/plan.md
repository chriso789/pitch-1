# Plan: Tenant-Safe Supplier Integration UI

`useSupplierDeveloperMode()` already exists in `src/lib/supplierAccess.ts` (returns `isDeveloper`, `isObrien`, `showAdvanced`, `allowSandboxDefaults`). I'll extend it with the granular flags requested and route every supplier surface through it. No backend/schema changes.

## 1. Extend the gating helper

`src/lib/supplierAccess.ts` — return:
```
{
  isDeveloperMode,          // master | platform_admin | is_developer
  isObrien,                 // O'Brien sandbox tenant
  showAdvanced,             // isDeveloperMode || isObrien
  allowSandboxDefaults,     // showAdvanced
  canSeeRawDiagnostics,     // showAdvanced
  canManageWebhooks,        // isDeveloperMode (admin-only, never normal tenants)
  canChangeEnvironment,     // isDeveloperMode
}
```
Keep old aliases so existing callers (`AbcDiagnosticsPanel`) keep working.

## 2. ABC settings — `src/components/settings/ABCConnectionSettings.tsx`

Normal tenant view (what stays visible):
- Header: "ABC Supply" + connection status badge (Connected / Not Connected / Expired)
- Account # input
- Branch / Ship-To input (only the operational fields, no Sandy defaults)
- "Connect ABC Supply Account" button (OAuth) + Disconnect
- "View Order History" link
- Last order / last sync

Gated behind `isDeveloperMode` (or `showAdvanced` where O'Brien needs sandbox continuity):
- Environment selector (Sandbox/Production toggle) — `canChangeEnvironment`
- OAuth Authorize URL, Token URL, Redirect URI, Scopes copy boxes
- Client ID / Secret status, raw token JSON, "Test Token" console
- WAF allowlist / egress IP guidance
- Sandbox default helpers (Sandy 2010466-2, Branch 1209) — `allowSandboxDefaults` only
- Webhook register/list panel (`AbcWebhookPanel`) — `canManageWebhooks`
- Raw audit / callback log viewer — `canSeeRawDiagnostics`

When developer-only env selector is hidden, environment is implicit: production for normal tenants, sandbox for O'Brien.

## 3. SRS settings — `src/components/settings/SRSConnectionSettings.tsx`

Normal view:
- Connect SRS Account, Customer Code, Integration Key (or invoice validation fields if SRS requires), Save/Connect, Disconnect, View Orders, status badge.

Hidden behind `isDeveloperMode` / `showAdvanced`:
- "Environment: Staging (Testing)" label and any Sandbox/Prod selector (this is the explicit bad example to remove)
- Base URL / token URL / scopes
- Sandbox test login + Sandy test ship-to / branch defaults (`allowSandboxDefaults`)
- Raw API response inspector, reconciliation debug, webhook tooling

## 4. QXO settings — `src/components/settings/QXOConnectionSettings.tsx`

Normal view:
- Connect QXO Account, customer/account fields, Save/Connect, Disconnect, View Orders, status badge.

Hidden behind `isDeveloperMode`:
- Environment selector, OAuth/token URLs, scopes
- Raw payload inspector, audit log

## 5. Supplier dashboard — `src/components/settings/SupplierIntegrationsPanel.tsx`

Restructure into 4 clean cards: ABC Supply, SRS Distribution, QXO, Billtrust (Coming Soon / Connect Payments).

Each card (normal tenants):
- Logo + name
- Status badge: Connected / Not Connected / Expired
- Buttons: Connect / Disconnect / View Order History
- "Last order" + "Last sync" metadata

No environment labels, no sandbox chips, no "Staging" pills for normal tenants. Developer mode adds an "Env: sandbox/prod" chip and a "Developer Tools" expander per card.

## 6. Order history — Supplier Order History view

Normal tenant inspect drawer shows only: supplier, project, PO, order #, confirmation #, status, submitted, last updated, clean status timeline.

Behind `canSeeRawDiagnostics`: raw request/response JSON, audit endpoint URLs, webhook payloads, transaction IDs, request IDs. (This mirrors the gating already implemented in `AbcDiagnosticsPanel`; apply same pattern to `SrsDiagnosticsPanel` and the QXO equivalent.)

## 7. Project Materials tab — `src/components/orders/ProjectMaterialsTab.tsx`

Normal users:
- "Push to Supplier" lists only connected suppliers; disconnected ones show "Connect in Settings" with a deep link to `/settings` → Integrations → Suppliers
- `LiveOrderTracker` stays (operational order status for their own project)
- `SrsDiagnosticsPanel` and `AbcDiagnosticsPanel` render in **normal mode** (operational only)

Developer mode: panels expand to show raw diagnostics (already done for ABC; replicate for SRS).

## 8. O'Brien isolation

`isObrien` is already tenant-scoped via `useCompanySwitcher().activeCompany.tenant_name`. Sandbox defaults / Sandy values / O'Brien notes render only when `isObrien || isDeveloperMode`. Order history queries already filter by `tenant_id` via existing RLS — no second-tenant leakage possible from the frontend gating change. I'll add a note but not change DB policy.

## 9. Acceptance verification

After the edits I'll:
- Load `/settings` → Integrations → Suppliers as the current (O'Brien) tenant, screenshot the developer view.
- Re-render with `isDeveloperMode=false` (simulated via a non-master tenant switch) and screenshot the clean view.
- Confirm SRS no longer shows "Environment: Staging (Testing)" for normal tenants.

## Files to change

- `src/lib/supplierAccess.ts` — extend hook return shape
- `src/components/settings/ABCConnectionSettings.tsx`
- `src/components/settings/SRSConnectionSettings.tsx`
- `src/components/settings/QXOConnectionSettings.tsx`
- `src/components/settings/SupplierIntegrationsPanel.tsx`
- `src/components/settings/abc/AbcWebhookPanel.tsx` (wrap whole panel in `canManageWebhooks`)
- `src/components/orders/SrsDiagnosticsPanel.tsx` (mirror ABC gating)
- `src/components/orders/ProjectMaterialsTab.tsx` (connected-supplier filter + "Connect in Settings" affordance)

No edge functions, no migrations, no schema changes.
