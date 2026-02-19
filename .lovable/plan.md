
# Fix: Photo Upload Fails - "Could not find 'file_path' column"

## Root Cause
The error message says it all: **"Could not find the 'file_path' column of 'customer_photos' in the schema cache"**

In `src/components/photos/LeadPhotoUploader.tsx` (line 222), the insert payload uses `file_path`:
```typescript
file_path: fileName,  // WRONG - column doesn't exist
```

But the actual `customer_photos` table schema has **`file_name`**, not `file_path`. The column names in the database are:
- `file_name` (exists)
- `file_url` (exists)
- `file_path` (does NOT exist)

## Fix

### `src/components/photos/LeadPhotoUploader.tsx` (line 222)

Change `file_path` to `file_name` in the insert payload:

```typescript
// Before
file_path: fileName,

// After
file_name: fileName,
```

This is a one-line fix. No other files or database changes needed -- the storage upload succeeds (photos reach the bucket), but the database record insert fails because of the wrong column name. Once corrected, the DB insert will succeed and photos will save properly.
