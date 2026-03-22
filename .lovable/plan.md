

# Fix: Wrong Owner Data + Missing Contact Info on Pin Drops

## Problem 1: Wrong Owner (Neighbor's Data)

**Root cause**: The ArcGIS adapter in `arcgis.ts` (line 33) uses a fuzzy LIKE query:
```
FULLADDRESS LIKE '%4063 FONSICA AVE%'
```

This returns up to 3 results and **blindly picks `features[0]`** (line 66) without verifying it matches the actual address. If the ArcGIS index returns "4061 FONSICA AVE" first, you get the neighbor's owner name.

Additionally, the address fed into ArcGIS comes from **Nominatim reverse geocoding** of the pin's lat/lng coordinates. If the pin is placed slightly off-center (closer to a property boundary), Nominatim may resolve to the wrong house number entirely.

**Fix**: Add best-match scoring in the ArcGIS adapter to compare each returned feature's address against the input address and pick the closest match instead of blindly using `features[0]`.

### Changes to `supabase/functions/_shared/public_data/sources/fl/adapters/arcgis.ts`:
- After receiving features, score each one by comparing the house number and street from the returned `FULLADDRESS` against the input address
- Pick the feature with the highest match score (exact house number match preferred)
- If no feature matches the house number, log a warning and return the closest match with a lower confidence score

## Problem 2: No Contact Information (Phones/Emails)

**Root cause**: The public lookup pipeline (`storm-public-lookup`) only returns public record data (owner name, parcel, year built). **Contact info (phones, emails) requires the paid skip-trace step** (`canvassiq-skip-trace` via BatchData), which is a separate manual button press.

Currently the panel shows owner name and property details, but phones/emails only appear after the user clicks the "Skip Trace" button. The UI doesn't make this obvious enough.

**Fix**: Make the contact section more visible with a clear CTA to run skip-trace, and auto-display any cached contact data from previous skip-traces.

### Changes to `src/components/storm-canvass/PropertyInfoPanel.tsx`:
- Add a prominent "Get Contact Info" button in the main property view (not buried in tabs) when no phone/email data exists
- Show a brief explanation: "Phone & email require skip-trace lookup"
- If contact data was previously cached (in `searchbug_data`), display it immediately without requiring another skip-trace

## Summary

| File | Change |
|------|--------|
| `sources/fl/adapters/arcgis.ts` | Add house-number matching to pick correct parcel from ArcGIS results |
| `PropertyInfoPanel.tsx` | Surface contact info section + skip-trace CTA more prominently |
| Redeploy `storm-public-lookup` | So the ArcGIS fix takes effect |

