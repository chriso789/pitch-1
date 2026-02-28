

# Fix: Can't Exit Editing Mode + Restore Template Area UI

## Problem 1: Can't exit editing mode
`handleCancelEdit` clears the `editEstimate` URL param using `window.history.replaceState`, but the load effect (line 484) reads from React Router's `searchParams` — which doesn't get updated by `replaceState`. So after cancel sets `existingEstimateId = null`, the effect sees `editEstimateId !== null` and re-triggers loading.

**Fix:** In `handleCancelEdit`, use React Router's `setSearchParams` instead of `window.history.replaceState` to clear the URL param properly.

## Problem 2: Restore template area UI
The previous edit removed the "Recalculate" and "Create New Estimate" buttons. These need to be restored so users can recalculate from the template or start fresh.

**Fix:** Restore the original action bar with "Recalculate" and "Create New Estimate" buttons, replacing the green "Editing estimate" indicator.

## Problem 3: Keep trade separation when adding trades
The existing migration logic in the "Add Trade" handler is correct — keep it as-is. When adding a new trade to a single-trade estimate, existing items migrate into `tradeLineItems` under the current section before the new section is created.

## Changes — `src/components/estimates/MultiTemplateSelector.tsx`

### Change A: Fix `handleCancelEdit` URL clearing (~line 681-708)
Replace `window.history.replaceState` with `setSearchParams` to properly clear the `editEstimate` param so React Router is aware.

### Change B: Restore the "Viewing saved estimate" action bar (~lines 2267-2273)
Replace the green editing indicator with the original block containing:
- "Viewing saved estimate. Select an action below."
- "Recalculate" button (resets to template and re-fetches items)
- "Create New Estimate" button (clears everything for a fresh start)

