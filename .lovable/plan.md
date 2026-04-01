

## Plan: Add 10DLC Registration Manager to Phone Settings

### Problem
Users must manually navigate the Telnyx portal to register their brand and campaign for 10DLC compliance. PITCH CRM should handle this automatically since we already manage phone provisioning.

### Approach
Use the **Telnyx 10DLC API** (`/v2/10dlc/brands`, `/v2/10dlc/campaigns`, `/v2/10dlc/campaignNumberAssignments`) to build a guided registration flow directly in the Phone Settings admin page.

### Changes

**1. New Edge Function: `supabase/functions/telnyx-10dlc/index.ts`**
- Authenticated admin-only endpoint
- Actions: `register-brand`, `create-campaign`, `assign-number`, `check-status`
- `register-brand`: POST to Telnyx `/v2/10dlc/brands` with company name, EIN, vertical, website, etc.
- `create-campaign`: POST to `/v2/10dlc/campaigns` with use case, description, sample messages, keywords (STOP/HELP/START), opt-in workflow description
- `assign-number`: POST to `/v2/10dlc/campaignNumberAssignments` to link phone numbers to the approved campaign
- `check-status`: GET brand/campaign status to poll for approval
- Stores brand_id and campaign_id in a new `tenant_10dlc_registrations` table or in tenant settings JSONB

**2. New Component: `src/components/admin/TenDLCRegistrationPanel.tsx`**
- 3-step wizard UI matching what Telnyx portal shows (the screenshot):
  - **Step 1 — Register Brand**: Company name, EIN, website URL, vertical dropdown, company address
  - **Step 2 — Create Campaign**: Use case description, opt-in workflow, sample messages, keywords (START/STOP/HELP), auto-response messages
  - **Step 3 — Assign Numbers**: Select from provisioned numbers, assign to campaign
- Status badges showing brand/campaign approval state (pending, approved, rejected)
- Auto-fills company info from tenant settings where possible
- Pre-populates sensible defaults for a construction CRM (vertical: "Construction", keywords: STOP/HELP/START, sample opt-in/opt-out messages)

**3. Update `src/pages/admin/PhoneSettings.tsx`**
- Add `TenDLCRegistrationPanel` below the `PhoneProvisioningPanel`
- Show compliance status banner: "10DLC Required — Register to enable SMS delivery"

**4. New DB migration**
- Table `ten_dlc_registrations` to store brand_id, campaign_id, status, tenant_id
- Or store in existing tenant/location settings JSONB (simpler)

### Technical Details

Telnyx 10DLC API endpoints:
- `POST /v2/10dlc/brands` — register brand (EIN, company info)
- `GET /v2/10dlc/brands/{id}` — check brand status
- `POST /v2/10dlc/campaigns` — create campaign (use case, sample messages, keywords)
- `GET /v2/10dlc/campaigns/{id}` — check campaign status  
- `POST /v2/10dlc/campaignNumberAssignments` — assign numbers

The edge function uses the existing `telnyxFetch` helper from `_shared/telnyx.ts`.

### Files
- **New**: `supabase/functions/telnyx-10dlc/index.ts`
- **New**: `src/components/admin/TenDLCRegistrationPanel.tsx`
- **Edit**: `src/pages/admin/PhoneSettings.tsx` (add panel)
- **New**: SQL migration for registration tracking

