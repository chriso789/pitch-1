
# Fix: Scope Documents Not Appearing After Bulk Upload

## Problem Summary

When uploading insurance scope documents via the Bulk Upload modal in Scope Intelligence, the documents are not appearing in the system. Currently, there are only **3 insurance scope documents** in the database (1 complete, 2 failed), and **no new uploads have been processed recently**.

---

## Root Cause Analysis

After thorough investigation, I identified these issues:

### Issue 1: Edge Function Was Not Processing Calls

The `scope-document-ingest` edge function showed **no recent activity** in the analytics logs, meaning calls weren't being executed. I've already redeployed the function, which should resolve this.

### Issue 2: Storage Upload Path Inconsistency

The bulk uploader uses the correct RLS-compliant path:
```typescript
// ScopeBulkUploader.tsx line 119
const storagePath = `${tenantId}/insurance-scopes/${Date.now()}_${file.name}`;
```

But the single-file uploader in `useScopeIntelligence.ts` uses the **wrong path format**:
```typescript
// Line 133 - WRONG FORMAT
const storagePath = `insurance-scopes/${tenantId}/${Date.now()}_${file.name}`;
```

This causes RLS violations when trying to upload via the single-file method.

### Issue 3: Failed Documents Not Visible in "Needs Review" Count

The dashboard shows "Needs Review: 0" but there are 2 failed documents. The "Needs Review" count only checks for `parse_status = 'needs_review'`, not `parse_status = 'failed'`.

---

## Solution

### Fix 1: Fix Storage Path in useScopeIntelligence.ts

**File:** `src/hooks/useScopeIntelligence.ts`
**Line:** 133

Change from:
```typescript
const storagePath = `insurance-scopes/${tenantId}/${Date.now()}_${file.name}`;
```

To:
```typescript
const storagePath = `${tenantId}/insurance-scopes/${Date.now()}_${file.name}`;
```

### Fix 2: Update Dashboard to Show Failed Documents

**File:** `src/components/insurance/ScopeIntelligenceDashboard.tsx`

Update the "Needs Review" card to include both `needs_review` AND `failed` status documents:
```typescript
const needsReviewCount = documents?.filter(d => 
  d.parse_status === 'needs_review' || d.parse_status === 'failed'
).length || 0;
```

Or create a separate "Failed" card to show failed documents distinctly.

### Fix 3: Add Retry/Reprocess Button for Failed Documents

The "Reprocess" functionality already exists in `ScopeDocumentBrowser.tsx`. Ensure the Documents tab shows failed documents prominently with reprocess buttons.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useScopeIntelligence.ts` | Fix storage path format (line 133) |
| `src/components/insurance/ScopeIntelligenceDashboard.tsx` | Include failed docs in "Needs Review" count OR add separate "Failed" counter |

---

## Already Completed

- ✅ Redeployed `scope-document-ingest` edge function
- ✅ Previously fixed edge function to handle timeouts and mark stuck docs as failed

---

## Testing Steps

After implementation:
1. Open Scope Intelligence page
2. Click "Bulk Upload" button
3. Select 1-2 PDF files
4. Verify upload progress shows correctly
5. Verify documents appear in the Documents tab
6. Verify status counts update on the dashboard

---

## Current Database State

| Status | Count |
|--------|-------|
| Complete | 1 |
| Failed | 2 |
| Total | 3 |

The 2 failed documents have error: "Processing timeout - please reprocess"
