

## Plan: Restructure AR Summary Cards Layout

### Problem
The 7 summary cards are crammed into one row. The "days" labels and dollar totals are truncated. The user wants:
1. Move the aging bucket labels ("1-30 Days", "31-60 Days", etc.) above the totals
2. Widen the total values so they're fully visible

### Fix

**File: `src/pages/AccountsReceivable.tsx`** (lines 259-302)

Split the 7 cards into two rows:
- **Row 1** (3 columns): Total Outstanding, Total Material Cost, Total Labor Cost — wider cards with `text-xl` values
- **Row 2** (4 columns): Current, 1-30 Days, 31-60 Days, 90+ Days — aging buckets with `text-xl` values

Each row uses fewer columns, giving cards more space. Labels stay above values (already the case), but removing `truncate` from values and using larger text ensures full visibility.

```tsx
{/* Row 1: Totals */}
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  <Card>/* Total Outstanding - text-xl font-bold */</Card>
  <Card>/* Total Material Cost */</Card>
  <Card>/* Total Labor Cost */</Card>
</div>

{/* Row 2: Aging Buckets */}
<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
  <Card>/* Current */</Card>
  <Card>/* 1-30 Days */</Card>
  <Card>/* 31-60 Days */</Card>
  <Card>/* 90+ Days */</Card>
</div>
```

Remove `truncate` from all value `<p>` elements and use `text-xl` so dollar amounts display fully. Single-file change.

