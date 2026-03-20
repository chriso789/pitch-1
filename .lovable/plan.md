

# Fix Estimate Page Margins & Add Street View/Aerial Cover Photo Options

## Issues Found

**1. Margin inconsistency across pages**
The `PageFooter` component uses `px-3` (12px padding) while the `PageHeader` uses `px-6` (24px) and content area uses `px-6` (24px). This makes the footer appear to extend wider than the rest of the page content, creating inconsistent margins visually.

**2. Street View & Aerial options missing from dropdown**
The dropdown only shows these options when `streetViewUrl` and `aerialUrl` are populated. Both require coordinates (`latitude`/`longitude`). This contact has an address ("6126 Nw 77Th Terrace, Parkland, FL 33067 US") but no geocoded coordinates, and no `roof_measurements` record. Without coordinates, the Street View URL cannot be generated and the aerial image cannot be fetched.

---

## Changes

### File: `src/components/estimates/EstimatePDFDocument.tsx`

**Fix footer padding**: Change `PageFooter` from `px-3` to `px-6` to match the header and content areas, ensuring consistent margins across all page elements.

### File: `src/components/estimates/EstimatePreviewPanel.tsx`

**Geocode from address when coordinates are missing**: In the coordinate-fetching `useEffect`, add a fallback step. When neither `contacts.latitude/longitude` nor `roof_measurements.gps_coordinates` yield results, use the Google Geocoding API to convert the customer's address string into coordinates.

```typescript
// After existing coord checks fail, geocode the address
if (googleMapsApiKey && customerAddress) {
  const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(customerAddress)}&key=${googleMapsApiKey}`;
  const resp = await fetch(geocodeUrl);
  const geo = await resp.json();
  if (geo.results?.[0]?.geometry?.location) {
    const { lat, lng } = geo.results[0].geometry.location;
    setPropertyCoords({ lat, lng });
  }
}
```

**Always show Street View and Aerial as options**: Instead of conditionally rendering the `SelectItem` entries only when URLs are already loaded, always show them (they'll be populated once coords are fetched). Add a loading state or small spinner if coordinates are still being resolved.

### Files Modified
- `src/components/estimates/EstimatePDFDocument.tsx` — footer padding fix (one class change)
- `src/components/estimates/EstimatePreviewPanel.tsx` — geocoding fallback + always-visible dropdown options

