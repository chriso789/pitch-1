
# Plan: Fix Diagram Source and Manual Measurement Perimeter Saving

## Problem Summary

You have identified two distinct issues:

1. **Diagram shows "Rectangular Estimate" warning** - The schematic diagram is built from rectangular bounding box fallback data instead of accurate AI-detected geometry
2. **Manual Entry perimeter not saved** - When using "Enter Manually", the perimeter (eaves + rakes) is not being saved to `measurement_approvals.saved_tags`, causing estimates to show "Perimeter: 0 ft"

---

## Issue 1: Diagram Built from Rectangular Fallback

### Root Cause
The `SchematicRoofDiagram` component checks `measurement?.footprint_source === 'solar_bbox_fallback'` and displays the warning banner. This happens when:
- The AI measurement system fails to get an accurate footprint from Mapbox, OSM, Microsoft Buildings, or Regrid
- The system falls back to the Google Solar API bounding box (a simple rectangle)
- The diagram still has AI-detected linear features but they're constrained to a rectangular outline

### Current Behavior
- AI pulls measurement but gets `footprint_source: 'solar_bbox_fallback'`
- Diagram displays rectangle with warning "Rectangular Estimate - Import Report for Accuracy"
- Linear features (ridge, hip, eave) are calculated but may be less accurate

### Solution
The diagram warning is actually **correct** - when footprint_source is solar_bbox_fallback, the geometry IS rectangular and less accurate. The fix should focus on:

1. Improving footprint detection (already done with the base64 stack overflow fix)
2. Allow re-measuring after footprint source improvements take effect

**No diagram code changes needed** - the warning is appropriate for rectangular fallbacks.

---

## Issue 2: Manual Entry Not Saving Perimeter/Eave/Rake

### Root Cause
The `ManualMeasurementDialog` saves data to two places:

1. **`pipeline_entries.metadata`** (lines 196-217) - Correctly saves `eaves_lf`, `rakes_lf`
2. **`roof_measurements` table** (lines 251-286) - Correctly saves `total_eave_length`, `total_rake_length`

However, the **`measurement_approvals.saved_tags`** is NOT created during manual entry. The approval is only created when:
- Importing vendor reports (has perimeter tag)
- Saving from AI measurement history (missing eave/rake tags)

### Missing Flow
When user clicks "Save" in ManualMeasurementDialog:
1. Creates `roof_measurements` record
2. Does NOT create `measurement_approvals` record

The approval is only created later when user clicks "Save" on the measurement history card.

### Solution: Create Approval Automatically for Manual Entry

**File**: `src/components/estimates/ManualMeasurementDialog.tsx`

Add `measurement_approvals` record creation with proper tags including `lf.perimeter`, `lf.eave`, `lf.rake`:

```typescript
// After line 300 (after roof_measurements insert succeeds)
// Also create measurement_approval automatically so it appears in saved list

if (insertedMeasurement?.id) {
  const perimeter = formData.eaves + formData.rakes;
  
  const approvalTags = {
    'roof.plan_area': adjustedArea,
    'roof.total_sqft': adjustedArea,
    'roof.squares': adjustedArea / 100,
    'roof.predominant_pitch': formData.pitch,
    'lf.ridge': formData.ridges,
    'lf.hip': formData.hips,
    'lf.valley': formData.valleys,
    'lf.eave': formData.eaves,
    'lf.rake': formData.rakes,
    'lf.perimeter': perimeter,
    'lf.step': formData.stepFlashing,
    'source': 'manual_entry',
  };

  await supabase.from('measurement_approvals').insert({
    tenant_id: pipelineData.tenant_id,
    pipeline_entry_id: pipelineEntryId,
    approved_at: new Date().toISOString(),
    saved_tags: approvalTags,
    approval_notes: `Manual entry - ${adjustedArea.toLocaleString()} sqft`,
  });
}
```

---

## Issue 2B: AI Measurement Save Missing Eave/Rake

### Root Cause
In `UnifiedMeasurementPanel.tsx`, the `handleSaveAiMeasurement` function (lines 927-977) creates `savedTags` but misses:
- `lf.eave` - should come from `measurement.total_eave_length`
- `lf.rake` - should come from `measurement.total_rake_length`  
- `lf.perimeter` - should be `total_eave_length + total_rake_length`

### Solution: Add Missing Linear Features

**File**: `src/components/measurements/UnifiedMeasurementPanel.tsx`

Update `handleSaveAiMeasurement` function (around lines 940-951):

```typescript
const savedTags = {
  'roof.plan_area': measurement.total_area_adjusted_sqft || 0,
  'roof.total_sqft': measurement.total_area_adjusted_sqft || 0,
  'roof.squares': totalSquares,
  'roof.predominant_pitch': measurement.predominant_pitch || '6/12',
  'roof.faces_count': measurement.facet_count || 0,
  'lf.ridge': measurement.total_ridge_length || 0,
  'lf.hip': measurement.total_hip_length || 0,
  'lf.valley': measurement.total_valley_length || 0,
  // ADD THESE MISSING TAGS:
  'lf.eave': measurement.total_eave_length || 0,
  'lf.rake': measurement.total_rake_length || 0,
  'lf.perimeter': (measurement.total_eave_length || 0) + (measurement.total_rake_length || 0),
  'source': 'ai_pulled',
  'imported_at': measurement.created_at,
};
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/ManualMeasurementDialog.tsx` | Auto-create `measurement_approvals` record with full tags including perimeter |
| `src/components/measurements/UnifiedMeasurementPanel.tsx` | Add `lf.eave`, `lf.rake`, `lf.perimeter` to `handleSaveAiMeasurement` |

---

## Technical Details

### ManualMeasurementDialog Changes

1. Get `tenant_id` from pipeline entry (already fetched at line 178)
2. After successful `roof_measurements` insert (line 283-300), add approval insert
3. Include all linear feature tags with proper naming:
   - `lf.ridge`, `lf.hip`, `lf.valley`, `lf.eave`, `lf.rake`, `lf.perimeter`, `lf.step`

### UnifiedMeasurementPanel Changes

1. Update `handleSaveAiMeasurement` function to include eave/rake/perimeter
2. These values come from `roof_measurements` table columns:
   - `total_eave_length` -> `lf.eave`
   - `total_rake_length` -> `lf.rake`
   - Sum of both -> `lf.perimeter`

---

## Expected Results After Implementation

1. **Manual Entry**: 
   - Clicking "Save Measurements" in manual dialog will create both `roof_measurements` AND `measurement_approvals`
   - The saved measurement will show correct Perimeter, Eave, and Rake values
   - Estimate templates will have access to `lf.perimeter` for drip edge calculations

2. **AI Measurement Save**:
   - Clicking "Save" on AI measurement history card will include all linear features
   - Perimeter will calculate correctly from eave + rake

3. **Estimate Accuracy**:
   - Formulas like `{{ ceil(lf.perimeter / 10) }}` for drip edge will evaluate correctly
   - No more "0 ft" for perimeter in measurement cards

---

## Note on Diagram Warning

The "Rectangular Estimate - Import Report for Accuracy" warning will continue to show for measurements that used `solar_bbox_fallback` footprint source. This is **intentional** - these measurements genuinely have less accurate geometry. The warning encourages:

1. Re-measuring with the newly fixed AI detection (base64 fix applied earlier)
2. Importing a vendor report with verified footprint
3. Manually drawing the footprint using the "Draw Footprint" tool

The warning will disappear when measurements have a proper footprint source like `mapbox_vector`, `osm_overpass`, or `ai_detection`.
