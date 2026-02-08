
## Fix: Email Should Show Quote Name, Not Quote Number

### Problem
The email shows **"Quote Number: OBR-00027-jahv"** but you want it to display the **quote name** (custom display name) that you set when creating the estimate.

### Root Cause
In `supabase/functions/send-quote-email/index.ts`:

1. **Line 115**: Only fetches `estimate_number`, not the `display_name` column:
   ```typescript
   .select("id, estimate_number, selling_price, pipeline_entry_id, tenant_id, pdf_url")
   ```

2. **Lines 309-310**: Hardcodes "Quote Number" label and uses `estimate_number`:
   ```html
   <td style="...">Quote Number</td>
   <td style="...">${estimate.estimate_number}</td>
   ```

### Solution
Update the edge function to:
1. Fetch `display_name` from the database
2. Show "Quote" label with the display name (falling back to estimate number if no name is set)

---

## Technical Changes

### File: `supabase/functions/send-quote-email/index.ts`

**Change 1 - Add `display_name` to select (Lines 115 & 132):**

```typescript
// Line 115 - Lookup by estimate_id
.select("id, estimate_number, display_name, selling_price, pipeline_entry_id, tenant_id, pdf_url")

// Line 132 - Lookup by pipeline_entry_id
.select("id, estimate_number, display_name, selling_price, pipeline_entry_id, tenant_id, pdf_url")
```

**Change 2 - Update email HTML (Lines 309-310):**

```html
<!-- Before -->
<td style="color: #6b7280; font-size: 14px;">Quote Number</td>
<td style="text-align: right; color: #111827; font-weight: 600; font-size: 14px;">${estimate.estimate_number}</td>

<!-- After -->
<td style="color: #6b7280; font-size: 14px;">Quote</td>
<td style="text-align: right; color: #111827; font-weight: 600; font-size: 14px;">${estimate.display_name || estimate.estimate_number}</td>
```

**Change 3 - Update email subject (Line 358):**

```typescript
// Before
subject: body.subject || `Your Quote from ${companyName} - #${estimate.estimate_number}`

// After
subject: body.subject || `Your Quote from ${companyName} - ${estimate.display_name || estimate.estimate_number}`
```

---

## Expected Result

| Before | After |
|--------|-------|
| **Quote Number**: OBR-00027-jahv | **Quote**: Nicole's Roofing Project |
| Subject: Your Quote from O'Brien - #OBR-00027-jahv | Subject: Your Quote from O'Brien - Nicole's Roofing Project |

If no display name is set, it gracefully falls back to showing the estimate number.

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/send-quote-email/index.ts` | Add `display_name` to select, update email HTML label and content, update subject line |
