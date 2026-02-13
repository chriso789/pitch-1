

## Production Hardening: Caching, Retry, Cost Analytics, Intel Scoring, and Route Optimization

### Overview

This adds 5 production-grade layers on top of the existing public data engine:
1. Retry utility with exponential backoff
2. BatchLeads cost analytics tracking (batchleads_usage table)
3. Smart fallback rules (absentee-only, homestead skip, per-storm cap)
4. Storm Intelligence scoring (damage, equity, claim likelihood, priority)
5. Canvass route optimization (cluster + nearest neighbor + 2-opt)

### Important Note: BATCHLEADS_API_KEY

The `BATCHLEADS_API_KEY` secret does **not** appear in the current project secrets list. It will need to be added before the BatchLeads fallback can activate. The system will still work without it -- it just skips the fallback gracefully.

### Database Migrations (4 new tables)

**Table 1: `batchleads_usage`** -- tracks every BatchLeads API call for cost visibility

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid | Tenant reference |
| storm_event_id | text | Storm event reference |
| polygon_id | text | Polygon reference |
| normalized_address_key | text | Property key |
| cost | numeric | Per-lookup cost (default 0.15) |
| created_at | timestamptz | Timestamp |

**Table 2: `storm_events`** -- storm metadata for intel scoring

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | e.g. "2026-03-Helene" |
| tenant_id | uuid | Tenant reference |
| name | text | Display name |
| start_at / end_at | timestamptz | Storm window |
| hazard_type | text | hail/wind/tornado/hurricane |
| max_wind_mph | int | Peak wind speed |
| hail_max_in | numeric | Max hail size |
| hail_prob / wind_prob | numeric | Probability 0-1 |
| polygon_geojson | jsonb | Storm polygon |

**Table 3: `storm_property_intel`** -- per-property intelligence scores

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid | Tenant reference |
| storm_event_id | text | FK to storm_events |
| property_id | uuid | Optional FK to storm_properties_public |
| normalized_address_key | text | Property key |
| property_snapshot | jsonb | Frozen property data |
| damage_score | int | 0-100 |
| equity_score | int | 0-100 |
| claim_likelihood_score | int | 0-100 |
| damage_factors / equity_factors / claim_factors | jsonb | Explainability |
| priority_score | int | 0-100 weighted blend |

Unique on `(tenant_id, storm_event_id, normalized_address_key)`.

**Table 4: `canvass_routes`** -- optimized door-knock routes

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid | Tenant reference |
| storm_event_id | text | Storm event |
| user_id | uuid | Assigned rep |
| name | text | Route name |
| start_lat / start_lng | double precision | Start point |
| planned_stops | jsonb | Ordered stop list |
| metrics | jsonb | Distance/time stats |

All tables get RLS policies for tenant isolation.

### New Shared Modules

**`_shared/utils/retry.ts`** -- Generic exponential backoff utility
- Configurable retries, base delay, factor
- Used by BatchLeads fallback, Overpass, county scrapers

**`_shared/intel/damage.ts`** -- Predictive storm damage scoring
- Inputs: storm hail/wind intensity, roof age proxy (year_built)
- Hail: up to 45pts (1 inch = ~18pts), Wind: up to 35pts, Age: up to 20pts

**`_shared/intel/equity.ts`** -- Equity estimation model
- Estimated value: living_sqft x configurable $/sqft (default $220)
- Mortgage proxy: last_sale_amount x LTV band based on years since purchase
- Score: equity percentage mapped to 0-100

**`_shared/intel/claim.ts`** -- Claim likelihood scoring
- 55% weight on damage score, 20% weight on equity
- +10 for absentee owners, homestead adjustments
- Identifies properties most likely to engage

**`_shared/intel/priority.ts`** -- Single sortable priority
- Weighted blend: 55% claim + 30% damage + 15% equity

**`_shared/routing/haversine.ts`** -- Distance calculation

