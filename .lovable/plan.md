

# Add Flat Section to Manual Measurement Entry

## What

Add a "Flat Sections" area input to the manual measurement dialog, allowing users to enter separate flat (0/12 pitch) square footage alongside the pitched area. The flat area will be tracked independently and included in the saved measurement data and material calculations.

## Changes

### `src/components/estimates/ManualMeasurementDialog.tsx`

1. **Extend `MeasurementFormData` interface** — Add `flatSectionArea: number` field (default `0`)

2. **Update `defaultFormData`** — Include `flatSectionArea: 0`

3. **Add "Flat Sections" input group** — Insert a new section after the Pitch selector (before the Linear Measurements separator) with:
   - A label "Flat Sections (0/12)" with an icon
   - A numeric input for flat section square footage
   - Helper text: "Enter area of any flat/low-slope sections (no pitch multiplier applied)"

4. **Update `getAdjustedArea()`** — Add `flatSectionArea` to the total adjusted area (flat sections use 1.0x multiplier, so added as-is)

5. **Update `getFlatArea()`** — Include flat section area in the flat total

6. **Update save payloads** (both create and edit modes):
   - Add `flat_section_sqft` to `comprehensive_measurements` and `saved_tags`
   - Ensure total area includes the flat section contribution

7. **Update Calculated Summary** — Show a "Flat Section" line if `flatSectionArea > 0`

8. **Update Material Preview calculation** — Include flat section area in the total passed to `calculateMaterialQuantities`

