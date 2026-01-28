
# Plan: Add Company-Level Sales Tax to Estimates

## Summary

Implement a sales tax feature that:
- Is configured at the company level in Settings → Estimate PDF tab
- Is automatically applied to ALL estimates when enabled
- Cannot be edited on individual estimates (displayed as read-only)
- Shows as a separate line item in the estimate breakdown

---

## Database Changes

### Modify `tenant_estimate_settings` table

Add two new columns:
- `sales_tax_enabled` (boolean, default false)
- `sales_tax_rate` (numeric, default 0)

```sql
ALTER TABLE tenant_estimate_settings
ADD COLUMN sales_tax_enabled boolean DEFAULT false,
ADD COLUMN sales_tax_rate numeric(5,3) DEFAULT 0;
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/settings/EstimateFinePrintSettings.tsx` | Add Sales Tax configuration section (enable/disable + rate input) |
| `src/hooks/useEstimatePricing.ts` | Add tax fields to `PricingBreakdown` interface and calculation |
| `src/components/estimates/MultiTemplateSelector.tsx` | Fetch tenant's sales tax settings and pass to pricing hook |
| `src/components/estimates/EstimateBreakdownCard.tsx` | Display tax amount as read-only line (non-editable) |
| `src/components/estimates/SectionedLineItemsTable.tsx` | Replace editable tax toggle with read-only display from company settings |
| `src/components/estimates/EstimatePDFDocument.tsx` | Include tax line in PDF output |
| Database migration | Add `sales_tax_enabled` and `sales_tax_rate` columns |

---

## Technical Details

### 1. Database Migration

```sql
-- Add sales tax settings to tenant_estimate_settings
ALTER TABLE tenant_estimate_settings
ADD COLUMN IF NOT EXISTS sales_tax_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sales_tax_rate numeric(5,3) DEFAULT 0;

COMMENT ON COLUMN tenant_estimate_settings.sales_tax_enabled IS 'Whether sales tax is applied to estimates';
COMMENT ON COLUMN tenant_estimate_settings.sales_tax_rate IS 'Sales tax percentage (e.g., 7.25 for 7.25%)';
```

### 2. Update `useEstimatePricing.ts`

Add to `PricingConfig` interface:
```typescript
export interface PricingConfig {
  overheadPercent: number;
  profitMarginPercent: number;
  repCommissionPercent: number;
  commissionStructure: 'profit_split' | 'sales_percentage';
  // NEW: Sales tax settings (from company config, read-only)
  salesTaxEnabled: boolean;
  salesTaxRate: number;
}
```

Add to `PricingBreakdown` interface:
```typescript
export interface PricingBreakdown {
  // ... existing fields ...
  salesTaxAmount: number;      // NEW: Calculated tax amount
  totalWithTax: number;        // NEW: sellingPrice + tax
}
```

Update breakdown calculation:
```typescript
// Calculate sales tax
const salesTaxAmount = config.salesTaxEnabled 
  ? sellingPrice * (config.salesTaxRate / 100) 
  : 0;
const totalWithTax = sellingPrice + salesTaxAmount;

return {
  // ... existing fields ...
  salesTaxAmount,
  totalWithTax,
};
```

### 3. Update `EstimateFinePrintSettings.tsx`

Add a new "Sales Tax" section before the Fine Print editor:

```typescript
// Sales Tax Section
<Card className="mb-6">
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      <Receipt className="h-5 w-5" />
      Sales Tax
    </CardTitle>
    <CardDescription>
      Configure sales tax that will be automatically applied to all estimates. 
      This cannot be changed on individual estimates.
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
      <div className="space-y-0.5">
        <Label className="text-base">Enable Sales Tax</Label>
        <p className="text-sm text-muted-foreground">
          When enabled, tax will be added to all estimate totals
        </p>
      </div>
      <Switch
        checked={salesTaxEnabled}
        onCheckedChange={handleTaxEnabledChange}
      />
    </div>
    
    {salesTaxEnabled && (
      <div className="space-y-2">
        <Label>Tax Rate (%)</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            step="0.001"
            min="0"
            max="25"
            value={salesTaxRate}
            onChange={(e) => handleTaxRateChange(e.target.value)}
            className="w-32"
          />
          <span className="text-muted-foreground">%</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Example: Enter 7.25 for 7.25% sales tax
        </p>
      </div>
    )}
  </CardContent>
</Card>
```

### 4. Update `MultiTemplateSelector.tsx`

Modify `fetchCompanyAndEstimateSettings` to also fetch tax settings:

```typescript
// Fetch estimate settings (including sales tax)
const { data: settings } = await supabaseClient
  .from('tenant_estimate_settings')
  .select('fine_print_content, default_include_fine_print, sales_tax_enabled, sales_tax_rate')
  .eq('tenant_id', tenantId)
  .maybeSingle();

if (settings) {
  setFinePrintContent(settings.fine_print_content || '');
  // Apply tax settings to pricing config
  setConfig({
    ...config,
    salesTaxEnabled: settings.sales_tax_enabled ?? false,
    salesTaxRate: settings.sales_tax_rate ?? 0,
  });
}
```

### 5. Update `EstimateBreakdownCard.tsx`

Add read-only tax display (no toggle, no edit):

