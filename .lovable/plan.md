

## Plan: Add "My Commissions" Quick Action Button on Dashboard

### What Exists

A full `CommissionReport` page already exists at `/commission-report` with summary cards, filters (date range, rep, status), and a detailed table pulling from `commission_earnings`. It already auto-filters for non-managers (only shows their own data). No changes needed to that page.

The dashboard has a "Quick Actions" grid with 3 cards (New Contact, Create Estimate, Schedule Work). This is where the button goes.

### Change

**File: `src/features/dashboard/components/Dashboard.tsx`**

Add a 4th quick action card in the grid (lines 501-538) that navigates to `/commission-report`:

- Icon: `DollarSign` or a wallet/receipt icon
- Title: "My Commissions"
- Subtitle: "View earnings by project"
- Styling: Use a gold/amber gradient to distinguish from existing cards
- Update grid to `md:grid-cols-4` to accommodate the 4th card
- For reps, this is the primary way to see their per-job commission breakdown

That's it -- one card added, one grid class changed. The existing CommissionReport page already handles role-based filtering (reps see only their own, managers can filter by rep).

### Files to Change

1. `src/features/dashboard/components/Dashboard.tsx` — add commission quick action card + update grid cols

