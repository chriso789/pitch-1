
# Plan: Smart CSV Import with Price Comparison & Audit

## Overview

Create an enhanced CSV import workflow for the Material Catalog that compares imported items against existing materials, displays pricing differences in an audit view, and allows selective saving of new/updated items.

---

## Current State

The existing `MaterialCatalogManager.tsx` has a basic CSV import that:
- Parses CSV and calls `api_bulk_import_materials` RPC
- Blindly upserts all records without comparison
- No visibility into what changed or what pricing differences exist

---

## Proposed Solution

### New Component: `MaterialImportAuditDialog.tsx`

A multi-step import dialog that:
1. **Step 1: Upload** - User uploads CSV file
2. **Step 2: Analysis** - System compares against existing materials and categorizes:
   - **New Items** - Not in catalog (will be added)
   - **Price Increases** - Existing item, new cost > current cost
   - **Price Decreases** - Existing item, new cost < current cost  
   - **No Change** - Existing item, same cost
3. **Step 3: Review & Confirm** - User reviews the audit and selects what to import
4. **Step 4: Save** - Imports selected items to Material Catalog

---

## Technical Implementation

### 1. New Component Structure

**File:** `src/components/materials/MaterialImportAuditDialog.tsx`

```text
MaterialImportAuditDialog
├── Step 1: FileUploadStep (CSV upload + parse)
├── Step 2: AnalysisStep (compare to existing materials)
├── Step 3: AuditReviewStep (show price diff table)
└── Step 4: ConfirmImportStep (save selected items)
```

### 2. Data Structures

```typescript
interface ImportedItem {
  code: string;
  name: string;
  category: string;
  uom: string;
  newCost: number;
  supplierSku?: string;
  markupPct?: number;
  coverage?: number;
}

interface AuditItem extends ImportedItem {
  existingMaterial?: Material; // From current catalog
  currentCost: number | null;
  priceDiff: number | null;     // newCost - currentCost
  priceDiffPct: number | null;  // % change
  status: 'new' | 'increase' | 'decrease' | 'no_change';
  selected: boolean;            // User can toggle
}

interface ImportAuditSummary {
  totalItems: number;
  newItems: AuditItem[];
  priceIncreases: AuditItem[];
  priceDecreases: AuditItem[];
  noChange: AuditItem[];
}
```

### 3. Analysis Logic

When CSV is parsed, fetch existing materials and compare:

```typescript
async function analyzeImport(importedItems: ImportedItem[], existingMaterials: Material[]): ImportAuditSummary {
  // Create lookup map by code and supplier_sku
  const materialByCode = new Map(existingMaterials.map(m => [m.code.toLowerCase(), m]));
  const materialBySku = new Map(existingMaterials.filter(m => m.supplier_sku).map(m => [m.supplier_sku!.toLowerCase(), m]));
  
  const auditItems: AuditItem[] = importedItems.map(item => {
    // Try to match by code first, then by supplier_sku
    const existing = materialByCode.get(item.code.toLowerCase()) 
                  || materialBySku.get(item.code.toLowerCase())
                  || materialBySku.get(item.supplierSku?.toLowerCase() || '');
    
    const currentCost = existing?.base_cost ?? null;
    const priceDiff = currentCost !== null ? item.newCost - currentCost : null;
    const priceDiffPct = currentCost && currentCost > 0 ? (priceDiff! / currentCost) * 100 : null;
    
    let status: AuditItem['status'];
    if (!existing) {
      status = 'new';
    } else if (priceDiff === 0 || priceDiff === null) {
      status = 'no_change';
    } else if (priceDiff > 0) {
      status = 'increase';
    } else {
      status = 'decrease';
    }
    
    return {
      ...item,
      existingMaterial: existing,
      currentCost,
      priceDiff,
      priceDiffPct,
      status,
      selected: status !== 'no_change' // Auto-select new items and price changes
    };
  });
  
  return {
    totalItems: auditItems.length,
    newItems: auditItems.filter(i => i.status === 'new'),
    priceIncreases: auditItems.filter(i => i.status === 'increase'),
    priceDecreases: auditItems.filter(i => i.status === 'decrease'),
    noChange: auditItems.filter(i => i.status === 'no_change')
  };
}
```

### 4. UI Design for Audit View

The audit step shows a summary card + detailed table:

