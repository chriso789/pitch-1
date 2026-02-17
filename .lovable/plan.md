

# Fix: Sarasota County ArcGIS URL is Dead + Sources Badges Misleading

## Root Cause

Two issues are causing "checks pass but no data saved":

### 1. Sarasota County ArcGIS DNS Failure (Backend)
The Sarasota adapter at `supabase/functions/_shared/public_data/sources/fl/counties/sarasota.ts` points to `gis.sc-pa.com` which is **no longer resolving** (DNS error in edge function logs). Every request fails with:
```
dns error: failed to lookup address information: Name or service not known
```

The correct, working endpoint is hosted on ArcGIS Online:
```
https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0
```

I verified this endpoint returns data for 4346 Marcott Cir: owner "WILSON ANITA", parcel "0067020049", assessed $294,900, year built 1993, 1,492 sqft.

The field names are also different from the old server:
| Old Field | New Field |
|-----------|-----------|
| PARCEL_ID | ACCOUNT |
| OWNER_NAME | NAME1 |
| SITUS_ADDRESS | FULLADDRESS |
| JUST_VALUE | JUST |
| (none) | YRBL (year built) |
| (none) | LIVING (sqft) |
| (none) | LSQFT (lot sqft) |

### 2. Source Badges Show False Positives (Frontend)
The pipeline `sources` object contains keys like `"appraiser": "skipped_fl_direct"` or `"tax": "universal_tax"` even when those sources returned zero data. The frontend filter `Object.keys(sources).filter(k => sources[k])` treats any truthy string as success, so it shows green checkmarks for sources that actually failed or returned nothing.

The badges should only show for sources that actually contributed data (i.e., confidence > 0 or owner found).

## Fix Plan

### Change 1: Update Sarasota adapter URL and field mapping

**File:** `supabase/functions/_shared/public_data/sources/fl/counties/sarasota.ts`

- Change `serviceUrl` from `https://gis.sc-pa.com/arcgis/rest/services/Parcels/MapServer/0` to `https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0`
- Change `searchField` from `SITUS_ADDRESS` to `FULLADDRESS`
- Update `outFields` to `ACCOUNT,NAME1,FULLADDRESS,HOMESTEAD,JUST,SALE_DATE,SALE_AMT,YRBL,LIVING,LSQFT`
- Update `fieldMap` to map the new field names:
  - `ACCOUNT` -> `parcel_id`
  - `NAME1` -> `owner_name`
  - `FULLADDRESS` -> `property_address`
  - `HOMESTEAD` -> `homestead`
  - `JUST` -> `assessed_value`
  - `SALE_DATE` -> `last_sale_date`
  - `SALE_AMT` -> `last_sale_amount`
  - `YRBL` -> `year_built`
  - `LIVING` -> `living_sqft`
  - `LSQFT` -> `lot_size`

### Change 2: Fix misleading source badges in frontend

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

Update the sources extraction (line 154) to only include sources that are NOT error/skip strings. Filter out values like `"skipped_fl_direct"`, `null`, `false`, and only include `true` or adapter IDs that start with `"fl_"` or similar known patterns. Additionally, only show the source badges row when confidence_score > 0.

### Change 3: Deploy edge function

After updating the Sarasota adapter, deploy `storm-public-lookup` so the fix takes effect immediately.

## Files to Update

| File | Change |
|------|--------|
| `supabase/functions/_shared/public_data/sources/fl/counties/sarasota.ts` | New ArcGIS Online URL + updated field names |
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | Fix source badge false positives |

## Expected Result

- Opening a pin in Sarasota County will auto-pull owner name, parcel ID, assessed value, year built, sqft from the working ArcGIS endpoint
- Source badges will only show green checkmarks for sources that actually returned data
- Confidence score will be 75+ (instead of 0) for Sarasota properties

