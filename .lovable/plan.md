

## Plan: Fix 3 Issues — Estimate Bar Sync, Material Color Export, Map Still Showing Tampa

### Issue 1: Saved Estimate Not Reflecting in Top Bar

**Root Cause**: The hyperlink bar at the top pulls data from the `api_estimate_hyperlink_bar` RPC, which reads from `pipeline_entries.metadata.selected_estimate_id`. When an estimate is selected in the SavedEstimatesList, it correctly invalidates the `hyperlink-data` query. However, the screenshot shows the top bar displaying $7,518 while the saved estimate shows $10,898 — indicating the RPC is reading from a different or stale estimate, or the `selected_estimate_id` metadata was not properly updated.

**Fix**: The `SavedEstimatesList.handleSelectEstimate` already invalidates `hyperlink-data`. The issue is likely that the `calculations` fallback data in `EstimateHyperlinkBar` is being shown instead of the RPC data. When `hyperlinkData` is null or loading, it falls back to the `calculations` prop which comes from a different source.

**Changes**:
- In `EstimateHyperlinkBar.tsx`: When an estimate is selected (`hyperlinkData?.selected_estimate_id` exists), always use `hyperlinkData` values and never fall back to the `calculations` prop. The fallback path should only be used when no estimate is selected.
- Ensure `SavedEstimatesList` also invalidates the `estimate-costs` query key that `TemplateSectionSelector` uses, so the Materials/Labor tabs update too.

---

### Issue 2: Colors Not Exporting in Material Order PDF

**Root Cause**: The `MaterialLineItemsExport` component already supports `notes` and `color_specs` fields and renders them in the PDF. But in `TemplateSectionSelector.tsx` (line 611-618), when it passes `lineItems` to `MaterialLineItemsExport`, the `lineItems` array contains `notes` fields — however the export PDF logic looks correct. The issue is likely that the `notes` field we just added is not being populated/saved yet, or the existing material order export (which may go through a different path like `material_orders` table) doesn't include the notes.

**Fix**: Verify the `lineItems` passed to `MaterialLineItemsExport` actually contain the `notes` data. The PDF rendering code in `MaterialLineItemsExport.tsx` already handles `item.notes || item.color_specs` — so if the data is there, it will render. The gap is likely in how line items are loaded from the database — the `notes` field needs to be preserved during load/save.

**Changes**:
- In `TemplateSectionSelector.tsx`: Ensure when loading line items from `enhanced_estimates.line_items` JSON, the `notes` field is mapped into each `LineItem` object.
- Confirm the save mutation includes `notes` in the serialized JSON (this was added in the previous change but needs verification).

---

### Issue 3: Storm Canvass Map Still Showing Tampa

**Root Cause**: The area-based fallback we implemented is completely inert. Database query confirms: `canvass_areas` has 0 rows and `canvass_area_assignments` has 0 active assignments. So `areaCentroid` is always `null`, and the distance sanity check never fires. Chris's browser returns a cached Tampa GPS fix, and since `areaCentroid` is null, the sanity check is skipped entirely — the Tampa coordinates are accepted as valid.

Chris's actual contacts are all in Pennsylvania (lat ~39.9, lng ~-75.3).

**Fix**: Since the area assignment system isn't populated, we need a different fallback strategy. Use the tenant's contact/property data centroid as the fallback when no assigned area exists.

**Changes in `LiveCanvassingPage.tsx`**:
- When `areaCentroid` is null (no assigned area), query the tenant's contacts table to compute a contact centroid from the average lat/lng of all geocoded contacts.
- Use this contact centroid for the same distance sanity check (> 200 miles = reject GPS fix).
- This gives Chris a Pennsylvania-based fallback derived from his actual data.
- Keep the existing area-based logic so it works when areas are eventually set up.

**Changes in `locationService.ts`**:
- Reduce `maximumAge` to 0 (already done) but also add a secondary check: if the GPS timestamp is older than 60 seconds, treat it as stale and reject it. Mobile Safari can return "fresh" positions from its internal cache even with `maximumAge: 0`.

---

### Files to Change

1. **`src/components/estimates/EstimateHyperlinkBar.tsx`** — Ensure selected estimate data from RPC always overrides the calculations prop fallback
2. **`src/components/estimates/TemplateSectionSelector.tsx`** — Verify notes field is preserved during load from JSON
3. **`src/components/orders/MaterialLineItemsExport.tsx`** — No changes needed (already handles notes)
4. **`src/pages/storm-canvass/LiveCanvassingPage.tsx`** — Add tenant contact centroid fallback when no assigned area exists
5. **`src/services/locationService.ts`** — Add GPS timestamp staleness check

