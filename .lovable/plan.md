

# Remove "Create Estimate" Button from Measurement Panel

## What
Remove the `QuickEstimateButton` from the `UnifiedMeasurementPanel` header, as shown in the user's screenshot.

## Changes

### `src/components/measurements/UnifiedMeasurementPanel.tsx`
- Remove the `QuickEstimateButton` import (line 26)
- Remove the `<QuickEstimateButton>` JSX usage (lines 483-486)

### Optional cleanup
- Delete `src/components/measurements/QuickEstimateButton.tsx` entirely since it will no longer be used

