

# Why "Job Photos" is Greyed Out — and How to Fix

## What's Happening

The "Job Photos" toggle is **disabled because no photos exist** for this lead. The system checks the `customer_photos` table and aerial imagery fallback — both return empty. This is technically correct behavior, but the UX gives no guidance on how to fix it.

## Plan

### 1. Add upload capability directly from the Extra Pages panel
When no photos exist, show a small "Upload Photos" link/button next to the disabled Job Photos toggle. Clicking it opens the existing photo upload flow (same one used in Photo Documentation).

### 2. Enable the toggle after upload
After photos are uploaded, re-fetch and enable the toggle automatically.

### Changes

| File | Change |
|------|--------|
| `src/components/estimates/PageOrderManager.tsx` | Add an `onUploadPhotos` callback prop. When `job_photos` is disabled due to no photos, render a small "Add Photos" button next to the toggle |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Wire `onUploadPhotos` to open a photo upload dialog. After upload completes, re-fetch photos so `hasPhotos` becomes true and the toggle activates |

### UX Detail
- The disabled toggle row for "Job Photos" will show helper text: *"No photos — "* with a clickable **"Add"** link
- Clicking "Add" opens a file picker (multi-select) that uploads to `customer_photos` for the current lead
- After successful upload, photos are re-fetched and the toggle auto-enables

