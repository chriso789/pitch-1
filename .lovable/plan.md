

# Change "Master" Display Name to "COB"

## What Changes

Two files have the display name "Master" hardcoded for the `master` role. Both need to be updated to show "COB" instead.

| File | Line | Current | New |
|------|------|---------|-----|
| `src/lib/roleUtils.ts` | 16 | `master: 'Master'` | `master: 'COB'` |
| `src/components/settings/FeaturePermissions.tsx` | 36 | `{ key: 'master', name: 'Master', color: 'destructive' }` | `{ key: 'master', name: 'COB', color: 'destructive' }` |

## What Stays the Same

- The internal role key `'master'` is unchanged everywhere -- all permission checks, hierarchy logic, and database values stay as-is
- Only the **display label** shown in the UI changes from "Master" to "COB"
- The "Master" entry in `useLaborRates.ts` (labor skill level for tradesmen) is unrelated and will not be touched

