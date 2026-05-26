## Goal

Ship two narrow, independently verifiable slices: (A) a per-connection QBO sandbox↔production switch so prod tenants can transact while sandbox stays available for QA, and (B) a tight verification of last loop's `pre_phase3_5_preempt` fix on a fresh Fonsica row — tests first, then live data.

---

## Slice A — QBO per-connection sandbox/production switch

### Current state (verified)

- `qbo_connections` rows already carry `is_sandbox` (used by `qbo-check-projects-api` and `qbo-fetch-items`).
- `_shared/qbo-auth.ts` picks host from the global `QBO_ENVIRONMENT` env (not per-connection).
- Five functions hardcode `https://quickbooks.api.intuit.com` and will hit production no matter what the connection says:
  - `qbo-customer-sync` (3 call sites)
  - `qbo-invoice-create` (2)
  - `qbo-invoice-send` (3)
  - `qbo-sync-payment` (2)
  - `qbo-webhook-handler` (2)
  - `qbo-oauth-connect` companyinfo verify call (1)
- `qbo-oauth-connect` `/status` reports `environment: QBO_ENVIRONMENT` — informational only, not authoritative per-connection.

### Changes

1. **Shared host helper** (`supabase/functions/_shared/qbo-host.ts`)
  - `qboHost(connection: { is_sandbox?: boolean | null }): string` → returns `https://sandbox-quickbooks.api.intuit.com` when `is_sandbox === true`, else `https://quickbooks.api.intuit.com`.
  - `qboHostFromRealm(supabase, realmId)` convenience for webhook paths that only have `realm_id`.
