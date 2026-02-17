

# Intelligence Layer: FCC Geo Detection, Scoring Engines, DNC Scrubbing, AI Door Knock Strategy

## Overview

Six additions to the existing pipeline, building on the FL county adapter registry and BatchData skip trace already in place.

---

## 1. FCC Area API -- Replace Census TIGER for County Detection

**Problem:** The current `countyResolver.ts` uses Census TIGER, which is slow and sometimes unreliable. The FCC Census Area API is faster, simpler, and needs no API key.

**File:** Create `supabase/functions/_shared/geo/fccArea.ts`

- Export `fccArea(lat, lon, timeoutMs)` returning `{ stateCode, countyName, countyFips, stateFips }`
- Export `normalizeCountyName(name)` stripping " county", lowercasing, trimming
- Endpoint: `https://geo.fcc.gov/api/census/area?format=json&lat={lat}&lon={lon}`

**File:** Update `supabase/functions/_shared/public_data/countyResolver.ts`

- Import `fccArea` and `normalizeCountyName`
- Try FCC first (faster), fall back to Census TIGER if FCC fails
- Normalize `county_name` output using `normalizeCountyName` so the FL registry gets clean keys like `"hillsborough"` instead of `"Hillsborough County"`

No changes to `publicLookupPipeline.ts` or `storm-public-lookup/index.ts` -- they already call `getCountyContext()`.

---

## 2. Equity Scoring Engine

**Problem:** The existing `_shared/intel/equity.ts` uses a PPSF/LTV model that requires `living_sqft`. Many county adapters don't return sqft. Need a simpler heuristic that works with county data alone.

**File:** Create `supabase/functions/_shared/scoring/equity.ts`

- Input: `{ assessedValue, lastSaleAmount, lastSaleDate, homestead }`
- Scoring bands:
  - Assessed value tiers: 500k+ (25pts), 300k+ (15pts), 200k+ (8pts)
  - Homestead bonus: +10pts
  - Time since last sale: 15y+ (30pts), 10y+ (22pts), 5y+ (12pts), unknown (8pts)
- Output: `{ score: 0-100, reasons: string[] }`
- This is a NEW file alongside the existing `intel/equity.ts` (which remains for the measurement pipeline). The scoring/ directory is for the canvass intelligence layer.

---

## 3. Absentee / Investor Scoring

**File:** Create `supabase/functions/_shared/scoring/absentee.ts`

- Input: `{ propertyAddress, mailingAddress, homestead, ownerName }`
- Logic:
  - Owner name contains LLC/INC/CORP/TRUST/etc: +35pts
  - Homestead false: +15pts
  - Mailing address differs from situs: +40pts
- Output: `{ score: 0-100, reasons: string[] }`

---

## 4. Roof Age Likelihood Scoring

**File:** Create `supabase/functions/_shared/scoring/roofAge.ts`

- Input: `{ yearBuilt, lastSaleDate, homestead }`
- Logic:
  - Home age 25y+: 45pts, 15y+: 30pts, 10y+: 15pts
  - Long tenure (12y+ since sale): +20pts
  - Homestead (stable owner): +5pts
- Output: `{ score: 0-100, reasons: string[] }`

---

## 5. Integrate Scores into Pipeline Response

**File:** Update `supabase/functions/storm-public-lookup/index.ts`

- After pipeline completes, compute all 3 scores from the merged result
- Include in response: `scores: { equity: {...}, absentee: {...}, roof_age: {...} }`
- Also write scores to the `storm_properties_public` upsert (add a `scores` JSONB column)

**Database migration:**
```sql
ALTER TABLE storm_properties_public ADD COLUMN IF NOT EXISTS scores jsonb;
```

---

## 6. DNC Scrubbing Table + Logic

**Database migration:** Create `dnc_scrub_results` table:
```sql
CREATE TABLE dnc_scrub_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  phone_e164 text NOT NULL,
  is_dnc boolean,
  is_wireless boolean,
  source text,
  scrubbed_at timestamptz DEFAULT now(),
  raw jsonb,
  UNIQUE(tenant_id, phone_e164)
);
ALTER TABLE dnc_scrub_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their tenant DNC data"
  ON dnc_scrub_results FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
    UNION SELECT active_tenant_id FROM profiles WHERE id = auth.uid()
  ));
```

**File:** Update `supabase/functions/canvassiq-skip-trace/index.ts`

- After BatchData returns phones, check `dnc_scrub_results` cache for each phone
- For uncached phones: mark based on BatchData's `dnc` field (free; no external DNC API call yet)
- Upsert to `dnc_scrub_results`
- Return phones with `callable: boolean` and `dnc: boolean` flags

**UI:** Update `PropertyInfoPanel.tsx`
- Show "DNC" badge on phones where `dnc === true`
- Gray out / hide DNC phones by default
- Only show callable phones prominently

---

## 7. AI Door Knock Strategy Edge Function

**File:** Create `supabase/functions/door-knock-strategy/index.ts`

- Input: property profile, scores, contact data, time of day
- Uses existing `generateAIResponse` from `_shared/lovable-ai.ts` with tool calling for structured output
- Returns JSON: `{ opener, angle, objections, next_action, compliance_notes }`
- Uses `parseAIJson` for safe parsing

**File:** Add to `supabase/config.toml`:
```toml
[functions.door-knock-strategy]
verify_jwt = false
```

**UI:** Add "Generate Strategy" button in `PropertyInfoPanel.tsx` tools tab
- Calls `door-knock-strategy` edge function
- Renders structured response in a compact card

---

## Files Summary

| Action | File |
|--------|------|
| CREATE | `supabase/functions/_shared/geo/fccArea.ts` |
| CREATE | `supabase/functions/_shared/scoring/equity.ts` |
| CREATE | `supabase/functions/_shared/scoring/absentee.ts` |
| CREATE | `supabase/functions/_shared/scoring/roofAge.ts` |
| CREATE | `supabase/functions/door-knock-strategy/index.ts` |
| UPDATE | `supabase/functions/_shared/public_data/countyResolver.ts` |
| UPDATE | `supabase/functions/storm-public-lookup/index.ts` |
| UPDATE | `supabase/functions/canvassiq-skip-trace/index.ts` |
| UPDATE | `supabase/config.toml` |
| UPDATE | `src/components/storm-canvass/PropertyInfoPanel.tsx` |
| MIGRATE | Add `scores` jsonb column to `storm_properties_public` |
| MIGRATE | Create `dnc_scrub_results` table |

## Edge Functions to Deploy

- `storm-public-lookup`
- `canvassiq-skip-trace`
- `door-knock-strategy` (new)

