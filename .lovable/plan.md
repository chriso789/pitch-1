

# Fix "Add Trade" Button + Homeowner-Friendly Descriptions

## Issue 1: Missing "Add Trade" Button

**Root Cause:** When no company has configured trades in `app_settings`, the code defaults to `['roofing']` only. Since roofing is already added, the filter `AVAILABLE_TRADES.filter(t => !addedTradeTypes.includes(t.value) && enabledTrades.includes(t.value))` returns an empty array, hiding the button entirely.

**Fix in `src/components/estimates/MultiTemplateSelector.tsx` (line 240):**

Change the default from `['roofing']` to include all trade values:
```typescript
// Before
const [enabledTrades, setEnabledTrades] = useState<string[]>(['roofing']);

// After
const [enabledTrades, setEnabledTrades] = useState<string[]>(
  ALL_TRADES.map(t => t.value)
);
```

This means all trades are available by default until a company explicitly configures their preferences. Companies can still narrow it down via the "Manage Trades" settings dialog.

---

## Issue 2: More Explanatory Descriptions for Homeowners

**Root Cause:** The `generateDynamicDescription` function (line 104-133) produces contractor shorthand like "32.5 squares" or "120 LF ridge line". Homeowners don't know what "SQ", "LF", or "squares" mean in roofing context.

**Fix in `src/components/estimates/MultiTemplateSelector.tsx` (lines 103-133):**

Rewrite the function to produce plain-English, homeowner-friendly descriptions that explain **what** and **why**:

```typescript
function generateDynamicDescription(
  item: TemplateLineItem,
  computedQty: number
): string {
  if (item.description) return item.description;

  const formula = item.qty_formula || '';
  const name = (item.item_name || '').toLowerCase();

  // Shingles / main roofing material
  if (formula.includes('surface_squares')) {
    let desc = `Covers ${computedQty.toFixed(1)} squares of your roof area`;
    if (formula.includes('1.15')) desc += ', includes 15% extra for waste and cuts';
    else if (formula.includes('1.10')) desc += ', includes 10% extra for waste and cuts';
    return desc;
  }

  // Ridge-related items
  if (formula.includes('ridge')) {
    return `Protects the ${computedQty.toFixed(0)} linear feet along the peak of your roof where two slopes meet`;
  }

  // Valley items
  if (formula.includes('valley')) {
    return `Waterproofs the ${computedQty.toFixed(0)} linear feet of valleys where two roof slopes channel rainwater`;
  }

  // Hip items
  if (formula.includes('hip')) {
    return `Covers ${computedQty.toFixed(0)} linear feet along the angled edges where roof planes meet`;
  }

  // Rake / gable edge
  if (formula.includes('rake')) {
    return `Finishes and seals ${computedQty.toFixed(0)} linear feet along the sloped edges of your roof`;
  }

  // Eave / perimeter / drip edge
  if (formula.includes('eave') || formula.includes('perimeter')) {
    return `Installed along ${computedQty.toFixed(0)} linear feet of your roof's outer edge to direct water into gutters`;
  }

  // General area coverage
  if (formula.includes('surface_area')) {
    return `Covers ${computedQty.toFixed(0)} square feet of roof surface area`;
  }

  return '';
}
```

This produces descriptions like:
- **Before:** "32.5 squares (incl. 10% waste)"
- **After:** "Covers 32.5 squares of your roof area, includes 10% extra for waste and cuts"
- **Before:** "120 LF ridge line"
- **After:** "Protects the 120 linear feet along the peak of your roof where two slopes meet"

---

## Files Modified

1. **`src/components/estimates/MultiTemplateSelector.tsx`**
   - Line 240: Change default `enabledTrades` from `['roofing']` to all trades
   - Lines 103-133: Rewrite `generateDynamicDescription` with homeowner-friendly language
