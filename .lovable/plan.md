

# Fix Contact Profile Overflow, Show Estimate Saver Name, Fix Skip Trace Error

Three issues to address:

## 1. Contact Profile Pipeline Area Overflowing

The header section in `ContactProfile.tsx` has flex items (buttons, selects, contact info) that don't wrap properly on narrow viewports, causing horizontal overflow.

**File: `src/pages/ContactProfile.tsx`**

- **Line 252**: Add `overflow-hidden` to the container div
- **Lines 299-320**: The contact info bar already uses `flex-wrap` -- add `overflow-hidden` and `max-w-full` to the parent
- **Lines 322-376**: The action buttons row needs `flex-wrap` added so Skip Trace, Assign Rep, Edit, and Create Lead wrap on narrow screens instead of overflowing
- **Lines 382-450**: The pipeline cards grid needs `overflow-hidden` on each card to prevent long status text or job numbers from pushing content outside

## 2. Show Who Saved Each Estimate (Under Title)

The `SavedEstimatesList` component fetches from `enhanced_estimates` but doesn't include the `created_by` profile name. The `enhanced_estimates` table has a `created_by` column (UUID referencing profiles).

**File: `src/components/estimates/SavedEstimatesList.tsx`**

- **Query (~line 107-124)**: Add a join to fetch the creator's name:
  ```
  profiles!enhanced_estimates_created_by_fkey(first_name, last_name)
  ```
- **Interface (~line 31-43)**: Add `created_by_name?: string` to the `SavedEstimate` interface
- **Data mapping (~line 128-131)**: Map the joined profile to `created_by_name`:
  ```ts
  created_by_name: est.profiles ? `${est.profiles.first_name} ${est.profiles.last_name}` : undefined
  ```
- **Display (~line 416, after the status badge row)**: Add a subtle line:
  ```tsx
  {estimate.created_by_name && (
    <span className="text-xs text-muted-foreground">
      Created by {estimate.created_by_name}
    </span>
  )}
  ```

## 3. Skip Trace Error -- Missing `SEARCHBUG_CO_CODE` Secret

The edge function `skip-trace-lookup/index.ts` requires two secrets: `SEARCHBUG_API_KEY` (present) and `SEARCHBUG_CO_CODE` (missing). Without the CO_CODE, the function throws immediately with "SearchBug API credentials not configured".

**Action**: You need to provide your SearchBug account number (CO_CODE) so it can be added as a secret. The function code itself is correct -- it just needs the credential.

**Fallback improvement in `supabase/functions/skip-trace-lookup/index.ts`**: Instead of throwing a hard error when CO_CODE is missing, return a clearer user-facing message:
- Change the error message at line 61 from a generic throw to a 400 response with:
  ```
  "Skip trace is not configured. Please add your SearchBug CO_CODE in Settings > Integrations."
  ```
  This prevents the 500 error and "app encountered an error" crash overlay.

