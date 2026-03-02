

# Cleaner Estimate Page Splits + Dynamic Warranty from Settings

## Three changes:

### 1. Trade-aware page chunking (avoid splitting a trade header from its first item)
**File:** `EstimatePDFDocument.tsx` — Replace `chunkItems` (lines 130-147)

Replace the naive slice-based chunker with a trade-aware version:
- After building each chunk, check if the last item in a chunk is the first item of a new trade (meaning the trade header would render at the bottom of a page with no items following it)
- If so, pull that item back to the next chunk so the trade header + at least its first item stay together
- This prevents orphaned trade headers at page bottoms

### 2. Warranty page uses tenant's saved warranty_terms (not hardcoded)
**File:** `EstimatePDFDocument.tsx`

- Add `warrantyTerms?: string` prop to `EstimatePDFDocumentProps`
- Pass it through to `WarrantyPage`
- If `warrantyTerms` is provided (from `tenants.warranty_terms`), render that content instead of the hardcoded manufacturer/workmanship cards
- Keep hardcoded content as fallback when no tenant warranty text is saved

**File:** `EstimatePreviewPanel.tsx`
- Fetch tenant's `warranty_terms` from the tenants table (tenant data is likely already loaded nearby)
- Pass `warrantyTerms` to `EstimatePDFDocument`

### 3. Warranty Settings UI
**New file:** `src/components/settings/WarrantySettings.tsx`
- Text area for manufacturer warranty description
- Text area for workmanship warranty description  
- Save button that writes to `tenants.warranty_terms` as a JSON string (e.g., `{ manufacturer: "...", workmanship: "..." }`)

**File:** Add warranty settings to the appropriate settings page (likely alongside EstimateFinePrintSettings or under a Company tab)

### Technical Notes
- `tenants.warranty_terms` column already exists (type TEXT, currently NULL for all tenants)
- Store as JSON string: `{"manufacturer": "...", "workmanship": "..."}` to support structured warranty sections
- The `chunkItems` trade-awareness uses the existing `trade_type` metadata already on line items

