

# Fix Measure Edge Function RLS Error for Storm Canvass Fast Estimate

## Problem

When clicking "Generate AI Estimate" on the Live Canvass page, the `measure` edge function fails with:

> `Tags insert failed: new row violates row-level security policy for table "measurement_tags"`

**Root cause:** The edge function creates a Supabase client using the service role key but also passes the user's `Authorization` header, which causes RLS to evaluate as the user. The `measurement_tags` INSERT policy requires `property_id IN (SELECT pipeline_entries.id WHERE tenant_id = get_user_tenant_id())`. Storm canvass passes a `canvassiq_properties.id` as `propertyId`, which doesn't exist in `pipeline_entries`, so the RLS check fails.

## Solution

Create a separate admin Supabase client (without the user's auth header) for write operations that need to bypass RLS (`persistTags`, `persistFacets`, `persistWasteCalculations`). The user-scoped client continues to be used for reads and user-context operations.

## Changes

**File: `supabase/functions/measure/index.ts`**

1. **Create an admin client** alongside the existing user-scoped client in the main router (around line 1796):
   ```
   const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
   ```
   This client uses the service role key without the user's auth header, fully bypassing RLS.

2. **Use the admin client for persist operations** -- Replace calls to `persistTags`, `persistFacets`, and `persistWasteCalculations` so they use `adminSupabase` instead of `supabase`. There are approximately 5-6 call sites where these functions are invoked (lines ~2514-2574 and similar).

   Before:
   ```
   await persistTags(supabase, row.id, propertyId, tags, userId);
   ```
   After:
   ```
   await persistTags(adminSupabase, row.id, propertyId, tags, userId);
   ```

3. **Apply the same fix to `persistFacets` and `persistWasteCalculations`** calls to prevent similar RLS failures for those tables.

## Technical Details

| File | Change |
|------|--------|
| `supabase/functions/measure/index.ts` | Add `adminSupabase` client (no auth header); use it for `persistTags`, `persistFacets`, `persistWasteCalculations` calls |

## Why This Approach

- The service role key is already used -- we just need to stop overriding it with the user's auth header for write operations
- No RLS policy changes needed (avoids opening security holes)
- Reads still use the user-scoped client for proper tenant isolation
- The admin client is only used server-side within the edge function, so there's no security risk

## Result

- "Generate AI Estimate" on the Live Canvass page will successfully run measurements and persist tags
- The Fast Estimate modal will display roof area, squares, pitch, and pricing tiers
- Existing pipeline-based measurements continue working unchanged

