
# Inspection Walkthrough Feature

## Overview

A guided, step-by-step photo inspection flow that walks reps through documenting every critical part of a property. Accessible from both Lead Details and Storm Canvass. Each step requires a photo + notes, and the completed inspection is saved to a new `inspections` table.

## New Database Table

Create an `inspections` table to store completed walkthrough results:

```sql
CREATE TABLE inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  lead_id UUID REFERENCES pipeline_entries(id),
  canvass_property_id UUID,
  inspected_by UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress, completed
  steps_data JSONB NOT NULL DEFAULT '[]',       -- array of {step_id, title, photo_url, notes, completed_at}
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
-- RLS: users can manage inspections within their tenant
CREATE POLICY "tenant_access" ON inspections
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
```

## Inspection Steps (11 total)

| # | ID | Title | Description |
|---|-----|-------|-------------|
| 1 | front | Front of House | Photograph the full front elevation. Ensure the entire facade is visible including roof line, fascia, and entry. |
| 2 | left_side | Left Side | Stand at the front-left corner and capture the full left side wall, eave, and any visible roof planes. |
| 3 | right_side | Right Side | Same as left, from the front-right corner. Note any AC units, meters, or obstructions. |
| 4 | rear | Rear of House | Capture the full back elevation. Include patio covers, rear roof slopes, and any additions. |
| 5 | gutters | Gutters (Soft Metals) | Close-up of gutters. Look for dents, dings, or bent sections caused by hail or wind debris. |
| 6 | downspouts | Downspouts | Photograph downspouts from top to bottom. Look for dents, kinks, or detachment from the wall. |
| 7 | window_wraps | Window Wraps / Trim | Close-up of window trim and wraps. Look for dents, cracks, or chipped paint from impact. |
| 8 | window_screens | Window Screens | Photograph window screens. Look for tears, holes, or bent frames from hail or debris. |
| 9 | siding | Siding | Capture siding sections. Look for cracks, chips, hail splatter marks, or loose panels. |
| 10 | roof | Roof | Photograph ridge cap, vents, pipe jacks, valleys, and any penetrations. Note missing or damaged shingles. |
| 11 | additional | Additional / Misc Damage | Capture any other damage not covered above. Use notes to describe what you're documenting. |

## New Files

### 1. `src/components/inspection/InspectionWalkthrough.tsx`

The main walkthrough component. Renders as a full-screen dialog.

**Props:**
- `open` / `onOpenChange` -- dialog control
- `leadId?` -- when opened from Lead Details (uses `customer-photos` bucket + `customer_photos` table)
- `contactId?` -- optional contact association
- `canvassPropertyId?` / `propertyAddress?` / `userLocation?` -- when opened from Storm Canvass (uses `canvass-photos` bucket + `canvass_activity_log`)

**State:**
- `currentStepIndex` -- which step the user is on (0-10)
- `stepsData` -- array of `{ stepId, photoUrl, notes, completedAt }` for each step
- `inspectionId` -- UUID of the `inspections` row (created on first photo)
- `showCamera` -- whether the camera capture UI is visible
- `showSummary` -- true when all steps done, shows review screen

**Flow per step:**
1. Show step title + description with bullet-point guidance
2. Show progress bar ("Step 3 of 11")
3. "Take Photo" button opens inline camera (reuses `CanvassPhotoCapture` logic for camera access, or file picker on desktop)
4. After capture, show thumbnail + notes textarea
5. "Next" button (disabled until photo uploaded) advances to next step
6. "Skip" option available (marks step as skipped)
7. "Back" button to revisit previous steps

**Photo upload logic:**
- If `leadId` is provided: upload to `customer-photos` bucket at path `{tenantId}/leads/{leadId}/{timestamp}.jpg`, insert into `customer_photos` table with `category: 'inspection'`
- If `canvassPropertyId` is provided: upload to `canvass-photos` bucket at path `{tenantId}/{propertyId}/{timestamp}.jpg`, log to `canvass_activity_log`

**Summary screen:**
- Grid of thumbnails with step title and notes
- Tap any step to retake photo or edit notes
- "Finish Inspection" button updates the `inspections` row with `status: 'completed'` and `completed_at`

### 2. `src/components/inspection/inspectionSteps.ts`

Constants file defining the 11 steps with `id`, `title`, `description`, and `guidance` bullet points.

### 3. `src/components/inspection/InspectionStepCard.tsx`

Single step display component: shows the title, description, photo thumbnail (or capture button), and notes input.

### 4. `src/components/inspection/InspectionSummary.tsx`

Review screen showing all captured photos in a grid with notes, plus the "Finish Inspection" button.

## Integration Points

### Lead Details (`src/pages/LeadDetails.tsx`)

Add an "Inspection" button in the Photos tab content area (line ~1158), above or alongside the `PhotoControlCenter`:

```tsx
<Button onClick={() => setShowInspection(true)} variant="outline" size="sm">
  <Camera className="h-4 w-4 mr-2" />
  Start Inspection
</Button>
```

Render `InspectionWalkthrough` as a sibling dialog (per dialog management standards), passing `leadId={id}` and `contactId={lead.contact?.id}`.

### Storm Canvass (`src/components/storm-canvass/PropertyInfoPanel.tsx`)

Add a new tool button in the Tools grid (line ~996, after the "Strategy" button):

```tsx
<Button variant="outline" size="sm" className="flex-col h-16 p-2"
  onClick={() => setShowInspection(true)}>
  <Camera className="h-5 w-5 mb-1 text-teal-500" />
  <span className="text-[10px]">Inspection</span>
</Button>
```

Render `InspectionWalkthrough` passing `canvassPropertyId={property.id}`, `propertyAddress`, and `userLocation`.

## Technical Details

- Photos are captured using the device camera via `navigator.mediaDevices.getUserMedia` (same pattern as `CanvassPhotoCapture`)
- GPS coordinates are captured automatically when available
- Timestamp overlay is burned into photos (same as `CanvassPhotoCapture`)
- Storage paths follow the `{tenantId}/...` convention required by RLS policies
- The `inspections.steps_data` JSONB column stores the full walkthrough state, making it easy to generate reports later
- Progress is saved incrementally -- if the rep closes the walkthrough mid-way, the `inspections` row retains all completed steps
