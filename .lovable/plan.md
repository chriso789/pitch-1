

# Power Dialer: Telnyx WebRTC Calling with Auto-Cycle and Mini Lead Panel

## Problem
The dialer currently has no real calling integration -- `initiateCall()` just sets a boolean. It doesn't use the existing `telnyxService` for WebRTC calls, doesn't auto-advance through list items, and shows only minimal contact info (name/phone) instead of the rich lead context reps need.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  PowerDialerSession (new component, replaces active call UI)│
│                                                             │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │  Call Controls    │  │  MiniLeadPanel                   │ │
│  │  - Timer          │  │  - Contact name/phone/email      │ │
│  │  - Hangup         │  │  - Address + map pin             │ │
│  │  - Mute/Unmute    │  │  - Lead status / qualification   │ │
│  │  - Next (skip)    │  │  - Estimated value / roof type   │ │
│  │  - Disposition    │  │  - Recent notes (editable)       │ │
│  │  - Caller ID      │  │  - Recent call history (3 max)   │ │
│  └──────────────────┘  │  - Quick SMS / Email buttons      │ │
│                         └──────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Queue Bar: "3 of 47" ← current position + progress     ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Database Changes

### 1. Add `contact_id` to `dialer_list_items`
```sql
ALTER TABLE dialer_list_items ADD COLUMN contact_id UUID REFERENCES contacts(id);
CREATE INDEX idx_dialer_list_items_contact_id ON dialer_list_items(contact_id);
```
This links list items to CRM contacts so we can pull full lead details.

### 2. Add `list_item_id` to `dialer_list_items` (if not exists on `calls`)
The `calls` table already has `campaign_id` -- verify `list_item_id` exists (migration defined it). If not, add it.

## Frontend Changes

### 1. New: `PowerDialerSession.tsx`
Full-screen session component that takes over when a campaign starts. Contains:

**Call engine** — wraps `telnyxService`:
- On mount, initializes Telnyx WebRTC via `telnyxService.initialize()`
- Fetches the full queue of pending `dialer_list_items` for the campaign's list
- Loads the first item, looks up its `contact_id` → fetches contact + pipeline_entry data
- Calls `telnyxService.makeCall(phone, contactId)` using the configured caller ID
- On call end → shows disposition dialog → on save → marks item as `called` → auto-loads next item and dials

**Auto-cycle flow:**
1. Load next pending item from queue
2. Fetch contact + lead details (via `contact_id` join to `pipeline_entries`)
3. Display in MiniLeadPanel
4. Auto-dial after 2-second preview (configurable)
5. On hangup → disposition → next

### 2. New: `MiniLeadPanel.tsx`
Compact lead detail card showing:
- Contact: name, phone, email, address
- Lead: status, priority, estimated value, roof type, assigned rep
- Notes: recent notes with inline add-note textarea
- History: last 3 calls/SMS for this contact
- Actions: Quick SMS, Quick Email buttons

Data source: single query joining `contacts` → `pipeline_entries` via `contact_id`.

### 3. Modify: `Dialer.tsx`
- When `startCampaign()` is called, set `isSessionActive = true` which renders `PowerDialerSession` instead of the tabs UI
- Pass campaign, list_id, caller_id to the session
- Session has a "Stop Campaign" button that returns to the tabs view

### 4. Modify: `telnyxService.ts`
- Add `muteCall()` / `unmuteCall()` methods (call `this.currentCall.muteAudio()`)
- Surface the Telnyx `callerNumber` from config so the dialer can pass it

## Edge Function: No new functions needed
`telnyx-mint-jwt` already exists and mints WebRTC tokens. The `telnyxService` already calls it.

## Files to Create
| File | Purpose |
|------|---------|
| `src/features/communication/components/PowerDialerSession.tsx` | Session orchestrator with call engine + queue management |
| `src/features/communication/components/MiniLeadPanel.tsx` | Compact lead details panel synced to current contact |

## Files to Modify
| File | Change |
|------|--------|
| `src/features/communication/components/Dialer.tsx` | Add session state, render `PowerDialerSession` when active |
| `src/services/telnyxService.ts` | Add `muteCall()`, `unmuteCall()` |
| Migration SQL | Add `contact_id` column to `dialer_list_items` |

