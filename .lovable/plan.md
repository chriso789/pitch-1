
# Auto-Populate Free Public Data When Opening a Pin

## Problem
When you open a pin on the Live Canvass map, the system calls `canvassiq-skip-trace` which:
1. Tries SearchBug API (paid -- you don't have a key configured)
2. Falls back to `generateDemoContactData()` which creates **completely fake** random phone numbers and made-up emails
3. The owner name comes from `storm-public-lookup` (Firecrawl) which IS working, but phone/email enrichment is broken

You're seeing fake data, not real data. And you shouldn't be paying for basic public record info.

## Solution

### Step 1: Add a Free People Search to storm-public-lookup via Firecrawl
Use Firecrawl SEARCH to find the homeowner's public contact info from free people-search sites (FastPeopleSearch, TruePeopleSearch, WhitePages, etc.) as a new step in the existing public data pipeline.

**New file:** `supabase/functions/_shared/public_data/sources/universal/peopleSearch.ts`

- After the appraiser resolves the owner name, run a Firecrawl search: `"{Owner Name}" "{City, State}" phone email`
- Scrape the top result with JSON extraction to pull: phone numbers, email addresses, age, relatives
- This is FREE public data (no skip trace cost) -- just uses your existing Firecrawl subscription
- Returns structured data: `{ phones: [{number, type}], emails: [{address}], age, relatives }`

### Step 2: Integrate into the Pipeline
**Edit:** `supabase/functions/_shared/public_data/publicLookupPipeline.ts`

- After appraiser/tax/clerk steps, if we have an owner name, call the new `peopleSearch` function
- Merge phone/email results into the pipeline output
- Add `contact_phones` and `contact_emails` fields to the result

### Step 3: Update storm-public-lookup to Store Contact Data
**Edit:** `supabase/functions/storm-public-lookup/index.ts`

- Save the phone/email data from the people search into `storm_properties_public` (the existing cache table)
- Also push it directly to `canvassiq_properties.phone_numbers` and `canvassiq_properties.emails` when `property_id` is provided

### Step 4: Remove Fake Data from canvassiq-skip-trace
**Edit:** `supabase/functions/canvassiq-skip-trace/index.ts`

- Remove the `generateDemoContactData()` function entirely -- no more fake phones/emails
- When SearchBug key is not configured, just use the data already populated by storm-public-lookup (which now includes phones/emails from Firecrawl people search)
- Keep the SearchBug path as an optional premium upgrade, but the default path is free Firecrawl-based data

### Step 5: Make the Auto-Enrich Flow Seamless
**Edit:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

- The auto-enrich on pin open already calls `canvassiq-skip-trace` (line 91-94)
- Update the flow to first check if `storm-public-lookup` already populated the data (from when the pin was created)
- If not, trigger `storm-public-lookup` directly instead of skip-trace -- it's the free path
- Only fall back to skip-trace if the user explicitly wants premium SearchBug data

## Data Flow After Changes

```text
Pin created (drop or parcel load)
  |
  v
storm-public-lookup runs automatically
  |
  +-- Firecrawl SEARCH: appraiser site -> owner name, year built, value
  +-- Firecrawl SEARCH: tax site -> tax amounts
  +-- Firecrawl SEARCH: people search -> phones, emails, age  [NEW]
  |
  v
All data cached in storm_properties_public + canvassiq_properties
  |
  v
User opens pin -> PropertyInfoPanel
  |
  v
Data already there (owner, phones, emails, age) -- no extra API calls needed
  |
  v
If data missing: re-trigger storm-public-lookup (free)
```

## Files to Change

| File | Action |
|------|--------|
| `supabase/functions/_shared/public_data/sources/universal/peopleSearch.ts` | New -- Firecrawl-based free people search |
| `supabase/functions/_shared/public_data/publicLookupPipeline.ts` | Add people search step after appraiser |
| `supabase/functions/storm-public-lookup/index.ts` | Store phone/email data in cache + canvassiq_properties |
| `supabase/functions/canvassiq-skip-trace/index.ts` | Remove fake data generation, use public data as default |
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | Prefer storm-public-lookup over skip-trace for auto-enrich |

## Cost Impact
- Owner name, property data: Firecrawl credits (already paid)
- Phone/email lookup: 1 additional Firecrawl search + 1 scrape = 2 more credits per pin
- Total per pin: ~8 Firecrawl credits (cached 30 days)
- SearchBug: $0 (optional premium, not needed)
- No fake data anywhere in the system