2. **Refactor the 6 functions** above to import `qboHost(connection)` and replace every hardcoded `https://quickbooks.api.intuit.com` with `${qboHost(connection)}`. For `qbo-webhook-handler`, look up the connection by `realm_id` first (it's keyed off realm anyway) and use its `is_sandbox`.
3. **OAuth callback writes `is_sandbox` correctly.** In `qbo-oauth-connect` callback, set `is_sandbox = (QBO_ENVIRONMENT === 'sandbox')` on insert/upsert so newly-created connections inherit the OAuth app's environment. (Intuit OAuth endpoints are environment-agnostic; what matters is which client_id was used.)
4. `**/status` endpoint clarifies both layers**: report `qbo_environment_secret` (global default for new connections) plus, when authenticated and a connection exists, `connection_is_sandbox`. No behavior change beyond the existing payload.
5. **Production cutover doc note (chat only, no code)** — to flip a tenant to production:
  - Owner sets `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` to the Intuit **Production** app keys and `QBO_ENVIRONMENT=production`.
  - Tenant disconnects + reconnects QBO from Settings; new row written with `is_sandbox=false`.
  - Sandbox tenants keep working as long as their row still has `is_sandbox=true`.

### Acceptance

- Search returns **zero** remaining `quickbooks.api.intuit.com` literals in `supabase/functions/qbo-*` outside `qbo-host.ts`.
- A sandbox-connection invoice create hits `sandbox-quickbooks.api.intuit.com`; a prod-connection invoice create hits `quickbooks.api.intuit.com` (verified by a unit test on `qboHost`).
- `/status` for the current master returns the existing payload plus a new `connection_is_sandbox` field when a connection row exists.

---

## Slice B — Fonsica `pre_phase3_5_preempt` verification

### Step 1 — Tests first

Run the existing Deno tests that cover the contract:

- `supabase/functions/start-ai-measurement/__tests__/registration-pretopology-terminal-payload.test.ts` (the one added last loop)
- `aerial-graph-survives-cpu-preempt.test.ts`
- `cpu-preempt-threshold.test.ts`
- `raw-perimeter-and-debug-contract.test.ts`
- `aerial-graph-fonsica-shaped-input.test.ts`

Pass criteria (must all be green):

- `pre_phase3_5_preempt.executed === true`
- `pre_phase3_5_preempt.aerial_graph_rebuilt_from_final_payload === true`
- `pre_phase3_5_preempt.work_units_preserved === true`
- `eave_edges.length >= 6` and `perimeter_edges.length >= 6`
- `cpu_budget_elapsed_ms < 75000` AND `cpu_budget_remaining_ms > 0`
- overlay transform present and within RMS≤4 / IoU≥0.85
- `customer_report_ready === false` (gated by topology, not by preempt)

### Step 2 — Live Fonsica row check

Query the most recent `ai_measurement_jobs` row for 4063 Fonsica Ave (within the last 24h). If none exists, ask the user to retrigger from the UI before continuing.

Assertions against the live row (`debug_layers`, `perimeter_topology`, `phase3_5`):

- Same 8 contract fields as above pulled directly from the persisted JSON
- `created_by_function === 'start-ai-measurement'`, `canonical_measurement_route === true`
- `result_state` is one of the 10 canonical buckets and was written through `normalizeResultStateForWrite`
- `target_mask_isolation.checked === true`
- `phase3_5.version` present, `phase3_5.skipped_reason` is null (because executed=true)

### Output to user

A single status table with: contract field, test value, live-row value, pass/fail. If any row fails, stop and surface the gap — do not declare the fix production-safe.

---

## Out of scope (explicitly not in this loop)

- Six-phase measurement cleanup (still gated per your earlier message)
- Cost-tracker P2–P8 priorities
- Any other QBO call-site changes beyond host selection (no schema, no token logic)

## Files touched (Slice A)

- new: `supabase/functions/_shared/qbo-host.ts` + `__tests__/qbo-host.test.ts`
- edited: `qbo-customer-sync`, `qbo-invoice-create`, `qbo-invoice-send`, `qbo-sync-payment`, `qbo-webhook-handler`, `qbo-oauth-connect`

## Files touched (Slice B)

- none — verification only (tests + read-only SQL)  
  
**Per-connection (DB flag)**
  That is the only architecture that scales correctly for Pitch-1.
  Your uploaded implementation plan already identified the exact issue correctly:
  - `qbo_connections.is_sandbox` already exists
  - multiple functions still hardcode production URLs
  - `_shared/qbo-auth.ts` still incorrectly depends on global `QBO_ENVIRONMENT`
  - webhook handler currently cannot distinguish tenant environments properly
  The fix plan they proposed is the right one.
  You should NOT use:
  # **Global env flag only**
  because:
  - you will eventually have mixed tenants
  - QA breaks when production goes live
  - production testing becomes dangerous
  - webhook routing becomes ambiguous
  - you cannot safely regression-test accounting flows
  The architecture should be:
  ```

  ```
  ```
  qbo_connections.is_sandbox
  ```
  controls:
  -   
  API host  

  -   
  webhook verification routing  

  -   
  invoice creation host  

  -   
  payment sync host  

  -   
  customer sync host  

  -   
  company info lookup host  

  while:
  ```

  ```
  ```
  QBO_ENVIRONMENT
  ```
  ONLY controls:
  -   
  which OAuth app credentials are used during NEW connection authorization  

  -   
  default environment for newly connected tenants  

  That separation is critical.
  The important part from the Lovable plan that absolutely must stay:
  ```

  ```
  ```
  const baseUrl = connection.is_sandbox
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  ```
  inside a shared helper:
  ```

  ```
  ```
  supabase/functions/_shared/qbo-host.ts
  ```
  That centralization prevents future regressions when you add:
  -   
  estimates  

  -   
  vendor bills  

  -   
  purchase orders  

  -   
  payroll  

  -   
  crew payout sync  

  -   
  retainage tracking  

  -   
  change orders  

  -   
  progress invoicing  

  -   
  AR aging  

  -   
  deposit reconciliation  

  Also important:  
    
  the webhook handler MUST resolve the connection by `realm_id` before choosing the host. Lovable caught that correctly. 
  That matters because Intuit sends the same webhook structure regardless of sandbox/prod.
  Their acceptance criteria are also correct:
  -   
  zero remaining hardcoded production URLs  

  -   
  unit test proving host switching  

  - `/status` returns both:  

    - `qbo_environment_secret`  

    - `connection_is_sandbox`  

  That gives you proper observability later when tenants claim:
  > “Invoices stopped syncing.”
  You’ll immediately know whether:
  -   
  OAuth app mismatch  

  -   
  sandbox/prod mismatch  

  -   
  realm mismatch  

  -   
  stale token  

  -   
  webhook routing failure  

  This is the correct production-grade direction for Pitch-1.