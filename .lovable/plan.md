
# Fix Public Data Not Populating on Pin Details

## Root Cause

The edge function logs reveal the exact failure:

```
ERROR [storm-public-lookup] upsert error {
  code: "PGRST204",
  message: "Could not find the 'polygon_id' column of 'storm_properties_public' in the schema cache"
}
```

The `storm-public-lookup` edge function tries to write `polygon_id` and `storm_event_id` columns to `storm_properties_public`, but **those columns don't exist** in the table. The upsert fails silently, so:
- No public data is ever saved to the cache table
- The `canvassiq-skip-trace` function then finds nothing in `storm_properties_public`
- Owner stays "Unknown Owner" and no property data fills in

## Fix (Two Parts)

### Part 1: Add Missing Columns to `storm_properties_public`

Create a migration to add the two missing columns:

```sql
ALTER TABLE storm_properties_public
  ADD COLUMN IF NOT EXISTS storm_event_id TEXT,
  ADD COLUMN IF NOT EXISTS polygon_id TEXT;
```

This is the critical fix -- once these columns exist, the upsert will succeed and public data will be cached.

### Part 2: Update `storm-public-lookup` Edge Function

The function also needs a small fix: even when the upsert fails, the result should still be returned to the caller (the skip-trace function). Currently it continues past the error, but the `canvassiq_properties` update on line 118 uses `property_id` which may not be passed from the skip-trace call path.

Additionally, remove the `polygon_id` and `storm_event_id` from the upsert row when they're null/undefined to avoid issues, or keep them since the columns will now exist.

No edge function code changes needed -- just the migration.

### Part 3: Redeploy `storm-public-lookup`

Redeploy the function so it picks up the schema cache refresh after the migration runs.

## Files Changed

| File | Change |
|------|--------|
| New migration SQL | Add `storm_event_id` and `polygon_id` columns to `storm_properties_public` |

## Expected Result

After this fix:
1. Rep drops a pin or taps a property in live canvassing
2. Auto-enrich triggers `canvassiq-skip-trace`
3. Skip-trace calls `storm-public-lookup` which successfully resolves owner from county appraiser
4. Public data upserts correctly to `storm_properties_public`
5. Owner name, year built, assessed value, etc. populate in the pin detail panel
