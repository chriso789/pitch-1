
# Plan: Add Pitch Adjustment at Location Verification (Single Roof Pitch)

## Overview

This plan adds a pitch selector to the `StructureSelectionMap` dialog (the PIN placement step) so users can set the predominant pitch **before** the AI measurement runs. The selected pitch will be passed to the `analyze-roof-aerial` edge function and used as an override for all calculations.

## Current Flow (Problem)

```text
User clicks "AI Measurements" 
    → StructureSelectionMap opens (PIN placement)
    → User confirms location
    → analyze-roof-aerial runs (pitch is auto-detected from Solar API)
    → Report shows pitch (NOT EDITABLE)
```

The pitch shown in your screenshot (7/12) comes from the Solar API or AI detection and cannot be changed after the measurement is complete.

## Proposed Flow (Solution)

```text
User clicks "AI Measurements"
    → StructureSelectionMap opens (PIN placement + PITCH SELECTOR)
    → User sets pitch (default: 6/12 or Solar-detected if available)
    → User confirms location
    → analyze-roof-aerial runs WITH pitchOverride parameter
    → System uses override pitch for all area calculations
    → Report shows user-selected pitch
```

---

## Technical Implementation

### Phase 1: Update StructureSelectionMap Component

**File**: `src/components/measurements/StructureSelectionMap.tsx`

**Changes**:
1. Add pitch state: `const [selectedPitch, setSelectedPitch] = useState<string>('6/12');`
2. Add pitch options constant
3. Add Select dropdown in the dialog UI (above map or in footer)
4. Update `onLocationConfirmed` callback signature to include pitch
5. Update `handleConfirm` to pass pitch to parent

**New Props Interface**:
```typescript
interface StructureSelectionMapProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLat: number;
  initialLng: number;
  address?: string;
  onLocationConfirmed: (lat: number, lng: number, pitchOverride?: string) => void;
  defaultPitch?: string; // Optional: pre-fill from previous measurement
}
```

**UI Addition** (in DialogHeader or footer):
```tsx
<div className="flex items-center gap-2 mt-2">
  <Label className="text-xs">Roof Pitch:</Label>
  <Select value={selectedPitch} onValueChange={setSelectedPitch}>
    <SelectTrigger className="w-24 h-8">
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="bg-background z-50">
      {PITCH_OPTIONS.map(p => (
        <SelectItem key={p} value={p}>{p}</SelectItem>
      ))}
    </SelectContent>
  </Select>
  <span className="text-xs text-muted-foreground">(affects area calculation)</span>
</div>
```

**Pitch Options**:
```typescript
const PITCH_OPTIONS = [
  '0/12', '1/12', '2/12', '3/12', '4/12', '5/12', '6/12', 
  '7/12', '8/12', '9/12', '10/12', '11/12', '12/12',
  '14/12', '16/12', '18/12'
];
```

---

### Phase 2: Update PullMeasurementsButton to Pass Pitch

**File**: `src/components/measurements/PullMeasurementsButton.tsx`

**Changes**:
1. Update `handleStructureConfirmed` to accept pitch parameter
2. Pass pitch to `handlePull` function
3. Include `pitchOverride` in the edge function request body

**Current Code** (lines 573-577):
```typescript
const handleStructureConfirmed = (lat: number, lng: number) => {
  setShowStructureSelector(false);
  handlePull(lat, lng);
};
```

**Updated Code**:
```typescript
const handleStructureConfirmed = (lat: number, lng: number, pitchOverride?: string) => {
  setShowStructureSelector(false);
  handlePull(lat, lng, pitchOverride);
};
```

**Update handlePull signature** (line 219):
```typescript
async function handlePull(confirmedLat: number, confirmedLng: number, pitchOverride?: string) {
```

**Update edge function call** (lines 265-273):
```typescript
const { data, error } = await supabase.functions.invoke('analyze-roof-aerial', {
  body: {
    address: address || 'Unknown Address',
    coordinates: { lat: pullLat, lng: pullLng },
    customerId: propertyId,
    userId: user?.id,
    pitchOverride: pitchOverride || undefined // NEW: Pass pitch override
  }
});
```

---

### Phase 3: Update analyze-roof-aerial Edge Function

**File**: `supabase/functions/analyze-roof-aerial/index.ts`

**Changes**:
1. Extract `pitchOverride` from request body
2. Use it in slope factor calculations instead of Solar-detected pitch
3. Store it in the database as `predominant_pitch`

**Request Handler** (around line 162):
```typescript
const { address, coordinates, customerId, userId, forceFullAnalysis, pitchOverride } = await req.json();

if (pitchOverride) {
  console.log(`📐 Using manual pitch override: ${pitchOverride}`);
}
```

**Calculation Usage** (multiple locations):
When calculating `totalAdjustedArea`, use:
```typescript
const effectivePitch = pitchOverride || solarDerivedPitch || '6/12';
const slopeFactor = getSlopeFactorFromPitch(effectivePitch);
const adjustedArea = flatArea * slopeFactor;
```

**Database Save** (line 3936):
```typescript
predominant_pitch: pitchOverride || measurements.predominantPitch,
```

---

### Phase 4: Update unified-measurement-pipeline (Optional Enhancement)

**File**: `supabase/functions/_shared/unified-measurement-pipeline.ts`

The new unified pipeline already supports `pitchOverride` in `UnifiedMeasurementRequest`. Ensure it flows through to area calculations:

```typescript
// Line 272 already handles this:
const effectivePitch = request.pitchOverride || 
  (solarData?.available ? getPredominantPitchFromSolar(solarData) : '6/12');
```

No changes needed here - already implemented.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/measurements/StructureSelectionMap.tsx` | Add pitch selector UI, update props/callback |
| `src/components/measurements/PullMeasurementsButton.tsx` | Pass pitch through handlePull to edge function |
| `supabase/functions/analyze-roof-aerial/index.ts` | Accept and use `pitchOverride` parameter |

---

## UI/UX Details

### Pitch Selector Placement
The pitch dropdown will be placed in the dialog header area of `StructureSelectionMap`, below the address and above the map. This keeps it visible while the user positions the PIN.

### Visual Design
- Label: "Roof Pitch:"
- Dropdown with values from 0/12 to 18/12
- Helper text: "(affects area calculation)"
- Default value: 6/12 (industry standard for residential)

### User Flow
1. User clicks "AI Measurements"
2. Structure Selection Map opens
3. User sees pitch dropdown with default 6/12
4. User can change pitch if they know it (e.g., from permit or existing report)
5. User drags PIN to roof center
6. User clicks "Confirm & Measure"
7. AI analysis runs with the selected pitch as override
8. Report shows the user-selected pitch value

---

## Edge Cases Handled

1. **No pitch selected**: Uses 6/12 default
2. **Solar API provides pitch**: User selection overrides Solar data
3. **Invalid pitch format**: Validation in Select options prevents this
4. **Existing measurements**: If re-measuring, could pre-fill with previous pitch (optional enhancement)

---

## Testing Verification

After implementation:
1. Open a lead page
2. Click "AI Measurements" 
3. Verify pitch dropdown appears in the Structure Selection Map dialog
4. Select a specific pitch (e.g., 10/12)
5. Confirm location
6. Verify the resulting report shows the selected pitch (10/12)
7. Verify the area calculation uses the correct slope factor for 10/12

---

## Expected Results

- Users can set pitch BEFORE measurement runs
- The system uses the user-specified pitch for all area calculations
- Reports display the user-selected pitch
- No more need to manually correct pitch after the fact
- Calculations are correct from the first measurement
