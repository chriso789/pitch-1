

# Add Acquisition Type / Lead Source Dropdown to Enhanced Lead Creation Dialog

## What exists already
- **`lead_sources` table** — tenant-scoped, with `name`, `category`, `is_active`, managed per company
- **Settings UI** — `LeadSources` component at Settings > Lead Sources tab, where users can add/edit/delete sources
- **`LeadForm.tsx`** — already fetches from `lead_sources` table and shows a "Lead Source" dropdown (with fallback)
- **`EnhancedLeadCreationDialog.tsx`** — the form shown in the screenshot (used from Pipeline page). Currently has NO lead source/acquisition type field

## Changes

### 1. `src/components/EnhancedLeadCreationDialog.tsx`
- Add `leadSource` to `formData` state (default `""`)
- Add state for `leadSources` array and `isLoadingSources` boolean
- On dialog open, fetch active `lead_sources` for the tenant (same pattern as `LeadForm.tsx` lines 84-129)
- Add a "Lead Source / Acquisition Type" `<Select>` dropdown in the left column, between "Estimated Value" and "Roof Type" (or after Estimated Value)
- Include the same fallback sources as `LeadForm.tsx` (Google Ads, Facebook Ads, Referral, Door to Door, etc.)
- Reset `leadSource` on form clear
- Pass `leadSource` in the `submitLead` body as `leadSource`

### 2. `supabase/functions/create-lead-with-contact/index.ts`
- Add `leadSource?: string` to the `LeadRequest` interface
- When creating a new contact, set `lead_source: body.leadSource || null` on the contact insert
- When creating the pipeline entry, add `lead_source_id: body.leadSource || null` to the pipeline metadata (or directly if the column exists)

### 3. Check `pipeline_entries` for `lead_source_id` column
- The types show `pipeline_entries` has a `lead_source_id` foreign key to `lead_sources`. So set `lead_source_id: body.leadSource || null` directly on the pipeline insert.
- Also set `lead_source` on the contact record.

This requires no new tables or migrations — the `lead_sources` table and settings management already exist and work across all company profiles.

