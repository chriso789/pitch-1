

# Cover Photo Selector for Estimate Cover Page

## What It Does
Adds a "Cover Photo" selector under the Cover Page toggle in the estimate preview controls. Users can pick from:
1. **Uploaded photos** — any photo from `customer_photos` or `documents` already discovered for the estimate
2. **Google Street View** — auto-generated from the property's lat/lng using Google Street View Static API
3. **Mapbox Aerial** — satellite imagery from `roof_measurements` or fetched on-demand via the existing `fetch-mapbox-imagery` edge function
4. **None** — no cover photo (current default)

If no uploaded photos exist, the selector defaults to Google Street View. The selected image URL is stored in `options.coverPagePropertyPhoto` which already flows through to the cover page component.

---

## Changes

### 1. `src/components/estimates/EstimatePreviewPanel.tsx`

**New state:**
- `coverPhotoSource`: `'none' | 'uploaded' | 'streetview' | 'aerial'` — tracks which source type is selected
- `selectedUploadedPhotoId`: which uploaded photo is chosen (if source is `'uploaded'`)
- `streetViewUrl`: cached Google Street View Static API URL
- `aerialUrl`: cached aerial/mapbox image URL

**New data fetching (alongside existing photo fetch):**
- Fetch `latitude, longitude` from the `contacts` table (via `contactId`) or from `roof_measurements`
- Generate Street View URL: `https://maps.googleapis.com/maps/api/streetview?size=800x400&location={lat},{lng}&key={apiKey}` (using the Google Maps key from `useGoogleMapsToken` hook)
- For aerial: reuse the `mapbox_image_url` or `google_maps_image_url` already fetched from `roof_measurements` in the existing aerial fallback effect

**Auto-default logic:**
- If uploaded photos exist → default to first uploaded photo
- If no uploaded photos but lat/lng available → default to `'streetview'`
- Otherwise → `'none'`

**New UI below the "Cover Page" toggle (when enabled):**
A compact "Cover Photo" sub-section with:
- A `<Select>` dropdown: "None", "Uploaded Photo", "Street View", "Aerial View"
- If "Uploaded Photo" selected: a horizontal scrollable row of small thumbnail buttons from `jobPhotos` to pick which one
- A small preview thumbnail of the selected image

**Wire `coverPagePropertyPhoto`:**
Update `options.coverPagePropertyPhoto` whenever the source/selection changes using the appropriate URL.

### 2. `src/components/estimates/EstimateCoverPage.tsx`

No structural changes needed — it already renders `propertyPhoto` when provided. Minor tweak: increase the photo height from `h-48` to `h-56` for better visual impact on the cover.

### 3. `src/hooks/useGoogleMapsToken.ts`

Already exists and returns the API key — will be imported into `EstimatePreviewPanel`.

### Files Modified
- `src/components/estimates/EstimatePreviewPanel.tsx` — main changes (state, data fetch, UI selector)
- `src/components/estimates/EstimateCoverPage.tsx` — minor photo height increase

