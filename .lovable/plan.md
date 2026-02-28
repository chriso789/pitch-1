

# Add Edit Capability to Saved Manual Measurements

## Problem
After saving a manual measurement, there's no way to fix typos or errors. Users must delete and re-enter the entire measurement.

## Changes

### `src/components/measurements/UnifiedMeasurementPanel.tsx`

**MeasurementCard component** — Add an "Edit" button (Pencil icon) that only appears for `manual_entry` source measurements:
- When clicked, opens a pre-filled `ManualMeasurementDialog` in "edit mode"
- Pass the existing `saved_tags` values as initial form data
- Pass the `approvalId` so the save logic updates instead of inserting

**MeasurementCard props** — Add `onEdit` callback, `isManual` boolean derived from `tags.source === 'manual_entry'`

### `src/components/estimates/ManualMeasurementDialog.tsx`

Add edit mode support:
- **New optional props**: `editMode?: boolean`, `approvalId?: string`, `initialValues?: MeasurementFormData`
- When `initialValues` is provided, pre-fill the form with those values on open
- When `editMode` is true and `approvalId` is set, the save handler **updates** the existing `measurement_approvals` row (`saved_tags`, `approval_notes`) and the corresponding `pipeline_entries` metadata instead of inserting new records
- Dialog title changes to "Edit Measurement" in edit mode
- The existing `roof_measurements` record does NOT need updating (it's historical); only the `measurement_approvals.saved_tags` and pipeline metadata are updated

### `src/components/estimates/ManualMeasurementButton.tsx`

No changes needed — the MeasurementCard will open the dialog directly.

## Flow
1. User sees saved measurement card with an Edit (pencil) button
2. Clicks Edit → ManualMeasurementDialog opens pre-filled with current values
3. User corrects the typo → clicks Save
4. Dialog updates `measurement_approvals.saved_tags` + `pipeline_entries.metadata` in place
5. Cache invalidated, card refreshes with corrected values

