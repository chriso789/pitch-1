

# Restore Missing Estimates for VCA Palm Beach

## Problem
The Estimate tab shows "$0" and no saved estimates because the `enhanced_estimates` records for this pipeline entry (`3ffe4e61-...`) are missing from the database. The PDFs were saved to the `documents` table (two "Paver System" / BETTER tier estimates), but the corresponding `enhanced_estimates` rows either failed to insert or were deleted.

The `SavedEstimatesList` component only queries `enhanced_estimates`, so without those records, nothing shows up — even though the PDFs exist in Documents.

## What happened
The estimate number prefix `OBR-00038` has one surviving record in `enhanced_estimates` but it's linked to a **different** pipeline entry (`704a5a06-...`), not `3ffe4e61-...`. The two PDFs (`OBR-00038-38e0.pdf`, `OBR-00038-z85r.pdf`) were saved to the documents table with `estimate_display_name: 'Paver System'` and `estimate_pricing_tier: 'better'`, but no matching `enhanced_estimates` rows exist.

## Fix

### 1. Insert the missing `enhanced_estimates` records
Create a migration that inserts two `enhanced_estimates` rows for this pipeline entry, using the metadata from the existing `documents` records (display name, pricing tier, estimate number). The selling price and other financial fields will need to default to 0 since we don't have the original calculation data — the user can edit them afterward.

### 2. Link pdf_url to the documents storage paths
Set `pdf_url` on each new `enhanced_estimates` record to match the existing document file paths so the "View" button works.

### SQL Migration
```sql
-- Restore estimate records from existing document metadata
INSERT INTO enhanced_estimates (
  pipeline_entry_id, tenant_id, estimate_number, display_name,
  pricing_tier, selling_price, status, pdf_url, created_at, created_by,
  customer_name, customer_address, roof_area_sq_ft, roof_pitch,
  material_cost, material_total, labor_cost, labor_total,
  overhead_percent, overhead_amount, subtotal,
  target_profit_percent, actual_profit_percent,
  line_items
)
SELECT
  d.pipeline_entry_id,
  d.tenant_id,
  REPLACE(d.filename, '.pdf', ''),
  d.estimate_display_name,
  d.estimate_pricing_tier,
  0, -- selling_price unknown, user can edit
  'draft',
  d.file_path,
  d.created_at,
  d.uploaded_by,
  '', '', 0, '4/12',
  0, 0, 0, 0,
  20, 0, 0,
  30, 0,
  '[]'::jsonb
FROM documents d
WHERE d.pipeline_entry_id = '3ffe4e61-58ff-45b0-9925-540a14aa994b'
  AND d.document_type = 'estimate';
```

### Files Changed
- One SQL migration file to restore the two `enhanced_estimates` records.

After this, the Estimate tab will show both "Paver System" estimates with edit/share capabilities. The user can then open each one and update the financial details if needed.

