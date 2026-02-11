

## Add Phone Number Selection to AI Agent Settings + Fix Test Call

### Problems

1. **Test Call fails** with "Invalid value for connection_id" -- the `test-ai-call` edge function reads `TELNYX_CONNECTION_ID` from environment variables (which is blank) instead of using the location's stored `telnyx_voice_app_id`.
2. **No way to pick which number the AI answers** -- the settings page has no UI to select a location/phone number for the AI agent.

### Solution

#### 1. Add a "Phone Number" selector to the AI Agent Settings page

At the top of the settings page (below the enable toggle), add a dropdown that lists all locations with a provisioned Telnyx phone number. The user picks which location's number the AI agent should answer. The selected `location_id` is saved to the `ai_answering_config` table.

- Query `locations` where `telnyx_phone_number IS NOT NULL` for the tenant
- Show a Select dropdown: "West Coast -- +1 (941) 541-0117" etc.
- Save the chosen `location_id` alongside the other config

#### 2. Add `location_id` column to `ai_answering_config`

A migration to add `location_id UUID REFERENCES locations(id)` to the `ai_answering_config` table so the selected phone number persists.

#### 3. Fix the `test-ai-call` edge function

Instead of reading `TELNYX_CONNECTION_ID` from env, use the location's `telnyx_voice_app_id` as the `connection_id` for the Telnyx API call. This is already queried but not used.

---

### Technical Details

**Database migration:**
```sql
ALTER TABLE ai_answering_config
ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
```

**File: `supabase/functions/test-ai-call/index.ts`**

Change line 58 from:
```typescript
const connectionId = Deno.env.get('TELNYX_CONNECTION_ID') || '';
```
to:
```typescript
const connectionId = location.telnyx_voice_app_id || Deno.env.get('TELNYX_CONNECTION_ID') || '';
```

Also update the query to accept an optional `location_id` parameter so the test call uses the specific location selected in settings. If `location_id` is provided, query that specific location; otherwise fall back to the first available.

**File: `src/pages/settings/AIAgentSettingsPage.tsx`**

- Add state for locations list and selected location
- Fetch locations with `telnyx_phone_number IS NOT NULL` on mount
- Add a Card below the enable toggle with a Select dropdown for choosing the answering number
- Include `location_id` in the config state and save/load it from `ai_answering_config`
- Pass `location_id` to the `test-ai-call` function invoke so it uses the correct number

| File | Change |
|------|--------|
| New migration | Add `location_id` column to `ai_answering_config` |
| `supabase/functions/test-ai-call/index.ts` | Use `telnyx_voice_app_id` as connection_id, accept `location_id` param |
| `src/pages/settings/AIAgentSettingsPage.tsx` | Add phone number/location selector, pass location_id to test call |
