

# Plan: Fix SRS Pricelist CSV Import Parser

## Problem Identified

The SRS pricelist CSV has a unique format that the current parser doesn't handle:

| Issue | Current Behavior | Required Behavior |
|-------|------------------|-------------------|
| Column `item` | Mapped as "code" | Should be "name" |
| No code column | Returns null | Auto-generate from name (e.g., "GAF Timberline HDZ" → "GAF-TIMBERLINE-HDZ") |
| Section headers | Parsed as data | Skip rows where `item` contains section text (e.g., "Shingle Hip and Ridge") |
| Multiple price columns | Only checks one | Check `cost per item`, `cost per bundle`, `cost per sq` in order |
| UOM | Defaults to "EA" | Extract from `calculation` column (e.g., "3BD/SQ" → "SQ", "25LF/BD" → "BD") |
| Category | Not detected | Derive from section headers (track current section as we parse) |

---

## CSV Structure Analysis

**Headers:**
```
brand logo, item, calculation, cost per bundle, cost per sq, cost per item
```

**Data Patterns:**
- Rows 2-11: Shingles - use `cost per sq` column, UOM = "SQ"
- Row 12: Section header "Brand, Shingle Hip and Ridge and Starter..." - SKIP
- Rows 13-25: Hip/Ridge/Starter - use `cost per item` column, UOM from `calculation`
- Row 26: Section header - SKIP
- And so on...

---

## Solution

Update `parseCSVRow` function in `MaterialImportAuditDialog.tsx` to:

1. **Skip section headers**: Check if `item` column contains known section identifiers
2. **Use `item` as name**: Map the `item` column to `name` field
3. **Auto-generate code**: Create code from name (sanitize and uppercase)
4. **Multi-price fallback**: Try `cost per item` → `cost per bundle` → `cost per sq`
5. **Extract UOM**: Parse from `calculation` column (e.g., "3BD/SQ" → last part "SQ")
6. **Track categories**: Detect section headers and assign category to subsequent rows

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/materials/MaterialImportAuditDialog.tsx` | Update `parseCSVRow` function with SRS-specific parsing logic |

---

## Technical Implementation

### Updated `parseCSVRow` Function

```typescript
// Section header indicators to skip
const SECTION_INDICATORS = [
  'shingle hip and ridge',
  'mechanically fastened',
  'self adhered',
  'residential low slope',
  'ventilation',
  'flashing',
  'drip edge',
  'accessories',
  'nails',
  'sealants',
  'uom+d' // Excel formula artifact
];

const isSectionHeader = (value: string): boolean => {
  if (!value) return false;
  const lower = value.toLowerCase();
  return SECTION_INDICATORS.some(indicator => lower.includes(indicator));
};

const generateCodeFromName = (name: string): string => {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 30);
};

const extractUOMFromCalculation = (calc: string): string => {
  if (!calc) return 'EA';
  // Examples: "3BD/SQ" → "SQ", "25LF/BD" → "BD", "10SQ/RL" → "RL"
  const parts = calc.split('/');
  if (parts.length === 2) {
    return parts[1].replace(/[^A-Z]/gi, '').toUpperCase() || 'EA';
  }
  // Try to find known UOMs
  const uomMatch = calc.match(/(BD|SQ|RL|EA|LF|BX|CS)/i);
  return uomMatch ? uomMatch[1].toUpperCase() : 'EA';
};

