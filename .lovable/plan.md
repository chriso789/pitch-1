

## Plan: Fix AR Summary Card Text Overflow

### Problem
The 7 summary cards are crammed into a single row (`grid-cols-7` on large screens). Large dollar amounts like `$186,386.07` overflow outside the card boundaries.

### Fix

**File: `src/pages/AccountsReceivable.tsx`** (line 259)

1. Change grid from `grid-cols-2 md:grid-cols-4 lg:grid-cols-7` to `grid-cols-2 md:grid-cols-4 xl:grid-cols-7` — only go to 7 columns on extra-large screens.

2. On the value `<p>` elements (lines 263, 269, 275, 281, 287, 293, 299), reduce text size and add truncation:
   - Change `text-xl` to `text-lg`
   - Add `truncate` class so text doesn't overflow
   - Add `min-w-0` on the CardContent to allow truncation to work

This is a single-file CSS-only fix affecting lines 259–300.

