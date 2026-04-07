

# Add "View Full Report" to AI Measurement Card

## Problem
The `MeasurementReportDialog` (which renders `ComprehensiveMeasurementReport` with roof diagram, facet breakdown, linear features, and export options) exists but is never opened from the `UnifiedMeasurementPanel`. After AI measurement completes, the user only sees a summary card with "Save to Estimates" — no way to view the detailed measurement report.

## Changes

### 1. Add "View Report" button to the AI measurement card
**File: `src/components/measurements/UnifiedMeasurementPanel.tsx`**
- Import `MeasurementReportDialog`.
- Add state: `const [showReport, setShowReport] = useState(false)`.
- Add a "View Report" button next to the existing "Save to Estimates" button inside the `latestUnapprovedAI` card (around line 703).
- Transform the AI measurement data into the `MeasurementData` shape that `ComprehensiveMeasurementReport` expects (`summary`, `linear_features`, `faces`, `center_lat`, `center_lng`, etc.).
- Render `<MeasurementReportDialog>` with the transformed data.

### 2. Also add "View Report" to saved MeasurementCards
- When a saved measurement exists (the `activeMeasurement` or items in `otherMeasurements`), add a report icon button on the `MeasurementCard` that opens the same dialog for that measurement's data.

## Technical Details
- The `ComprehensiveMeasurementReport` expects a `measurement` prop with shape `{ id, property_id, summary: { total_area_sqft, ridge_ft, hip_ft, ... }, linear_features, faces, center_lat, center_lng }`.
- The AI measurement from `roof_measurements` stores these as flat columns (`total_area_adjusted_sqft`, `total_ridge_length`, etc.) — a simple mapping object bridges the two.
- The `diagramTags` already constructed in the card can be passed as `tags`.
- Two buttons in a flex row: "View Report" (outline) and "Save to Estimates" (primary).

