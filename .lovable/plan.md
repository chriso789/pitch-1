

# Fix: Auto-Pull All Free Public Data and Conditionally Show BatchData Button

## What's Wrong

1. **`handlePublicLookup` only extracts `owner_name`** -- The `storm-public-lookup` edge function returns parcel_id, assessed_value, year_built, living_sqft, homestead, lot_size, land_use, and confidence_score, but the frontend callback (lines 134-149) only reads `owner_name`. All other fields are thrown away.

2. **UI reads from `property.property_data` instead of `localProperty`** -- The property detail badges (parcel ID, sqft, year built, homestead) on lines 683-706 read from `property.property_data`, which is the raw database prop passed from the parent. After `handlePublicLookup` completes, the new data is only in `localProperty` but the UI doesn't reference it for those fields.

3. **"Get Contact Info" button always visible** -- It should only show when the free public lookup didn't find contact data (no phones/emails from public sources), as a fallback to trigger the paid BatchData skip-trace.

## Fix Plan

### File: `src/components/storm-canvass/PropertyInfoPanel.tsx`

**Change 1: Extract all public fields in `handlePublicLookup`**

After the `storm-public-lookup` call returns, merge ALL pipeline fields into `localProperty`:
- `owner_name`, `parcel_id`, `assessed_value`, `year_built`, `living_sqft`, `lot_size`, `land_use`, `homestead`, `confidence_score`, `owner_mailing_address`
- Also merge `property_data` object so the UI badges work from `localProperty`

Update lines ~134-149 to:
```typescript
const enrichedFields: Record<string, any> = {};
if (validOwner(pipelineResult?.owner_name)) {
  enrichedFields.owner_name = validOwner(pipelineResult.owner_name);
}
// Build property_data from pipeline
enrichedFields.property_data = {
  ...prev.property_data,
  parcel_id: pipelineResult?.parcel_id || prev.property_data?.parcel_id,
  assessed_value: pipelineResult?.assessed_value || prev.property_data?.assessed_value,
  year_built: pipelineResult?.year_built || prev.property_data?.year_built,
  living_sqft: pipelineResult?.living_sqft || prev.property_data?.living_sqft,
  homestead: pipelineResult?.homestead ?? prev.property_data?.homestead,
  lot_size: pipelineResult?.lot_size || prev.property_data?.lot_size,
  land_use: pipelineResult?.land_use || prev.property_data?.land_use,
  confidence_score: pipelineResult?.confidence_score || prev.property_data?.confidence_score,
  sources: Object.keys(pipelineResult?.sources || {}).filter(k => pipelineResult.sources[k]),
};
setLocalProperty(prev => ({ ...prev, ...enrichedFields }));
```

**Change 2: UI reads from `localProperty` instead of `property`**

Update lines 664-706 to reference `localProperty.property_data` instead of `property.property_data` for:
- Confidence badge
- Parcel ID, sqft, year built, homestead badges
- Sources verification

**Change 3: Conditionally show "Get Contact Info" button**

Only show the BatchData button when:
- Public lookup is done AND no phone numbers or emails were found from public data
- OR when the user has no owner_name (total failure)

Replace the always-visible button (line 762-777) with conditional rendering: show "Get Contact Info" only when `publicLookupDoneRef.current === property.id && phoneNumbers.length === 0 && emails.length === 0`.

During public lookup loading, show a "Loading property data..." indicator instead.

### No Edge Function Changes

The `storm-public-lookup` function already returns all the fields. The FL county registry and ArcGIS adapters (with suffix normalization) are already deployed. The issue is purely frontend -- the data comes back but gets ignored.

## Files to Update

| File | Change |
|------|--------|
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | Extract all pipeline fields in handlePublicLookup; read from localProperty in UI; conditionally show BatchData button |

