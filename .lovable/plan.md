
# Fix: Multi-Trade Line Items Not Merging Into Single Estimate — COMPLETED

## Summary

Implemented per-trade item storage with merge into unified `lineItems` array so all trades (Roofing, Gutters, Siding, etc.) contribute to a single estimate with combined pricing.

## Changes Made

| File | Change |
|------|--------|
| `src/hooks/useEstimatePricing.ts` | Added `trade_type` and `trade_label` to `LineItem` interface |
| `src/components/estimates/MultiTemplateSelector.tsx` | Added `tradeLineItems` state, `handleTradeTemplateSelect`, merge effect, updated shouldShowTemplateContent, updated save serialization, updated trade delete handler |
| `src/components/estimates/SectionedLineItemsTable.tsx` | Added trade grouping headers when multi-trade items present |
