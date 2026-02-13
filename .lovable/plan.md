

## Tenant Config Table + "Why This Score?" Panel + Manager Map Areas with Rep Assignments

### Overview

Three features built on the existing StormCanvass intelligence engine:

1. **Tenant config tables** -- make scoring weights and county $/sqft configurable per tenant instead of hardcoded
2. **"Why This Score?" explainability panel** -- renders `storm_property_intel` factors as a visual breakdown (similar to TradeDecisionPanel pattern)
3. **Manager-drawn map areas** with rep assignments, precomputed property membership, and live counters (total + contacted)

The map pin dataset is **`canvassiq_properties`** (confirmed from `GooglePropertyMarkersLayer.tsx`). All area membership joins use that table.

---

### 1. Database Migration

**Table: `storm_intel_tenant_config`** -- per-tenant global scoring defaults

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| tenant_id | uuid PK | -- | Tenant reference |
| default_ppsf | numeric | 220 | Default price per sqft for equity model |
| w_damage / w_equity / w_claim | numeric | 0.30 / 0.15 / 0.55 | Priority blend weights |
| claim_w_damage / claim_w_equity | numeric | 0.55 / 0.20 | Claim model internal weights |
| claim_absentee_bonus | int | 10 | Points added for absentee |
| claim_homestead_low_damage_penalty | int | 8 | Penalty when homestead + low damage |
| claim_homestead_high_damage_bonus | int | 6 | Bonus when homestead + high damage |
| hail_points_per_inch / hail_cap | numeric/int | 18 / 45 | Damage model hail config |
| wind_points_per_3mph / wind_cap | numeric/int | 1 / 35 | Damage model wind config |
| age_points_per_2yrs / age_cap | numeric/int | 1 / 20 | Damage model age config |
| min_priority_to_route | int | 60 | Minimum score for route inclusion |
| min_confidence_for_public_only | int | 70 | Skip BatchLeads threshold |

**Table: `storm_intel_county_config`** -- per-county $/sqft and LTV overrides

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid | Tenant reference |
| state | text | e.g. "FL" |
| county | text | e.g. "Sarasota" |
| zip | text (nullable) | Optional zip override |
| ppsf | numeric | County-specific price per sqft |
| ltv_recent / ltv_5yr / ltv_10yr / ltv_older | numeric | LTV bands by purchase recency |

Unique on `(tenant_id, state, county, zip)`.

