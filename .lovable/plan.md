
# Fix Bulk Upload Storage Path for RLS Compliance

## Problem Identified

All bulk uploads are failing with **"new row violates row-level security policy"** on the Storage bucket.

**Root Cause:** The bulk uploader is using an incorrect storage path pattern:

```
Current:  insurance-scopes/{tenantId}/{timestamp}_{filename}.pdf
                 ^
                 First folder is "insurance-scopes" - RLS check fails!
```

The existing RLS policy for the `documents` bucket checks that the **first folder** matches the user's tenant_id:

```sql
-- Policy: Tenant users can upload to documents bucket
WITH CHECK (
  bucket_id = 'documents' AND 
  (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM profiles WHERE id = auth.uid()
  )
)
```

**Expected path pattern:** `{tenantId}/subfolder/filename.pdf`

---

## Solution

Change the storage path in `ScopeBulkUploader.tsx` to put the tenant_id **first**:

```typescript
// BEFORE (fails RLS):
const storagePath = `insurance-scopes/${tenantId}/${Date.now()}_${file.name}`;

// AFTER (passes RLS):
const storagePath = `${tenantId}/insurance-scopes/${Date.now()}_${file.name}`;
```

This is a one-line fix that aligns with how other tenant-scoped uploads work in the project.

---

## File to Modify

| File | Change |
|------|--------|
| `src/components/insurance/ScopeBulkUploader.tsx` | Fix storage path pattern (line 119) |

---

## Code Change

```typescript
// Line 119 in ScopeBulkUploader.tsx
// Change from:
const storagePath = `insurance-scopes/${tenantId}/${Date.now()}_${file.name}`;

// Change to:
const storagePath = `${tenantId}/insurance-scopes/${Date.now()}_${file.name}`;
```

---

## Why This Works

The RLS policy `Tenant users can upload to documents bucket` extracts the first folder from the path using `storage.foldername(name)[1]` and checks if it matches the user's tenant_id or active_tenant_id.

| Path Pattern | First Folder | RLS Result |
|-------------|--------------|------------|
| `insurance-scopes/abc123/file.pdf` | `insurance-scopes` | FAIL |
| `abc123/insurance-scopes/file.pdf` | `abc123` (tenant_id) | PASS |

---

## Expected Result

After this fix:
- Bulk uploads will succeed for authenticated users
- Files will be stored in `{tenantId}/insurance-scopes/` subfolder
- The `scope-document-ingest` edge function will process each file
- Documents will appear in the Scope Intelligence list after processing
