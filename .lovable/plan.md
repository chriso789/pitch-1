

## Plan: Fix Status Display Truncation + Debug Search

### Issue 1: Status Shows "In..." Instead of "In Production"

**Root Cause**: In `LeadDetails.tsx` line 789, the status `<Select>` is inside a flex row with the lead name (large h1 text) and Edit button. The flex container squeezes the Select, truncating "In Production" to "In...".

**Fix**: Add `shrink-0` to the `<Select>` wrapper or to the `<SelectTrigger>` so it doesn't get compressed by the large name text. Also add `whitespace-nowrap` to the status text span.

**File**: `src/pages/LeadDetails.tsx` — line 806, add `shrink-0` to SelectTrigger classes.

---

### Issue 2: Search Still Not Finding "Mariotti"

**Root Cause**: The `shouldFilter={false}` fix was applied, and the RPC works when called directly (returns both contact and job for "mariotti"). The RPC is `SECURITY DEFINER` so RLS isn't an issue. The problem is likely one of:
- The profile query (line 92-96) returning null `tenant_id` for the logged-in user
- The `supabase.auth.getUser()` returning null (unauthenticated)
- The code silently returning on lines 89 or 98 with no error indication

The code has silent failures — `if (!user) return` and `if (!profile?.tenant_id) return` both exit without any feedback, leaving "No results found" displayed.

**Fix**:
1. Add `console.log` diagnostics to trace the search flow (user, tenant_id, RPC response)
2. Remove the per-search profile lookup — cache tenant_id from the auth context instead of querying `profiles` table on every keystroke
3. Show a meaningful message when auth/profile is missing instead of silently returning empty results

**File**: `src/components/CLJSearchBar.tsx` — use `useAuth()` context (already available in the app) to get tenant_id directly instead of querying profiles each time. Add console.warn for diagnostic.

---

### Files to Change

1. **`src/pages/LeadDetails.tsx`** — Add `shrink-0` to the status SelectTrigger to prevent truncation
2. **`src/components/CLJSearchBar.tsx`** — Replace per-search profile query with auth context; add diagnostic logging for failed searches

