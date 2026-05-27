## Goal

In the **Create Invoice** dialog (`src/components/estimates/PaymentsTab.tsx`), stop emitting one invoice line per material/labor row from the estimate template. Instead, render **one rolled-up line per trade** from the base contract plus **one rolled-up line per approved change order**. Add a per-group expand toggle so the user can drill into the underlying items when they want to.

Scope is UI/presentation only inside `PaymentsTab.tsx`. The DB payload written to `project_invoices.line_items` will be the rolled-up groups (one row per trade, one row per CO), which is what the user wants on the invoice itself. No changes to estimate, change orders, or pricing logic.

## Behavior

**Default view (collapsed, new default):**
- One row per trade from the latest estimate, e.g.
  - `Roofing — Labor & Materials` … `$98,432.10`
  - `Gutters — Labor & Materials` … `$4,210.00`
- One row per approved change order, e.g.
  - `CO #2 — Skylight replacement` … `$2,150.00`
- Each row has a checkbox (include/exclude the whole group), an editable description, a total, a delete button, and a chevron to expand.
- Totals continue to use the same selling-price scaling already in `useEffect` (markup + remaining-balance scale for base items, full selling price for COs).

**Expanded group:**
- Clicking the chevron on a group reveals its underlying items (qty / unit / price / total) read-only-styled but still editable like today.
- Editing an underlying item recomputes the group total. Unchecking an underlying item subtracts it from the group total (group stays included as long as at least one child is selected).

**"Show qty & price" toggle (existing checkbox):** repurposed to "Show item details" — when ON, all groups auto-expand; when OFF (default), all groups collapse. The per-row chevron still works for one-off expansion.

**What gets saved:**
- `project_invoices.line_items` receives the **rolled-up groups** (one entry per included trade, one per included CO) with `description`, `qty: 1`, `unit: 'lot'`, `unit_cost = group total`, `line_total = group total`.
- This matches the invoice the customer sees and keeps the PDF clean.

## Implementation outline

1. Introduce a new shape in component state:
   ```ts
   type InvoiceGroup = {
     key: string;                   // `trade:roofing` | `co:<id>`
     kind: 'trade' | 'change_order';
     label: string;                 // editable description
     selected: boolean;
     expanded: boolean;
     children: (InvoiceLineItem & { selected: boolean })[];
   };
   ```
   Replace `invoiceLineItems` with `invoiceGroups`. Keep `InvoiceLineItem` type as-is.

2. Rework the auto-populate `useEffect` (lines ~376–441):
   - Run today's selling-price scaling and remaining-balance scaling on the base estimate items exactly as before.
   - After scaling, group the resulting items by `trade_type` / `trade_label` (fall back to `'roofing'` / `'Roofing'`, matching `EstimatePDFDocument.tsx`). One `InvoiceGroup` per trade.
   - For each approved CO, build one `InvoiceGroup` whose `children` are the existing `parseChangeOrderLineItems(co)` output. Label = `CO #N — <title>`.
   - To preserve trade metadata, extend `parseLineItems` to copy `trade_type` / `trade_label` onto each `InvoiceLineItem` (additive, optional fields).

3. Derived values:
   - `groupTotal(group) = sum(children where selected).line_total`
   - `invoiceSubtotal = sum(groups where selected).groupTotal`

4. Render changes in the dialog body (~lines 942–1027):
   - Replace the flat line-item list with a list of groups.
   - Each group row: checkbox, chevron (toggle `expanded`), editable label `Input`, right-aligned `groupTotal`, delete button (removes whole group).
   - When `expanded` (or global "Show item details" is on), render the existing per-item row UI underneath, indented, using the current Qty / Unit / Price / Total inputs. Item edits update `children` in place.
   - Keep "Add Line Item" but route it to add a child under a new ad-hoc group called `Custom` (or the currently focused group if simpler — pick the simpler path: create a one-row `Custom` group).

5. `createInvoiceMutation` (~lines 443–488):
   - Build `lineItemsPayload` as one entry per selected group:
     ```ts
     { description: group.label, qty: 1, unit: 'lot', unit_cost: groupTotal, line_total: groupTotal }
     ```
   - Validation: at least one group selected and `invoiceSubtotal > 0`.

6. Repurpose the existing `showLineDetails` checkbox: rename label to `Show item details`; when toggled, set `expanded` on every group accordingly. Default `false`.

7. No backend / schema / edge-function changes. No changes to `ChangeOrdersTab`, `TotalsTab`, or PDF generators.

## Out of scope

- Editing the estimate's trade definitions.
- Splitting a CO across multiple invoices.
- Changing how `project_invoices.line_items` is consumed downstream (PDF / QBO sync continue to read whatever rows we write — now cleaner trade-level rows).

## Files touched

- `src/components/estimates/PaymentsTab.tsx` (only)
