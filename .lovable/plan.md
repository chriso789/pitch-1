

# Plan: Expand CSV Column Name Mapping for Material Import

## Problem Summary

The Material Import system doesn't recognize your CSV columns because they don't match the expected patterns. Your CSV has:

| Your Column | Expected Patterns | Match? |
|-------------|-------------------|--------|
| `brand logo` | N/A | ❌ Not mapped |
| `item` | code, sku, item_code | ❌ Not recognized |
| `calcluation` | N/A | ❌ Not mapped |
| `cost per bundle` | cost, price, base_cost, unit_cost | ❌ Not recognized |
| `cost per square` | N/A | ❌ Not mapped |
| `cost per item` | cost, price, base_cost, unit_cost | ❌ Not recognized |

The `parseCSVRow` function in `MaterialImportAuditDialog.tsx` fails because it can't find required columns (code, name, cost).

---

## Solution

Expand the column name mapping to support more common variations used by suppliers like SRS Distribution.

### File: `src/components/materials/MaterialImportAuditDialog.tsx`

**Current Column Mappings (lines 105-112):**
```typescript
const codeCol = mapColumnName(headers, ['code', 'sku', 'item_code', 'Code', 'SKU', 'Item Code', 'ItemCode']);
const nameCol = mapColumnName(headers, ['name', 'description', 'product', 'item_name', 'Name', 'Description', 'Product', 'ItemName']);
const costCol = mapColumnName(headers, ['cost', 'price', 'base_cost', 'unit_cost', 'Cost', 'Price', 'BaseCost', 'UnitCost']);
const uomCol = mapColumnName(headers, ['uom', 'unit', 'UOM', 'Unit']);
const categoryCol = mapColumnName(headers, ['category', 'category_name', 'Category', 'CategoryName']);
const markupCol = mapColumnName(headers, ['markup', 'markup_pct', 'Markup', 'MarkupPct']);
```

**Updated Column Mappings:**
```typescript
// Expanded to support more vendor formats (SRS, ABC Supply, etc.)
const codeCol = mapColumnName(headers, [
  'code', 'sku', 'item_code', 'item', 'item_number', 'part_number', 'product_code',
  'Code', 'SKU', 'Item Code', 'ItemCode', 'Item', 'Item Number', 'Part Number', 'Product Code'
]);
const nameCol = mapColumnName(headers, [
  'name', 'description', 'product', 'item_name', 'item_description', 'material',
  'Name', 'Description', 'Product', 'ItemName', 'Item Name', 'Item Description', 'Material'
]);
const costCol = mapColumnName(headers, [
  'cost', 'price', 'base_cost', 'unit_cost', 'unit_price', 
  'cost_per_unit', 'cost per unit', 'cost per item', 'cost per bundle', 'cost per square',
  'Cost', 'Price', 'BaseCost', 'UnitCost', 'Unit Cost', 'Unit Price',
  'Cost Per Unit', 'Cost Per Item', 'Cost Per Bundle', 'Cost Per Square'
]);
const uomCol = mapColumnName(headers, [
  'uom', 'unit', 'unit_of_measure', 'units',
  'UOM', 'Unit', 'Unit of Measure', 'Units'
]);
const categoryCol = mapColumnName(headers, [
  'category', 'category_name', 'type', 'product_type', 'material_type',
  'Category', 'CategoryName', 'Type', 'Product Type', 'Material Type'
]);
const brandCol = mapColumnName(headers, [
  'brand', 'manufacturer', 'brand_name', 'brand logo',
  'Brand', 'Manufacturer', 'Brand Name', 'Brand Logo'
]);
```

---

## Additional Enhancement

Add a new `brand` field to the import to capture brand information from your CSV's "brand logo" column:

1. Add `brandCol` mapping (shown above)
2. Include brand in the `ImportedItem` interface
3. Pass brand to the material catalog when saving

---

## UI Improvement

Update the "Supported column names" section in the upload dialog to show more variations:

**Current:**
```
Code: code, sku, item_code
Name: name, description, product
Cost: cost, price, base_cost, unit_cost
```

**Updated:**
```
Code: code, sku, item, item_code, product_code
Name: name, description, product, material
Cost: cost, price, unit_cost, cost per item, cost per bundle
UOM: uom, unit (defaults to EA)
Category: category, type
Brand: brand, manufacturer, brand logo
```

---

## Changes Summary

| File | Change |
|------|--------|
| `src/components/materials/MaterialImportAuditDialog.tsx` | Expand column name mappings to support vendor CSV formats |

---

## Alternative Quick Fix

If you need an immediate solution, you can rename your CSV columns before uploading:

| Current Column | Rename To |
|----------------|-----------|
| `item` | `code` or `sku` |
| `brand logo` | `brand` (optional) |
| `cost per item` or `cost per bundle` | `cost` |
| Add missing column | `name` (item description) |

**Note:** Your CSV appears to be missing a "name" or "description" column, which is required. The system needs to know what to call each material.

