

## Rebuild StormCanvass: Public Data Engine (No Regrid)

### Overview

Replace all Regrid dependencies in the StormCanvass system with a multi-source public data ingestion engine that cross-validates homeowner records from free government sources and assigns confidence scores.

### Current State

- `canvassiq-load-parcels` uses Google reverse geocoding to find addresses, then calls `fetchRegridOwner()` for owner data (currently failing with 401)
- `canvassiq-skip-trace` uses SearchBug for people search, falls back to random demo data when owner is "Unknown"
- `canvassiq-enrichment` uses Firecrawl to scrape county property appraiser sites (hardcoded to 3 FL counties only)
- `_shared/free-property-extractor.ts` already has Esri ArcGIS + OSM sources but is NOT wired into the canvass pipeline
- `_shared/regrid-footprint-extractor.ts` is used by the measurement pipeline (separate concern -- keep for now but make optional)

### Architecture

```text
Pin Drop / Polygon Select
        |
        v
[canvassiq-load-parcels]  -- Google reverse geocode (keeps working)
        |
        v  (remove fetchRegridOwner, replace with public lookup)
[storm-public-lookup]  -- NEW edge function
        |
        +-- Step 1: Nominatim reverse geocode (free backup)
        +-- Step 2: Census TIGER county FIPS detection
        +-- Step 3: Esri ArcGIS parcel query (owner, APN, sqft, year)
        +-- Step 4: OSM building metadata
        +-- Step 5: Firecrawl county appraiser scrape (validation layer)
        +-- Step 6: Confidence scoring engine
        |
        v
[storm_properties_public] table  -- results cached
        |
        v
[PropertyInfoPanel] -- displays verified data with confidence badge
```

### Changes

#### 1. Database Migration: `storm_properties_public` table

New table to store cross-validated public property records:

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| property_address | text | Normalized street address |
| county | text | Detected county name |
| county_fips | text | FIPS code from TIGER |
| state | text | State abbreviation |
| parcel_id | text | APN from assessor |
| owner_name | text | Cross-validated owner |
| owner_mailing_address | text | Mailing address if different |
| living_sqft | integer | Living area |
| year_built | integer | Construction year |
| lot_size | text | Lot dimensions/acreage |
| land_use | text | Residential/Commercial/etc |
| last_sale_date | date | Most recent transfer |
| last_sale_amount | numeric | Sale price |
| homestead | boolean | Homestead exemption flag |
| mortgage_lender | text | If recorded |
| assessed_value | numeric | Tax assessed value |
| confidence_score | integer | 0-100 composite score |
| source_appraiser | text | Appraiser source URL/name |
| source_tax | text | Tax collector source |
| source_clerk | text | Clerk of court source |
| source_esri | boolean | Whether Esri returned data |
| source_osm | boolean | Whether OSM returned data |
| lat | decimal | Property latitude |
| lng | decimal | Property longitude |
| tenant_id | uuid | Multi-tenant FK |
| canvassiq_property_id | uuid | Links to canvassiq_properties |
| created_at | timestamptz | Record creation |
| updated_at | timestamptz | Last update |

RLS: tenant isolation (same pattern as `canvassiq_properties`).

#### 2. New Edge Function: `storm-public-lookup`

**File:** `supabase/functions/storm-public-lookup/index.ts`

Accepts `{ lat, lng, address?, tenant_id, property_id? }` and runs the full pipeline:

**Step 1 -- Geo Resolution**
- Use Nominatim reverse geocode as free fallback (no API key needed)
- Extract normalized address, city, state, zip

**Step 2 -- County Detection**
- Use Census TIGER geocoder API (`https://geocoding.geo.census.gov/geocoder/geographies/coordinates`) to detect county FIPS and county name from lat/lng
- Free, no key required, covers all US

**Step 3 -- Esri ArcGIS Parcel Query** (already built in `free-property-extractor.ts`)
- Extract: owner name, APN, sqft, year built, lot size, land use, zoning
- +40 confidence points if owner found

**Step 4 -- OSM Building Metadata** (already built)
- Extract: building type, year, address validation
- +10 confidence points if data found

**Step 5 -- Firecrawl County Appraiser Scrape** (expand existing)
- Expand county URL map beyond 3 FL counties -- add dynamic county detection
- Search by address on county appraiser site
- Extract: owner name, mailing address, assessed value, homestead status, last sale
- Cross-validate owner name against Esri result
- +20 confidence if match, +15 if new data found, -10 if mismatch (flag LOW_CONFIDENCE)

**Step 6 -- Confidence Engine**

