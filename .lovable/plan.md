

# Enable Job Photos Toggle with Aerial Fallback

## Problem
The "Job Photos" toggle is greyed out when there are no customer photos uploaded. The user wants it to automatically pull an aerial/satellite image of the property when no job photos exist.

## Solution

When `jobPhotos.length === 0`, fetch the aerial image from `roof_measurements` (which stores `google_maps_image_url` and `mapbox_image_url` from the measurement pipeline) using the `contactId` or `pipelineEntryId`. If an aerial exists, enable the toggle and render the aerial as a single "photo" on the Job Photos page.

## Changes

### 1. Fetch aerial image as fallback (`src/components/estimates/EstimatePreviewPanel.tsx`)

After the existing `fetchPhotos` effect (lines 178-190), add a second effect:
- If `jobPhotos.length === 0` and we have a `contactId` or `pipelineEntryId`, query `roof_measurements` for the latest record matching the contact
- Look up `customer_id` via `pipeline_entries → contacts` to get the contact UUID, then query `roof_measurements` where `customer_id = contactId`
- Pull `google_maps_image_url` or `mapbox_image_url` (prefer google, fallback to mapbox)
- If found, set `jobPhotos` to a single synthetic entry: `[{ id: 'aerial', file_url: aerialUrl, description: 'Aerial View', category: 'aerial' }]`

This automatically enables the toggle since `jobPhotos.length > 0`.

### 2. Remove disabled state when aerial is available (same file, line 721)

No code change needed — the existing `disabled={jobPhotos.length === 0}` will naturally become false once the aerial fallback populates the array.

### 3. Update PDF template label (`src/components/estimates/EstimatePDFDocument.tsx`)

In the `PhotosPage` component, if the only photo has `category === 'aerial'`, label the page as "Aerial View" instead of "Job Photos" for clarity.

## Files Changed

| File | Change |
|------|--------|
| `src/components/estimates/EstimatePreviewPanel.tsx` | Add aerial image fallback fetch when no job photos exist |
| `src/components/estimates/EstimatePDFDocument.tsx` | Label aerial photos appropriately on the photos page |

