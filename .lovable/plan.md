## Goal

Fix `extractMaskContour` in `supabase/functions/_shared/dsm-analyzer.ts` so it stops merging Solar mask components from neighboring buildings into a single convex hull. Today (lines 846–878), every viable component is merged, which inflates the footprint at addresses like 4063 Fonsica Ave to ~75,825 sqft and trips the `area_too_large` gate.

## Change

In `extractMaskContour` (lines ~846–908):

1. Keep the existing geocode-target + viable filtering (lines 849–858) and the "nearest to geocode" primary pick (lines 861–866).
2. After picking `bestComp`, compute a distance threshold from the primary's effective radius:
   - `primaryRadius = Math.sqrt(bestComp.size / Math.PI)`
   - `mergeDistThreshold = Math.min(60, Math.max(20, primaryRadius * 2.5))`
3. Build `toMerge = viable.filter(c => c.id === bestComp.id || hypot(c.centroid - bestComp.centroid) <= mergeDistThreshold)`.
4. Replace `viableIds` with `mergeIds = new Set(toMerge.map(c => c.id))` when constructing `compMask`. Everything downstream (convex hull, fill, trace) stays the same.
5. Update the console log to:
   `[MASK_CONTOUR] Components: ${components.length} total, ${viable.length} viable, ${toMerge.length} within merge threshold (${mergeDistThreshold.toFixed(1)}px of primary). Merged ${toMerge.length} (${mergedPixelCount}px²) → convex hull → filled: ${filledPixelCount}px²`
6. Update `_lastContourDiagnostics`:
   - `merged_components: toMerge.length` (was `viable.length`)
   - add `merge_dist_threshold_px: Number(mergeDistThreshold.toFixed(1))`
   - add `excluded_components: viable.length - toMerge.length`

No other functions, gates, or callers change. Editing this edge function will trigger automatic redeployment.

## Expected outcome at 4063 Fonsica Ave

- `merged_components`: 6 → 1–2
- `excluded_components`: 4–5
- Contour area: ~75,825 sqft → ~2,000–4,000 sqft
- Footprint passes the `area_too_large` sanity gate; downstream solver runs.

## Verification

- After deploy, re-run the Fonsica Ave measurement and check edge function logs for the new `[MASK_CONTOUR]` line and `_lastContourDiagnostics` fields.
- Confirm a previously-passing single-building address still yields `excluded_components: 0` and unchanged contour area (no regression on clean tiles).
