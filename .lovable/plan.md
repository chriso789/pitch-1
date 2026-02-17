
# Integrate BatchData Skip Trace API -- Clean Architecture

## Overview

Replace the Firecrawl people-search scraping with **BatchData Skip Trace** as the primary contact enrichment source. This gives you **unmasked emails**, **verified phone numbers with DNC status**, and **structured first/last names** -- all from one API call per property.

## New Architecture Flow

```text
Pin Click
    |
    v
storm-public-lookup (county scrape for owner/parcel/assessed value)
    |
    v
Cache in storm_properties_public + canvassiq_properties
    |
    v
canvassiq-skip-trace checks: contact cached?
    |
    +-- YES (< 30 days) --> return cached
    |
    +-- NO --> BatchData Skip Trace API
                    |
                    v
              Cache in canvass_property_contacts
                    |
                    v
              Render full details (name, phones, emails, age)
```

## What Gets Removed

- **Firecrawl people search** (`peopleSearch.ts`) -- no longer called from the pipeline
- **TruePeopleSearch / FastPeopleSearch / WhitePages scraping** -- eliminated entirely
- **Client-side scraping** -- none exists, confirmed clean

## What Gets Built

### Step 1: Add `BATCHDATA_API_KEY` Secret

You mentioned it's already saved -- I'll verify. If not present, I'll add it.

### Step 2: New Database Table -- `canvass_property_contacts`

```sql
CREATE TABLE canvass_property_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES canvassiq_properties(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  primary_phone TEXT,
  secondary_phone TEXT,
  phone_numbers JSONB DEFAULT '[]',   -- [{number, type, dnc}]
  emails TEXT[] DEFAULT '{}',
  age INTEGER,
  relatives TEXT[] DEFAULT '{}',
  batchdata_raw JSONB,                -- full API response for audit
  enriched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(property_id)
);
-- RLS: tenant isolation via property join
```

### Step 3: New Adapter -- `supabase/functions/_shared/public_data/sources/batchdata/skipTrace.ts`

BatchData Skip Trace adapter:
- **Endpoint:** `POST https://api.batchdata.com/api/v1/property/skip-trace`
- **Auth:** `Authorization: Bearer {BATCHDATA_API_KEY}`
- **Request:**
```json
{
  "requests": [{
    "propertyAddress": {
      "street": "123 Main St",
      "city": "Tampa",
      "state": "FL",
      "zip": "33601"
    }
  }]
}
```
- **Response parsing:** Extract `results[0].persons[0]` for name/phones/emails/age
- **Returns:** Structured `{ firstName, lastName, phones[], emails[], age, relatives[], raw }`
- Uses existing `retry()` utility for resilience

### Step 4: Rewrite `canvassiq-skip-trace/index.ts`

Simplified 3-step flow:
1. **Check cache** -- query `canvass_property_contacts` by `property_id`. If exists and < 30 days old, return cached.
2. **Call BatchData** -- use the new adapter with property address. No owner name required (BatchData resolves by address).
3. **Cache result** -- upsert into `canvass_property_contacts` and update `canvassiq_properties` with owner_name/phones/emails.

Remove:
- SearchBug API calls
- Firecrawl people search fallback
- storm_properties_public people search data extraction
- All "demo data" / fake data paths

### Step 5: Update `publicLookupPipeline.ts`

Remove step 6 (people search via Firecrawl). The pipeline now ONLY does:
1. Property Appraiser (county scrape)
2. Tax Collector
3. Clerk (deeds/mortgages)
4. BatchLeads fallback (for absentee owners, existing logic)
5. Merge + confidence score

Contact enrichment is now **separate** -- handled by `canvassiq-skip-trace` calling BatchData, not by the public lookup pipeline.

### Step 6: Update `PropertyInfoPanel.tsx`

- Read contact data from `canvass_property_contacts` (via the skip-trace response)
- Display `first_name` + `last_name` separately in the header
- Show full unmasked emails (no more "(partial)" indicators)
- Show phone type labels (Mobile/Landline) and DNC badge from BatchData
- Show age from BatchData response

### Cost Control

BatchData skip trace is only called when:
- User clicks a pin (on-demand, not batch)
- No cached contact exists (or cache is > 30 days old)
- Estimated cost: ~$0.10-0.15 per skip trace

## Files Changed

| File | Action |
|------|--------|
| `canvass_property_contacts` table | CREATE (new migration) |
| `supabase/functions/_shared/public_data/sources/batchdata/skipTrace.ts` | CREATE -- BatchData adapter |
| `supabase/functions/canvassiq-skip-trace/index.ts` | REWRITE -- clean 3-step: cache check, BatchData call, cache store |
| `supabase/functions/_shared/public_data/publicLookupPipeline.ts` | EDIT -- remove people search step (step 6) |
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | EDIT -- display first/last name, full emails, phone types |

## Edge Functions to Deploy

- `storm-public-lookup` (pipeline change)
- `canvassiq-skip-trace` (full rewrite)
