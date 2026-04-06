

## Two-Part Fix: Report Failures + Material Inventory System

### Part 1: Why Reports Failed

The "Failed to send a request to the Edge Function" error is a **network timeout**, not a parsing bug. Your `roof-report-ingest` function now does:
1. PDF text extraction via pdfjs
2. Vision AI diagram extraction (sends each page image to Gemini)
3. Database writes + storage uploads

For large PDFs (10+ pages), this easily exceeds the default timeout. The reports that succeeded were smaller/faster. The ones that failed simply timed out before completing.

**Fix:** Add retry logic with a longer timeout in `BulkReportImporter.tsx`, and add a `skipDiagram` option for bulk imports to process text-only first, then backfill diagrams separately.

### Part 2: Material Inventory Tracking System

The database already has full inventory tables (`inventory_items`, `inventory_levels`, `inventory_locations`, `inventory_transactions`). Need to build the UI.

**New Component: `InventoryManager.tsx`**

A full inventory management panel with these capabilities:

- **Items List View**: Searchable/filterable table of all inventory items (SKU, name, brand, category, qty on hand, unit cost, barcode)
- **Add Item**: Form to add single items manually (name, SKU, brand, category, UOM, cost, price, barcode/UPC)
- **Bulk Add**: Upload multiple of the same item — enter item + quantity, creates an `inventory_transaction` of type `receive`
- **Receive Stock**: Select existing item, enter quantity received, auto-updates `inventory_levels`
- **Locations**: View/create storage locations (warehouse, truck, job site)
- **Transaction History**: Log of all stock movements (received, used, transferred, adjusted)
- **Photo/UPC Placeholder**: UI section with camera icon and barcode scanner icon, labeled "Coming Soon — Snap a photo or scan UPC to auto-identify product." This sets up the future feature.

**Integration into Settings:**

- Add `"inventory"` to `TAB_TO_CATEGORY` under `"products"` category
- Add it as a sub-tab inside the "Products & Pricing" section alongside materials, estimates, suppliers
- Available to all company profiles (not developer-only)

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/components/inventory/InventoryManager.tsx` | Main inventory management component with items list, add/receive/bulk flows |
| `src/components/inventory/InventoryItemForm.tsx` | Add/edit item form (name, SKU, brand, category, UOM, barcode, cost) |
| `src/components/inventory/InventoryReceiveDialog.tsx` | Dialog for receiving stock — single or bulk quantity entry |
| `src/components/inventory/InventoryTransactionLog.tsx` | Transaction history table |
| `src/components/inventory/InventoryLocationManager.tsx` | Create/manage storage locations |
| `src/features/settings/components/Settings.tsx` | Add inventory sub-tab to Products & Pricing section |
| `src/components/measurements/BulkReportImporter.tsx` | Add retry logic with extended timeout; add `skipDiagram` fast-mode option for reliability |

### Database

No migration needed — `inventory_items`, `inventory_levels`, `inventory_locations`, and `inventory_transactions` tables already exist with full schema including `barcode`, `brand`, `category`, `unit_cost`, `quantity_on_hand`, `transaction_type`, etc.

### Technical Notes

- All queries scoped with `tenant_id` using `useEffectiveTenantId()`
- Receiving stock creates an `inventory_transaction` (type: `receive`) and upserts `inventory_levels`
- Bulk receive = single transaction with quantity > 1
- Photo scanning will use device camera API + a barcode detection library (future phase) — for now, manual barcode/UPC text entry field
- Report retry: wrap `supabase.functions.invoke` call with 2 retries and 90s timeout per attempt

