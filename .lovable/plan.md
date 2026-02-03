

# Fix Lead Creation Roof Type Enum Mismatch

## Problem Identified

The "Create Lead" button fails with:
```
invalid input value for enum roof_type: "asphalt_shingle"
```

**Root Cause:** The `LeadCreationDialog.tsx` component has roof type options that don't match the database enum.

## Database vs UI Comparison

| Database Enum Values | LeadCreationDialog Values (WRONG) |
|---------------------|-----------------------------------|
| `shingle` | `asphalt_shingle` |
| `metal` | `metal` |
| `tile` | `tile` |
| `flat` | `flat_membrane` |
| `slate` | `slate` |
| `cedar` | `wood_shake` |
| `other` | (missing) |

The `EditProjectDetailsDialog.tsx` already has the correct values - they just need to match.

---

## Solution

Update the `roofTypes` array in `LeadCreationDialog.tsx` (lines 106-113) to match the database enum values:

```typescript
// BEFORE (lines 106-113):
const roofTypes = [
  { value: "asphalt_shingle", label: "Asphalt Shingle" },
  { value: "metal", label: "Metal Roofing" },
  { value: "tile", label: "Tile (Clay/Concrete)" },
  { value: "slate", label: "Slate" },
  { value: "wood_shake", label: "Wood Shake/Shingle" },
  { value: "flat_membrane", label: "Flat/Membrane" },
];

// AFTER (matching database enum):
const roofTypes = [
  { value: "shingle", label: "Asphalt Shingle" },
  { value: "metal", label: "Metal" },
  { value: "tile", label: "Tile" },
  { value: "flat", label: "Flat/Membrane" },
  { value: "slate", label: "Slate" },
  { value: "cedar", label: "Cedar/Wood Shake" },
  { value: "other", label: "Other" },
];
```

---

## File to Modify

| File | Change |
|------|--------|
| `src/components/LeadCreationDialog.tsx` | Update roofTypes array values to match database enum (lines 106-113) |

---

## Expected Result

After this fix:
- Lead creation will succeed when a roof type is selected
- The values sent to the database will be valid enum values
- The UI labels remain user-friendly while the stored values match the database schema