**Summary Cards:**
```text
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  📦 NEW      │ │  📈 INCREASE │ │  📉 DECREASE │ │  ✓ NO CHANGE │
│     12       │ │      8       │ │      3       │ │      45      │
│   items      │ │   items      │ │   items      │ │   items      │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

**Audit Table (tabs for each category):**
```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ [✓] Code       │ Name                   │ Current │ New     │ Diff   │ %    │
├─────────────────────────────────────────────────────────────────────────────┤
│ [✓] SRS-HDZ    │ GAF Timberline HDZ     │ $110.00 │ $115.00 │ +$5.00 │ +4.5%│
│ [✓] SRS-OC-DUR │ OC Duration            │ $108.00 │ $114.00 │ +$6.00 │ +5.6%│
│ [ ] SRS-CT-LM  │ CertainTeed Landmark   │ $113.00 │ $113.00 │ $0.00  │ 0%   │
└─────────────────────────────────────────────────────────────────────────────┘
```

- Rows are color-coded: green for new, yellow/orange for increases, blue for decreases
- Checkboxes allow selecting which items to save
- "Select All" / "Deselect All" buttons per category

### 5. Save Logic

When user clicks "Save to Catalog":

```typescript
async function saveSelectedItems(items: AuditItem[]): Promise<{ added: number; updated: number }> {
  const selectedItems = items.filter(i => i.selected);
  
  // Call existing RPC or new dedicated RPC
  const { data, error } = await supabase.rpc('api_bulk_import_materials', {
    p_materials: selectedItems.map(item => ({
      code: item.code,
      name: item.name,
      category: item.category,
      uom: item.uom,
      base_cost: item.newCost,
      markup_pct: item.markupPct || 0.35,
      coverage: item.coverage,
      sku: item.supplierSku
    }))
  });
  
  // Log to price_history for audit trail
  for (const item of selectedItems.filter(i => i.status === 'increase' || i.status === 'decrease')) {
    await supabase.from('price_history').insert({
      tenant_id: tenantId,
      sku: item.code,
      product_name: item.name,
      old_price: item.currentCost,
      new_price: item.newCost,
      price_change_pct: item.priceDiffPct,
      changed_at: new Date().toISOString()
    });
  }
  
  return {
    added: selectedItems.filter(i => i.status === 'new').length,
    updated: selectedItems.filter(i => i.status !== 'new').length
  };
}
```

### 6. Integration with MaterialCatalogManager

Replace the simple import dialog in `MaterialCatalogManager.tsx` with the new audit dialog:

```typescript
// Before (lines 242-265)
<Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
  <DialogTrigger asChild>
    <Button variant="outline">
      <Upload className="h-4 w-4 mr-2" />
      Import CSV
    </Button>
  </DialogTrigger>
  <DialogContent>
    {/* Simple file input */}
  </DialogContent>
</Dialog>

// After
<MaterialImportAuditDialog
  open={importDialogOpen}
  onOpenChange={setImportDialogOpen}
  existingMaterials={materials}
  onImportComplete={() => {
    loadData();
    toast.success('Materials imported successfully');
  }}
/>
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/materials/MaterialImportAuditDialog.tsx` | **Create** | New multi-step import dialog with audit view |
| `src/components/materials/ImportAuditTable.tsx` | **Create** | Reusable audit table component with diff highlighting |
| `src/components/MaterialCatalogManager.tsx` | **Modify** | Replace simple import dialog with new audit dialog |

---

## User Experience Flow

1. User clicks "Import CSV" button in Material Catalog
2. Dialog opens with file upload dropzone
3. User uploads CSV file (e.g., from SRS pricelist)
4. System parses CSV and compares against existing materials (loading spinner)
5. **Audit View** appears showing:
   - Summary cards (12 new, 8 price increases, 3 decreases, 45 unchanged)
   - Tabbed table view with checkboxes for each category
   - Price differences highlighted with colors and percentage change
6. User reviews and toggles checkboxes as needed
7. User clicks "Save Selected Items to Catalog"
8. Confirmation toast: "Added 12 new materials, updated 11 prices"
9. Dialog closes, catalog refreshes

---

## Visual Design Specifications

**Color Coding:**
- **New Items**: Green badge, green highlight
- **Price Increases**: Orange/yellow badge, warning highlight
- **Price Decreases**: Blue badge, info highlight  
- **No Change**: Gray badge, no highlight

**Price Diff Display:**
- Increases: `+$5.00 (+4.5%)` in orange text
- Decreases: `-$3.50 (-3.2%)` in blue text
- No change: `$0.00` in gray text

**Selection States:**
- Checkbox column for each row
- "Select All New Items" button
- "Select All Price Changes" button
- "Deselect All" button

---

## CSV Format Support

The importer should support flexible column names to handle different vendor formats:

| Accepted Column Names | Maps To |
|----------------------|---------|
| `code`, `sku`, `item_code`, `Code`, `SKU`, `Item Code` | `code` |
| `name`, `description`, `product`, `item_name`, `Name`, `Description` | `name` |
| `cost`, `price`, `base_cost`, `unit_cost`, `Cost`, `Price` | `base_cost` |
| `uom`, `unit`, `UOM`, `Unit` | `uom` |
| `category`, `category_name`, `Category` | `category` |
| `markup`, `markup_pct`, `Markup` | `markup_pct` |
| `coverage`, `coverage_per_unit`, `Coverage` | `coverage` |
| `supplier_sku`, `vendor_sku` | `supplier_sku` |

---

## Expected Results

After implementation:
1. Users can import vendor pricelists (SRS, ABC, etc.) with full visibility into changes
2. Price increases/decreases are clearly visible before committing
3. New materials are identified and can be added selectively
4. Audit trail is maintained in `price_history` table
5. No accidental price overrides - user explicitly confirms changes
