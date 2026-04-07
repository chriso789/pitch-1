

## Fix Pipeline Status Transition + Add AR Action Buttons

### Root Cause: All Edge Functions Are Broken

**Every single edge function (240 files)** has `Deno.Deno.serve` instead of `Deno.serve`. This is why the "Error updating status - Failed to send a request to the Edge Function" error appears when moving a lead to a project. The function literally cannot start.

This affects the `pipeline-status` function specifically, but also every other edge function in the system.

### Plan

**Step 1 -- Fix `Deno.Deno.serve` in `pipeline-status/index.ts`**

Change line 7 from `Deno.Deno.serve(...)` to `Deno.serve(...)`. Deploy and verify the pipeline transition works.

**Step 2 -- Batch-fix `Deno.Deno.serve` across all 240 edge functions**

Run a find-and-replace across `supabase/functions/` to fix every occurrence. This unblocks every edge function in the system (payments, measurements, approvals, webhooks, etc.).

**Step 3 -- Add action buttons to Accounts Receivable project rows**

Currently each AR row only shows name, address, contract/paid amounts, and a "No Invoice" badge. Add a dropdown action menu per row with:

- **Create Invoice** -- navigates to `/lead/:id?tab=total` with invoice creation focus (for items with no invoice)
- **Send Payment Link** -- calls `stripe-create-payment-link` for the latest unpaid invoice
- **Send Zelle Info** -- generates Zelle payment instruction link
- **View Details** -- navigates to the lead/project detail page
- **Mark Paid** -- quick manual payment recording

Uses a `DropdownMenu` from shadcn/ui on each row, replacing the current click-only navigation.

### Files to Edit

| File | Change |
|------|--------|
| `supabase/functions/pipeline-status/index.ts` | Fix `Deno.Deno.serve` to `Deno.serve` |
| All 240 edge function `index.ts` files | Same fix via batch script |
| `src/pages/AccountsReceivable.tsx` | Add `DropdownMenu` with action buttons per project row |

### Technical Notes

- The `Deno.Deno.serve` bug was likely introduced by an automated refactor. `Deno.serve` is the correct Deno 2.x API.
- The batch fix will use a shell `sed` command across all files in `supabase/functions/`.
- AR action buttons will reuse existing edge functions (`stripe-create-payment-link`, `zelle-payment-page`) once they're unblocked by the Deno fix.

