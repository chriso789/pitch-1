

# Plan: Separate Manufacturer & Workmanship Warranty Toggles

## Changes

### 1. `src/components/estimates/PDFComponentOptions.ts`
- Replace `showWarrantyInfo: boolean` with two new fields:
  - `showManufacturerWarranty: boolean`
  - `showWorkmanshipWarranty: boolean`
- Update both `customer` and `internal` presets accordingly
- Keep backward compatibility: add a computed helper or just update all references

### 2. `src/components/estimates/EstimatePreviewPanel.tsx` (~line 743-747)
- Replace single "Warranty Info" toggle with two toggles:
  - "Manufacturer Warranty"
  - "Workmanship Warranty"

### 3. `src/components/estimates/PDFExportDialog.tsx` (~line 297-304)
- Same: replace single "Warranty Info" switch with two separate switches

### 4. `src/components/estimates/EstimateAddonsPanel.tsx` (~line 259-264)
- Replace single "warranty-info" checkbox with two checkboxes

### 5. `src/components/estimates/EstimatePDFDocument.tsx`
- Update `buildWarrantyPages` to accept the two boolean flags instead of a single `showWarrantyInfo`
- Only render manufacturer section if `showManufacturerWarranty` is true
- Only render workmanship section if `showWorkmanshipWarranty` is true
- If neither is true, return empty array (no warranty pages)
- Update the call site (~line 444) to pass the new flags

### 6. `src/components/estimates/EstimatePDFTemplate.tsx` (~line 632-633)
- Update warranty rendering to respect the two separate flags

All references to `showWarrantyInfo` will be replaced with the two new flags. The splitting logic remains the same — if both are enabled and combined text is long, they split across pages.

