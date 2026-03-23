

## Plan: Fix Duplicate Map Pins + Patch Tenant ID Security Vulnerability

### Two Issues

**1. Duplicate pins on live canvass map (screenshot)**
The image shows doubled pins for addresses like 4102, 4052, 4103, 4063. The previous fix added `mountedRef` guards but didn't address the actual cause: markers accumulate across loads because `reconcileMarkers` only removes keys *not in the current load set* — it never removes keys that *are* in the set but already have a marker. When the same address appears with a slightly different normalized key (e.g. different whitespace or field order between loads), both the old and new marker survive.

Additionally, the `loadingRef.current` guard on line 403 silently skips loads, meaning a rapid sequence of `idle` events can leave partial marker sets rendered.

**2. Security: `get_user_tenant_id()` session override**
The function checks `current_setting('app.current_tenant_id', true)` first — any authenticated user can execute `SET app.current_tenant_id = '<victim_uuid>'` via a raw SQL connection and access all data across hundreds of RLS-protected tables.

---

### Fix 1: Eliminate Duplicate Markers

**File: `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx`**

- **Replace `loadingRef` skip with load-version-only concurrency control**: Remove the early `return` on line 403. Instead, let concurrent loads proceed but only the latest `loadVersionRef` writes markers. This prevents "skipped load leaves stale markers" scenarios.
- **Clear all markers before full reconciliation on each load**: Before calling `reconcileMarkers`, clear markers whose keys are NOT in the incoming set. The current code does this, but the issue is that `loadProperties` can exit early (line 403) leaving old markers. Removing that gate fixes it.
- **Normalize address keys more aggressively**: In `getNormalizedAddressKey`, strip ALL whitespace variations and ensure the same address always produces the exact same key regardless of field ordering in the JSON.

Changes:
- Remove lines 402-403 (`if (loadingRef.current) return; loadingRef.current = true;`)
- Replace with: allow concurrent entry but track with `thisLoadVersion` only
- Keep all existing staleness checks (`thisLoadVersion < loadVersionRef.current`)

### Fix 2: Remove Session Variable Override from `get_user_tenant_id()`

**Migration SQL:**

```sql
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid()),
    (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );
$$;
```

This removes the `current_setting('app.current_tenant_id', true)` line entirely. Tenant resolution now relies solely on the `profiles` table (which is protected by its own RLS and only writable via the `switch_active_tenant` RPC).

Also update `get_user_tenant_ids()` if it has the same pattern.

---

### Files to Change
1. `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` — remove `loadingRef` gate, let version-only concurrency control handle staleness
2. New migration SQL — rewrite `get_user_tenant_id()` without session variable override
3. New migration SQL — rewrite `get_user_tenant_ids()` if similarly affected

### Expected Result
- One pin per address on the live canvass map
- No cross-tenant data access via `SET app.current_tenant_id`

