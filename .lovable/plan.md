

# Fix: Owner Data Not Updating in UI After Enrichment

## Root Cause

There are two issues preventing owner data from appearing after clicking "Enrich":

### Issue 1: React State Not Updating (Frontend Bug)
After `handleEnrich` succeeds and refetches updated data from `canvassiq_properties`, the code **directly mutates the `property` prop** (lines 238-241):
```typescript
property.phone_numbers = updatedProperty.phone_numbers;
property.emails = updatedProperty.emails;
property.owner_name = updatedProperty.owner_name;
```
This does NOT trigger a React re-render. The UI stays stuck showing "Unknown Owner" and "No owner data found" even when the database has been updated with real data.

### Issue 2: Appraiser Search Fails for Some Addresses (Backend)
The edge function logs show that for addresses like "4083 Fonsica Avenue", the Firecrawl appraiser search returns **no results**. Without an owner name, the people search (phones/emails) is completely skipped. The pipeline returns empty-handed.

## Solution

### 1. Use Local State for Property Data (Frontend Fix)
**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

- Add a `localProperty` state initialized from the `property` prop
- After enrichment refetch, update `localProperty` state (which triggers re-render)
- Derive `ownerName`, `phoneNumbers`, `emails`, `displayOwners`, etc. from `localProperty` instead of the raw prop
- Reset `localProperty` when `property.id` changes

### 2. Improve Appraiser Search Resilience (Backend Fix)
**File:** `supabase/functions/_shared/public_data/sources/universal/appraiser.ts`

- When the quoted exact-address search fails, retry with a looser query (without quotes around the address) to catch partial matches on county appraiser sites
- This fallback increases the chance of finding property records for less-indexed addresses

### 3. Allow People Search Without Owner Name (Backend Fix)
**File:** `supabase/functions/_shared/public_data/publicLookupPipeline.ts`

- When no owner name is found from appraiser/tax sources, attempt a people search using just the property address instead of skipping entirely
- This provides a path to get contact data even when the appraiser search fails

## Changes Summary

| What | File | Detail |
|------|------|--------|
| Local state for property data | `PropertyInfoPanel.tsx` | Replace prop mutation with `useState` + `useEffect` sync |
| Appraiser search retry | `appraiser.ts` | Add unquoted fallback query when exact match fails |
| Address-based people search | `publicLookupPipeline.ts` | Try people search by address when owner name is unavailable |
| Redeploy edge function | `storm-public-lookup` | Deploy updated pipeline |

