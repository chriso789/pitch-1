
# Fix: Sync Estimate Display Name to Documents Table

## Problem

When you change the name of an estimate (e.g., "Standing Seam Painted") and click "Save Changes", the estimate record is updated correctly, but the **documents table is NOT updated**. This causes the "Recent Documents" list to show the raw filename (`OBR-00025-i7dr.pdf`) instead of the friendly display name.

**Current State:**
- `enhanced_estimates.display_name` = "Standing Seam Painted" ✅
- `documents.estimate_display_name` = null ❌

---

## Solution

Update the `update-estimate-line-items` edge function to also update all associated document records when `display_name` or `pricing_tier` changes.

---

## Technical Implementation

### File: `supabase/functions/update-estimate-line-items/index.ts`

**Add document sync after estimate update (around line 260):**

After successfully updating the `enhanced_estimates` table, sync the display name and pricing tier to any documents that match the estimate number.

```typescript
// After the estimate update succeeds...

// Sync display_name/pricing_tier to associated documents
if ((display_name !== undefined || pricing_tier !== undefined) && estimate.estimate_number) {
  const docUpdatePayload: Record<string, any> = {};
  
  if (display_name !== undefined) {
    docUpdatePayload.estimate_display_name = display_name?.trim() || null;
  }
  if (pricing_tier !== undefined) {
    docUpdatePayload.estimate_pricing_tier = pricing_tier || null;
  }

  // Update documents where filename matches the estimate number
  const { error: docUpdateError } = await serviceClient
    .from('documents')
    .update(docUpdatePayload)
    .eq('document_type', 'estimate')
    .eq('tenant_id', estimate.tenant_id)
    .like('filename', `${estimate.estimate_number}%`);

  if (docUpdateError) {
    console.warn('[update-estimate-line-items] Document sync warning:', docUpdateError);
    // Don't fail the request - estimate was updated successfully
  } else {
    console.log(`[update-estimate-line-items] Synced display_name to documents for ${estimate.estimate_number}`);
  }
}
```

---

## How Document Matching Works

Documents are matched to estimates using the filename pattern:
- Estimate number: `OBR-00025-i7dr`
- Document filename: `OBR-00025-i7dr.pdf`

The query uses `LIKE` with the estimate number prefix to match all versions of the estimate PDF.

---

## Data Flow

```text
User clicks "Save Changes"
       │
       ▼
MultiTemplateSelector.handleSaveLineItemChanges()
       │ sends display_name, pricing_tier
       ▼
update-estimate-line-items Edge Function
       │
       ├──► UPDATE enhanced_estimates (display_name, pricing_tier)
       │
       └──► UPDATE documents (estimate_display_name, estimate_pricing_tier)
              WHERE filename LIKE '{estimate_number}%'
       │
       ▼
Documents Tab shows updated display name
```

---

## File to Modify

| File | Changes |
|------|---------|
| `supabase/functions/update-estimate-line-items/index.ts` | Add document sync after estimate update |

---

## Result After Fix

1. User renames estimate to "Standing Seam Painted"
2. User clicks "Save Changes"
3. `enhanced_estimates.display_name` is updated ✅
4. `documents.estimate_display_name` is also updated ✅
5. Documents Tab immediately shows "Standing Seam Painted" instead of raw filename

---

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| No documents exist for estimate | No error, update simply affects 0 rows |
| Multiple document versions exist | All matching documents are updated |
| Document sync fails | Warning logged, but estimate update succeeds |
| Display name cleared (empty) | Documents updated to null |