const parseCSVRow = (row: any, headers: string[]): ImportedItem | null => {
  // Map columns for SRS format
  const itemCol = mapColumnName(headers, ['item', 'Item']);
  const calcCol = mapColumnName(headers, ['calculation', 'Calculation']);
  const costPerItemCol = mapColumnName(headers, ['cost per item', 'Cost Per Item', '$/UOM']);
  const costPerBundleCol = mapColumnName(headers, ['cost per bundle', 'Cost Per Bundle']);
  const costPerSqCol = mapColumnName(headers, ['cost per sq', 'Cost Per Sq', 'cost per square']);
  const brandCol = mapColumnName(headers, ['brand', 'brand logo', 'Brand', 'Brand Logo']);

  const itemName = itemCol ? row[itemCol]?.toString().trim() : null;
  
  // Skip empty rows or section headers
  if (!itemName || isSectionHeader(itemName)) return null;
  
  // Skip if Brand column has section header text
  const brandValue = brandCol ? row[brandCol]?.toString().trim() : '';
  if (brandValue && isSectionHeader(brandValue)) return null;

  // Get cost - try multiple columns in priority order
  let costStr: string | null = null;
  if (costPerItemCol && row[costPerItemCol]) {
    costStr = row[costPerItemCol].toString().replace(/[$,]/g, '').trim();
  }
  if ((!costStr || costStr === '0' || costStr === '') && costPerBundleCol && row[costPerBundleCol]) {
    costStr = row[costPerBundleCol].toString().replace(/[$,]/g, '').trim();
  }
  if ((!costStr || costStr === '0' || costStr === '') && costPerSqCol && row[costPerSqCol]) {
    costStr = row[costPerSqCol].toString().replace(/[$,]/g, '').trim();
  }

  const cost = costStr ? parseFloat(costStr) : NaN;
  if (isNaN(cost) || cost <= 0) return null;

  // Extract UOM from calculation column
  const calcValue = calcCol ? row[calcCol]?.toString().trim() : '';
  const uom = extractUOMFromCalculation(calcValue);

  // Generate code from item name
  const code = generateCodeFromName(itemName);

  return {
    code,
    name: itemName,
    newCost: cost,
    uom,
    category: '', // Will be enhanced with section tracking
    markupPct: 0.35,
    coverage: undefined,
    supplierSku: undefined,
  };
};
```

### Section Category Tracking

To properly categorize items, we'll track the current section as we parse:

```typescript
const handleFileUpload = (event) => {
  // ... existing code ...
  
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const headers = results.meta.fields || [];
      let currentCategory = 'Shingles'; // Default first section
      
      const importedItems: ImportedItem[] = [];
      
      for (const row of results.data as any[]) {
        const itemValue = row['item']?.toString().trim() || '';
        const brandValue = row['brand logo']?.toString()?.trim() || row['Brand']?.toString()?.trim() || '';
        
        // Check if this is a section header
        if (isSectionHeader(itemValue) || isSectionHeader(brandValue)) {
          // Update current category from the section header
          if (itemValue && !itemValue.toLowerCase().includes('uom')) {
            currentCategory = itemValue.split(' ').slice(0, 3).join(' ');
          }
          continue;
        }
        
        const parsed = parseCSVRow(row, headers);
        if (parsed) {
          parsed.category = currentCategory;
          importedItems.push(parsed);
        }
      }
      
      // ... rest of existing code ...
    }
  });
};
```

---

## Expected Results

After the fix, importing the SRS pricelist CSV will:

| Before | After |
|--------|-------|
| "No valid rows found" error | Successfully parses 100+ materials |
| - | Auto-generates codes (e.g., "GAF-TIMBERLINE-HDZ") |
| - | Extracts correct UOM (SQ, BD, RL, EA) |
| - | Uses appropriate price column |
| - | Assigns categories by section |

**Example Parsed Data:**
| Code | Name | Cost | UOM | Category |
|------|------|------|-----|----------|
| GAF-TIMBERLINE-HDZ | GAF Timberline HDZ | $115.00 | SQ | Shingles |
| GAF-S-A-R-HIP-AND-RIDGE | GAF S-A-R Hip and Ridge | $59.00 | BD | Hip and Ridge |
| SG-30-TOP-SHIELD-CMI | SG-30 (Top Shield)(CMI) | $67.00 | RL | Underlayments |

---

## Summary

| Change | Purpose |
|--------|---------|
| Skip section headers | Don't treat "Shingle Hip and Ridge and Starter" as product rows |
| Use `item` as name | CSV doesn't have separate code column |
| Auto-generate code | Create unique identifier from product name |
| Multi-price fallback | Check `cost per item`, `cost per bundle`, `cost per sq` |
| Extract UOM from calculation | Parse "3BD/SQ" → "SQ" |
| Track section categories | Assign products to correct category |

