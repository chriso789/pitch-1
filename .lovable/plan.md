

## Plan: Fix AR Page — Wrong Column Name Crashes Query

### Root Cause
Line 76 of `AccountsReceivable.tsx` selects `address_line1` from the `contacts` table, but **that column does not exist** — the actual column is `address_street`. PostgREST rejects the entire query, so `projects` returns an error/empty array, no estimate IDs are collected, and all totals show $0.

This is why the Pipeline board shows totals correctly (it doesn't join contacts with that column) but AR shows nothing.

### Fix

**File: `src/pages/AccountsReceivable.tsx`** (line 76)

Change:
```
contacts(first_name, last_name, address_line1, address_city, address_state)
```
To:
```
contacts(first_name, last_name, address_street, address_city, address_state)
```

Also update line 212 where the address is assembled — change `contact.address_line1` to `contact.address_street`.

Single-file, two-line fix.