| Match Condition | Points |
|----------------|--------|
| Esri/ArcGIS owner found | +40 |
| Tax/appraiser owner matches | +20 |
| Clerk/deed record matches | +15 |
| Exact address validation | +15 |
| Homestead verified | +10 |

Max: 100. Below 60 = LOW_CONFIDENCE flag.

**Step 7 -- Persist & Return**
- Upsert into `storm_properties_public`
- Update `canvassiq_properties.owner_name` and `canvassiq_properties.property_data` with verified data
- Return structured JSON

#### 3. Rewrite `canvassiq-load-parcels`

**File:** `supabase/functions/canvassiq-load-parcels/index.ts`

- Remove `fetchRegridOwner()` function entirely (lines 573-627)
- Remove `regridApiKey` variable and all references
- After Google geocoding finds addresses, call `storm-public-lookup` for each property to get owner data (batch, parallel, 5 at a time)
- Store results directly with validated owner names

#### 4. Update `canvassiq-skip-trace`

**File:** `supabase/functions/canvassiq-skip-trace/index.ts`

- Before falling back to demo data, check `storm_properties_public` for verified owner name
- If owner is "Unknown", call `storm-public-lookup` to attempt resolution first
- Remove demo data generation for owner names (keep phone/email demo as separate concern)
- Only generate demo enrichment for phones/emails if SearchBug is unavailable

#### 5. Update `canvassiq-enrichment`

**File:** `supabase/functions/canvassiq-enrichment/index.ts`

- Expand county URL map from 3 hardcoded counties to dynamic detection
- Add more county property appraiser URLs (top 50 US counties by population)
- Add county auto-detection using the TIGER FIPS lookup

#### 6. Update Frontend: `PropertyInfoPanel.tsx`

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

- Add "Property Intelligence" section showing:
  - Owner name with confidence badge (green checkmark >= 80, yellow warning 60-79, red alert < 60)
  - Parcel ID, Sq Ft, Year Built, Homestead status
  - Last sale date and amount
  - Mortgage lender (if available)
  - Source verification checkmarks (Appraiser, Tax, Clerk, Esri, OSM)
- Replace current "Unknown Owner" display with confidence-aware rendering
- When LOW_CONFIDENCE: show yellow "Needs Verification" badge

#### 7. Cleanup Regrid References in Canvass Pipeline

- `canvassiq-load-parcels`: Remove all Regrid code
- `_shared/free-property-extractor.ts`: Remove premium/Regrid option (lines 344-382)
- Keep `_shared/regrid-footprint-extractor.ts` for measurement pipeline (separate system, not canvass) -- but make it gracefully degrade

#### 8. Storm Mode: Polygon Batch Processing

When a storm polygon is selected:
- Use OSM Overpass to find all buildings within polygon bounds
- Batch lookup via `storm-public-lookup` (5 concurrent)
- Cache results in `storm_properties_public`
- Display sortable canvass list: homestead first, highest confidence first, recent sales, absentee owner flag

### Files Modified

| File | Action |
|------|--------|
| `supabase/functions/storm-public-lookup/index.ts` | CREATE -- new public data pipeline function |
| `supabase/functions/canvassiq-load-parcels/index.ts` | REWRITE -- remove Regrid, wire in public lookup |
| `supabase/functions/canvassiq-skip-trace/index.ts` | UPDATE -- check public data before demo fallback |
| `supabase/functions/canvassiq-enrichment/index.ts` | UPDATE -- expand county support, remove Regrid refs |
| `supabase/functions/_shared/free-property-extractor.ts` | UPDATE -- remove premium/Regrid option |
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | UPDATE -- add Property Intelligence display with confidence |
| Database migration | CREATE `storm_properties_public` table with RLS |
| `supabase/config.toml` | ADD `storm-public-lookup` function entry |

### Data Sources (All Free)

| Source | Data Provided | Cost |
|--------|---------------|------|
| Google Geocoding | Address normalization, lat/lng | Already paying |
| Nominatim | Free backup geocoding | Free |
| Census TIGER | County FIPS detection | Free |
| Esri ArcGIS Living Atlas | Owner, APN, sqft, year built, lot size | Free |
| OpenStreetMap Overpass | Building type, metadata | Free |
| Firecrawl (county sites) | Owner validation, assessed value, homestead, sales | Existing key |

### What This Does NOT Change

- The measurement pipeline (`analyze-roof-aerial`, `regrid-footprint-extractor`) -- separate system, keeps Regrid as optional fallback for building footprints
- SearchBug for phone/email enrichment -- still used for skip-trace contact data
- Google Maps API for geocoding -- still the primary address resolution

