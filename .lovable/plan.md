
# Fix: Literal "null" Displaying as Owner Name

## Problem

The word "null" is showing as the owner name in both the header and the owner list. This happens because `localProperty.owner_name` contains the literal string `"null"` (from the database or pipeline), and JavaScript treats it as truthy -- so the fallback to "Unknown Owner" never triggers.

## Fix

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

Add a small helper function that treats junk owner values as falsy:

```typescript
function validOwner(name: any): string | null {
  if (!name) return null;
  const s = String(name).trim().toLowerCase();
  if (!s || s === 'null' || s === 'undefined' || s === 'unknown' || s === 'unknown owner') return null;
  return String(name).trim();
}
```

Then apply it everywhere owner_name is read:

| Line | Current | Fixed |
|------|---------|-------|
| 292 | `localProperty.owner_name \|\| homeowner?.name \|\| 'Primary Owner'` | `validOwner(localProperty.owner_name) \|\| validOwner(homeowner?.name) \|\| 'Primary Owner'` |
| 300 | `localProperty.owner_name \|\| homeowner?.name \|\| 'Unknown Owner'` | `validOwner(localProperty.owner_name) \|\| validOwner(homeowner?.name) \|\| 'Unknown Owner'` |

Also sanitize incoming pipeline data in `handleEnrich` so `"null"` strings never get stored:

- Line ~112: gate `setEnrichedOwners` with `validOwner(pipelineResult.owner_name)`
- Line ~127: gate `owner_name` in `setLocalProperty` with `validOwner(pipelineResult?.owner_name) || prev.owner_name`

**File:** `supabase/functions/storm-public-lookup/index.ts`

Sanitize at the server level too -- before writing to `canvassiq_properties`, strip "null"/"Unknown Owner" strings:

```typescript
const cleanOwner = (v: any) => {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return (s === 'null' || s === 'unknown' || s === 'unknown owner') ? null : String(v).trim();
};

if (cleanOwner(result.owner_name)) updatePayload.owner_name = cleanOwner(result.owner_name);
```

This ensures "null" is never stored in the DB or displayed in the UI.