**`_shared/routing/routePlanner.ts`** -- Route optimization
- Grid clustering (~1km cells) to prevent zig-zag
- Nearest neighbor within clusters (priority-weighted)
- 2-opt improvement passes (up to 80 iterations)
- No paid routing API needed

### Pipeline Updates

**`publicLookupPipeline.ts`** -- Add smart fallback rules:
- Only trigger BatchLeads for absentee owners (mailing != property address)
- Skip if homestead=true AND confidence >= 60
- Skip if land_use is not residential
- Log every BatchLeads call to `batchleads_usage` table
- Per-storm cap of 150 BatchLeads calls

**`sources/batchleads/fallback.ts`** -- Add retry wrapper:
- 3 retries with 500ms base delay, exponential backoff

**`overpass.ts`** -- Add retry wrapper:
- 2 retries with 700ms base delay

### New Edge Functions

**`storm-intel-score`** -- Score a single property
- Fetches storm event + property data
- Runs damage, equity, claim models
- Computes priority score
- Upserts to `storm_property_intel`

**`storm-intel-batch-score`** -- Batch score all properties for a storm
- Pulls properties from `storm_properties_public` for a storm event
- Invokes `storm-intel-score` per property with controlled concurrency

**`canvass-route-plan`** -- Build optimized canvass route
- Selects top N properties by priority_score (default 80, min priority 60)
- Runs cluster + nearest neighbor + 2-opt
- Saves route to `canvass_routes`
- Returns ordered stops with distance metrics

### Caching Strategy

The existing `storm_properties_public` table already serves as the cache layer (the current `storm-public-lookup` checks it with a 30-day TTL and confidence >= 40 threshold). No separate cache table is needed -- the current implementation is sufficient. BatchLeads-enriched records use a shorter effective TTL (7 days) by checking the `used_batchleads` flag during freshness evaluation.

### Config Updates

Add to `supabase/config.toml`:
```
[functions.storm-intel-score]
verify_jwt = false

[functions.storm-intel-batch-score]
verify_jwt = false

[functions.canvass-route-plan]
verify_jwt = false
```

### Files Created/Modified

| File | Action |
|------|--------|
| Database migration | CREATE `batchleads_usage`, `storm_events`, `storm_property_intel`, `canvass_routes` with RLS |
| `supabase/functions/_shared/utils/retry.ts` | CREATE |
| `supabase/functions/_shared/intel/damage.ts` | CREATE |
| `supabase/functions/_shared/intel/equity.ts` | CREATE |
| `supabase/functions/_shared/intel/claim.ts` | CREATE |
| `supabase/functions/_shared/intel/priority.ts` | CREATE |
| `supabase/functions/_shared/routing/haversine.ts` | CREATE |
| `supabase/functions/_shared/routing/routePlanner.ts` | CREATE |
| `supabase/functions/storm-intel-score/index.ts` | CREATE |
| `supabase/functions/storm-intel-batch-score/index.ts` | CREATE |
| `supabase/functions/canvass-route-plan/index.ts` | CREATE |
| `supabase/functions/_shared/public_data/publicLookupPipeline.ts` | UPDATE -- smart fallback rules + BatchLeads usage logging |
| `supabase/functions/_shared/public_data/sources/batchleads/fallback.ts` | UPDATE -- add retry wrapper |
| `supabase/functions/storm-public-lookup/index.ts` | UPDATE -- differentiated cache TTL for BatchLeads records |
| `supabase/config.toml` | ADD 3 function entries |

### Cost Control Summary

| Control | Implementation |
|---------|---------------|
| Absentee-only fallback | Only trigger BatchLeads when mailing address differs from property address |
| Homestead skip | Skip fallback if homestead=true AND confidence >= 60 |
| Non-residential skip | Skip fallback if land_use is not residential |
| Per-storm cap | Max 150 BatchLeads calls per storm_event_id |
| Usage tracking | Every call logged to `batchleads_usage` with $0.15 cost |
| Retry backoff | 3 attempts with exponential delays (500ms, 1s, 2s) |

