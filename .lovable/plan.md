## Diagnosis

`SectionedLineItemsTable.tsx:415` does `item.qty.toFixed(2)` with no null guard. When any row on the estimate has `qty = null/undefined` (which happens for blank labor lines, headers, or rows imported without a quantity), this throws `Cannot read properties of undefined (reading 'toFixed')`, the React error boundary trips, and the estimate page renders the generic "Something went wrong" card you screenshotted. Console confirms the stack: `SortableItemRow → SectionedLineItemsTable.tsx:866:92` (line 415 in source).

## Fix (one line, presentation layer only)

Coerce `qty` and `unit` to safe values before formatting:

```ts
// before
`${Number(item.qty.toFixed(2))} ${item.unit}`

// after
`${Number(Number(item.qty ?? 0).toFixed(2))} ${item.unit ?? ''}`
```

Also do a quick scan of the same file for any other unguarded numeric reads on `item.unit_cost` / `item.line_total` that could trip the same boundary on a malformed row, and apply the same `?? 0` guard. `formatCurrency` already tolerates undefined in most of the codebase, but I'll verify before touching anything else.

## Scope

- Single file: `src/components/estimates/SectionedLineItemsTable.tsx`
- No database changes, no business-logic changes, no row clean-up.
- The bad row stays in the DB and renders as `0 ` for qty — you can then edit it normally instead of being locked out of the whole estimate. If you want, I can follow up with a separate pass that finds and flags `qty IS NULL` rows on this estimate for review.

Switch to build mode and I'll ship the guard.