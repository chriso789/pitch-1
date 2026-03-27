

## Plan: Fix 3 Issues — Totals Area Payments, Recent Search, AR Dashboard

### Issue 1: "Totals" tab shows hardcoded $34,000 placeholder — needs real payments/invoice data

The `total` tab in `LeadDetails.tsx` (line 752-775) is a static placeholder showing `$34,000` or `$0`. It needs to show actual contract value, payments received, invoices, and balance — pulling from `project_invoices` and `project_payments` tables plus the estimate data via `api_estimate_hyperlink_bar`.

**Fix**: Replace the hardcoded "Final Selling Price" card with a real financial summary that includes:
- Contract value (from selected estimate's selling price)
- Total payments received
- Outstanding balance
- Invoice list with status
- Create Invoice / Record Payment buttons (reuse `PaymentsTab` component)
- Total material cost and total labor cost from the estimate

**File**: `src/pages/LeadDetails.tsx` — Replace lines 752-775 to render `PaymentsTab` + a financial summary card that pulls from `api_estimate_hyperlink_bar` for materials/labor/selling price, and `project_invoices`/`project_payments` for payment data.

---

### Issue 2: Recent searches not appearing on focus

The search bar code looks correct but there's a subtle issue: `showRecents` is set to `false` by the search effect (line 106) when `searchTerm.length < 2`, which fires on initial render and clears recents before the focus handler runs. The effect runs after mount setting `showRecents = false`, then when user focuses, `onFocus` sets `showRecents = true`, but then the effect fires again due to re-render and clears it.

**Fix in `CLJSearchBar.tsx`**:
- Remove the `showRecents` state entirely — it's redundant with checking `searchTerm.length < 2 && recents.length > 0`
- In the dropdown rendering, show recents when `open && searchTerm.length < 2 && recents.length > 0` instead of checking `showRecents`
- In the search effect, don't set `showRecents = false` — just return early when `searchTerm.length < 2` without closing the dropdown if recents are loaded

---

### Issue 3: AR Dashboard shows $0 — existing projects have no invoices + need cost tracking and time filter

**Root causes**:
1. Projects approved before the AR auto-creation code was added have no `project_invoices` rows
2. The AR dashboard only queries `project_invoices` — it has no way to show projects that should have AR but don't have invoices yet

**Fix in `AccountsReceivable.tsx`**:
- Query all `pipeline_entries` with `status = 'project'` joined with their selected estimate's selling price
- Cross-reference with `project_invoices` and `project_payments` to calculate real balances
- For projects without invoices, show the full estimate selling price as outstanding (with a "Create Invoice" action)
- Add total material cost and total labor cost cards (aggregate from `enhanced_estimates` or `project_cost_invoices`)
- Add a time filter (This Month, Last 30 Days, This Quarter, This Year, All Time) that filters by `created_at`

---

### Files to modify

| File | Change |
|------|--------|
| `src/pages/LeadDetails.tsx` | Replace hardcoded Totals tab with real financial summary using PaymentsTab + estimate data |
| `src/components/CLJSearchBar.tsx` | Fix recent searches visibility logic — remove redundant `showRecents` state |
| `src/pages/AccountsReceivable.tsx` | Query project pipeline entries for AR data, add material/labor cost totals, add time filter |

