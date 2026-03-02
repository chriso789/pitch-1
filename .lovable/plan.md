

# Fix Cross-Location Data Integrity Issues

## Problem Summary
- 15 pipeline entries point to contacts in the wrong location
- 5 contacts are duplicated across both locations
- Need ongoing prevention

## Phase 1: Data Correction (SQL updates via insert tool)

### A. Fix 15 location-mismatched pipeline entries
For each mismatched pipeline entry, update the contact's `location_id` to match the pipeline entry's location — OR — update the pipeline entry's `location_id` to match the contact. The correct approach depends on where the work is actually happening.

**Recommended logic:** The pipeline entry's location represents where the job is being serviced. So the contact should be updated to match the pipeline entry location, unless the contact already has other pipeline entries in their current location.

### B. Merge 5 cross-location duplicate contacts
For each duplicate pair:
1. Keep the older record as primary (or the one with more activity)
2. Re-link any pipeline entries from the duplicate to the primary
3. Soft-delete the duplicate contact (`is_deleted = true`)

## Phase 2: Prevention (code changes)

### A. `src/hooks/useCreateLead.ts` or lead creation logic
- Before creating a new contact during lead creation, normalize the phone number and check for existing contacts **across all locations within the tenant** (not just the current location)
- If a match is found in another location, prompt the user: "This contact already exists in [Other Location]. Use existing contact?"

### B. Contact import dedup enhancement
- Extend the existing import dedup logic to also flag cross-location matches (it currently checks within the target location per memory)

### C. Webhook lead ingestion
- Apply the same cross-tenant phone/email dedup check when leads arrive from external sources

## Phase 3: Admin Data Health Dashboard (optional, future)
- Add a "Data Health" card to the admin dashboard showing:
  - Cross-location duplicate count
  - Location-mismatched pipeline entries
  - Contacts without pipeline entries
  - Pipeline entries without projects

## Immediate Action
I'll run the data corrections first (Phase 1A + 1B), then implement the prevention logic in code (Phase 2A).

