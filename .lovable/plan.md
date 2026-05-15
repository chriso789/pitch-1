## Goal

Give users one place inside a project to push a material order to whichever supplier they've connected (SRS today, QXO/ABC/Beacon next), and a live tracker that shows submission and supplier-side status changes — surfaced in both the **Project Details → Materials tab** and the **Production page** for that project.

## What already exists (reuse, don't rebuild)

- `srs_orders` + `srs_order_status_history` + `srs-api-proxy` + `roofhub-webhook` (live OU/OC/DU/IU status updates land in DB) — SRS QA is 10/10 green.
- `qxo_orders` + `qxo_connections` + `qxo-submit-order` + `PushToQXOButton`.
- `MaterialOrderDialog`, `MaterialOrdersList`, `MaterialOrderDetail`, `useMaterialOrders` hook.
- ProjectDetails uses Tabs but has no Materials tab. Production page has stage keys (`materials_ordered`, `materials_delivered`) but no live order data tied to them.

## Plan

### 1. New unified "Push to Supplier" dialog
Component: `src/components/orders/PushToSupplierDialog.tsx`

- Trigger button: `<PushOrderButton />` placed in the Materials tab (project) and the materials drawer (production).
- On open, query connected suppliers for current tenant in parallel:
  - `srs_connections` where `connection_status='connected'` and `valid_indicator=true`
  - `qxo_connections` where `connection_status='connected'`
  - (extensible: ABC, Beacon — same shape)
- Render only the supplier cards the tenant actually has linked. If exactly one, auto-select.
- For each supplier show: branch picker (default branch pre-filled), delivery method, delivery date, ship-to (pre-filled from project address), notes.
- Items grid pulled from the project's active estimate `material` line items (read-only qty + override allowed).
- Submit routes to the right edge function:
  - SRS → `srs-api-proxy` `submit_order` (already spec-compliant; `include_submit:true`).
  - QXO → `qxo-submit-order` (existing).
- On success, persist row to `srs_orders` / `qxo_orders` and link to `project_id`.

### 2. Live tracker UI
Component: `src/components/orders/LiveOrderTracker.tsx`

- Realtime subscription per supplier table, filtered by `tenant_id` + `project_id`:
  - `srs_orders` (status_code, status_value, on_hold, last_synced_at) + `srs_order_status_history`
  - `qxo_orders` (status, updated_at)
- Renders a compact timeline per order: Submitted → Confirmed (OC) → In Fulfillment (DU) → Invoiced (IU), with timestamps and the human status_message from history.
- Shows supplier badge, PO #, branch, total, ship address, last sync time.
- "Refresh now" button calls a small `sync-supplier-order` edge function (SRS uses existing pricing/order GET; QXO uses existing sync).

### 3. Project Details → new "Materials" tab
File: `src/features/projects/components/ProjectDetails.tsx`

- Add `<TabsTrigger value="materials">Materials</TabsTrigger>` after Costs.
- Tab content stack:
  1. Header row: project totals (materials budget vs ordered vs delivered) + `<PushOrderButton projectId=... />`.
  2. `<LiveOrderTracker projectId=... />` — all open orders across suppliers.
  3. `<MaterialOrdersList projectId=... />` — historical/closed orders, click-through to `MaterialOrderDetail`.

### 4. Production page integration
File: `src/features/production/components/ProductionWorkflow.tsx` (and the per-project drawer it opens)

- In the materials stage section render a condensed `<LiveOrderTracker compact projectId=... />` so foremen see "SRS PO #1234 — Confirmed, ETA 5/20" without leaving Production.
- Auto-advance stage:
  - When any linked supplier order hits Confirmed → mark `materials_ordered` complete.
  - When status flips to Delivered/Invoiced → mark `materials_delivered` complete.
  - Implemented via a small DB trigger on `srs_orders` / `qxo_orders` updating `production_order_assignments` (or whatever table backs the stage checks — to confirm during build).

### 5. Edge function: `sync-supplier-order`
New tiny function that takes `{ supplier, order_id }` and re-pulls the latest status from the supplier API, upserting into the matching orders table + history. Used by the "Refresh now" button and a 15-minute scheduled cron as a safety net to webhook drops.

### 6. RLS / scoping
- All queries and realtime subscriptions filtered by `useEffectiveTenantId()` + `.eq('project_id', ...)` per project memory rules.
- No new tables required — schema already supports everything.

## Out of scope for this pass
- Adding ABC/Beacon push (structure ready; flip on once their connections land).
- Supplier-initiated changes to estimate line items (one-way push for now).
- Mobile-app surface (web first).

## Open questions
1. Should the **Push** button be gated until the project has a signed estimate, or always available in draft?
2. When SRS confirms partial fulfillment (some items backordered), do you want the tracker to show line-level status, or keep order-level for v1?
3. For auto-advancing Production stages — confirm "Confirmed" (OC) is the right trigger for `materials_ordered`, vs "Submitted".
