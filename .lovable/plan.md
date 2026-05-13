## QXO/Beacon AR Sync — Lean v1

Build an AR/Financials layer on top of the existing QXO auth so the Connection Details card actually populates and users can see balance, credits, and invoices in near real-time.

### Scope (Lean v1)
- Profile bootstrap (account_id, profile_id, default_branch)
- Account balance + available credit (daily snapshot)
- Open + Paid invoices (full history pull on first sync, deltas after)
- Basic AR dashboard UI under the QXO settings tab
- Manual "Refresh now" button + 15-min cron

Explicitly out of scope for v1: aging buckets, statements, PO matching, Material Audit tie-in, webhooks. (Easy to add later — schema will support them.)

### Database

New tables (all tenant-scoped, RLS via `useEffectiveTenantId` pattern):

- `qxo_account_profile` — one row per tenant: `account_id`, `profile_id`, `default_branch`, `company_name`, `last_synced_at`
- `qxo_balance_snapshots` — daily snapshot: `tenant_id`, `balance`, `available_credit`, `currency`, `snapshot_date`, `raw_payload jsonb`
- `qxo_invoices` — `tenant_id`, `qxo_invoice_id` (unique per tenant), `invoice_number`, `po_number`, `branch`, `status` (open/paid/partial/credit), `issued_date`, `due_date`, `amount`, `balance`, `job_id` (nullable, matched on PO), `raw_payload jsonb`, `last_synced_at`
- `qxo_sync_runs` — audit log: `tenant_id`, `kind` (profile/balance/invoices), `started_at`, `finished_at`, `status`, `records_upserted`, `error`

RLS: tenant-scoped read; writes only via service role from edge functions.

### Edge functions

- `qxo-sync-profile` — calls Beacon `/profile` + `/accounts`, upserts `qxo_account_profile`. Triggered on connect + manual refresh.
- `qxo-sync-balance` — calls `/account/balance` + `/account/credits`, inserts daily snapshot (one per day, upsert on date).
- `qxo-sync-invoices` — paginated pull of invoices; first run = full history, subsequent = `modified_since` delta. Upsert by `qxo_invoice_id`.
- `qxo-sync-orchestrator` — called by cron + manual refresh; runs all three in sequence per tenant with active QXO connection.

All reuse the existing QXO session-token logic from `qxo-api-proxy`.

### Cron

`pg_cron` job every 15 minutes invoking `qxo-sync-orchestrator` for all tenants with a valid QXO connection. Per-tenant rate limit (skip if last successful run < 10 min ago) to avoid hammering Beacon.

### UI (in `QXOConnectionSettings.tsx`)

Add three sections below the existing Connection Details card:

1. **Connection Details card** — now actually populated (Account ID, Profile ID, Default Branch from `qxo_account_profile`)
2. **Balance card** — current balance, available credit, "as of" timestamp, Refresh button
3. **Invoices table** — searchable, filter tabs (All / Open / Paid / Credit), columns: Invoice #, PO #, Branch, Issued, Due, Amount, Balance, Status. Click row → drawer with raw line items from `raw_payload`.

Refresh button calls `qxo-sync-orchestrator` and toasts progress; table re-fetches on success.

### Sequence

```text
Connect → qxo-sync-profile → populates Connection Details
       ↓
   First full sync (balance + invoices)
       ↓
   Cron every 15 min → delta sync
       ↓
   Manual Refresh button → on-demand sync
```

### Technical notes
- Multi-tenancy: all queries `.eq('tenant_id', effectiveTenantId)`; edge functions resolve tenant from connection record.
- All Beacon calls go through existing `qxo-api-proxy` pattern for session token reuse + refresh.
- `raw_payload jsonb` on invoices/balance keeps full Beacon response for future features (aging, PO match) without schema change.
- Indexes: `qxo_invoices(tenant_id, status)`, `qxo_invoices(tenant_id, due_date)`, `qxo_invoices(tenant_id, po_number)`.

### Deliverables
- 1 migration (4 tables + RLS + indexes + cron schedule)
- 4 edge functions
- 1 updated settings component (`QXOConnectionSettings.tsx`) + 1 new invoices table component

Approve and I'll build it.