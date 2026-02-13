

# Dynamic Descriptions for Estimate Line Items

## Problem
Currently, the `description` field exists on template line items (`estimate_calc_template_items.description`) and on the `LineItem` interface, but it is never displayed in the `SectionedLineItemsTable`. Many items have null or generic descriptions. Users need meaningful, auto-generated descriptions that reflect the actual quantities and context.

## Solution

### 1. Add description display to `SectionedLineItemsTable`

**File: `src/components/estimates/SectionedLineItemsTable.tsx`**

In `renderItemRow` (line ~223-239), add the `description` field below `item_name`:

```
Item Name [Modified badge] [Note icon]
Description text here (gray, smaller)
Color/Specs: notes text (amber)
```

- Show `item.description` in a `text-xs text-muted-foreground` paragraph below the item name
- Only render if `item.description` is truthy and different from `item_name`

### 2. Make description editable inline

Add the description to the editable cell system:
- Click on description text to edit inline (similar to notes but as a simple text input)
- Or add description editing to the existing NoteEditor popover as a second field

### 3. Auto-generate dynamic descriptions from template data

**File: `src/components/estimates/MultiTemplateSelector.tsx`**

When template line items are loaded and quantities are calculated (around line ~808-850 where `fetchTemplateItems` processes items), generate descriptions dynamically:

For each line item, build a description from:
- The template's static `description` if it exists (e.g., "Remove existing roofing")
- Append computed context: quantity and unit (e.g., "32.5 SQ with 10% waste factor")
- For formula-based items, include the measurement source (e.g., "Based on 3,250 SF roof area")

**Description generation logic:**

```typescript
function generateDynamicDescription(
  item: TemplateLineItem,
  computedQty: number,
  measurements: Record<string, number>
): string {
  // Start with static description if available
  let desc = item.description || '';
  
  // Parse the formula to determine measurement source
  const formula = item.qty_formula || '';
  if (formula.includes('surface_squares')) {
    desc = desc || `${computedQty.toFixed(1)} squares`;
    if (formula.includes('1.10')) desc += ' (incl. 10% waste)';
    if (formula.includes('1.15')) desc += ' (incl. 15% waste)';
  } else if (formula.includes('ridge')) {
    desc = desc || `${computedQty.toFixed(0)} LF ridge line`;
  } else if (formula.includes('valley')) {
    desc = desc || `${computedQty.toFixed(0)} LF valley`;
  } else if (formula.includes('perimeter')) {
    desc = desc || `${computedQty.toFixed(0)} LF perimeter`;
  } else if (formula.includes('surface_area')) {
    desc = desc || `${computedQty.toFixed(0)} SF coverage area`;
  }
  
  return desc;
}
```

### 4. Persist description on save

When estimates are saved to `enhanced_estimates` (the JSON line items blob), include the `description` field so it persists and shows on reload and in PDFs.

**File: `src/hooks/useEstimatePricing.ts`** — No changes needed; `description` is already on the `LineItem` interface.

### 5. Show description in PDF output

**File: `src/components/estimates/EstimatePDFDocument.tsx`** and **`EstimatePDFTemplate.tsx`**

Add the description below the item name in the PDF line items table, matching the same layout as the on-screen table.

## Files Modified

1. **`src/components/estimates/SectionedLineItemsTable.tsx`** — Display description below item_name, add inline edit capability
2. **`src/components/estimates/MultiTemplateSelector.tsx`** — Generate dynamic descriptions when loading template items and calculating quantities
3. **`src/components/estimates/EstimatePDFDocument.tsx`** — Show description in PDF output
4. **`src/components/estimates/EstimatePDFTemplate.tsx`** — Show description in PDF template

## No database migration needed

The `description` column already exists on `estimate_calc_template_items` and the `LineItem` interface already has `description?: string`.
