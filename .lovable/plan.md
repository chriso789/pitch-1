

# Fix Estimate Descriptions, Duplicate Net Profit, and Overhead Calculation

## Three Issues to Fix

### Issue 1: Template Descriptions Still Show Old Technical Text in Database
The seeder code was updated with homeowner-friendly descriptions, but the existing records in `estimate_calc_template_items` still have old descriptions like "Starter strip shingles", "Hip and ridge cap", "Synthetic underlayment 10sq roll", etc.

**Fix:** Write a SQL migration that updates all existing template item descriptions in `estimate_calc_template_items` to match the new homeowner-friendly text from the seeder. This uses a `CASE` statement matching on `item_name` patterns to update ~20 common description mappings in one pass.

### Issue 2: "Net Profit" Displayed Twice
In `EstimateBreakdownCard.tsx`, the Profit row shows the profit amount (e.g., $9,903.12), then immediately below the commission line it shows "Net Profit: $9,903.12" -- the exact same number. This is redundant.

**Fix:** Remove lines 178-182 in `EstimateBreakdownCard.tsx` that render the "Net Profit: ..." subtitle under the commission row. The profit amount is already clearly shown in the Profit section directly above.

### Issue 3: Overhead Calculated on Tax-Inclusive Selling Price
In `ProfitCenterPanel.tsx` (line 183), overhead is calculated as `sellingPrice * (overheadRate / 100)`. But `sellingPrice` from `api_estimate_hyperlink_bar` pulls from `enhanced_estimates.selling_price`, which includes sales tax. Overhead should be calculated on the pre-tax selling price.

Similarly in `RepProfitBreakdown.tsx` (line 119), overhead uses the raw `sellingPrice` prop which may include tax.

**Fix:**
- In `ProfitCenterPanel.tsx`: Fetch `sales_tax_amount` from the estimate data and subtract it before computing overhead. Update the RPC or add a separate query to get the tax amount.
- In `RepProfitBreakdown.tsx`: Accept an optional `salesTaxAmount` prop and subtract it from sellingPrice before overhead calculation.
- Update `api_estimate_hyperlink_bar` SQL function to also return `sales_tax_amount` so the frontend can separate pre-tax selling price.

---

## Technical Details

### Migration: Update Existing Template Descriptions
A new SQL migration will run `UPDATE estimate_calc_template_items SET description = CASE...END` for all common item names across all tenants. Mapping includes:
- Shingles (any brand) -> "Remove old roof and install new..."
- Starter Strip -> "Adhesive starter row installed along eaves..."
- Ridge Cap -> "Specially shaped shingles installed along the peak..."
- Underlayment -> "Waterproof barrier installed over the roof deck..."
- Ice and Water -> "Self-adhering waterproof membrane..."
- Drip Edge -> "Metal edge flashing installed along the roof perimeter..."
- Valley Metal -> "Metal channel installed where two roof slopes meet..."
- Pipe Boot -> "Rubber-sealed flashing fitted around plumbing vent pipes..."
- Coil Nails -> "Galvanized roofing nails used to secure shingles..."
- Roofing Cement -> "Sealant applied to flashings, edges, and penetrations..."
- OSB Sheets -> "Replacement plywood decking boards..."
- Tear Off (labor) -> "Remove and dispose of all existing roofing materials..."
- Shingle/Panel Install (labor) -> "Professionally install new... per manufacturer specifications..."
- Cleanup/Haul (labor) -> "Complete job-site cleanup, magnetic nail sweep..."
- Underlayment Install -> "Install waterproof underlayment over the entire roof deck..."
- Ridge/Hip Work -> "Install ridge cap and hip cap along all peaks and hip lines..."
- Flashing/Details -> "Install step flashing, valley metal, and detail work..."

### Files Modified
1. **New migration SQL** -- bulk update descriptions in `estimate_calc_template_items`
2. **`src/components/estimates/EstimateBreakdownCard.tsx`** -- remove redundant "Net Profit" line (lines 178-182)
3. **`src/components/estimates/ProfitCenterPanel.tsx`** -- subtract `sales_tax_amount` before overhead calculation
4. **`src/components/estimates/RepProfitBreakdown.tsx`** -- subtract tax before overhead calculation
5. **Update `api_estimate_hyperlink_bar`** SQL function to return `sales_tax_amount`
