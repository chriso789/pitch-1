

# Fix: Job Photos Greyed Out — Wrong Storage Bucket Resolution

## Problem
Photos uploaded through the Documents tab are stored in the **`documents`** storage bucket (see `DocumentsTab.tsx` line 321: `.from('documents').upload(...)`). However, `resolveStorageBucket()` maps `document_type='photo'` to the `customer-photos` bucket. When the estimate preview tries to generate signed URLs, they fail silently because the files don't exist in `customer-photos`, resulting in all mapped photos being `null` and `jobPhotos` remaining empty — greying out the toggle.

## Fix

### `src/lib/documents/resolveStorageBucket.ts`

The function needs to be smarter about photos uploaded via the Documents tab vs the photo uploader. The key differentiator is the **file path pattern**:

- Documents tab uploads use paths like `{pipeline_entry_id}/filename.jpeg` (no `/leads/` segment)
- Photo uploader uploads use paths like `{tenant_id}/leads/{lead_id}/photos/filename.jpeg`

Update the photo branch to only route to `customer-photos` when the path contains `/leads/` (indicating it came from the photo uploader). Otherwise, default to `documents` bucket.

```
Current logic (lines 21-24):
  if (documentType === 'photo' || ...) return 'customer-photos';

Fixed logic:
  if (documentType === 'photo' || ...) {
    if (filePath?.includes('/leads/')) return 'customer-photos';
    return 'documents';
  }
```

| File | Change |
|------|--------|
| `src/lib/documents/resolveStorageBucket.ts` | Fix photo bucket resolution to check file path before assuming `customer-photos` |