```typescript
{/* Sales Tax (Company Setting - Read Only) */}
{config.salesTaxEnabled && (
  <div className="flex items-center justify-between text-sm">
    <span className="flex items-center gap-2 text-muted-foreground">
      <Receipt className="h-4 w-4" />
      Sales Tax ({formatPercent(config.salesTaxRate)})
      <Badge variant="outline" className="text-xs">Company Rate</Badge>
    </span>
    <span className="font-medium">{formatCurrency(breakdown.salesTaxAmount)}</span>
  </div>
)}

{/* Update Grand Total */}
<div className="flex items-center justify-between py-2">
  <span className="text-lg font-semibold flex items-center gap-2">
    <DollarSign className="h-5 w-5" />
    {config.salesTaxEnabled ? 'TOTAL (with tax)' : 'SELLING PRICE'}
  </span>
  <span className="text-2xl font-bold text-primary">
    {formatCurrency(config.salesTaxEnabled ? breakdown.totalWithTax : breakdown.sellingPrice)}
  </span>
</div>
```

### 6. Update `SectionedLineItemsTable.tsx`

Remove the editable tax toggle. Instead, display tax as read-only if enabled:

```typescript
// Remove: taxEnabled prop with editable toggle
// Add: Read-only tax display from company settings

{salesTaxEnabled && (
  <TableRow className="bg-muted/30">
    <TableCell colSpan={editable ? 4 : 3} className="text-right">
      <span className="flex items-center justify-end gap-2 text-sm">
        <Receipt className="h-4 w-4 text-muted-foreground" />
        Sales Tax ({salesTaxRate.toFixed(2)}%)
        <Badge variant="outline" className="text-xs">Company Rate</Badge>
      </span>
    </TableCell>
    <TableCell className="text-right font-mono">
      {formatCurrency(salesTaxAmount)}
    </TableCell>
    {editable && <TableCell />}
  </TableRow>
)}
```

### 7. Update `EstimatePDFDocument.tsx`

Include tax line in PDF when enabled:

```typescript
// In the totals section
{config.salesTaxEnabled && config.salesTaxRate > 0 && (
  <div className="flex justify-between">
    <span>Sales Tax ({config.salesTaxRate.toFixed(2)}%)</span>
    <span className="font-mono">{formatCurrency(breakdown.salesTaxAmount)}</span>
  </div>
)}

{/* Grand Total */}
<div className="flex justify-between text-lg font-bold border-t pt-2">
  <span>TOTAL DUE</span>
  <span className="font-mono">
    {formatCurrency(config.salesTaxEnabled ? breakdown.totalWithTax : breakdown.sellingPrice)}
  </span>
</div>
```

### 8. Update Estimate Save (MultiTemplateSelector)

Save tax info to the estimate record:

```typescript
const { data: newEstimate, error: createError } = await supabaseClient
  .from('enhanced_estimates')
  .insert({
    // ... existing fields ...
    selling_price: breakdown.sellingPrice,
    sales_tax_rate: config.salesTaxEnabled ? config.salesTaxRate : 0,
    sales_tax_amount: breakdown.salesTaxAmount,
    total_with_tax: breakdown.totalWithTax,
    // ...
  })
```

This requires adding columns to `enhanced_estimates`:

```sql
ALTER TABLE enhanced_estimates
ADD COLUMN IF NOT EXISTS sales_tax_rate numeric(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS sales_tax_amount numeric(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_with_tax numeric(10,2);
```

---

## Data Flow

```text
┌─────────────────────────────────────────────────────────────────┐
│                     SETTINGS (Company Level)                     │
│  Settings → General → Estimate PDF                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ ☑ Enable Sales Tax                                          │ │
│  │ Tax Rate: [7.25] %                                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│        ↓ Saves to tenant_estimate_settings                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    ESTIMATE BUILDER                              │
│  MultiTemplateSelector loads settings on mount                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Pricing Breakdown:                                          │ │
│  │   Materials: $15,000                                        │ │
│  │   Labor: $8,000                                             │ │
│  │   Overhead (10%): $2,300                                    │ │
│  │   Profit (30%): $6,900                                      │ │
│  │   ─────────────────                                         │ │
│  │   Subtotal: $32,200                                         │ │
│  │   Sales Tax (7.25%): $2,334.50  🔒 Company Rate             │ │
│  │   ═══════════════════                                       │ │
│  │   TOTAL: $34,534.50                                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  Note: Tax rate shown as read-only with "Company Rate" badge     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      PDF OUTPUT                                  │
│  Same display - tax rate locked, pulled from company settings    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Expected User Experience

1. **Admin/Manager** goes to Settings → General → Estimate PDF
2. Enables "Sales Tax" toggle
3. Enters tax rate (e.g., 7.25%)
4. Saves settings

5. **Sales Rep** creates an estimate
6. Tax is automatically calculated and displayed
7. Rep CANNOT change the tax rate (shows "Company Rate" badge)
8. Saved estimate includes tax in totals
9. PDF shows tax as separate line item

---

## Summary of Changes

| Component | What Changes |
|-----------|-------------|
| Database | 2 new columns in `tenant_estimate_settings`, 3 new columns in `enhanced_estimates` |
| Settings UI | New "Sales Tax" configuration card |
| Pricing Hook | New fields for tax calculation |
| Estimate Builder | Fetches and applies company tax settings |
| Breakdown Card | Displays tax as read-only |
| Line Items Table | Shows tax (non-editable) |
| PDF Document | Includes tax line in output |
