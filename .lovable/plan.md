
# Call Center Live Dialer with Contact List Builder

## Overview

Transform the Call Center page into a full-featured live dialer workspace where reps can build contact lists, filter through contacts, and call directly from the system. This adds three major capabilities to the existing Call Center page:

1. **List Builder** -- Filter and select contacts from the CRM to create callable lists
2. **Live Dialer** -- Step through a list and call contacts one-by-one with dispositions
3. **Stagnant Lead Focus** -- Pre-built filters to surface contacts that haven't been touched in X days

## What Changes

### 1. New Component: `CallCenterListBuilder.tsx`
A dialog/panel where reps can:
- Search and filter contacts by qualification status, lead source, location, assigned rep, date ranges, and tags
- Filter for "stagnant leads" (contacts with no activity in 7/14/30/60/90 days using `last_activity_at` or `updated_at`)
- Select individual contacts or bulk-select filtered results
- Save the selection as a new `dialer_list` with items written to `dialer_list_items`
- Uses existing `contacts` table with the user's tenant and location filters

### 2. New Component: `CallCenterLiveDialer.tsx`
A focused calling interface that:
- Loads a selected `dialer_list` and steps through its `dialer_list_items`
- Shows the current contact's name, phone, email, address, and qualification status
- Provides a "Call" button that opens the phone via `tel:` link (same pattern as `PhoneNumberSelector`)
- After each call, shows a disposition dialog (using `dialer_dispositions` from the DB)
- Tracks progress (called/remaining/skipped) and updates item status
- "Next" / "Skip" / "End Session" controls
- Logs call attempts to `communication_history`

### 3. Updated: `CallCenterPage.tsx`
Add a tabbed layout to the existing page:
- **Tab 1: "Dialer"** -- The new live dialer + list selection UI
- **Tab 2: "Call Log"** -- The existing recent calls view (moved here as-is)
- **Tab 3: "Lists"** -- View/manage saved dialer lists, see stats, delete old lists
- Header updated: "Call Center" title stays, subtitle updated to reflect dialer capability
- A prominent "Build List" button opens the list builder dialog

### 4. New Component: `StagnantLeadFilter.tsx`
A preset filter chip bar specifically for finding stagnant leads:
- "No activity 7+ days", "14+ days", "30+ days", "60+ days", "90+ days"
- Filters contacts where `updated_at` or the latest `communication_history.created_at` is older than the selected threshold
- Can be combined with other filters (location, status, source)

## Database Usage

All tables already exist -- no migrations needed:
- `dialer_lists` -- stores named lists with tenant_id
- `dialer_list_items` -- stores contacts in each list (phone, name, status, contact_id via metadata)
- `dialer_dispositions` -- call outcome options
- `dialer_campaigns` -- optional grouping (not required for basic flow)
- `dialer_sessions` -- tracks dialing session stats
- `contacts` -- source data for filtering and list building
- `communication_history` -- for logging calls and checking last activity

## Technical Details

### Files Created
1. `src/components/call-center/CallCenterListBuilder.tsx` -- Filter/select contacts dialog
2. `src/components/call-center/CallCenterLiveDialer.tsx` -- Active dialing interface
3. `src/components/call-center/StagnantLeadFilter.tsx` -- Preset stagnant-lead filter chips
4. `src/components/call-center/CallCenterListsManager.tsx` -- View/manage saved lists

### Files Modified
1. `src/pages/CallCenterPage.tsx` -- Add tabs (Dialer, Call Log, Lists), add "Build List" button, integrate new components

### Key Patterns Followed
- Uses `useEffectiveTenantId()` for tenant filtering (existing pattern)
- Uses `tel:` link for initiating calls (same as `PhoneNumberSelector.tsx`)
- Logs to `communication_history` (same as `PhoneNumberSelector.tsx`)
- Uses Tanstack Query for data fetching (existing pattern)
- Disposition dialog pattern from existing `Dialer.tsx`
- Location filtering uses `user_location_assignments` (same pattern as the rep dropdown fix)

### Contact Filtering Options in List Builder
- **Status**: qualification_status (unqualified, qualified, not_home, interested, etc.)
- **Lead Source**: lead_source field
- **Location**: location_id
- **Assigned Rep**: assigned_to
- **Tags**: tags array
- **Stagnant Duration**: contacts not updated in X days
- **Has Phone**: only contacts with a phone number (required for calling)
- **Search**: free-text search on name/phone/email

### Live Dialer Flow
1. Rep selects a saved list from the Lists tab or builds a new one
2. Clicks "Start Dialing" to enter the live dialer view
3. First pending contact loads with full details
4. Rep clicks "Call" -- opens phone dialer via tel: link
5. After call, rep selects a disposition and adds optional notes
6. System logs the attempt, updates the list item status, advances to next contact
7. Progress bar shows how many contacts remain
8. Rep can pause/resume or end session at any time
