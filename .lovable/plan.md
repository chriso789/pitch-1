

# Fix Tristate Pipeline: Populate Stage Keys + Add Orphan Handling

## Problem
Tristate's 9 pipeline stages all have `key = NULL`. The code auto-generates keys from names (e.g., "New Lead" → `new_lead`), but existing entries have statuses like `lead`, `project`, `completed`, `legal_review` — none of which match auto-generated keys. Result: all 10 entries are invisible.

**9 other tenants** have the same NULL key issue.

## Data Currently in Pipeline

| Contact | Status | Needs Key Mapping |
|---|---|---|
| test Contact | `lead` | "New Lead" stage |
| Andrea Iacono | `lead` | "New Lead" stage |
| QUALITY MEATS | `lead` | "New Lead" stage |
| Rich Biedrzycki | `lead` | "New Lead" stage |
| KEVIN MARIOTTI | `legal_review` | No matching stage — orphan |
| Cherie Stutz | `project` | "In Production" stage |
| Christian Morrissette | `project` | "In Production" stage |
| MICHAEL HENKIN | `project` | "In Production" stage |
| Patti & Michael Attanasio | `project` | "In Production" stage |
| Michelle McGonigle | `completed` | "Complete" stage |

## Fix — Two Parts

### Part 1: Data Fix — Populate `key` column for all 9 affected tenants

Update Tristate's pipeline_stages keys to match the statuses their entries actually use:

| Stage Name | Key to Set |
|---|---|
| New Lead | `lead` |
| Contacted | `contacted` |
| Inspection Scheduled | `inspection_scheduled` |
| Estimate Sent | `estimate_sent` |
| Negotiation | `negotiation` |
| Sold | `sold` |
| In Production | `project` |
| Complete | `completed` |
| Lost | `lost` |

For the other 8 tenants with NULL keys, auto-generate keys from names (lowercase, spaces→underscores) since they likely don't have existing entries with legacy statuses.

Use the **insert/update tool** (not migration) since this is a data update.

### Part 2: Code Fix — Orphan handling in Pipeline.tsx

**File: `src/features/pipeline/components/Pipeline.tsx`** (~line 354-364)

After grouping entries by stage key, add a pass that collects any entries whose `status` doesn't match any stage key and pushes them into the first column. This prevents future data mismatches from making entries invisible.

```tsx
// After the forEach that groups by stage key:
const allStageKeys = jobStages.map(s => s.key);
const orphaned = filteredData.filter(e => !allStageKeys.includes(e.status));
if (orphaned.length > 0 && jobStages.length > 0) {
  const firstKey = jobStages[0].key;
  groupedData[firstKey] = [...(groupedData[firstKey] || []), ...filterBySearch(orphaned)];
}
```

### Part 3: Schema safeguard (migration)

Add a NOT NULL constraint with a default on `pipeline_stages.key` to prevent this from recurring:

```sql
-- Set remaining NULL keys to auto-generated values
UPDATE pipeline_stages SET key = lower(regexp_replace(name, '\s+', '_', 'g'))
WHERE key IS NULL;

-- Add NOT NULL + default
ALTER TABLE pipeline_stages ALTER COLUMN key SET NOT NULL;
ALTER TABLE pipeline_stages ALTER COLUMN key SET DEFAULT '';
```

### Files Changed
- Data update: `pipeline_stages` rows for 9 tenants (Tristate gets custom mapping, others get auto-generated)
- `src/features/pipeline/components/Pipeline.tsx` — orphan entry handling (~4 lines added)
- 1 SQL migration — NOT NULL constraint on `key` column

