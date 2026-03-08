

# Fix: "Start Dialer" Button — Set Number + Activate Session

## Problem
The "Start Dialer" button currently only shows a toast and switches to the dialer tab. It doesn't prompt users to properly set their callback number via a dialog, save it to `app_settings`, or actually trigger the first call in the session.

## Solution

### 1. Add a "Set Your Number" dialog to `CallCenterPage.tsx`

When "Start Dialer" is clicked and no callback number is saved (or it's invalid), open a dialog that:
- Shows an input for the user's personal phone number
- Saves it to `app_settings` (reusing the same upsert pattern from `DialerSettings.tsx`)
- On save, closes the dialog and activates the dialer session

If a callback number is already set, skip the dialog and go straight to activation.

### 2. Add a `dialerActive` state flag

Currently the `CallCenterLiveDialer` is always rendered in the dialer tab. Add an `isSessionActive` boolean state so:
- Before "Start Dialer" is clicked: show an idle state ("Press Start Dialer to begin")
- After clicked (with valid callback + list): set `isSessionActive = true`, switch to dialer tab, and the `CallCenterLiveDialer` auto-calls the first contact

### 3. Auto-call first contact on session start

Add an `autoStart` prop to `CallCenterLiveDialer`. When `true`, the component automatically calls `handleCall()` on mount (for the first pending contact), so the rep's phone rings immediately after clicking "Start Dialer".

## Files Changed

| File | Change |
|---|---|
| `src/pages/CallCenterPage.tsx` | Add callback number dialog, `isSessionActive` state, save-and-start logic |
| `src/components/call-center/CallCenterLiveDialer.tsx` | Add `autoStart` prop that triggers `handleCall()` on first render |

