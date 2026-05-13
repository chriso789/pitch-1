## Goal

Allow AI Measurement to complete on addresses with no OSM building polygon (e.g. 4063 Fonsica Ave, North Port FL) by (a) confirming the proximity-merge filter in `dsm-analyzer.ts` is deployed and (b) adding a last-resort Solar fallback in `start-ai-measurement/index.ts`.

## Status check

- `supabase/functions/_shared/dsm-analyzer.ts` (lines ~867–878) **already contains** the proximity filter exactly as specified (`primaryRadius`, `mergeDistThreshold`, `toMerge`, `mergeIds`). No logic change needed — only a trivial touch to force redeploy of any edge function that bundles it.
- `supabase/functions/start-ai-measurement/index.ts` line **1169** has `const selected = validCandidates[0] || null;` — needs the two requested changes.

## Changes

### 1. `supabase/functions/_shared/dsm-analyzer.ts`
Touch the top-of-file header comment (bump date) so Supabase rebuilds and redeploys every edge function that imports it (notably `start-ai-measurement`). No code change.

### 2. `supabase/functions/start-ai-measurement/index.ts`
At line 1169:
- Change `const selected` → `let selected`.
- Immediately after, insert the last-resort fallback block:
  - Only triggers when `selected` is null AND no `osm_overpass` candidate has `rejected_reason === null`.
  - Picks Solar candidates rejected as `solar_bbox_not_roof_perimeter` or `solar_inner_geometry_not_roof_perimeter` whose `area_sqft` is within `[RESIDENTIAL_MIN_SQFT, RESIDENTIAL_MAX_SQFT]`.
  - Ranks `google_solar_segments_hull` > `google_solar_segments_union` > `google_solar_bbox`, tiebreak on `validity_score`.
  - Clears `rejected_reason` on the chosen candidate, assigns it to `selected`, and logs `[FOOTPRINT_FALLBACK] …` so it's traceable in edge logs.

No other call sites, gates, schemas, or downstream solver code change. Both files are bundled into the same edge function deploy.

## Verification

1. After deploy, re-run AI Measurement on **4063 Fonsica Ave, North Port FL 34286**.
2. Edge logs should show:
   - `[MASK_CONTOUR] … within merge threshold …` confirming the proximity filter is live.
   - `[FOOTPRINT_FALLBACK] … Promoting google_solar_segments_hull (~2,744 sqft) …`.
3. Measurement job should complete with planes/edges/area instead of `missing_valid_footprint`.
4. Spot-check one previously-passing OSM-backed address to confirm `hasValidOsm` short-circuits the fallback (no regression).
