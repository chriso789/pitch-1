

# Fix Lead Creation Edge Function Error

## Root Cause

The `create-lead-with-contact` edge function fails when inserting into `pipeline_entries` because it sets a column that doesn't exist on the table:

```
lead_source_id: body.leadSource || null    // ← THIS COLUMN DOESN'T EXIST
```

The `pipeline_entries` table has a `source` column typed as a `lead_source` enum (`referral`, `canvassing`, `online`, `advertisement`, `social_media`, `other`). The function is trying to write to a non-existent `lead_source_id` column, which causes the insert to fail.

Additionally, the fallback lead sources in the UI use string values like `'google_ads'` and `'facebook_ads'` which don't match the enum values, so even if the column name were corrected, the value would be rejected.

## Fix

### File: `supabase/functions/create-lead-with-contact/index.ts`

1. **Remove `lead_source_id`** from the `pipelineData` object (line 381)
2. **Map `leadSource` to the `source` enum** where possible, otherwise store it in metadata:
   - If `leadSource` matches an enum value (referral, canvassing, online, advertisement, social_media, other), use it as `source`
   - If it's a UUID (from the `lead_sources` table), store it in `metadata.lead_source_id` for reference and set `source` to `'other'`
   - If it's a fallback string like `google_ads`, map to closest enum (`online` / `advertisement` / `social_media`) or default to `'other'`

### Technical Detail

Current broken code (line 372-392):
```typescript
const pipelineData: any = {
  ...
  lead_source_id: body.leadSource || null,  // REMOVE THIS
  ...
};
```

Replace with mapping logic:
```typescript
// Map leadSource to the source enum
function mapLeadSource(value: string | null): string | null {
  if (!value) return null;
  const enumValues = ['referral','canvassing','online','advertisement','social_media','other'];
  if (enumValues.includes(value)) return value;
  // Map common fallback strings
  const mapping: Record<string, string> = {
    'google_ads': 'online',
    'facebook_ads': 'social_media',
    'instagram': 'social_media',
    'door_knocking': 'canvassing',
    'yard_sign': 'advertisement',
    'direct_mail': 'advertisement',
  };
  return mapping[value] || 'other';
}

const pipelineData = {
  ...
  source: mapLeadSource(body.leadSource),  // Correct column + enum value
  ...
};
```

The original `leadSource` value (whether UUID or string) is preserved in `metadata.lead_source_id` for detailed tracking.

