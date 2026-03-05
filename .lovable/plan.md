

# Fix Canvass-to-CRM Data Transfer and Pipeline Consistency

## Three Issues Identified

### Issue 1: Contact created as "Unknown Owner" from canvass pins
**Root cause**: In `PropertyInfoPanel.tsx`, when a contact is auto-created from a disposition or via "Add Customer," the owner name resolution falls through to `parseFirstName(undefined)` = "Unknown" / `parseLastName(undefined)` = "Owner". The canvassiq_properties record may have `owner_name`, `property_data`, `phone_numbers`, `emails`, and enrichment data that should be used.

**Fix** (`src/components/storm-canvass/PropertyInfoPanel.tsx`):
- In both `handleDisposition` (line ~486-513) and `handleAddCustomer` (line ~559-604), ensure the contact insert includes:
  - Enriched phone numbers and emails from the property record
  - Property metadata (year_built, assessed_value, parcel_id, etc.) stored in contact's `metadata` field
  - `lead_source_details` with canvass context (property_id, disposition, enrichment source)

The `ownerFullName` variable is already resolved, but the `parseFirstName`/`parseLastName` helpers return "Unknown"/"Owner" for null/undefined input. The real issue is that if the `validOwner()` chain returns null, the ownerFullName fed to the parsers is undefined. This is expected when no owner data exists -- but the phone, email, address, and property data should still carry over correctly. The name fallback should use address-based naming instead (e.g., "Homeowner at 4272 Winfall Ave").

### Issue 2: Rep who dropped the pin not tagged on the contact
**Root cause**: The contact insert in both `handleDisposition` and `handleAddCustomer` sets `created_by: profile.id` but omits `assigned_to: profile.id`.

**Fix** (`src/components/storm-canvass/PropertyInfoPanel.tsx`):
- Add `assigned_to: profile.id` to the contact insert object in both `handleDisposition` (line ~489) and `handleAddCustomer` (line ~566)
- Also add `location_id` from the user's active location assignment so the contact lands in the correct CRM location

### Issue 3: Cesar Yax has Production job but Pipeline shows (0)
**Root cause**: The job exists in the `jobs` table linked to this contact, but there's no corresponding `pipeline_entries` record (or it's been deleted). The pipeline entry count comes from `pipeline_entries` where `is_deleted = false`. When the system approved the lead and created a project/job, the pipeline entry either wasn't created or was deleted.

**Fix**: This is a data fix -- create a pipeline entry for Cesar Yax's contact with status `project` to reflect the active production job. This also needs a systemic fix: when the `api-approve-job-from-lead` or job creation flow creates a job, it must ensure a pipeline entry exists with `status = 'project'`.

## Files to Change

### 1. `src/components/storm-canvass/PropertyInfoPanel.tsx`
- **`handleDisposition` contact creation** (~line 489-513): Add `assigned_to: profile.id`, pass location_id, improve name fallback to use address
- **`handleAddCustomer`** (~line 566-583): Same changes -- add `assigned_to`, `location_id`, improve name fallback

### 2. Data fix (SQL migration)
- Query for Cesar Yax's contact and create a pipeline entry with `status = 'project'` linked to the existing job

### 3. `supabase/functions/canvass-pin-sync/index.ts` (consistency)
- The bulk sync function (line 77-100) already sets `created_by: repId` but also omits `assigned_to`. Add `assigned_to: repId` to the contact insert.

