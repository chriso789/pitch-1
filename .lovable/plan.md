## Goal

On the estimate materials section, let the user pick a connected supplier (ABC / SRS / QXO) once, and show the matched supplier product info (SKU, description, live price) directly under each line item — no need to open the Push-to-Supplier dialog to see it.

## UX

```text
[ Materials section header ]   Match supplier: [ ABC Supply (Sandbox) ▼ ]  Branch: [1209]

┌────────────────────────────────────────────────────────────────────┐
│ GAF Timberline HDZ Shingles            Oyster Grey   57  bundle … │
│   ABC #10056234 · Timberline HDZ Oyster Grey · $42.50/bdl   [🔍] │
├────────────────────────────────────────────────────────────────────┤
│ GAF Pro-Start Starter Strip            Oyster Grey    2  bundle … │
│   No ABC match — [search]                                          │
└────────────────────────────────────────────────────────────────────┘
```

- Supplier picker shows only connected suppliers (reuses the same detection logic as PushToSupplierDialog).
- "Branch" defaults from the user's per-supplier preference (already persisted in profiles.default_supplier_branches) or the connection's default branch.
- Each material row gets a small subline with: SKU · short description · price (or "No match" + search button).
- A 🔍 button on each row opens the existing `AbcCatalogSearchPopover` / `CatalogSearchPopover` to change the match. The SKU is persisted to `estimate_line_items.abc_item_number` / `srs_item_code`, same columns the Push dialog already writes to — so the Push dialog later shows the same matches with no extra mapping.
- Auto-match runs once when supplier+branch is set: fetches the catalog (ABC search or SRS get_products) and assigns best matches to rows that don't already have one. Match logic reuses the existing scorers in PushToSupplierDialog (extracted to a small helper file).
- Live price for ABC: reuses `AbcPriceCell` / pricing fetch already in `AbcCatalogControls`.

## Scope of code changes

1. New helper `src/components/orders/catalogMatching.ts`
   - Extract `scoreSrsProductMatch`, `autoFillSrsCatalogSkus`, and the ABC catalog scorer from PushToSupplierDialog so both surfaces share matching logic. (Pure refactor, no behavior change.)

2. New component `src/components/estimates/InlineSupplierMatch.tsx`
   - Props: `{ item, supplier, tenantId, environment, branchCode, onChange }`.
   - Renders the SKU · description · price subline, plus search popover button.
   - Persists SKU to `estimate_line_items` (same write path as PushToSupplierDialog's `persistSku`).

3. `src/components/estimates/TemplateSectionSelector.tsx`
   - Add supplier-picker row above the materials table only when `sectionType === 'material'`.
   - Detect connected suppliers (reuse hook calls already used in Push dialog) and store the chosen one in local state, defaulting to the only connected one when there's exactly one.
   - For each material row, render `<InlineSupplierMatch>` under the item name when a supplier is selected.
   - Trigger one-shot auto-match when supplier + branch + line items are all ready and any row is missing a SKU.

4. No DB migrations: `abc_item_number`, `srs_item_code`, `abc_color`, `abc_uom`, `abc_price*` already exist on `estimate_line_items` (used by Push dialog today).

## Non-goals (won't do in this pass)

- Bulk re-price button (price will refresh when the row is matched; can add later).
- QXO catalog auto-match (no catalog endpoint wired yet — picker still selects QXO but inline match shows "QXO catalog search coming soon").
- Labor section — supplier match is materials-only.
- Changing the Push-to-Supplier dialog UI (it stays the same, just benefits from already-persisted matches).
