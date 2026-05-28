# Supplier Integration Tenant Isolation + Customer-Facing UI

## Audit findings (current state)

**RLS posture is already strong — no broad/missing policies found.**


| Area                                                                                       | Status                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `abc_*` tables                                                                             | All 19 have RLS on; tenant-scoped policies via `get_user_active_tenant_id()` / `user_can_access_tenant()` / `abc_is_tenant_admin()` |
| `abc_tokens`, `abc_oauth_states`, `qxo_credentials`                                        | RLS on, **0 policies** → service-role-only (correct, locked from clients)                                                           |
| `abc_connections`                                                                          | Defense-in-depth: explicit `no_client_write` policy + tenant read                                                                   |
| `abc_api_audit`                                                                            | Read restricted to tenant admins (master/owner/corporate/office_admin) only                                                         |
| `srs_*`, `qxo_*`                                                                           | RLS on, tenant-scoped                                                                                                               |
| `srs_order_items`, `srs_order_status_history`, `supplier_catalog*`, `supplier_price_list*` | No `tenant_id` column — need to verify policies scope via parent FK before claiming gap                                             |


**Conclusion:** No emergency RLS migration is needed. The leak risk is in **frontend code that doesn't filter `.eq('tenant_id', …)**` and **the Integrations UI exposing developer/debug surface to all tenants**.

## What changes

### Phase 1 — Verify the four "no tenant_id" tables (read-only)

Inspect existing policies on `srs_order_items`, `srs_order_status_history`, `supplier_catalog_items`, `supplier_catalogs`, `supplier_price_list_items`, `supplier_price_lists`. If they correctly scope via parent FK (`srs_orders.tenant_id`, etc.), document and move on. If not, add the missing policy in one small migration.

### Phase 2 — Frontend tenant-filter sweep

Add explicit `.eq('tenant_id', useEffectiveTenantId())` to every supplier query in:

- `src/components/settings/ABCConnectionSettings.tsx` (5 queries: `abc_connections`, `abc_oauth_callback_logs`, `abc_api_audit`)
- `src/components/settings/AbcDiagnosticsPanel.tsx` (5 queries: `abc_orders`, `abc_order_job_links`, `abc_webhook_events`, `abc_api_audit`)
- `src/components/settings/SRSConnectionSettings.tsx` (3 queries)
- `src/components/settings/QXOConnectionSettings.tsx` (1 query)

RLS already enforces this server-side, but explicit filters prevent accidental cross-tenant leaks in code paths that ever run under service role and make the intent auditable.

### Phase 3 — New customer-facing Supplier Integrations page

New component: `src/components/settings/SupplierIntegrationsPanel.tsx`

- Generic card per supplier (ABC, SRS, QXO, Billtrust) with: connected status, last sync, last order, Connect / Disconnect / View Order History.
- Mount in `IntegrationsSettings.tsx` as the default view for normal users.
- **No** OAuth URLs, token URLs, scopes, debug logs, callback logs, WAF notes, Sandy defaults — those move behind a role gate.

### Phase 4 — Role-gate the developer surface

Wrap the existing `ABCConnectionSettings`, `SRSConnectionSettings`, `QXOConnectionSettings`, `AbcDiagnosticsPanel` (settings-level), `abc_oauth_callback_logs` view, `abc_api_audit` table, WAF allowlist notes inside an "Advanced (Developer)" tab visible only when:

- `has_role(user, 'master')` OR
- `has_role(user, 'platform_admin')` OR
- `tenant_id === OBRIEN_TENANT_ID` (for sandbox demo continuity)

The project-level `AbcDiagnosticsPanel projectId={projectId}` on the Materials tab stays for all users — it's already scoped to a single project's orders via RLS + the new explicit tenant filter.

### Phase 5 — Isolate O'Brien sandbox defaults

- Pull the hardcoded Sandy defaults (Ship-To `2010466-2`, Branch `1209`, sandbox username, WAF observed IP notes) into a `isObrienSandboxTenant(tenantId)` helper.
- Only render those defaults / hints in `ABCConnectionSettings` and `PushToSupplierDialog` when `isObrienSandboxTenant()` or platform_admin.
- Other tenants see a blank Connect form, no preset values.

### Phase 6 — New Supplier Order History page

New route: `Settings → Integrations → Supplier Order History` (`src/pages/SupplierOrderHistory.tsx`)

- Union view across `abc_orders`, `srs_orders`, `qxo_orders` — each query explicitly `.eq('tenant_id', tenantId)`.
- Columns: supplier, project/job, PO, supplier order #, confirmation #, status, branch, ship-to, submitted, last update, total, actions (Inspect, Refresh Status).

### Phase 7 — Backend guardrail verification (read-only)

Confirm `supabase/functions/abc-api-proxy/handler.ts` and `supabase/functions/supplier-api/abc-proxy-handler.ts`:

