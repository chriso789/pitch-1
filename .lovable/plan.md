

## Plan: Dynamic Invoice Builder with Estimate Line Items

### Problem
1. **Invoice creation fails** — likely an RLS or data issue (the `created_by` value may not be resolving correctly, or the tenant_id context isn't matching)
2. **Invoices are too simple** — currently just an amount + due date. You need invoices that pull in line items from the estimate (e.g., "Roof Replacement — $17,500") so they look professional and itemized.

### Solution

#### 1. Add `line_items` column to `project_invoices`

**New migration**: Add a JSONB `line_items` column to store itemized invoice lines.

```sql
ALTER TABLE project_invoices ADD COLUMN line_items jsonb DEFAULT '[]';
```

#### 2. Rebuild the Create Invoice dialog in `PaymentsTab.tsx`

Replace the simple amount/date form with a dynamic invoice builder:

- **Auto-populate from estimate**: Fetch the linked `enhanced_estimates` for the pipeline entry. Parse `line_items.materials` and `line_items.labor` into invoice line items.
- **Editable line items table**: Each row has Description, Qty, Unit Price, and Line Total. Users can edit, remove, or add custom lines.
- **Auto-calculated total**: Sum of all line items becomes the invoice amount.
- **Pre-built trade descriptions**: Group materials under a summary line like "Roof Replacement — Materials" and labor under "Roof Replacement — Labor", or let users customize.

The dialog will show:
```
Line Items:
  [x] OC Duration Shingles    40 SQ × $114.00 = $4,560.00
  [x] OC Starter Shingle       2 BDL × $54.00 =   $108.00
  [x] Tear Off                32.43 SQ × $55.00 = $1,783.65
  [x] Shingle Install         35.67 SQ × $55.00 = $1,961.85
  [ + Add Line Item ]
  
  Subtotal: $8,413.50
  Due Date: [04/02/2026]
  Notes: [____________]
  
  [Create Invoice]
```

#### 3. Fix the creation error

- Use `auth.uid()` directly via `(await supabase.auth.getUser()).data.user?.id` for `created_by` instead of `profile?.id` (which may be undefined or mismatched)
- Add error logging to surface the actual Supabase error message in the toast

#### 4. Display line items on invoice cards

Update the invoice list rendering to show a collapsible line item breakdown under each invoice.

### Files Changed

| Action | File |
|--------|------|
| New | Migration: add `line_items` JSONB to `project_invoices` |
| Edit | `src/components/estimates/PaymentsTab.tsx` — rebuild Create Invoice dialog with line items from estimate, fix `created_by` |
| Edit | `src/integrations/supabase/types.ts` — reflect new column |

### Technical Details

- Estimate line items structure: `{ materials: [...], labor: [...] }` where each item has `id, item_name, qty, unit, unit_cost, line_total, description`
- Invoice `line_items` will store: `[{ description, qty, unit, unit_cost, line_total }]`
- The invoice `amount` and `balance` will equal the sum of line totals
- Checkboxes let users select which estimate items to include (partial invoicing)

