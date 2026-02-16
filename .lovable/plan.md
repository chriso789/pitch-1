
# Fix: Owner Info Not Displaying in Pin Details

## Root Cause Analysis

There are three interconnected bugs preventing owner data from showing:

1. **Client-side data flow gap**: The `handleEnrich` function successfully receives owner data from the pipeline response and stores it in `enrichedOwners` state, but the header title (line 538) reads from `localProperty.owner_name` -- which never gets updated because the DB write-back fails.

2. **Server-side conditional gate**: In `storm-public-lookup/index.ts` line 135, the `canvassiq_properties` update is gated behind `if (property_id && result.owner_name)`. When the appraiser scrape gets "junk" data (common for some addresses), owner_name is null, so the DB never receives ANY enrichment data -- not even partial results like parcel_id or contact info.

3. **Local state overwrite**: Even when the pipeline returns valid owner data, the client immediately refetches from `canvassiq_properties` (which still has null) and overwrites `localProperty`, erasing the enrichment data that was just received.

## Fix Plan

### 1. Client: Use pipeline response data directly (not just DB refetch)

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

After the edge function call returns, update `localProperty` directly from the pipeline response data -- don't rely solely on the DB refetch (which may not have been written to):

```typescript
// After line 119 (setEnrichedOwners), add:
// Update localProperty directly from pipeline response
setLocalProperty((prev: any) => ({
  ...prev,
  owner_name: pipelineResult.owner_name || prev.owner_name,
  phone_numbers: pipelineResult.contact_phones?.map(p => p.number) || prev.phone_numbers,
  emails: pipelineResult.contact_emails?.map(e => e.address) || prev.emails,
  searchbug_data: {
    owners: [{ id: '1', name: pipelineResult.owner_name, age: pipelineResult.contact_age, is_primary: true }],
    phones: pipelineResult.contact_phones || [],
    emails: pipelineResult.contact_emails || [],
    relatives: pipelineResult.contact_relatives || [],
    source: 'public_data_pipeline',
    enriched_at: new Date().toISOString(),
  },
}));
```

Then keep the DB refetch as a secondary update (it will merge, not overwrite if fields are null).

### 2. Server: Remove the owner_name gate on canvassiq_properties update

**File:** `supabase/functions/storm-public-lookup/index.ts`

Change line 135 from:
```typescript
if (property_id && result.owner_name) {
```
to:
```typescript
if (property_id) {
```

And guard individual field updates so null values don't overwrite existing data:

```typescript
const updatePayload: Record<string, any> = {
  enrichment_last_at: new Date().toISOString(),
  enrichment_source: ['public_data', 'firecrawl_people_search'],
  updated_at: new Date().toISOString(),
};

if (result.owner_name) updatePayload.owner_name = result.owner_name;
if (contactPhones.length > 0) updatePayload.phone_numbers = contactPhones.map(p => p.number);
if (contactEmails.length > 0) updatePayload.emails = contactEmails.map(e => e.address);
// Always write searchbug_data and property_data with whatever we have
updatePayload.searchbug_data = { ... };
updatePayload.property_data = { ... };
```

### 3. Client: Merge DB refetch instead of overwriting

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

Change the refetch merge logic (lines 130-137) to only update fields that have real values -- don't overwrite with null:

```typescript
setLocalProperty((prev: any) => ({
  ...prev,
  phone_numbers: updatedProperty.phone_numbers?.length ? updatedProperty.phone_numbers : prev.phone_numbers,
  emails: updatedProperty.emails?.length ? updatedProperty.emails : prev.emails,
  owner_name: updatedProperty.owner_name || prev.owner_name,
  searchbug_data: updatedProperty.searchbug_data || prev.searchbug_data,
}));
```

## Changes Summary

| File | Change |
|------|--------|
| `PropertyInfoPanel.tsx` | Update `localProperty` directly from pipeline response, not just from DB refetch |
| `PropertyInfoPanel.tsx` | Merge DB refetch data instead of blindly overwriting (prevent null clobbering) |
| `storm-public-lookup/index.ts` | Remove owner_name gate on canvassiq_properties update; write partial data |
