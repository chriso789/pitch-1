

# Stamp 10 Florida County Adapters

## What We're Doing

Creating 10 new county config files using the existing `ArcGISCountyConfig` + `arcgisLookup` pattern (same as Hillsborough and Orange), then registering them all.

## Files to Create (10 county configs)

Each file follows the exact same pattern: import types + adapter, define config, export function.

| County | File | Service URL | Search Field |
|--------|------|-------------|--------------|
| Pinellas | `counties/pinellas.ts` | `gis.pcpao.org` | SITUSADDRESS |
| Pasco | `counties/pasco.ts` | `gis.pascopa.com` | SITUS_ADDRESS |
| Sarasota | `counties/sarasota.ts` | `gis.sc-pa.com` | SITUS_ADDRESS |
| Manatee | `counties/manatee.ts` | `gis.mymanatee.org` | SITUS_ADDRESS |
| Polk | `counties/polk.ts` | `gis.polkpa.org` | SITUS_ADDRESS |
| Brevard | `counties/brevard.ts` | `gis.bcpao.us` | SITUS_ADDRESS |
| Lee | `counties/lee.ts` | `gis.leepa.org` | SITUS_ADDRESS |
| Collier | `counties/collier.ts` | `gis.collierappraiser.com` | SITUS_ADDRESS |
| Broward | `counties/broward.ts` | `gis.bcpa.net` | SITUS_ADDRESS |
| Palm Beach | `counties/palm_beach.ts` | `gis.pbcgov.org` | SITUS_ADDRESS |

Each config specifies:
- `id`: source identifier (e.g. `fl_pinellas_arcgis`)
- `serviceUrl`: county ArcGIS MapServer/FeatureServer endpoint
- `searchField`: address field name for LIKE queries
- `outFields`: comma-separated fields to request (parcel, owner, homestead, sale data, assessed value where available)
- `fieldMap`: maps ArcGIS field names to our standard `CountyLookupResult` fields
- `transforms`: homestead boolean coercion, numeric validation for sale amounts/values

## File to Update

**`registry.ts`** -- Import all 10 new counties and add them to the `REGISTRY` map:

```
pinellas, pasco, sarasota, manatee, polk, brevard, lee, collier, broward, "palm beach"
```

The existing county name normalization (lowercase, strip " county") handles all keys. "palm beach" uses the space-separated key to match Census TIGER output.

## No Other Changes Needed

- `arcgis.ts` adapter: unchanged (already handles everything)
- `types.ts`: unchanged (all fields already defined)
- `publicLookupPipeline.ts`: unchanged (already calls `lookupFlCountyProperty` for FL counties)
- `storm-public-lookup` edge function: just needs redeployment to pick up new shared code

## Technical Notes

- The ArcGIS endpoint URLs are based on common FL county appraiser GIS patterns. If any endpoint returns errors on first test, the field names or URL paths may need minor adjustments (e.g., `/MapServer/0` vs `/FeatureServer/0`, or different layer indices). The adapter gracefully returns `confidence_score: 0` on errors, so Firecrawl fallback kicks in automatically.
- `outFields: "*"` can be used as a safe default if exact field names aren't confirmed, but specifying fields is more efficient.
- Each county file is ~25 lines. Total new code: ~250 lines across 10 files + ~15 lines of registry imports.

## Deployment

Redeploy `storm-public-lookup` to pick up the new county adapters from shared code.

## Result

After this, the system supports **12 FL counties** via direct ArcGIS APIs (Hillsborough, Orange + 10 new), covering Tampa Bay, Orlando corridor, Southwest FL, and Southeast FL. Remaining counties (Hernando, Seminole, Osceola, Lake, Indian River, St. Lucie, Martin, Miami-Dade, Charlotte, Monroe) can be stamped identically in a follow-up.
