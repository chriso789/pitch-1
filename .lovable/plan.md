

# Inspection Walkthrough Configuration Settings

## Overview

Build an admin settings panel where company owners can customize the inspection walkthrough steps -- reorder them, edit titles/descriptions/guidance, add new steps, remove steps, and mark steps as **mandatory** (requiring at least one photo before the rep can proceed or finish).

Currently, the 11 inspection steps are hardcoded in `src/components/inspection/inspectionSteps.ts`. This plan moves that configuration to the database per-tenant, with a settings UI for management and a hook that loads the tenant's config at runtime.

---

## Database

### New table: `inspection_step_configs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID FK → tenants | |
| `step_key` | TEXT | Unique per tenant (e.g. `front`, `gutters`, `custom_1`) |
| `title` | TEXT NOT NULL | |
| `description` | TEXT | |
| `guidance` | TEXT[] | Array of guidance bullets |
| `is_required` | BOOLEAN DEFAULT false | If true, rep must take at least 1 photo |
| `min_photos` | INTEGER DEFAULT 0 | Minimum photo count (0 = optional) |
| `order_index` | INTEGER | Sort order |
| `is_active` | BOOLEAN DEFAULT true | Soft delete |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

- RLS: tenant-scoped read/write for admin roles (owner, corporate, office_admin)
- On first load for a tenant with no config rows, the system seeds the 11 default steps

### Settings tab registration

Insert a row into `settings_tabs` for the new "Inspections" tab under the "business" category, restricted to owner/corporate/office_admin roles.

---

## Frontend Components

### 1. `InspectionWalkthroughSettings.tsx` (new)

Settings panel rendered under the new "Inspections" settings tab. Features:

- **Step list** with drag-and-drop reordering (using existing `@dnd-kit` dependency)
- Each step card shows: title, description, required badge, min photos count
- **Edit dialog** per step: title, description, guidance bullets (add/remove), toggle required, set min photos
- **Add step** button to create custom steps
- **Delete/deactivate** step (with confirmation; cannot delete if it's the only active step)
- **Reset to defaults** button that re-seeds the 11 standard steps
- Auto-saves order changes on drag-drop; form saves on confirm

### 2. `useInspectionConfig.ts` hook (new)

```typescript
// Returns tenant-specific steps sorted by order_index
// Falls back to hardcoded INSPECTION_STEPS if no config exists
// Caches with React Query
```

### 3. Modifications to existing inspection components

| File | Change |
|------|--------|
| `InspectionWalkthrough.tsx` | Use `useInspectionConfig()` instead of `INSPECTION_STEPS`; enforce `is_required` -- block skip on required steps, block finish if required steps have fewer photos than `min_photos` |
| `InspectionStepCard.tsx` | Show "Required" badge on mandatory steps; show minimum photo count hint |
| `InspectionSummary.tsx` | Use dynamic steps from hook; show warning on required steps missing photos; disable "Finish" until all required steps are satisfied |
| `useInspectionReportPDF.ts` | Use dynamic steps from hook instead of hardcoded array |
| `Settings.tsx` | Add case for `"inspections"` tab rendering `InspectionWalkthroughSettings` |

### 4. Settings tab category mapping

Add `inspections: "business"` to `TAB_TO_CATEGORY` in `Settings.tsx`.

---

## Enforcement Logic

When a step has `is_required: true`:
- The **Skip** button is hidden or disabled with tooltip "This step is required"
- The **Finish Inspection** button checks all required steps have `photoUrls.length >= min_photos` (minimum 1 if `min_photos` is 0 but `is_required` is true)
- A validation toast lists which required steps are incomplete

---

## Technical Details

- Drag-and-drop uses `@dnd-kit/core` and `@dnd-kit/sortable` (already installed)
- Default seeding happens client-side: if the query returns 0 rows for the tenant, insert the 11 defaults via a single batch insert
- The hardcoded `INSPECTION_STEPS` array remains as the fallback/seed source -- no existing behavior breaks if a tenant hasn't configured their steps yet
- React Query key: `['inspection-config', tenantId]` with a 5-minute stale time

