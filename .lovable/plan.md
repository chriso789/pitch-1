

## StormCanvass: Modular Architecture + Queue Table + BatchLeads Fallback

### Overview

This implements three major changes:
1. Create the `storm_lookup_queue` table and add `normalized_address_key` + BatchLeads columns to `storm_properties_public`
2. Extract the monolithic `storm-public-lookup` (704 lines) into modular shared modules with the adapter pattern
3. Add BatchLeads as a controlled fallback (only when confidence < 70 or missing owner/mailing data)
4. Create `storm-polygon-batch` and `storm-polygon-worker` edge functions for polygon batching

### Database Migration

**New table: `storm_lookup_queue`**
- `id`, `tenant_id`, `storm_event_id`, `polygon_id`, `lat`, `lng`, `address`, `status` (queued/running/done/error), `result` (jsonb), `error`, `created_at`
- Unique index on `(tenant_id, storm_event_id, polygon_id, lat, lng)`
- RLS enabled with tenant isolation policy

**Alter `storm_properties_public`**
- Add `normalized_address_key text`
- Add unique constraint on `(tenant_id, normalized_address_key)`
- Add `used_batchleads boolean default false`
- Add `batchleads_payload jsonb`

### New Shared Modules (`_shared/public_data/`)

| File | Purpose |
|------|---------|
| `types.ts` | NormalizedLocation, CountyContext, PublicPropertyResult, AppraiserAdapter, TaxAdapter, ClerkAdapter interfaces |
| `normalize.ts` | Address key normalization (street abbreviations, lowercase, underscore) |
| `locationResolver.ts` | Nominatim reverse/forward geocode with abort timeout |
| `countyResolver.ts` | Census TIGER FIPS county detection |
| `merge.ts` | Priority-ordered merge (appraiser > tax > clerk > batchleads); never overwrites validated fields |
| `score.ts` | Confidence engine (0-100): +40 appraiser, +20 tax match, +15 clerk, +15 address, +10 homestead, +5 cross-source owner match; cap at 85 if only BatchLeads provided owner |
| `registry.ts` | Adapter registry with `pickAppraiser()`, `pickTax()`, `pickClerk()` |
| `publicLookupPipeline.ts` | Orchestrates adapters + BatchLeads fallback (if confidence < 70 or missing owner/mailing) |
| `geo.ts` | Polygon bbox, point-in-polygon, grid sampling |
| `overpass.ts` | Overpass API building/address discovery in polygon |

### County Adapter Pattern

Example adapters in `sources/fl/sarasota/`:
- `appraiser.ts` -- Firecrawl scrape of sc-pa.com
- `tax.ts` -- Tax collector validation stub
- `clerk.ts` -- Clerk of court stub

Each implements `supports(county)` for auto-selection. The existing 40+ county URL map from the monolith is preserved in the Sarasota appraiser as the reference pattern, with the Firecrawl scrape logic extracted from the current monolith.

### BatchLeads Fallback

**File:** `sources/batchleads/fallback.ts`

- Only called when `confidence_score < 70` OR `owner_name` is null OR `owner_mailing_address` is null
- Requires `BATCHLEADS_API_KEY` secret (user must add)
- Calls `https://api.batchleads.io/v1/property/lookup` with normalized address
- Returns partial result: owner_name, mailing_address, last_sale, mortgage_lender, parcel_id
- Never overwrites existing validated fields (parcel_id, homestead, sale amount)
- Confidence capped at 85 if only BatchLeads provided the owner data
- Rate limited: max 150 BatchLeads calls per storm event

### Rewritten `storm-public-lookup/index.ts`

Reduced from 704 lines to ~100 lines:
- Validates input
- Calls `resolveLocation()` -> `getCountyContext()` -> `lookupPropertyPublic()`
- Pipeline handles appraiser/tax/clerk/BatchLeads internally
- Upserts to `storm_properties_public` using `normalized_address_key`
- Updates `canvassiq_properties` if `property_id` provided

### New Edge Functions

**`storm-polygon-batch`**
- Accepts GeoJSON polygon + tenant/storm/polygon IDs
- Discovers candidate addresses via Overpass API (buildings with addr tags)
- Falls back to grid sampling within bbox
- Deduplicates by normalized key
- Inserts into `storm_lookup_queue`
- Processes first 50 inline (concurrency 6)

**`storm-polygon-worker`**
- Drains `storm_lookup_queue` for a given storm event
- Configurable concurrency (1-10) and batch size (1-500)
- Calls `storm-public-lookup` per queued item
- Updates queue status

### Config Updates

Add to `supabase/config.toml`:
```
[functions.storm-polygon-batch]
verify_jwt = false

[functions.storm-polygon-worker]
verify_jwt = false
```

### Files Created/Modified

| File | Action |
|------|--------|
| Database migration | CREATE `storm_lookup_queue`, ALTER `storm_properties_public` |
| `supabase/functions/_shared/public_data/types.ts` | CREATE |
| `supabase/functions/_shared/public_data/normalize.ts` | CREATE |
| `supabase/functions/_shared/public_data/locationResolver.ts` | CREATE |
| `supabase/functions/_shared/public_data/countyResolver.ts` | CREATE |
| `supabase/functions/_shared/public_data/merge.ts` | CREATE |
| `supabase/functions/_shared/public_data/score.ts` | CREATE |
| `supabase/functions/_shared/public_data/registry.ts` | CREATE |
| `supabase/functions/_shared/public_data/publicLookupPipeline.ts` | CREATE |
| `supabase/functions/_shared/public_data/geo.ts` | CREATE |
| `supabase/functions/_shared/public_data/overpass.ts` | CREATE |
| `supabase/functions/_shared/public_data/sources/fl/sarasota/appraiser.ts` | CREATE |
| `supabase/functions/_shared/public_data/sources/fl/sarasota/tax.ts` | CREATE |
| `supabase/functions/_shared/public_data/sources/fl/sarasota/clerk.ts` | CREATE |
| `supabase/functions/_shared/public_data/sources/batchleads/fallback.ts` | CREATE |
| `supabase/functions/storm-public-lookup/index.ts` | REWRITE |
| `supabase/functions/storm-polygon-batch/index.ts` | CREATE |
| `supabase/functions/storm-polygon-worker/index.ts` | CREATE |
| `supabase/config.toml` | ADD 2 entries |

### Secret Required

`BATCHLEADS_API_KEY` -- user will need to add this for the fallback to activate. Without it, the system still works using only free public sources.

### BatchLeads Cost Protection

- Max 150 calls per storm event tracked via counter
- Only triggered on low-confidence or missing critical fields
- Never overwrites validated public data
- Source transparency in UI (shows which sources contributed)

