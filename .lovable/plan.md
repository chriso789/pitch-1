

# Meta Conversions API (CAPI) Integration

## What This Does
Sends lead events (and future conversion events) from PITCH CRM to Meta/Facebook in real-time using their server-side Conversions API. This fixes the error shown in your Meta Events Manager by sending properly hashed, server-side events with the correct payload format.

## Architecture

The integration stores Meta CAPI credentials (Pixel ID + Access Token) per tenant in the existing `tenants.settings` JSONB column. An edge function handles the actual API call to `graph.facebook.com`, and it gets called whenever a new lead is created.

---

## Implementation Steps

### 1. Create `meta-capi` edge function
- **New file:** `supabase/functions/meta-capi/index.ts`
- Accepts: `{ event_name, contact_id, tenant_id, event_time, custom_data }`
- Looks up tenant's Meta CAPI config from `tenants.settings.meta_capi` (pixel_id, access_token, enabled)
- If not enabled, returns early
- Hashes email/phone with SHA-256 per Meta requirements
- Sends POST to `https://graph.facebook.com/v21.0/{pixel_id}/events` with the exact payload format Meta expects:
  ```json
  {
    "data": [{
      "event_name": "Lead",
      "event_time": <unix_timestamp>,
      "action_source": "system_generated",
      "custom_data": { "event_source": "crm", "lead_event_source": "PITCH CRM" },
      "user_data": { "em": ["<sha256_email>"], "ph": ["<sha256_phone>"], "lead_id": <contact_id> }
    }]
  }
  ```
- Logs success/failure to `audit_log`
- Add to `config.toml` with `verify_jwt = true`

### 2. Wire into lead creation flow
- **File:** `supabase/functions/receive-lead/index.ts`
- After successfully creating a pipeline entry, call `meta-capi` via internal fetch if the tenant has Meta CAPI enabled
- Non-blocking (fire-and-forget with error logging)

### 3. Create Meta CAPI settings UI tab
- **New file:** `src/components/settings/MetaCAPISettings.tsx`
- Fields: Pixel ID, Access Token (masked input), Enable/Disable toggle
- Test Connection button that sends a test event
- Saves to `tenants.settings.meta_capi` JSONB
- **File:** `src/components/settings/IntegrationsSettings.tsx`
- Add "Meta CAPI" tab alongside existing Telnyx, API Keys, etc.

### 4. Support additional event types (future-ready)
- The edge function accepts any `event_name` (Lead, Purchase, Subscribe, etc.)
- Can be called from automation-processor for pipeline stage changes (e.g., "Contract Signed" → Purchase event)

---

## Technical Details

- **No new DB tables needed** — uses existing `tenants.settings` JSONB column
- **No new secrets needed** — each tenant stores their own Pixel ID and Access Token in settings (not shared env vars), since each company has different Meta ad accounts
- **Hashing:** SHA-256 applied to email and phone before sending (Meta requirement)
- **API version:** Meta Graph API v21.0
- **Event deduplication:** Uses `contact_id` as `event_id` to prevent duplicates
- **Error handling:** Retries once on 5xx, logs failures to audit_log

