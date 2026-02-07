
# Plan: Improve Estimate Attachment File Loading Reliability

## Investigation Summary

After extensive code review and database analysis, I found that:

1. **Code logic is correct** - The document picker correctly fetches files from the `documents` table, and the selected document's `file_path` is correctly passed through to the `AttachmentPagesRenderer` for download.

2. **Console logs confirm correct fetching**:
   - `OBC Workmanship Warranty.pdf` → `company-docs/1770439998989-OBC Workmanship Warranty.pdf`
   - Files are downloading successfully from the correct bucket (`smartdoc-assets`)

3. **Potential issues identified**:
   - State isn't reset when attachments change (could show stale pages briefly)
   - No abort controller for cancelled requests (could cause race conditions)
   - The preview might show "Lifetime Workmanship Warranty Certificate" which IS the warranty document

## Root Cause Analysis

| Possible Cause | Evidence |
|----------------|----------|
| Wrong file_path in database | ❌ Database shows correct mappings |
| Wrong bucket resolution | ❌ Console shows `smartdoc-assets` (correct) |
| Wrong file content in storage | ⚠️ Cannot verify directly, but possible |
| React state/cache issue | ⚠️ Possible - no state reset on attachment change |
| Browser cache | ⚠️ Possible - user might need hard refresh |

## Solution: Improve Attachment Loading Reliability

### Part 1: Reset State When Attachments Change

Ensure pages are cleared immediately when attachments change to prevent stale data:

**File**: `src/components/estimates/AttachmentPagesRenderer.tsx`

```typescript
useEffect(() => {
  // Reset state immediately when attachments change
  setPages([]);
  setErrors([]);
  setLoading(true);
  
  if (!attachments || attachments.length === 0) {
    setLoading(false);
    return;
  }
  
  // ... rest of loading logic
}, [attachments]);
```

### Part 2: Add Abort Controller for Race Conditions

Prevent race conditions when attachments change quickly:

```typescript
useEffect(() => {
  const abortController = new AbortController();
  
  setPages([]);
  setErrors([]);
  setLoading(true);
  
  // ... loading with abort check
  
  return () => {
    abortController.abort();
  };
}, [attachments]);
```

### Part 3: Add Unique Key for Attachment Identification

Add a stable key based on document_id for better debugging and rendering:

```typescript
// When building pages, include document_id
allPages.push({
  ...rendered,
  documentId: att.document_id, // Add this
  attachmentFilename: att.filename,
  pageNumber: pageNum,
  totalPages: pdf.numPages,
});
```

### Part 4: Enhanced Logging for Debugging

Add more detailed logging to help identify issues:

```typescript
console.log('[AttachmentPagesRenderer] Attachment data:', {
  document_id: att.document_id,
  filename: att.filename,
  file_path: att.file_path,
});
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/AttachmentPagesRenderer.tsx` | Reset state, add abort controller, improve logging |

## Verification Steps

After implementation:
1. Open an estimate with attachments
2. Check console logs show correct document IDs and file paths
3. Remove an attachment → verify it disappears immediately
4. Add a different attachment → verify correct content shows
5. Hard refresh the page and verify attachments load correctly

## Additional Recommendation

If the issue persists after these code changes, the problem is likely that the **actual PDF file in Supabase Storage** contains different content than expected. In that case:

1. Go to **Supabase Dashboard → Storage → smartdoc-assets**
2. Navigate to `company-docs/1770439998989-OBC Workmanship Warranty.pdf`
3. Download the file and verify its content matches what you expect
4. If wrong, re-upload the correct Workmanship Warranty PDF file
