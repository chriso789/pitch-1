

# Fix: Show and Manage Uploaded Photos in Lead Details

## Problem
The Photos tab in Lead Details never displays the actual uploaded photos. Even though photos are fetched correctly from the `customer_photos` table, the gallery code (lines 1158-1196) renders a generic placeholder icon instead of the real images. There is also no way to edit, categorize, delete, or manage photos from this tab.

## Solution
Replace the broken photo viewer with the existing `PhotoControlCenter` component, which already provides a full-featured photo gallery with grid/list views, category filtering, editing, deletion, reordering, and estimate inclusion toggles.

## Changes

### `src/pages/LeadDetails.tsx`

**Replace the Photos TabsContent** (lines 1150-1197) with `PhotoControlCenter`:

```tsx
<TabsContent value="photos" className="mt-0 space-y-4">
  <PhotoControlCenter
    leadId={id!}
    showHeader={false}
    compactMode={true}
  />
</TabsContent>
```

This replaces both the `LeadPhotoUploader` and the broken image placeholder carousel with a single unified component that already handles:
- Photo uploading (with drag-and-drop)
- Grid and list view modes
- Category filtering (Before, During, After, Damage, etc.)
- Photo editing (description, category)
- Photo markup/annotation
- Bulk select and delete
- Drag-and-drop reordering
- "Include in Estimate" toggle per photo
- Primary photo selection

**Add the import** for `PhotoControlCenter` at the top of the file.

**Remove unused imports** that were only needed for the old photo viewer (the `ImageIcon`, `currentPhotoIndex` state, `showFullScreenPhoto` state, `ChevronLeft`/`ChevronRight` if not used elsewhere).

### Update photo count badge

The tab badge still uses `photos` from `useLeadDetails`. This will continue to work since `PhotoControlCenter` fetches its own data internally, and the badge count from `useLeadDetails` remains accurate for display purposes.

## Result
- All uploaded photos (including the 2 drone photos from mobile) will be visible in a grid
- Users can edit, categorize, annotate, and delete photos
- Users can mark photos for estimate inclusion directly from the gallery
- Upload functionality is preserved within the same component
