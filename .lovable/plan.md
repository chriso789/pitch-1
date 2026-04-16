

## Root Cause

**1. Why the toggles "don't work"** (Materials Section, Labor Section, Unit Pricing, Subtotals, Customer Name, Property Address)

The toggle handlers (`updateOption`) are wired correctly and DO mutate state. The reason nothing visibly changes in the customer-mode preview is that the customer preset in `PDFComponentOptions.ts` has `showUnifiedItems: true` and `hideSectionSubtotals: true`. The PDF template in `EstimatePDFTemplate.tsx` then short-circuits:

- Line 306: `!opts.showUnifiedItems && opts.showMaterialsSection && ...` — Materials Section only renders if unified view is OFF. Toggling "Materials Section" ON does nothing because unified view wins.
- Line 378: same pattern for Labor Section.
- Line 322 / 348 / 394 / 417: `showLineItemPricing` is honored — but only inside the materials/labor sections, which are hidden by unified view. So toggling "Unit Pricing" appears dead in customer mode.
- Line 357 / 426: Subtotals require `showSubtotals && !hideSectionSubtotals`. The customer preset forces `hideSectionSubtotals: true`, so toggling "Subtotals" ON has no effect.
- Customer Name / Property Address (line 223-230) ARE wired correctly and should toggle. Will verify, but the wrapper `(opts.showCustomerName || opts.showCustomerAddress)` correctly hides the whole block only when both are off — individual toggles work. If user reports them broken, it's likely the same visual confusion from the pricing toggles next to them, OR the cover page is showing customer info from a separate source. Will audit cover page rendering for the same flags.

**2. Warranty default for O'Brien Contracting**

`PDF_PRESETS.customer.showManufacturerWarranty = true` is hardcoded. There's no per-tenant override. Need to read tenant name (or tenant settings) and force it off for O'Brien Contracting.

## Plan

### Fix 1 — Make toggles actually take effect (`EstimatePreviewPanel.tsx`)

When the user toggles **Materials Section, Labor Section, Unit Pricing, or Subtotals** in the controls panel, also flip the conflicting unified-view flags so the change is visible:

- Toggle Materials/Labor Section ON → set `showUnifiedItems: false` (switch to traditional sectioned view).
- Toggle Unit Pricing ON → set `showUnifiedItems: false` AND `showLineItemPricing: true` (unit prices live inside the materials/labor tables).
- Toggle Subtotals ON → set `hideSectionSubtotals: false` AND `showSubtotals: true`.
- Toggle Materials/Labor Section OFF when both off → restore `showUnifiedItems: true` so something still renders.

Implement via a smarter `updateOption` wrapper (e.g. `updateOptionSmart`) used by these four toggles only. Other toggles keep the simple setter.

### Fix 2 — Audit Customer Name / Property Address

Confirm `EstimatePDFTemplate.tsx` lines 223-230 are the only place these render in the customer-facing PDF. Check `EstimatePDFDocument.tsx` cover page — if cover page renders customer info ignoring the flags, gate it on the same `opts.showCustomerName` / `opts.showCustomerAddress`.

### Fix 3 — Tenant-level warranty default for O'Brien Contracting

In `EstimatePreviewPanel.tsx` (or wherever `getDefaultOptions('customer')` is first applied), after loading `companyInfo.name`, detect O'Brien Contracting (case-insensitive match on `obrien` / `o'brien`) and override:

```ts
showManufacturerWarranty: false
```

Apply on initial mount AND on `handleViewModeChange` / `handleResetToDefaults` so it persists across resets. Use the same matching pattern already established in `ContactBulkImport.tsx` (`obrien contracting`, `o'brien contracting`, etc.).

### Files to edit

- `src/components/estimates/EstimatePreviewPanel.tsx` — smart toggle handler + tenant-aware warranty default.
- `src/components/estimates/EstimatePDFDocument.tsx` — only if cover page bypasses customer name/address flags (verify first, edit if needed).

### What I will NOT do

- No schema changes.
- No new settings UI for warranty default — it's a hardcoded rule for O'Brien per the request.
- No changes to the PDF template rendering logic itself; the existing flag checks are correct, the controls just need to set the right combination of flags.

