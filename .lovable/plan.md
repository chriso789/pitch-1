

# Fix: Photos Not Showing After Upload + Edge Function Schema Mismatches

## Root Cause

The `PhotoControlCenter` uploads photos via the `photo-upload` edge function, but that edge function has **multiple column name mismatches** against the actual `customer_photos` database table, causing every insert to fail silently.

### Actual `customer_photos` columns vs what the edge function uses:

| Edge Function Uses | Actual Column | Issue |
|---|---|---|
| `file_path` | Does NOT exist | `file_name` is the correct column |
| `updated_at` (in update action) | Does NOT exist | `uploaded_at` exists but is set on creation |

The `file_path` bug causes both the `upload` and `bulk_upload` actions to fail -- the photo gets saved to storage but the database record is never created. So the gallery query returns nothing.

## Fix (2 files)

### 1. `supabase/functions/photo-upload/index.ts`

**Upload action (line 217):** Change `file_path: storagePath` to `file_name: storagePath`

**Bulk upload action (line 356):** Change `file_path: storagePath` to `file_name: storagePath`

**Update action (line 414):** Remove `updated_at` from the updates object (column doesn't exist). The update itself still works since category/description/include_in_estimate are valid columns.

### 2. `src/components/photos/PhotoControlCenter.tsx`

After upload completes via `usePhotos`, the react-query cache is already invalidated. But to ensure the gallery is visible immediately (no blank state while refetching), add optimistic display of uploaded photos:

- After `uploadPhoto` resolves successfully in `handleFileUpload`, the `queryClient.invalidateQueries` in `usePhotos` will trigger an automatic refetch. No additional changes needed here once the edge function bug is fixed -- the photos will appear.

However, to improve the mobile UX:
- Show a success toast with photo count after batch upload
- Auto-scroll to show the newly uploaded photos in the grid

## Result
- Photos uploaded from mobile (or desktop) will immediately appear in the gallery grid
- The "Upload" and "Take Photo" buttons will work end-to-end
- Photo updates (category, estimate inclusion) will also work correctly
- Both single and bulk upload paths are fixed

