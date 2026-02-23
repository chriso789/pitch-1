

# Support Multiple Photos Per Inspection Step

## Problem

Currently each inspection step stores a single `photoUrl: string | null`. Field reps often need to capture multiple angles of the same area (e.g., multiple downspouts, several windows, damage from different views).

## Data Model Change

Change `StepData.photoUrl` from `string | null` to `photoUrls: string[]` (an array). Keep backward compatibility by also checking for the old `photoUrl` field when loading existing inspections from the database.

## Changes by File

### 1. `src/components/inspection/InspectionStepCard.tsx`

- Update `StepData` interface: replace `photoUrl: string | null` with `photoUrls: string[]`
- Photo area: show a scrollable horizontal row of thumbnail images when photos exist
- Each thumbnail gets a small "X" button to remove it
- Always show the "Add Photo" button below the thumbnails (not just when empty)
- Show photo count badge (e.g., "3 photos")

### 2. `src/components/inspection/InspectionWalkthrough.tsx`

- Update `StepData` interface to use `photoUrls: string[]`
- `initStepsData`: set `photoUrls: []` instead of `photoUrl: null`
- `uploadFile`: push new URL into the array instead of replacing
- `upsertInspection`: same array-based logic
- Progress calculation: check `s.photoUrls.length > 0` instead of `s.photoUrl`
- Completion: a step is "completed" when it has at least one photo

### 3. `src/components/inspection/InspectionSummary.tsx`

- Update `StepData` interface to use `photoUrls: string[]`
- `completedCount`: check `s.photoUrls.length > 0`
- Thumbnail display: show first photo from array, with "+N" badge if more exist

### 4. `src/components/inspection/useInspectionReportPDF.ts`

- Update `StepData` interface to use `photoUrls: string[]`
- `completedCount`/`skippedCount`: use array length checks
- Photo embedding: embed ALL photos for each step (lay them out side by side or stacked, 2 per row)
- Adjust page break logic to account for multiple photos per step

### 5. `src/components/inspection/InspectionHistory.tsx`

- Backward compatibility: when loading `steps_data` from DB, normalize old `photoUrl` field into `photoUrls` array

## UI Layout for Multiple Photos

```
Step 6 of 11
Downspouts
Photograph downspouts from top to bottom.

[Guidance bullets]

+--------+ +--------+ +--------+
| photo1 | | photo2 | | photo3 |  <-- horizontal scroll
+--------+ +--------+ +--------+
         [ + Add Photo ]           <-- always visible

[Notes textarea]
```

Each photo thumbnail is ~80px square with a delete "X" button on hover/tap. The "Add Photo" button is always available so the user can keep adding.

## Backward Compatibility

When reading `steps_data` from the database, normalize with:
```typescript
// If old format with photoUrl string, convert to array
const photoUrls = step.photoUrls || (step.photoUrl ? [step.photoUrl] : []);
```

This ensures existing completed inspections still render correctly.

## Files to Modify

| File | Change |
|------|--------|
| `src/components/inspection/InspectionStepCard.tsx` | Multi-photo UI with thumbnails + add button |
| `src/components/inspection/InspectionWalkthrough.tsx` | Array-based photo storage and upload logic |
| `src/components/inspection/InspectionSummary.tsx` | Array-aware summary display |
| `src/components/inspection/useInspectionReportPDF.ts` | Embed all photos per step in PDF |
| `src/components/inspection/InspectionHistory.tsx` | Backward compat normalization |