**Table: `canvass_areas`** -- manager-drawn polygons

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid | Tenant reference |
| name | text | Area display name |
| description | text | Optional description |
| polygon_geojson | jsonb | GeoJSON polygon |
| color | text | Display color (default #3b82f6) |
| created_by | uuid | Manager who created |

**Table: `canvass_area_assignments`** -- rep-to-area mapping

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid | Tenant reference |
| area_id | uuid FK | References canvass_areas |
| user_id | uuid | Assigned rep |
| is_active | boolean | Default true |

Unique on `(tenant_id, area_id, user_id)`.

**Table: `canvass_area_properties`** -- precomputed membership

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid | Tenant reference |
| area_id | uuid FK | References canvass_areas |
| property_id | uuid | FK to canvassiq_properties |
| lat / lng | double precision | Property coordinates |

Unique on `(tenant_id, area_id, property_id)`.

**View: `canvass_area_stats`** -- live counter aggregation

Joins `canvass_area_properties` with `canvassiq_visits` to produce `total_properties` and `contacted_properties` per area. Uses `security_invoker = true` to respect RLS.

All tables get RLS policies for tenant isolation.

---

### 2. Update Scoring Modules to Use Config

**`_shared/intel/damage.ts`** -- Accept optional config parameter with hail/wind/age weights. Falls back to current hardcoded values if no config passed.

**`_shared/intel/equity.ts`** -- Accept optional config for `ppsf` and LTV bands instead of hardcoded `220` and `0.9/0.8/0.7/0.6`.

**`_shared/intel/claim.ts`** -- Accept optional config for claim weights, absentee bonus, homestead adjustments.

**`_shared/intel/priority.ts`** -- Accept optional config for `w_damage`, `w_equity`, `w_claim` blend weights.

**`storm-intel-score/index.ts`** -- Load tenant config + county config from DB before scoring. Pass config to all scoring functions. Single DB fetch at start, cached for the request.

---

### 3. "Why This Score?" Panel

**New file: `src/components/storm-canvass/StormScoreWhyPanel.tsx`**

A slide-out or inline panel that fetches from `storm_property_intel` and renders:

- **Header**: Property address + owner name + county
- **Priority badge**: Large score number with color coding (green >= 70, yellow >= 40, red < 40)
- **Signal pills**: Badges for key factors (Absentee Owner, Homestead, Older Home, High Damage Risk, High Equity)
- **Three score bars** with progress indicators:
  - Damage Score (0-100) with factors: hail size + points, wind speed + points, roof age + points
  - Equity Score (0-100) with factors: estimated value, mortgage, equity percentage
  - Claim Likelihood (0-100) with factors: damage weight, equity weight, absentee status, homestead adjustment
- **Explanation line**: "Priority is a weighted blend of Claim (55%) + Damage (30%) + Equity (15%) -- configurable by your admin."

Integrated into `PropertyInfoPanel.tsx` as a new tab or expandable section, visible when `storm_property_intel` data exists for the current property.

---

### 4. Manager Territory Map

**New file: `src/components/storm-canvass/TerritoryManagerMap.tsx`**

Manager-facing component with:
- Google Maps with polygon drawing tools (using Google Maps Drawing Library)
- Save drawn polygon to `canvass_areas` with name/color
- Rep assignment multi-select dropdown per area
- Calls `canvass-area-build-membership` edge function after saving polygon
- Displays area stats overlay: "128 properties | 42 contacted (33%)"
- Color-coded area fills with opacity

**New file: `src/components/storm-canvass/AreaStatsBadge.tsx`**

Compact counter component showing total/contacted with a progress bar. Used in both manager and rep views.

**Update: `PropertyInfoPanel.tsx`** -- Add "Score Intel" tab that renders `StormScoreWhyPanel` when intel data is available for the property.

---

### 5. New Edge Function: `canvass-area-build-membership`

Accepts `{ tenant_id, area_id }`:
1. Loads polygon from `canvass_areas`
2. Computes bbox from polygon
3. Queries `canvassiq_properties` within bbox
4. Runs point-in-polygon filter (using existing `geo.ts` utilities)
5. Upserts matching properties into `canvass_area_properties`
6. Returns `{ inserted, total_in_area }`

---

### 6. Config Updates

Add to `supabase/config.toml`:
```
[functions.canvass-area-build-membership]
verify_jwt = false
```

---

### Files Created/Modified

| File | Action |
|------|--------|
| Database migration | CREATE 5 tables + 1 view, RLS policies |
| `supabase/functions/_shared/intel/damage.ts` | UPDATE -- accept config param |
| `supabase/functions/_shared/intel/equity.ts` | UPDATE -- accept config param |
| `supabase/functions/_shared/intel/claim.ts` | UPDATE -- accept config param |
| `supabase/functions/_shared/intel/priority.ts` | UPDATE -- accept config param |
| `supabase/functions/storm-intel-score/index.ts` | UPDATE -- load config from DB |
| `supabase/functions/canvass-area-build-membership/index.ts` | CREATE |
| `src/components/storm-canvass/StormScoreWhyPanel.tsx` | CREATE |
| `src/components/storm-canvass/TerritoryManagerMap.tsx` | CREATE |
| `src/components/storm-canvass/AreaStatsBadge.tsx` | CREATE |
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | UPDATE -- add Score Intel tab |
| `supabase/config.toml` | ADD 1 entry |

