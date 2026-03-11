

# Plan: Fix Missing `location_id` on Lead Creation

## Root Cause

The `LeadForm.tsx` creates pipeline entries **without setting `location_id`**. The pipeline view (`usePipelineData.ts` line 71-72) filters entries by `location_id` when a location is selected. Since the new entry has `location_id = NULL`, it's invisible when viewing "West Coast" or any specific location.

The "David Ramage" lead likely failed due to a different issue (possibly a unique constraint on contacts or a validation error that was caught but not surfaced properly), since it doesn't exist in the DB at all. But the core visibility bug remains: even leads that DO get created are missing their `location_id`.

## Fix

### 1. `src/features/contacts/components/LeadForm.tsx`

- Import `useLocation` from `@/contexts/LocationContext`
- Get `currentLocationId` from the context
- Pass `location_id: currentLocationId` in both the `contacts` insert (line 197) and the `pipeline_entries` insert (line 232)
- This ensures leads are assigned to the user's currently selected location

### 2. Improve Error Surfacing

- In the `catch` block (line 283), add the actual error message to the toast description so failures are never silent again:
  ```
  description: error?.message || "Please try again or contact support."
  ```

### 3. Fix Existing Orphaned Records

- Run a one-time SQL migration to assign `location_id` to any `pipeline_entries` rows where it's NULL, using the user's default location or the tenant's first location as a fallback.

---

Two file changes (`LeadForm.tsx`) plus one optional DB migration. The fix ensures every new lead inherits the active location context.

