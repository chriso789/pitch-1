

# Sync Missing Edge Functions to config.toml

## Problem

6 edge function directories exist in `supabase/functions/` but have no corresponding entry in `supabase/config.toml`. Without a config entry, these functions won't deploy correctly.

## Missing Functions

| Function | Recommended `verify_jwt` | Rationale |
|----------|--------------------------|-----------|
| `api-key-manager` | `true` | Admin tool -- requires auth |
| `automation-processor` | `false` | Background/system processor |
| `crew-schedule-optimizer` | `true` | Authenticated user action |
| `crew-timesheet-processor` | `true` | Authenticated user action |
| `noaa-storm-reports` | `false` | Public data fetch |
| `request-quote-signature` | `false` | Customer-facing signing link |

## Change

**File: `supabase/config.toml`**

Append 6 new `[functions.*]` entries at the end of the file with the appropriate `verify_jwt` settings listed above.

## Existing Functions

All other 319+ functions already have matching config entries and directory code. The `polish-inspection-notes` function (recently created) is properly configured with `verify_jwt = false` and has correct CORS headers.

No other changes needed.

