

# Call Center: "Start Dialer" Button + Caller ID / Location Number Settings

## Problem

1. **No "Start Dialer" button** — The Dialer tab shows a list selection but no prominent action to begin dialing
2. **Caller ID selection not tied to locations** — Currently reads from `app_settings` / `localStorage` with a manual phone number input, ignoring the Telnyx numbers already provisioned on locations
3. **East Coast number vs porting number are separate** — Users need to see which location number they're calling through, select it on the Call Center page, and also manage it in Settings

## Changes

### 1. Add "Start Dialer" button to Call Center Dialer tab

In `CallCenterPage.tsx`, add a prominent "Start Dialer" button next to "Build List" in the header. When clicked (and a list is selected), it sets the `selectedListId` and switches to the dialer tab. If no list is selected, prompt to pick one first.

Also add a **caller ID selector** dropdown in the Dialer tab header area that loads location phone numbers from the `locations` table (where `telnyx_phone_number IS NOT NULL`). This shows location name + number (e.g., "East Coast — (239) 919-4485") with a porting badge if applicable.

### 2. Pass selected caller ID to `CallCenterLiveDialer`

Add a `callerId` prop to `CallCenterLiveDialer`. The `handleCall` function in that component currently calls `telnyx-dial` without specifying a `location_id` — update it to pass the selected location's ID so the edge function uses the correct from-number.

### 3. New Settings tab: "Dialer" under Communications

Register a `dialer` settings tab in the database and add to `TAB_TO_CATEGORY` as `communications`.

Create `DialerSettings.tsx` with:
- **Outbound Caller ID** section: Lists all locations with Telnyx numbers, shows number + porting status, lets user set a **default** outbound number (saved to `app_settings` key `default_dialer_caller_id` with `location_id`)
- **Location Number Management** link: Button that navigates to Location Management settings for editing numbers
- This keeps the two locations (Call Center page + Settings) in sync via the same `locations` table data

### 4. Update `CallCenterLiveDialer` to use location-based caller ID

Instead of the edge function falling back through location lookup, the dialer explicitly passes `location_id` from the selected caller ID. The `telnyx-dial` edge function already supports `location_id` — just need to pass it.

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/call-center/DialerSettings.tsx` | Settings panel for default outbound number + location number overview |

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/CallCenterPage.tsx` | Add "Start Dialer" button, caller ID selector dropdown (fetches locations with telnyx numbers), pass `callerId`/`locationId` to `CallCenterLiveDialer` |
| `src/components/call-center/CallCenterLiveDialer.tsx` | Accept `callerId` and `locationId` props, pass `location_id` to `telnyx-dial` edge function |
| `src/features/settings/components/Settings.tsx` | Add `dialer: "communications"` to `TAB_TO_CATEGORY`, add `case "dialer"` rendering `DialerSettings` |

## Database

Insert into `settings_tabs`:
```sql
INSERT INTO settings_tabs (tab_key, label, icon, description, is_active, required_role, display_order)
VALUES ('dialer', 'Dialer', 'Phone', 'Configure outbound caller ID and dialing preferences', true, 'owner', 45);
```

