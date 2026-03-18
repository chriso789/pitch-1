

# Fix Invoice Submission Edge Function Errors

## Root Cause
The `submit-project-invoice` edge function fails because of check constraints on the `project_cost_invoices` table:

1. **Status constraint**: Only allows `pending`, `approved`, `rejected`, `needs_review` — but the function inserts `'verified'` when a document is attached (line 100)
2. **Invoice type constraint**: Only allows `material`, `labor` — but the UI sends `'overhead'` as a valid type

## Changes

### 1. Database Migration — Update Check Constraints
```sql
-- Add 'verified' to status constraint
ALTER TABLE project_cost_invoices DROP CONSTRAINT project_cost_invoices_status_check;
ALTER TABLE project_cost_invoices ADD CONSTRAINT project_cost_invoices_status_check 
  CHECK (status = ANY (ARRAY['pending','approved','rejected','needs_review','verified']));

-- Add 'overhead' to invoice_type constraint
ALTER TABLE project_cost_invoices DROP CONSTRAINT project_cost_invoices_invoice_type_check;
ALTER TABLE project_cost_invoices ADD CONSTRAINT project_cost_invoices_invoice_type_check 
  CHECK (invoice_type = ANY (ARRAY['material','labor','overhead']));
```

### 2. Edge Function — Fix `document_type` for overhead
In `supabase/functions/submit-project-invoice/index.ts` line 115, the `docType` mapping doesn't handle `overhead`. Update to:
```typescript
const docType = invoice_type === 'material' ? 'invoice_material' 
  : invoice_type === 'labor' ? 'invoice_labor' 
  : 'invoice_overhead';
```

### 3. Edge Function — Also fix `link-document-invoice`
The `link-document-invoice` function (line 141) also inserts `status: 'verified'` which would fail. Same fix applies.

These are small, targeted fixes. No UI changes needed.

