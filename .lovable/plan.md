

# Three Fixes: Dialer Statuses, Estimate Price, and PDF Item Grouping

## Issue 1: Dialer List Builder — Missing Contact Statuses

**Problem**: The status dropdown in `CallCenterListBuilder.tsx` (lines 214-222) is hardcoded to only 6 statuses (Unqualified, Qualified, Not Home, Interested, Not Interested, Follow Up). It's missing statuses like "Past Customer", "New Roof", "Go Back", "Do Not Contact", and any custom tenant statuses.

**Fix**: Import and use `useContactStatuses()` hook (already exists at `src/hooks/useContactStatuses.ts`) to dynamically populate the status dropdown with all active tenant contact statuses instead of the hardcoded list.

**File**: `src/components/call-center/CallCenterListBuilder.tsx`
- Import `useContactStatuses`
- Call the hook to get `statuses`
- Replace the hardcoded `<SelectItem>` entries (lines 215-222) with a `.map()` over the dynamic statuses array

---

## Issue 2: Estimate Preview Shows Wrong Price ($23,407.72 vs $23,600)

**Problem**: When the estimate was saved at $23,600, the rep likely manually adjusted the selling price. But the system only preserves this via `is_fixed_price` + `fixed_selling_price`. If the rep adjusted the price without explicitly toggling "fixed price mode", the estimate saves `selling_price: 23600` but `is_fixed_price: false`, so on reload the pricing engine recomputes from line items → $23,407.72.

**Fix**: In the estimate loading logic (`MultiTemplateSelector.tsx`, lines 661-666), also check if the saved `selling_price` differs from the computed price. If the estimate has a `selling_price` that doesn't match the computed value, treat it as a fixed price to preserve the rep's intent.

**File**: `src/components/estimates/MultiTemplateSelector.tsx`
- After loading items and config, compare saved `selling_price` with computed breakdown
- If they differ significantly (>$1), auto-set `fixedPrice` to the saved `selling_price`
- This ensures the preview always shows the price the rep agreed to

---

## Issue 3: PDF Scope Table — Add Material/Labor Type Sections

**Problem**: The `ItemsTable` component in `EstimatePDFDocument.tsx` groups items by `trade_type` (e.g., "Roofing", "Gutters") but doesn't separate materials from labor within each trade. The user wants "Materials" and "Labor" sub-section headers to match the estimate builder layout.

**Fix**: Within each trade group in the `ItemsTable`, further group items by `item_type` ("material" vs "labor") and render sub-headers for each.

**File**: `src/components/estimates/EstimatePDFDocument.tsx` (ItemsTable component, lines 705-797)
- Within each trade group, split items into materials and labor sub-groups
- Render a "Materials" sub-header before material items and a "Labor" sub-header before labor items
- Only show sub-headers when both types exist in a trade group (skip if all items are one type)
- Style sub-headers slightly smaller/lighter than trade headers to create visual hierarchy

## Files Changed

| File | Change |
|------|--------|
| `src/components/call-center/CallCenterListBuilder.tsx` | Use `useContactStatuses()` for dynamic status dropdown |
| `src/components/estimates/MultiTemplateSelector.tsx` | Auto-detect saved fixed price on estimate load |
| `src/components/estimates/EstimatePDFDocument.tsx` | Add material/labor sub-sections within trade groups in ItemsTable |

