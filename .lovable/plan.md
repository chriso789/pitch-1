

# Fix: Call Center Crash, Stagnant Filter, and Start Dialer Flow

## Issues Found

### 1. Runtime crash: `Smartphone is not defined`
The `Smartphone` icon IS imported from lucide-react on line 12. This is likely a lucide-react version issue — the `Smartphone` icon may not exist in the installed version (`0.462.0`). Need to replace with an available icon like `Phone` or use a different icon name.

### 2. Stagnant filter shows "No contacts match filters"
**This is working correctly.** The oldest non-deleted contact with a phone number was last updated Feb 19 (8 days ago). The 14+ day filter finds 0 results because no contacts are that stale yet. The **7+ day** filter should return results. No code fix needed — just a data timing issue.

### 3. "Start Dialer" button doesn't engage
The button only switches to the dialer tab (`setActiveTab('dialer')`) — it doesn't actually start dialing. The `CallCenterLiveDialer` shows "No List Selected" if no list was previously chosen from the Lists tab. The flow is broken because:
- There's no way to select a list from the Dialer tab header
- The button doesn't auto-select the most recent list
- Even with a list selected, clicking "Start Dialer" just shows the tab — it doesn't begin calling

## Plan

### Fix 1: Replace `Smartphone` icon
In `CallCenterPage.tsx`, replace `Smartphone` with `Phone` (or `PhoneCall`) which is already imported — eliminates the crash.

### Fix 2: Add list selector to header + auto-start
- Add a list selector dropdown next to the "Start Dialer" button that loads available lists from `dialer_lists`
- When "Start Dialer" is clicked with a list selected, switch to dialer tab — the `CallCenterLiveDialer` already handles calling when `selectedListId` is set
- If no list exists, prompt to build one

### Fix 3: Stagnant filter — use `created_at` instead of `updated_at`
The stagnant filter uses `updated_at` which gets refreshed by any system update. Switch to `created_at` for stagnant lead detection — a lead created 30+ days ago that hasn't converted is truly stagnant regardless of system touches to `updated_at`.

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/CallCenterPage.tsx` | Replace `Smartphone` with already-imported `Phone`, add list selector dropdown in header, wire Start Dialer to select+start |
| `src/components/call-center/CallCenterListBuilder.tsx` | Change stagnant filter from `updated_at` to `created_at` |