- Resolve `tenant_id` from JWT (`_shared/auth.ts` + `_shared/tenant.ts`), never from body.
- All `abc_tokens` / `abc_connections` fetches `.eq('tenant_id', resolvedTenantId)`.
- All `abc_orders` / `abc_api_audit` writes use `resolvedTenantId`.

Confirm `supabase/functions/supplier-webhook/index.ts` resolves tenant from `abc_webhooks` / `abc_orders` lookup, never trusts payload.

If any of these are violated, fix in a follow-up patch (not in scope of this plan if clean).

### Phase 8 — Acceptance checklist doc

Add `docs/SUPPLIER_TENANT_ISOLATION_TEST.md` with the 5-section test plan from the request (A–E), so the user can walk through O'Brien vs second-tenant verification manually.

## Explicitly out of scope

- No `result_state` / measurement work.
- No changes to `PushToSupplierDialog` ABC submit logic itself (already tenant-scoped via `abc-api-proxy`).
- No new edge function folders (per Pitch CRM Architecture Guard).
- No webhook signature work — that's still gated on ABC partner docs verification from the prior plan.

## Decision gate

Approve and I'll start with **Phase 1 + Phase 2** (verify + explicit tenant filters — lowest risk, highest payoff), then **Phase 3 + Phase 4** (new panel + role-gated developer view), then Phases 5/6/7/8. Each phase is a separate, reviewable batch — not one giant commit.  
  
I would approve this plan, but I would **change the order**.

Right now Lovable wants to do:

```

```

```
Phase 1
Phase 2
Phase 3
Phase 4
Phase 5
Phase 6
Phase 7
Phase 8
```

That's too much before Sandy's demo.

The highest risk is not RLS. The audit already says RLS is strong across the ABC/SRS/QXO tables. 

What matters is:

### Immediate Priorities

#### Phase 2 — Tenant Filter Sweep

Approve immediately.

Even though RLS exists, explicit:

```

```

```
.eq('tenant_id', tenantId)
```

on every supplier query is cheap protection and makes the code auditable. 

#### Phase 4 — Role-Gate Developer Surface

Approve immediately.

This is the biggest UI problem today.

Normal contractors should NOT see:

```

```

```
OAuth URLs
Token URLs
Scopes
Callback logs
WAF diagnostics
Sandbox test data
Audit logs
```

The current ABC page still feels like a developer console.

---

### Next Priority

#### Phase 5 — O'Brien Sandbox Isolation

Approve immediately.

The Sandy defaults:

```

```

```
Ship-To 2010466-2
Branch 1209
Sandbox login notes
WAF notes
```

must not appear for every tenant. 

This is a quick win.

---

### After That

#### Phase 3 — Supplier Integrations Panel

Approve.

This is the customer-facing experience you ultimately want:

```

```

```
ABC Supply
Connected

SRS
Connected

QXO
Disconnected

Billtrust
Connected
```

with:

```

```

```
Connect
Disconnect
View Orders
```

instead of exposing integration internals.

---

### Phase 6

Approve.

The Supplier Order History page is the right abstraction layer.

Instead of:

```

```

```
ABC Orders
SRS Orders
QXO Orders
```

users should see:

```

```

```
Supplier Order History
```

and filter by supplier.

---

### Phase 1

Do last.

The audit already says no obvious RLS gap exists. 

Don't burn demo time auditing FK-scoped tables until the UI is fixed.

---

### Phase 7

Do after demo.

That's backend verification.

Good work, but not demo-critical.

---

### Phase 8

Do after demo.

Documentation won't make or break Sandy's call.

---

## What I would send Lovable

```

```

```
Approved with revised priority order.

Priority A
Phase 2 — Explicit tenant filters

Priority B
Phase 4 — Role-gate developer surface

Priority C
Phase 5 — O'Brien sandbox isolation

Priority D
Phase 3 — Supplier Integrations Panel

Priority E
Phase 6 — Supplier Order History

After demo:
Phase 1
Phase 7
Phase 8

Reason:

The audit already shows strong RLS posture across ABC/SRS/QXO tables.

The biggest current risk is user experience and accidental visibility of developer/demo tooling.

Goal before Sandy's demo:

Normal tenants should only see:

- Connect Supplier
- Disconnect Supplier
- Supplier Order History
- Order Status

They should NOT see:

- OAuth URLs
- Token URLs
- Callback logs
- WAF diagnostics
- Sandbox defaults
- O'Brien demo settings
- abc_api_audit
- abc_oauth_callback_logs

Implement the UI isolation first.

Then isolate O'Brien-specific sandbox defaults.

Then build the Supplier Integrations and Supplier Order History pages.

Leave deep RLS verification and documentation passes until after demo unless a concrete issue is found.
```

That gets you to a **multi-tenant SaaS-ready supplier experience** much faster than continuing to focus on backend auditing that already looks healthy.