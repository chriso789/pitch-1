
Implementation plan to fix “saved added trades not showing in Estimate Preview” and “incorrect total”:

1) Update preview data source to include all saved trade items
- File: `src/components/estimates/EstimatePDFDocument.tsx`
- Replace material-only pagination input with unified item pagination:
  - Build `scopeItems = opts.showUnifiedItems ? [...materialItems, ...laborItems] : materialItems`
  - Use `scopeItems` for `chunkItems(...)` and page generation instead of `materialItems`
- Update memo dependencies to include `laborItems` so preview recomputes when added trade labor changes.

2) Restore true unified scope behavior (materials + labor) in preview table
- File: `src/components/estimates/EstimatePDFDocument.tsx`
- Ensure `ItemsTable` receives combined items in unified mode (not materials only).
- Sort consistently by:
  - trade label/type
  - then `sort_order`
  - then item name
- Keep total calculations unchanged (still from `breakdown`) so displayed total matches all loaded items.

3) Show trade separation inside preview scope
- File: `src/components/estimates/EstimatePDFDocument.tsx`
- In unified view table rendering, add trade section headers (Roofing, Gutters, etc.) so saved added trades are visibly separated by trade in preview output.
- Keep customer-safe formatting (no internal cost columns).

4) Harden edit-load state to prevent stale or mismatched preview state
- File: `src/components/estimates/MultiTemplateSelector.tsx`
- In edit URL effect (`editEstimate` handling), stop using `window.history.replaceState` and clear query params through `setSearchParams(..., { replace: true })` so React Router state stays in sync.
- On each estimate load, reset trade state before restore:
  - clear `tradeLineItems`
  - restore `tradeSections` from loaded `line_items` trade metadata
- Explicitly handle fixed-price restore:
  - if loaded estimate is fixed price, set fixed price
  - else clear fixed price
- This ensures preview uses current saved line items/totals and not stale in-memory state.

5) Keep save/edit flow consistent with preview
- File: `src/components/estimates/MultiTemplateSelector.tsx`
- After successful save, ensure preview data source is refreshed from current saved estimate state before opening preview again (no stale data carryover between edit sessions).
- Keep current “Save Estimate” single-action model unchanged.

Technical details
- Primary root issue in preview rendering: `EstimatePDFDocument` currently chunks/render scope from `materialItems` only, which hides trade additions saved as labor items.
- Secondary state issue: URL/search param sync via `window.history.replaceState` can leave stale `searchParams` in React Router and cause inconsistent re-load behavior.
- Affected files:
  - `src/components/estimates/EstimatePDFDocument.tsx` (scope/pagination/trade grouping)
  - `src/components/estimates/MultiTemplateSelector.tsx` (edit-load URL + state restore consistency)
- Validation checklist after implementation:
  - Open saved estimate with roofing + gutters, click Preview, confirm both trades appear.
  - Confirm Preview total matches saved estimate card total.
  - Save edits, reopen same estimate from list, confirm trade grouping and total persist.
  - Verify customer/internal preview modes both reflect multi-trade saved state.
