

# Fix List Builder Filters + Exclude Project-Stage Contacts + Add to Previous Telnyx Dialer Plan

## Combined Plan

This plan adds two fixes to the List Builder **on top of** the previously approved Telnyx live dialer plan (WebRTC calling, voicemail drops, recording, contact detail panel, webhooks). Both plans will be implemented together.

## Part A: List Builder Fixes (this request)

### Problem 1: Filter returns "No contacts match filters"
The query logic is correct but may fail silently when the `is_deleted` filter uses `.or('is_deleted.is.null,is_deleted.eq.false')` syntax which can conflict with other filters. The fix normalizes the filter chain to ensure all conditions compose properly with PostgREST.

### Problem 2: Projects showing in dialer list
Contacts that already have a pipeline entry at "project" status or beyond (project, completed, closed) should NOT appear in the dialer list. These are active or finished jobs, not stagnant leads to cold-call.

**Fix in `CallCenterListBuilder.tsx`:**
1. After fetching contacts, run a secondary query to get contact IDs that have pipeline entries with `status IN ('project', 'completed', 'closed')` for the same tenant
2. Exclude those contact IDs from the displayed list
3. This keeps the Supabase query simple (no complex joins) and the exclusion logic explicit

### Technical Changes to `CallCenterListBuilder.tsx`
- Add a parallel query to fetch `pipeline_entries` where `status` is in the advanced/terminal set: `['project', 'completed', 'closed']`
- Filter the contacts result to exclude any contact whose ID appears in that set
- Fix the `is_deleted` filter to use `.eq('is_deleted', false)` combined with `.or()` properly, or switch to a simpler `.neq('is_deleted', true)` pattern that handles null correctly

## Part B: Telnyx Live Dialer (previous plan, unchanged)

All items from the previously approved plan remain:

1. **WebRTC Calling** -- Replace `tel:` links in `CallCenterLiveDialer.tsx` with in-browser Telnyx calls via `telnyx-dial` edge function, with mute/hold/hangup controls and live timer
2. **Voicemail Drop** -- New `VoicemailDropManager.tsx` component and `telnyx-voicemail-drop` edge function to play pre-recorded audio when AMD detects voicemail
3. **Contact Detail Panel** -- New `ContactDetailPanel.tsx` shown between calls for reps to update CRM data before advancing
4. **Call Webhook Handler** -- New `telnyx-call-webhook` edge function to receive Telnyx events, store recordings, update call records
5. **Quick Call Mode** -- Standalone single-call card in the Dialer tab for one-off recorded calls
6. **Storage Buckets** -- `call-recordings` and `voicemail-drops` for audio files

### Files Created
1. `src/components/call-center/VoicemailDropManager.tsx`
2. `src/components/call-center/ContactDetailPanel.tsx`
3. `supabase/functions/telnyx-voicemail-drop/index.ts`
4. `supabase/functions/telnyx-call-webhook/index.ts`

### Files Modified
1. `src/components/call-center/CallCenterListBuilder.tsx` -- Fix filters, exclude project-stage contacts
2. `src/components/call-center/CallCenterLiveDialer.tsx` -- Replace tel: with WebRTC, add call controls, voicemail drop, contact detail panel
3. `src/pages/CallCenterPage.tsx` -- Add Quick Call card, voicemail management, integrate new components
4. `supabase/config.toml` -- Add webhook function entries with `verify_jwt = false`
