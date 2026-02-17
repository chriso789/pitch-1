

# Disable Auto-Enrichment on Pin Open

## Current Behavior
When a property pin is opened (panel becomes visible), the `useEffect` on lines 226-255 automatically calls `handleEnrich()`, which invokes two edge functions (`storm-public-lookup` and `canvassiq-skip-trace`). This fires API calls (and incurs costs) before the user has even looked at the property.

## Change

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

Remove the entire auto-enrich `useEffect` block (lines 226-255). The `handleEnrich` function is already wired to the manual "Enrich" button in the UI, so users can still trigger enrichment on demand when they want owner/contact details.

Also remove the now-unused `hasAutoEnrichedRef` (line 73), since it only existed to prevent duplicate auto-enrichment calls.

## No Edge Function Changes Needed

All edge functions from recent updates (`canvassiq-load-parcels`, `storm-public-lookup` with ArcGIS suffix normalization) are already deployed and current. No additional deployments required.

## Result

- Opening a pin shows the property address and any cached data from the database
- Owner name, phones, and emails only load when the user clicks "Enrich" or "Get Contact Info"
- No unnecessary API calls or BatchData costs on casual browsing

