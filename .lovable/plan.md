

# Fix: Include Documents-Table Photos in Estimate Job Photos

## Problem
Photos uploaded to this lead are stored in the `documents` table (with `document_type = 'photo'` and `mime_type LIKE 'image/%'`), but the estimate preview only queries the `customer_photos` table. The 4 photos for Angela Rollins exist in `documents` but are invisible to the estimate.

## Fix

### `src/components/estimates/EstimatePreviewPanel.tsx`
Expand the photo-fetching `useEffect` to also query the `documents` table as a secondary source:

1. After querying `customer_photos` (existing logic), if no photos found, query `documents` table filtered by:
   - `pipeline_entry_id = pipelineEntryId` 
   - `mime_type LIKE 'image/%'` OR `document_type` in `('photo', 'inspection_photo', 'job_photo', 'progress_photo', 'completion_photo')`
2. Map document records to the same shape (`id`, `file_url`, `description`, `category`) — resolve `file_url` from storage using `resolveStorageBucket` + `getPublicUrl` on `file_path`
3. Merge both sources: `customer_photos` results first, then `documents` table photos (deduplicated)

This ensures photos uploaded via SmartDocs or the Documents tab are available for the estimate without requiring users to re-upload to `customer_photos`.

| File | Change |
|------|--------|
| `src/components/estimates/EstimatePreviewPanel.tsx` | Add `documents` table query as fallback/supplement for job photos |

