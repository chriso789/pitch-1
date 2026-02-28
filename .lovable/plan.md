

# Fix: Preview Trade Order + Incorrect Total

## Root Causes Found

### 1. Trade order reversed in preview
`EstimatePDFDocument.tsx` line 404 sorts by `trade_type` alphabetically (`gutters` < `roofing`), so Gutters shows first. The builder shows Roofing first. Fix: sort by trade occurrence order in the original item arrays instead of alphabetically.

### 2. Wrong total in preview
In `MultiTemplateSelector.tsx` line 651, when loading an estimate for editing:
```
profitMarginPercent: estimate.actual_profit_percent || 30
```
`actual_profit_percent` is the **realized** profit (11.23%), not the **target** margin (20%) used to derive the selling price. This causes `useEstimatePricing` to recalculate a much lower selling price ($41,917 vs $47,193).

The correct source is `estimate.calculation_metadata.pricing_config.profitMarginPercent`.

---

## Changes

### A. Fix trade order in preview — `EstimatePDFDocument.tsx` (~line 400-408)
Replace alphabetical `tradeA.localeCompare(tradeB)` with order-of-first-appearance sorting. Build a trade order map from the combined items array before sorting, preserving the original insertion order (Roofing items come before Gutters items in the saved data).

### B. Fix profit margin loading — `MultiTemplateSelector.tsx` (~line 649-653)
Change `profitMarginPercent` source from `estimate.actual_profit_percent` to `estimate.calculation_metadata?.pricing_config?.profitMarginPercent`, falling back to `estimate.actual_profit_percent` then `30`:
```typescript
const calcMetadata = estimate.calculation_metadata as any;
const targetMargin = calcMetadata?.pricing_config?.profitMarginPercent 
  ?? estimate.actual_profit_percent 
  ?? 30;

setConfig({
  overheadPercent: estimate.overhead_percent || 15,
  profitMarginPercent: targetMargin,
  repCommissionPercent: estimate.rep_commission_percent || 5,
});
```

Also load `salesTaxEnabled` and `salesTaxRate` from the estimate record to ensure tax is applied:
```typescript
setConfig({
  overheadPercent: estimate.overhead_percent || 15,
  profitMarginPercent: targetMargin,
  repCommissionPercent: estimate.rep_commission_percent || 5,
  salesTaxEnabled: (estimate.sales_tax_rate || 0) > 0,
  salesTaxRate: estimate.sales_tax_rate || 0,
});
```

Also load `commissionStructure` from `calculation_metadata` if present.

